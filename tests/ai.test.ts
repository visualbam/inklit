import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fetchAiFollowUps } from "../src/ai.js";
import type { Task } from "../src/model.js";

function task(overrides: Partial<Task> = {}): Task {
  return {
    slug: "feature-task",
    path: "/tmp/feature-task",
    shortSha: "abc123",
    subject: "Feature task",
    ageSeconds: 0,
    state: "merged",
    dirty: false,
    symbols: "",
    ...overrides,
  };
}

test("fetchAiFollowUps parses JSON from claude stdout", async () => {
  await withFakeClaude(
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify([{",
      "  title: 'Verify edge cases',",
      "  detail: 'Check the newly merged behavior.',",
      "  prompt: 'Inspect the diff and add focused tests.'",
      "}]));",
    ].join("\n"),
    async (cwd) => {
      const followUps = await fetchAiFollowUps(
        task(),
        "diff --git a/src/example.ts b/src/example.ts\n+export const value = 1;\n",
        cwd
      );

      assert.deepEqual(followUps, [
        {
          title: "Verify edge cases",
          detail: "Check the newly merged behavior.",
          prompt: "Inspect the diff and add focused tests.",
        },
      ]);
    }
  );
});

test("fetchAiFollowUps reports non-zero claude stdout errors", async () => {
  await withFakeClaude(
    [
      "#!/usr/bin/env node",
      "console.log('Not logged in · Please run /login');",
      "process.exit(1);",
    ].join("\n"),
    async (cwd) => {
      await assert.rejects(
        () =>
          fetchAiFollowUps(
            task(),
            "diff --git a/src/example.ts b/src/example.ts\n+export const value = 1;\n",
            cwd
          ),
        /claude -p failed: Not logged in/
      );
    }
  );
});

async function withFakeClaude(
  source: string,
  run: (cwd: string) => Promise<void>
): Promise<void> {
  const root = await fs.mkdtemp(join(tmpdir(), "inklit-ai-test-"));
  const binDir = join(root, "bin");
  const fakeClaude = join(binDir, "claude");
  const oldPath = process.env.PATH;
  try {
    await fs.mkdir(binDir);
    await fs.writeFile(fakeClaude, source);
    await fs.chmod(fakeClaude, 0o755);
    process.env.PATH = `${binDir}${delimiter}${oldPath ?? ""}`;
    await run(root);
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    await fs.rm(root, { recursive: true, force: true });
  }
}
