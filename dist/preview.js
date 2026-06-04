import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { execa } from "execa";
import { listProject } from "./wt.js";
import { clearPreview, loadAll, recordPreview } from "./state.js";
const TASK_PATH_POLL_MS = 250;
const TASK_PATH_TIMEOUT_MS = 8_000;
const PREVIEW_BOOT_TIMEOUT_MS = 12_000;
const PREVIEW_PROBE_MS = 250;
const PREVIEW_HOST = "127.0.0.1";
const STATIC_SERVER_SOURCE = String.raw `import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { promises as fs } from "node:fs";

const root = resolve(process.argv[1] ?? ".");
const port = Number(process.argv[2] ?? "0");

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".txt", "text/plain; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
]);

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const relative = pathname.startsWith("/") ? pathname.slice(1) : pathname;
    const filePath = resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    if (stat.isDirectory()) {
      const indexPath = join(filePath, "index.html");
      const indexStat = await fs.stat(indexPath).catch(() => null);
      if (indexStat?.isFile()) {
        await sendFile(indexPath, res);
        return;
      }
      const entries = await fs.readdir(filePath, { withFileTypes: true });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderListing(pathname, entries));
      return;
    }

    if (stat.isFile()) {
      await sendFile(filePath, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(err instanceof Error ? err.message : String(err));
  }
});

server.listen(port, PREVIEW_HOST, () => {
  process.stdout.write("static preview listening on http://" + PREVIEW_HOST + ":" + port + "\n");
});

async function sendFile(path, res) {
  const data = await fs.readFile(path);
  const type = mimeTypes.get(extname(path).toLowerCase()) ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  res.end(data);
}

function renderListing(pathname, entries) {
  const base = pathname.endsWith("/") ? pathname : pathname + "/";
  const links = entries
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const href = base + encodeURIComponent(entry.name) + (entry.isDirectory() ? "/" : "");
      return "<li><a href=\"" + href + "\">" + entry.name + (entry.isDirectory() ? "/" : "") + "</a></li>";
    })
    .join("");
  return "<!doctype html><html><head><meta charset=\"utf-8\"><title>Preview</title><style>body{font:14px/1.4 system-ui,sans-serif;margin:24px}ul{padding-left:20px}a{text-decoration:none}</style></head><body><h1>Directory listing</h1><ul>" + links + "</ul></body></html>";
}
`;
export async function openPreviewInBrowser(url) {
    await execa("open", [url], { reject: false });
}
export async function refreshTaskPreview(slug, cwd) {
    const records = await loadAll().catch(() => ({}));
    const existing = records[slug];
    if (!existing)
        return;
    if (existing.preview && isPreviewAlive(existing.preview))
        return;
    if (existing.preview) {
        await clearPreview(slug).catch(() => { });
    }
    const worktreePath = await waitForTaskPath(slug, cwd);
    if (!worktreePath)
        return;
    const plans = await detectPreviewPlans(worktreePath);
    for (const plan of plans) {
        const preview = await launchPreviewPlan(plan, worktreePath);
        if (!preview)
            continue;
        const current = await loadAll().catch(() => ({}));
        if (!current[slug]) {
            await stopPreview(preview).catch(() => { });
            return;
        }
        try {
            await recordPreview(slug, preview);
            return;
        }
        catch {
            await stopPreview(preview).catch(() => { });
        }
    }
}
export async function clearTaskPreview(slug, preview) {
    const currentPreview = preview ?? (await loadAll().catch(() => ({})))[slug]?.preview;
    if (currentPreview) {
        await stopPreview(currentPreview).catch(() => { });
    }
    await clearPreview(slug).catch(() => { });
}
export async function detectPreviewPlans(worktreePath) {
    const pkg = await readPackageJson(worktreePath);
    const plans = [];
    const pm = packageManagerFor(pkg);
    const scripts = pkg?.scripts ?? {};
    for (const scriptName of ["dev", "start", "preview", "serve"]) {
        if (typeof scripts[scriptName] !== "string")
            continue;
        plans.push({
            kind: "app",
            label: `${pm} run ${scriptName}`,
            packageManager: pm,
            scriptName,
        });
    }
    plans.push({
        kind: "static",
        label: "static preview",
    });
    return plans;
}
async function launchPreviewPlan(plan, worktreePath) {
    const port = await pickFreePort();
    if (plan.kind === "static") {
        return launchStaticPreview(worktreePath, port, plan.label);
    }
    if (!plan.scriptName || !plan.packageManager)
        return null;
    return launchAppPreview(worktreePath, port, plan);
}
async function launchAppPreview(worktreePath, port, plan) {
    const args = packageManagerRunArgs(plan.packageManager, plan.scriptName, port);
    const env = {
        ...process.env,
        HOST: PREVIEW_HOST,
        HOSTNAME: PREVIEW_HOST,
        PORT: String(port),
        BROWSER: "none",
        NODE_ENV: "development",
    };
    const child = spawn(plan.packageManager, args, {
        cwd: worktreePath,
        detached: true,
        env,
        stdio: "ignore",
    });
    child.once("error", () => { });
    if (!child.pid)
        return null;
    child.unref();
    const ready = await waitForPreviewReady(child.pid, port, PREVIEW_BOOT_TIMEOUT_MS);
    if (!ready) {
        await stopPreview({ pid: child.pid }).catch(() => { });
        return null;
    }
    return {
        url: `http://${PREVIEW_HOST}:${port}`,
        port,
        pid: child.pid,
        command: plan.label,
        kind: "app",
        startedAt: Date.now(),
    };
}
async function launchStaticPreview(worktreePath, port, label) {
    const child = spawn(process.execPath, ["--input-type=module", "-e", STATIC_SERVER_SOURCE, worktreePath, String(port)], {
        cwd: worktreePath,
        detached: true,
        stdio: "ignore",
    });
    child.once("error", () => { });
    if (!child.pid)
        return null;
    child.unref();
    const ready = await waitForPreviewReady(child.pid, port, PREVIEW_BOOT_TIMEOUT_MS);
    if (!ready) {
        await stopPreview({ pid: child.pid }).catch(() => { });
        return null;
    }
    return {
        url: `http://${PREVIEW_HOST}:${port}`,
        port,
        pid: child.pid,
        command: label,
        kind: "static",
        startedAt: Date.now(),
    };
}
async function waitForTaskPath(slug, cwd) {
    const deadline = Date.now() + TASK_PATH_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const project = await listProject({ cwd }).catch(() => null);
        const task = project?.tasks.find((entry) => entry.slug === slug);
        if (task?.path)
            return task.path;
        await sleep(TASK_PATH_POLL_MS);
    }
    return null;
}
async function readPackageJson(worktreePath) {
    try {
        const raw = await fs.readFile(join(worktreePath, "package.json"), "utf8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
    }
    catch {
        return null;
    }
}
function packageManagerFor(pkg) {
    const declared = pkg?.packageManager;
    if (declared?.startsWith("pnpm@"))
        return "pnpm";
    if (declared?.startsWith("yarn@"))
        return "yarn";
    if (declared?.startsWith("bun@"))
        return "bun";
    if (declared?.startsWith("npm@"))
        return "npm";
    return "npm";
}
function packageManagerRunArgs(packageManager, scriptName, port) {
    const extra = ["--host", PREVIEW_HOST, "--port", String(port)];
    switch (packageManager) {
        case "npm":
        case "pnpm":
        case "bun":
        case "yarn":
            return ["run", scriptName, "--", ...extra];
    }
}
async function pickFreePort() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const port = await new Promise((resolvePort, rejectPort) => {
            const server = net.createServer();
            server.unref();
            server.once("error", rejectPort);
            server.listen(0, PREVIEW_HOST, () => {
                const address = server.address();
                if (typeof address === "object" && address) {
                    const { port } = address;
                    server.close(() => resolvePort(port));
                    return;
                }
                server.close(() => rejectPort(new Error("Unable to allocate port")));
            });
        }).catch(() => -1);
        if (port > 0)
            return port;
    }
    throw new Error("Unable to allocate a free preview port");
}
async function waitForPreviewReady(pid, port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!isProcessAlive(pid))
            return false;
        if (await isPortOpen(port))
            return true;
        await sleep(PREVIEW_PROBE_MS);
    }
    return false;
}
async function isPortOpen(port) {
    return await new Promise((resolve) => {
        const socket = net.createConnection({ host: PREVIEW_HOST, port });
        const finish = (value) => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(value);
        };
        socket.once("connect", () => finish(true));
        socket.once("error", () => finish(false));
        socket.once("timeout", () => finish(false));
        socket.setTimeout(500);
    });
}
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
async function stopPreview(preview) {
    const pid = preview.pid;
    try {
        process.kill(-pid, "SIGTERM");
        return;
    }
    catch {
        try {
            process.kill(pid, "SIGTERM");
            return;
        }
        catch {
            /* ignore */
        }
    }
}
function isPreviewAlive(preview) {
    return isProcessAlive(preview.pid);
}
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
//# sourceMappingURL=preview.js.map