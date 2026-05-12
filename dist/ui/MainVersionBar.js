import React from "react";
import { Box, Text } from "ink";
import { lifecycleForTask } from "../model.js";
import { UI } from "./theme.js";
import { compactPath, truncate } from "./text.js";
export function MainVersionBar({ mainVersion, targetBranch, tasks, visibleTaskCount, filterQuery, width, }) {
    if (!mainVersion) {
        return (React.createElement(Box, { paddingX: 1 },
            React.createElement(Text, { bold: true, color: UI.accent }, "inklit"),
            React.createElement(Text, { dimColor: true }, " \u00B7 main version loading\u2026")));
    }
    if (mainVersion.error) {
        return (React.createElement(Box, { paddingX: 1 },
            React.createElement(Text, { bold: true, color: UI.accent }, "inklit"),
            React.createElement(Text, { dimColor: true },
                " ",
                "\u00B7 main version unavailable \u00B7",
                " ",
                truncate(mainVersion.error, Math.max(12, width - 38)))));
    }
    const path = compactPath(mainVersion.path, 28);
    const counts = summarize(tasks);
    const filter = filterQuery.trim()
        ? ` · filter "${filterQuery.trim()}" ${visibleTaskCount}/${tasks.length}`
        : "";
    const target = targetBranch && targetBranch !== mainVersion.branch
        ? ` · target ${targetBranch}`
        : "";
    const summary = ` · main version ${mainVersion.branch || "unknown"} ${mainVersion.shortSha || "no sha"} ${mainVersion.dirty ? "dirty" : "clean"} · active ${counts.active} ready ${counts.ready}${counts.applying ? ` applying ${counts.applying}` : ""}${counts.failed ? ` failed ${counts.failed}` : ""} done ${counts.done}${target}${filter} · ${path}`;
    const maxSummary = Math.max(12, width - "inklit ".length - 2);
    return (React.createElement(Box, { paddingX: 1 },
        React.createElement(Text, { bold: true, color: UI.accent }, "inklit"),
        React.createElement(Text, { dimColor: true }, truncate(summary, maxSummary))));
}
function summarize(tasks) {
    const counts = { active: 0, ready: 0, applying: 0, failed: 0, done: 0 };
    for (const task of tasks) {
        const lifecycle = lifecycleForTask(task);
        if (lifecycle === "active")
            counts.active += 1;
        if (lifecycle === "ready")
            counts.ready += 1;
        if (lifecycle === "applying")
            counts.applying += 1;
        if (lifecycle === "failed")
            counts.failed += 1;
        if (lifecycle === "done")
            counts.done += 1;
    }
    return counts;
}
//# sourceMappingURL=MainVersionBar.js.map