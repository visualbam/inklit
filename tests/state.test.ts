import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs, constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearPane,
  clearPreview,
  getAgent,
  loadAll,
  loadUiPrefs,
  recordLifecycle,
  recordListDensity,
  recordPane,
  recordRemove,
  recordResume,
  recordSpawn,
  recordPreview,
  recordTaskFailure,
  recordTaskOperation,
  wrapperPath,
  ensureWrapper,
  type TaskSnapshot,
} from "../src/state.js";

async function withTempState(
  run: (dir: string) => Promise<void>
): Promise<void> {
  const previous = process.env.XDG_STATE_HOME;
  const dir = await fs.mkdtemp(join(tmpdir(), "inklit-state-"));
  process.env.XDG_STATE_HOME = dir;
  try {
    await run(dir);
  } finally {
    if (previous === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previous;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("state records spawn, resume, panes, lifecycle, and removal", async () => {
  await withTempState(async (dir) => {
    await recordSpawn("task-a", "codex", "terminal_1");
    assert.equal(await getAgent("task-a"), "codex");
    assert.equal((await loadAll())["task-a"]?.paneId, "terminal_1");

    await recordResume("task-a", "claude", "terminal_2");
    const resumed = (await loadAll())["task-a"];
    assert.equal(resumed?.agent, "claude");
    assert.equal(resumed?.paneId, "terminal_2");
    assert.equal(typeof resumed?.lastResumedAt, "number");

    await recordPreview("task-a", {
      url: "http://127.0.0.1:4173",
      port: 4173,
      pid: 1234,
      command: "npm run dev",
      kind: "app",
      startedAt: 99,
    });
    assert.equal((await loadAll())["task-a"]?.preview?.url, "http://127.0.0.1:4173");

    await clearPreview("task-a");
    assert.equal((await loadAll())["task-a"]?.preview, undefined);

    await recordPane("task-a", "terminal_3");
    assert.equal((await loadAll())["task-a"]?.paneId, "terminal_3");

    const snapshot: TaskSnapshot = {
      path: "/tmp/task-a",
      shortSha: "abc123",
      subject: "Task A",
      ageSeconds: 0,
      dirty: false,
      symbols: "",
    };
    await recordLifecycle("task-a", "done", snapshot);
    assert.equal((await loadAll())["task-a"]?.lifecycle, "done");
    assert.equal((await loadAll())["task-a"]?.snapshot?.shortSha, "abc123");

    await recordTaskOperation(
      "task-a",
      { phase: "merge", targetBranch: "develop", startedAt: 123 },
      snapshot
    );
    assert.equal((await loadAll())["task-a"]?.lifecycle, "applying");
    assert.equal((await loadAll())["task-a"]?.operation?.targetBranch, "develop");

    await recordTaskFailure(
      "task-a",
      {
        phase: "merge",
        targetBranch: "develop",
        message: "merge failed",
        details: "conflict in src/app.ts",
        at: 456,
      },
      snapshot
    );
    assert.equal((await loadAll())["task-a"]?.lifecycle, "failed");
    assert.equal((await loadAll())["task-a"]?.operation, undefined);
    assert.equal((await loadAll())["task-a"]?.failure?.message, "merge failed");

    await recordLifecycle("task-a", null);
    assert.equal((await loadAll())["task-a"]?.lifecycle, undefined);
    assert.equal((await loadAll())["task-a"]?.snapshot, undefined);
    assert.equal((await loadAll())["task-a"]?.operation, undefined);
    assert.equal((await loadAll())["task-a"]?.failure, undefined);

    await clearPane("task-a");
    assert.equal((await loadAll())["task-a"]?.paneId, undefined);

    await recordRemove("task-a");
    assert.equal((await loadAll())["task-a"], undefined);

    const files = await fs.readdir(join(dir, "inklit"));
    assert.deepEqual(files, ["tasks.json"]);
  });
});

test("state stores UI preferences without a task record", async () => {
  await withTempState(async () => {
    assert.deepEqual(await loadUiPrefs(), { listDensity: undefined });
    await recordListDensity("compact");
    assert.deepEqual(await loadUiPrefs(), { listDensity: "compact" });
  });
});

async function withTempData(
  run: (dir: string) => Promise<void>
): Promise<void> {
  const previous = process.env.XDG_DATA_HOME;
  const dir = await fs.mkdtemp(join(tmpdir(), "inklit-data-"));
  process.env.XDG_DATA_HOME = dir;
  try {
    await run(dir);
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("wrapperPath() respects XDG_DATA_HOME", async () => {
  await withTempData(async (dir) => {
    assert.equal(
      wrapperPath(),
      join(dir, "inklit", "bin", "inklit-agent-wrap")
    );
  });
});

test("ensureWrapper() creates executable script with expected content", async () => {
  await withTempData(async () => {
    const path = await ensureWrapper();
    const content = await fs.readFile(path, "utf-8");
    assert.ok(content.startsWith("#!/bin/bash"), "must be a bash script");
    assert.ok(content.includes('"$@"'), "must pass through args");
    assert.ok(content.includes("touch"), "must touch signal file");
    assert.ok(content.includes('exec "${SHELL:-bash}"'), "must exec interactive shell");
    assert.ok(!content.includes(" -l"), "must not start a login shell");
    const stat = await fs.stat(path);
    assert.ok(stat.mode & constants.S_IXUSR, "wrapper must be user-executable");
  });
});

test("ensureWrapper() is idempotent — no rewrite when content matches", async () => {
  await withTempData(async () => {
    const path1 = await ensureWrapper();
    const stat1 = await fs.stat(path1);
    const path2 = await ensureWrapper();
    const stat2 = await fs.stat(path2);
    assert.equal(path1, path2);
    assert.equal(stat1.mtimeMs, stat2.mtimeMs, "mtime must not change on second call");
  });
});

test("ensureWrapper() rewrites when content differs (version update)", async () => {
  await withTempData(async () => {
    const path = await ensureWrapper();
    await fs.writeFile(path, "#!/bin/bash\nold content\n", "utf-8");
    const stat1 = await fs.stat(path);
    await ensureWrapper();
    const stat2 = await fs.stat(path);
    assert.ok(stat2.mtimeMs > stat1.mtimeMs, "mtime must advance after rewrite");
    const content = await fs.readFile(path, "utf-8");
    assert.ok(content.includes('"$@"'), "content must be updated to current version");
  });
});
