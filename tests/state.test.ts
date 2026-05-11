import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearPane,
  getAgent,
  loadAll,
  loadUiPrefs,
  recordLifecycle,
  recordListDensity,
  recordPane,
  recordRemove,
  recordResume,
  recordSpawn,
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

    await recordLifecycle("task-a", null);
    assert.equal((await loadAll())["task-a"]?.lifecycle, undefined);
    assert.equal((await loadAll())["task-a"]?.snapshot, undefined);

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
