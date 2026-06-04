import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { listProject } from "./wt.js";
import { clearPreview, loadAll, recordPreview } from "./state.js";
const TASK_PATH_POLL_MS = 250;
const TASK_PATH_TIMEOUT_MS = 8_000;
const PREVIEW_BOOT_TIMEOUT_MS = 30_000;
const PREVIEW_PROBE_MS = 250;
const PREVIEW_HOST = "127.0.0.1";
const BASE_PREVIEW_PORT = 3000;
const MAX_PORT_SCAN = 100;
/** Matches the first localhost URL a dev server prints (vite, next, etc.). */
const SERVER_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::(\d+))?[^\s)'"]*/i;
const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;
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
    const plans = [];
    const pkg = await readPackageJson(worktreePath);
    const scripts = pkg?.scripts ?? {};
    if (Object.keys(scripts).length > 0) {
        const pm = await detectPackageManager(worktreePath, pkg);
        for (const scriptName of ["dev", "start", "preview", "serve"]) {
            if (typeof scripts[scriptName] !== "string")
                continue;
            plans.push({
                kind: "app",
                label: `${pm} run ${scriptName}`,
                command: pm,
                args: runScriptArgs(pm, scriptName),
            });
        }
    }
    const denoTasks = await readDenoTasks(worktreePath);
    if (denoTasks) {
        for (const taskName of ["dev", "start", "serve"]) {
            if (typeof denoTasks[taskName] === "undefined")
                continue;
            plans.push({
                kind: "app",
                label: `deno task ${taskName}`,
                command: "deno",
                args: ["task", taskName],
            });
        }
    }
    plans.push({
        kind: "static",
        label: "static preview",
    });
    return plans;
}
async function launchPreviewPlan(plan, worktreePath) {
    if (plan.kind === "static") {
        const port = await pickFreePort();
        return launchStaticPreview(worktreePath, port, plan.label);
    }
    return launchAppPreview(worktreePath, plan);
}
async function launchAppPreview(worktreePath, plan) {
    // Pre-allocate a port and pass it via PORT for frameworks that honour it
    // (Next.js, CRA, plain node servers). Vite and friends pick their own port
    // and print it instead — we parse that from the server's output. Whichever
    // becomes reachable first wins, so we never assume the wrong port.
    const port = await pickFreePort();
    const logPath = join(os.tmpdir(), `inklit-preview-${Date.now()}-${port}.log`);
    const handle = await fs.open(logPath, "w").catch(() => null);
    const env = {
        ...process.env,
        HOST: PREVIEW_HOST,
        HOSTNAME: PREVIEW_HOST,
        PORT: String(port),
        BROWSER: "none",
        NODE_ENV: "development",
    };
    const child = spawn(plan.command, plan.args, {
        cwd: worktreePath,
        detached: true,
        env,
        stdio: ["ignore", handle ? handle.fd : "ignore", handle ? handle.fd : "ignore"],
    });
    child.once("error", () => { });
    const pid = child.pid;
    // The child inherited a dup of the fd; close our copy so it isn't leaked.
    await handle?.close().catch(() => { });
    if (!pid) {
        await fs.rm(logPath, { force: true }).catch(() => { });
        return null;
    }
    child.unref();
    const found = await waitForAppUrl(pid, port, logPath, PREVIEW_BOOT_TIMEOUT_MS);
    await fs.rm(logPath, { force: true }).catch(() => { });
    if (!found) {
        await stopPreview({ pid }).catch(() => { });
        return null;
    }
    return {
        url: found.url,
        port: found.port,
        pid,
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
async function readDenoTasks(worktreePath) {
    for (const name of ["deno.json", "deno.jsonc"]) {
        try {
            const raw = await fs.readFile(join(worktreePath, name), "utf8");
            // Tolerate JSONC comments by stripping line/block comments before parse.
            const stripped = raw
                .replace(/\/\*[\s\S]*?\*\//g, "")
                .replace(/(^|[^:])\/\/.*$/gm, "$1");
            const parsed = JSON.parse(stripped);
            if (parsed?.tasks && typeof parsed.tasks === "object")
                return parsed.tasks;
            return {};
        }
        catch {
            continue;
        }
    }
    return null;
}
async function fileExists(path) {
    return fs
        .access(path)
        .then(() => true)
        .catch(() => false);
}
/**
 * Pick the package manager without the user specifying one: lockfiles are the
 * strongest signal, then the corepack `packageManager` field, then npm.
 */
async function detectPackageManager(worktreePath, pkg) {
    if (await fileExists(join(worktreePath, "pnpm-lock.yaml")))
        return "pnpm";
    if (await fileExists(join(worktreePath, "yarn.lock")))
        return "yarn";
    if ((await fileExists(join(worktreePath, "bun.lockb"))) ||
        (await fileExists(join(worktreePath, "bun.lock")))) {
        return "bun";
    }
    if (await fileExists(join(worktreePath, "package-lock.json")))
        return "npm";
    const declared = pkg?.packageManager;
    if (declared?.startsWith("pnpm@"))
        return "pnpm";
    if (declared?.startsWith("yarn@"))
        return "yarn";
    if (declared?.startsWith("bun@"))
        return "bun";
    return "npm";
}
function runScriptArgs(packageManager, scriptName) {
    // No forced --port/--host: compound scripts (e.g. "api & client") choke on
    // appended flags, and we read the real bound port from the server's output.
    switch (packageManager) {
        case "yarn":
            return [scriptName];
        case "bun":
        case "npm":
            return ["run", scriptName];
        case "pnpm":
            // Replit-style projects ship a `preinstall` guard that aborts unless run
            // by pnpm. pnpm 9+ auto-runs a deps check (`pnpm install`) before scripts
            // and that nested check trips the guard, killing the dev server before it
            // starts. Skip the pre-run verification so the script launches directly.
            return ["--config.verify-deps-before-run=false", "run", scriptName];
    }
}
/**
 * Wait for a dev server to become reachable. Returns as soon as either the
 * URL parsed from the server's log is accepting connections, or the
 * pre-allocated PORT we passed is. Null on process death or timeout.
 */
async function waitForAppUrl(pid, fallbackPort, logPath, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!isProcessAlive(pid))
            return null;
        const log = await fs.readFile(logPath, "utf8").catch(() => "");
        const match = log.replace(ANSI_RE, "").match(SERVER_URL_RE);
        if (match) {
            const parsedPort = match[1] ? Number(match[1]) : 80;
            if (parsedPort > 0 && (await isPortOpen(parsedPort))) {
                return { url: `http://${PREVIEW_HOST}:${parsedPort}`, port: parsedPort };
            }
        }
        if (await isPortOpen(fallbackPort)) {
            return { url: `http://${PREVIEW_HOST}:${fallbackPort}`, port: fallbackPort };
        }
        await sleep(PREVIEW_PROBE_MS);
    }
    return null;
}
/**
 * Allocate a preview port by scanning upward from a base, returning the first
 * free one — so previews get predictable, incrementing ports (3000, 3001, …)
 * and never collide with a port already in use. Falls back to an OS-assigned
 * random port only if the whole scan range is occupied.
 */
async function pickFreePort(base = BASE_PREVIEW_PORT) {
    for (let port = base; port < base + MAX_PORT_SCAN; port += 1) {
        if (await isPortFree(port))
            return port;
    }
    return pickRandomFreePort();
}
async function isPortFree(port) {
    return await new Promise((resolve) => {
        const server = net.createServer();
        server.unref();
        server.once("error", () => resolve(false));
        server.listen(port, PREVIEW_HOST, () => {
            server.close(() => resolve(true));
        });
    });
}
async function pickRandomFreePort() {
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