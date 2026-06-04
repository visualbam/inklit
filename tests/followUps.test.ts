import test from "node:test";
import assert from "node:assert/strict";
import type { Task, SuggestedFollowUp } from "../src/model.js";
import {
  activeFollowUps,
  mergedFallbackFollowUps,
  suggestedFollowUps,
} from "../src/ui/followUps.js";

function task(state: Task["state"], overrides: Partial<Task> = {}): Task {
  return {
    slug: "feature-task",
    path: "/tmp/feature-task",
    shortSha: "abc123",
    subject: "Feature task",
    ageSeconds: 0,
    state,
    dirty: false,
    symbols: "",
    ...overrides,
  };
}

test("activeFollowUps uses loaded AI follow-ups for merged tasks", () => {
  const aiFollowUps: SuggestedFollowUp[] = [
    {
      title: "Exercise merge edge cases",
      detail: "Validate the applied path with focused checks.",
      prompt: "Inspect the merged diff and add regression coverage.",
    },
  ];

  assert.deepEqual(
    activeFollowUps(task("merged"), aiFollowUps, "feature-task"),
    aiFollowUps
  );
});

test("activeFollowUps falls back to ready suggestions when no applied AI list matches", () => {
  const readyTask = task("ready", {
    review: { files: 2, commitsAhead: 1, untracked: 0 },
  });

  assert.deepEqual(
    activeFollowUps(readyTask, [], "other-task"),
    suggestedFollowUps(readyTask)
  );
});

test("mergedFallbackFollowUps grounds prompts in changed files from diff", () => {
  const followUps = mergedFallbackFollowUps(
    task("merged"),
    [
      "diff --git a/src/ui/App.tsx b/src/ui/App.tsx",
      "--- a/src/ui/App.tsx",
      "+++ b/src/ui/App.tsx",
      "@@",
      "+const changed = true;",
      "diff --git a/src/ai.ts b/src/ai.ts",
      "--- a/src/ai.ts",
      "+++ b/src/ai.ts",
      "@@",
      "+const changedToo = true;",
    ].join("\n")
  );

  assert.equal(followUps.length, 3);
  assert.match(followUps[0]!.detail, /src\/ui\/App\.tsx/);
  assert.match(followUps[0]!.prompt, /src\/ui\/App\.tsx, src\/ai\.ts/);
});
