import test from "node:test";
import assert from "node:assert/strict";
import type { Task } from "../src/model.js";
import { commandRows, helpSections, isLiveTask } from "../src/ui/commands.js";

function task(state: Task["state"], overrides: Partial<Task> = {}): Task {
  return {
    slug: "feature-task",
    path: "/tmp/feature-task",
    shortSha: "abc123",
    subject: "Feature task",
    ageSeconds: 0,
    state,
    dirty: true,
    symbols: "",
    ...overrides,
  };
}

test("commandRows reflects session and selected task state", () => {
  const rows = commandRows({
    task: task("ready"),
    density: "compact",
    targetBranch: "develop",
    showArchived: false,
    inSession: false,
  });

  assert.equal(rows.find((row) => row.key === "n")?.muted, true);
  assert.equal(rows.find((row) => row.key === "i")?.muted, true);
  assert.equal(
    rows.find((row) => row.key === "m")?.label,
    "review and apply to develop"
  );
  assert.equal(rows.find((row) => row.key === "v")?.label, "switch to detailed board");
});

test("commandRows mutes destructive actions for applied tasks", () => {
  const rows = commandRows({
    task: task("merged"),
    density: "detailed",
    targetBranch: "main",
    showArchived: true,
    inSession: true,
  });

  assert.deepEqual(
    rows
      .filter((row) => row.key === "m" || row.key === "X")
      .map((row) => [row.key, row.muted, row.label]),
    [
      ["m", true, "already applied"],
      ["X", true, "kill unavailable after apply"],
    ]
  );
  assert.equal(rows.find((row) => row.key === "z")?.label, "hide archived tasks");
});

test("helpSections uses the active target branch everywhere target-specific", () => {
  const rows = helpSections("release").flatMap((section) => section.rows);
  assert.ok(rows.some(([key, label]) => key === "f" && label === "files changed vs release"));
  assert.ok(rows.some(([key, label]) => key === "m" && label.includes("release")));
  assert.ok(rows.some(([key, label]) => key === "--main" && label.endsWith("release")));
});

test("isLiveTask matches pane-backed task states", () => {
  assert.equal(isLiveTask(task("running")), true);
  assert.equal(isLiveTask(task("waiting")), true);
  assert.equal(isLiveTask(task("permission")), true);
  assert.equal(isLiveTask(task("idle")), true);
  assert.equal(isLiveTask(task("ready")), false);
  assert.equal(isLiveTask(task("merged")), false);
});
