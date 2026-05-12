#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { App } from "./ui/App.js";
import { renameOwnPane } from "./zellij.js";
import { parseGlobalArgs, rootHelp, runSpawnCommand } from "./cli.js";
function readPackageVersion() {
    try {
        const here = dirname(fileURLToPath(import.meta.url));
        const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
        return typeof pkg.version === "string" ? pkg.version : "unknown";
    }
    catch {
        return "unknown";
    }
}
const args = process.argv.slice(2);
let parsed;
try {
    parsed = parseGlobalArgs(args);
}
catch (err) {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
}
if (parsed.command === "version") {
    // eslint-disable-next-line no-console
    console.log(`inklit ${readPackageVersion()}`);
    process.exit(0);
}
if (parsed.command === "help") {
    // eslint-disable-next-line no-console
    console.log(rootHelp());
    process.exit(0);
}
if (parsed.command === "spawn") {
    try {
        const defaultBase = parsed.mainBranch === "main" ? undefined : parsed.mainBranch;
        const code = await runSpawnCommand(parsed.commandArgs, { defaultBase });
        process.exit(code);
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}
renameOwnPane("inklit");
const { waitUntilExit } = render(React.createElement(App, { mainBranch: parsed.mainBranch }));
waitUntilExit().then(() => process.exit(0), (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map