import test from "node:test";
import assert from "node:assert/strict";
import { launchArgsFor, resumeArgsFor } from "../src/agent.js";

test("launchArgsFor adds non-interactive approval flags", () => {
  assert.deepEqual(launchArgsFor("codex", "Fix the bug"), [
    "--ask-for-approval",
    "never",
    "Fix the bug",
  ]);
  assert.deepEqual(launchArgsFor("claude", "Fix the bug"), [
    "--permission-mode",
    "bypassPermissions",
    "Fix the bug",
  ]);
});

test("resumeArgsFor preserves resume commands after approval flags", () => {
  assert.deepEqual(resumeArgsFor("codex"), [
    "--ask-for-approval",
    "never",
    "resume",
    "--last",
  ]);
  assert.deepEqual(resumeArgsFor("claude"), [
    "--permission-mode",
    "bypassPermissions",
    "--continue",
  ]);
});
