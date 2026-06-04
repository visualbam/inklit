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

test("fetchAiFollowUps parses JSON from codex last message output", async () => {
  await withFakeAiCli(
    "codex",
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const execIndex = process.argv.indexOf('exec');",
      "const approvalIndex = process.argv.indexOf('--ask-for-approval');",
      "if (execIndex === -1 || approvalIndex === -1 || approvalIndex > execIndex) process.exit(3);",
      "const out = process.argv[process.argv.indexOf('--output-last-message') + 1];",
      "const schema = process.argv[process.argv.indexOf('--output-schema') + 1];",
      "if (!schema || !fs.existsSync(schema)) process.exit(2);",
      "fs.writeFileSync(out, JSON.stringify([{",
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

test("fetchAiFollowUps reports non-zero codex stdout errors", async () => {
  await withFakeAiCli(
    "codex",
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
        /codex exec failed: Not logged in/
      );
    }
  );
});

test("fetchAiFollowUps can use claude provider when configured", async () => {
  await withFakeAiCli(
    "claude",
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify([{",
      "  title: 'Verify edge cases',",
      "  detail: 'Check the newly merged behavior.',",
      "  prompt: 'Inspect the diff and add focused tests.'",
      "}]));",
    ].join("\n"),
    async (cwd) => {
      process.env.INKLIT_AI_PROVIDER = "claude";
      const followUps = await fetchAiFollowUps(
        task(),
        "diff --git a/src/example.ts b/src/example.ts\n+export const value = 1;\n",
        cwd
      );

      assert.equal(followUps[0]?.title, "Verify edge cases");
    }
  );
});

async function withFakeAiCli(
  binary: string,
  source: string,
  run: (cwd: string) => Promise<void>
): Promise<void> {
  const root = await fs.mkdtemp(join(tmpdir(), "inklit-ai-test-"));
  const binDir = join(root, "bin");
  const fakeBinary = join(binDir, binary);
  const oldPath = process.env.PATH;
  const oldProvider = process.env.INKLIT_AI_PROVIDER;
  const oldModel = process.env.INKLIT_CODEX_MODEL;
  try {
    await fs.mkdir(binDir);
    await fs.writeFile(fakeBinary, source);
    await fs.chmod(fakeBinary, 0o755);
    process.env.PATH = `${binDir}${delimiter}${oldPath ?? ""}`;
    process.env.INKLIT_AI_PROVIDER = binary === "claude" ? "claude" : "codex";
    delete process.env.INKLIT_CODEX_MODEL;
    await run(root);
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldProvider === undefined) delete process.env.INKLIT_AI_PROVIDER;
    else process.env.INKLIT_AI_PROVIDER = oldProvider;
    if (oldModel === undefined) delete process.env.INKLIT_CODEX_MODEL;
    else process.env.INKLIT_CODEX_MODEL = oldModel;
    await fs.rm(root, { recursive: true, force: true });
  }
}
