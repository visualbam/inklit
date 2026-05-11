#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./ui/App.js";
import { renameOwnPane } from "./zellij.js";

const args = process.argv.slice(2);
if (args.includes("-v") || args.includes("--version")) {
  // eslint-disable-next-line no-console
  console.log("inklit 0.0.1");
  process.exit(0);
}
if (args.includes("-h") || args.includes("--help")) {
  // eslint-disable-next-line no-console
  console.log(
    [
      "inklit — TUI for parallel AI coding agents in git worktrees.",
      "",
      "Usage:  inklit",
      "",
      "Run inside a zellij session for full functionality (focus + spawn).",
      "Outside zellij, the list still renders read-only.",
      "",
      "Keys: j/k move, gg/G top/bottom, n new task, m apply, q quit.",
    ].join("\n")
  );
  process.exit(0);
}

renameOwnPane("inklit");
const { waitUntilExit } = render(<App />);
waitUntilExit().then(
  () => process.exit(0),
  (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  }
);
