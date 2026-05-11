// Smoke-test inspector helpers against a worktree path.
// Usage: node scripts/smoke-inspector.mjs <path>
import { gitDiff, gitFiles, gitLog, detectWaiting } from "../dist/wt.js";
import { sanitizeAgentTranscript } from "../dist/ui/agentTranscript.js";

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

console.log("\n=== agent transcript chrome filter ===");
const transcript = [
  "❯ saye bye",
  "",
  "● Bye!",
  "────────────────────────────────────────────────────────────────────────",
  "❯",
  "────────────────────────────",
  "lazyagent.say-hello | Opus 4.7 | git:say-hello────────",
  "scroll J/K ^d/^u gg/G · ? help",
  "real output after footer",
].join("\n");
const sanitized = sanitizeAgentTranscript(transcript);
const unwanted = ["────────────────", "git:say-hello", "scroll J/K", "\n❯\n"];
for (const needle of unwanted) {
  const ok = !sanitized.includes(needle);
  console.log(`${ok ? "✓" : "✗"} removed ${JSON.stringify(needle)}`);
}
const kept = ["❯ saye bye", "● Bye!", "real output after footer"];
for (const needle of kept) {
  const ok = sanitized.includes(needle);
  console.log(`${ok ? "✓" : "✗"} kept ${JSON.stringify(needle)}`);
}
