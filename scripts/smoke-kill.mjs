// Smoke test: removeWorktree on a single named branch.
// Usage: node scripts/smoke-kill.mjs <slug>
import { removeWorktree } from "../dist/wt.js";
const slug = process.argv[2];
if (!slug) {
  console.error("usage: smoke-kill.mjs <slug>");
  process.exit(1);
}
await removeWorktree(slug);
console.log(`removed ${slug}`);
