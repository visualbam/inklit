import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { isSkippableRebaseStop, syncFromMain } from "../src/wt.js";

test("detects rebase stops that require skipping empty commits", () => {
  assert.equal(
    isSkippableRebaseStop("No changes - did you forget to use 'git add'?"),
    true
  );
  assert.equal(
    isSkippableRebaseStop("The previous cherry-pick is now empty"),
    true
  );
  assert.equal(
    isSkippableRebaseStop("dropping abc123 -- patch contents already upstream"),
    true
  );
  assert.equal(
    isSkippableRebaseStop("CONFLICT (content): Merge conflict"),
    false
  );
});

test("syncFromMain rebases while preserving dirty task changes", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "inklit-wt-"));
  const mainPath = join(root, "repo");
  const taskPath = join(root, "task");
  try {
    await fs.mkdir(mainPath);
    await git(mainPath, ["init", "-b", "main"]);
    await git(mainPath, ["config", "user.email", "test@example.com"]);
    await git(mainPath, ["config", "user.name", "Test User"]);
    await fs.writeFile(join(mainPath, "base.txt"), "base\n");
    await fs.writeFile(join(mainPath, "task.txt"), "base task\n");
    await git(mainPath, ["add", "base.txt", "task.txt"]);
    await git(mainPath, ["commit", "-m", "base"]);
    await git(mainPath, ["branch", "task"]);
    await git(mainPath, ["worktree", "add", taskPath, "task"]);

    await fs.writeFile(join(mainPath, "main.txt"), "main\n");
    await git(mainPath, ["add", "main.txt"]);
    await git(mainPath, ["commit", "-m", "main update"]);
    await fs.writeFile(join(taskPath, "task.txt"), "dirty task\n");
    await fs.writeFile(join(taskPath, "dirty.txt"), "dirty\n");

    await syncFromMain(taskPath, "main");

    assert.equal(await fs.readFile(join(taskPath, "main.txt"), "utf8"), "main\n");
    assert.equal(
      await fs.readFile(join(taskPath, "task.txt"), "utf8"),
      "dirty task\n"
    );
    assert.equal(
      await fs.readFile(join(taskPath, "dirty.txt"), "utf8"),
      "dirty\n"
    );
    const { stdout: base } = await git(taskPath, ["merge-base", "main", "HEAD"]);
    const { stdout: main } = await git(taskPath, ["rev-parse", "main"]);
    assert.equal(base, main);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function git(cwd: string, args: string[]) {
  return execa("git", ["-C", cwd, ...args], {
    reject: true,
    stripFinalNewline: true,
  });
}
