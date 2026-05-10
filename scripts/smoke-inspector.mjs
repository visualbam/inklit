// Smoke-test inspector helpers against a worktree path.
// Usage: node scripts/smoke-inspector.mjs <path>
import { gitDiff, gitFiles, gitLog, detectWaiting } from "../dist/wt.js";

const path = process.argv[2];
if (!path) {
  console.error("usage: smoke-inspector.mjs <path>");
  process.exit(1);
}

console.log("=== diff ===");
console.log(await gitDiff(path));
console.log("\n=== log ===");
console.log(await gitLog(path));
console.log("\n=== files ===");
console.log(JSON.stringify(await gitFiles(path), null, 2));

console.log("\n=== detectWaiting tests ===");
const cases = [
  ["normal output\nstill running\nfoo", false],
  ["doing things\nProceed? (y/n) ", true],
  ["last line\n? Confirm action", true],
  ["agent output\n❯ ", true],
  ["just regular text", false],
];
for (const [text, expected] of cases) {
  const got = detectWaiting(text);
  console.log(
    `${got === expected ? "✓" : "✗"} expected=${expected} got=${got}  ${JSON.stringify(text.slice(-40))}`
  );
}
