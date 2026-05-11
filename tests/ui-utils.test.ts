import test from "node:test";
import assert from "node:assert/strict";
import { compactPath, padRight, truncate, truncateMiddle } from "../src/ui/text.js";
import { windowWithMarkers } from "../src/ui/windowing.js";

test("truncate handles normal and narrow widths", () => {
  assert.equal(truncate("abcdef", 10), "abcdef");
  assert.equal(truncate("abcdef", 3), "ab…");
  assert.equal(truncate("abcdef", 1), "a");
  assert.equal(truncate("abcdef", 0), "");
});

test("truncateMiddle preserves both ends when shortening paths", () => {
  assert.equal(truncateMiddle("src/ui/Inspector.tsx", 10), "src/…r.tsx");
  assert.equal(truncateMiddle("short", 10), "short");
});

test("padRight pads without truncating", () => {
  assert.equal(padRight("key", 6), "key   ");
  assert.equal(padRight("long-key", 3), "long-key");
});

test("compactPath prefers the final two path segments", () => {
  const compact = compactPath("/Users/bruce/Projects/inklit/src/ui/App.tsx", 18);
  assert.equal(compact, "…/ui/App.tsx");
});

test("windowWithMarkers accounts for hidden marker rows", () => {
  const first = windowWithMarkers([1, 2, 3, 4, 5], 3, 0);
  assert.deepEqual(first, { visible: [1, 2], above: 0, below: 3 });

  const middle = windowWithMarkers([1, 2, 3, 4, 5], 3, 2);
  assert.deepEqual(middle, { visible: [3], above: 2, below: 2 });

  const clamped = windowWithMarkers([1, 2, 3, 4, 5], 3, 99);
  assert.deepEqual(clamped, { visible: [4, 5], above: 3, below: 0 });
});
