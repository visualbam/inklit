#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./ui/App.js";
import { renameOwnPane } from "./zellij.js";
import { parseGlobalArgs, rootHelp, runSpawnCommand } from "./cli.js";
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
    console.log("inklit 0.0.1");
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