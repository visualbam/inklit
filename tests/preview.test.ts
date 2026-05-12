import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectPreviewPlans } from "../src/preview.js";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(join(tmpdir(), "inklit-preview-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("detectPreviewPlans prefers common package scripts before static fallback", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(
      join(dir, "package.json"),
      JSON.stringify(
        {
          packageManager: "pnpm@9.0.0",
          scripts: {
            dev: "vite",
            preview: "vite preview",
          },
        },
        null,
        2
      )
    );

    const plans = await detectPreviewPlans(dir);
    assert.equal(plans[0]?.kind, "app");
    assert.equal(plans[0]?.label, "pnpm run dev");
    assert.equal(plans[1]?.kind, "app");
    assert.equal(plans[1]?.label, "pnpm run preview");
    assert.equal(plans.at(-1)?.kind, "static");
  });
});

test("detectPreviewPlans falls back to static when no package script is found", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(join(dir, "index.html"), "<!doctype html><h1>Hello</h1>");

    const plans = await detectPreviewPlans(dir);
    assert.deepEqual(plans, [{ kind: "static", label: "static preview" }]);
  });
});
