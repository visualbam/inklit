import React from "react";
import { Box, Text } from "ink";
import { lifecycleForTask } from "../model.js";
import { DiffView } from "./DiffView.js";
import { FilesView } from "./FilesView.js";
import { LIFECYCLE_COLOR, LIFECYCLE_LABEL, formatStateLabel, } from "./icons.js";
import { UI } from "./theme.js";
import { suggestedFollowUps } from "./followUps.js";
import { reviewSentence, reviewSummary } from "./review.js";
import { padRight, truncate } from "./text.js";
import { windowWithMarkers } from "./windowing.js";
export function Inspector({ task, mode, targetBranch, diff, log, agent, files, loading, height, width, offset, }) {
    // Reserve header, status strip, mode tabs, footer, and spacing inside the box.
    const maxLines = Math.max(3, height - 6);
    const title = task ? task.slug : "(no selection)";
    const header = task
        ? `${title} · ${modeLabel(mode, targetBranch)} · ${task.shortSha || "no sha"}`
        : `${title} · ${modeLabel(mode, targetBranch)}`;
    const contentWidth = Math.max(10, width - 4);
    return (React.createElement(Box, { flexDirection: "column", borderStyle: "round", borderColor: task ? UI.border : UI.subtle, paddingX: 1, flexGrow: 1 },
        React.createElement(Box, null,
            React.createElement(Text, { bold: true }, truncate(header, width - 2))),
        task ? (React.createElement(TaskStatusStrip, { task: task, targetBranch: targetBranch, width: width })) : null,
        React.createElement(ModeTabs, { active: mode }),
        React.createElement(Box, { marginTop: 1, flexDirection: "column", flexGrow: 1 }, !task ? (React.createElement(Text, { dimColor: true }, "nothing selected")) : loading ? (React.createElement(Text, { dimColor: true }, "loading\u2026")) : mode === "task" ? (React.createElement(TaskOverview, { task: task, targetBranch: targetBranch, maxLines: maxLines, offset: offset, width: width })) : mode === "diff" ? (React.createElement(DiffView, { diff: diff, maxLines: maxLines, offset: offset, width: contentWidth })) : mode === "files" ? (React.createElement(FilesView, { entries: files, targetBranch: targetBranch, maxLines: maxLines, offset: offset, width: contentWidth })) : mode === "log" ? (React.createElement(PlainText, { text: log, maxLines: maxLines, offset: offset })) : (React.createElement(PlainText, { text: agent, maxLines: maxLines, offset: offset, placeholder: "(agent transcript empty \u2014 pane may not be live)" }))),
        React.createElement(Box, null,
            React.createElement(Text, { dimColor: true },
                "scroll ",
                React.createElement(Text, { bold: true }, "J/K"),
                " ^d/^u ",
                React.createElement(Text, { bold: true }, "gg/G"),
                " \u00B7",
                " ",
                React.createElement(Text, { bold: true }, "?"),
                " help"))));
}
function ModeTabs({ active }) {
    const tabs = [
        ["task", "t", "task"],
        ["files", "f", "files"],
        ["diff", "d", "diff"],
        ["log", "l", "log"],
        ["agent", "a", "agent"],
    ];
    return (React.createElement(Box, { marginTop: 1 }, tabs.map(([mode, key, label], index) => {
        const isActive = mode === active;
        return (React.createElement(Text, { key: mode },
            index > 0 ? React.createElement(Text, { dimColor: true }, " ") : null,
            React.createElement(Text, { color: isActive ? UI.accent : undefined, bold: isActive },
                "[",
                key,
                ":",
                label,
                "]")));
    })));
}
function TaskStatusStrip({ task, targetBranch, width, }) {
    const lifecycle = lifecycleForTask(task);
    const label = LIFECYCLE_LABEL[lifecycle];
    const line = `${label} task · ${paneSummary(task)} · ${task.state === "merging"
        ? "applying in background"
        : task.dirty
            ? "changes pending review"
            : "clean worktree"} · ${nextAction(task, targetBranch)}`;
    return (React.createElement(Box, null,
        React.createElement(Text, { color: LIFECYCLE_COLOR[lifecycle] }, label),
        React.createElement(Text, { dimColor: true },
            " ",
            truncate(line.slice(label.length + 1), width - 10))));
}
function TaskOverview({ task, targetBranch, maxLines, offset, width, }) {
    const rows = [
        [
            "Status",
            `${LIFECYCLE_LABEL[lifecycleForTask(task)]} task, ${paneSummary(task)}`,
        ],
        ["Next", nextAction(task, targetBranch)],
        ["Readiness", reviewSentence(task)],
        ["Signals", reviewSummary(task)],
        [
            "Controls",
            `Open files/diff/log, then apply to ${targetBranch} with m or discard with X.`,
        ],
        [
            "Thread",
            task.paneId
                ? "Agent transcript is live; i sends a line without focusing."
                : "No live pane; enter resumes the recorded agent.",
        ],
        ["Checkpoint", `${task.shortSha || "unknown"} on ${task.slug}`],
        ["Preview", task.preview?.url ?? "not running yet"],
        [
            "Changes",
            task.dirty
                ? "Uncommitted changes are present."
                : "No uncommitted changes; committed task changes may still exist.",
        ],
        ["Worktree", task.path],
    ];
    const failureRows = failureDetailRows(task);
    if (failureRows.length > 0)
        rows.splice(2, 0, ...failureRows);
    const followUps = suggestedFollowUps(task);
    if (followUps[0]) {
        rows.push([
            "Next task",
            `T/1: ${followUps[0].title} - ${followUps[0].detail}`,
        ]);
    }
    if (followUps[1]) {
        rows.push([
            "Task 2",
            `2: ${followUps[1].title} - ${followUps[1].detail}`,
        ]);
    }
    const { visible, above, below } = windowWithMarkers(rows, Math.max(1, maxLines - 1), offset);
    return (React.createElement(Box, { flexDirection: "column" },
        React.createElement(TaskTimeline, { task: task }),
        above > 0 ? (React.createElement(Box, null,
            React.createElement(Text, { dimColor: true },
                "\u2191 ",
                above,
                " hidden above"))) : null,
        visible.map(([label, value]) => (React.createElement(Box, { key: `${label}:${value}` },
            React.createElement(Text, { color: UI.accent }, padRight(label, 10)),
            React.createElement(Text, null, padRight(truncate(value, width - 12), width - 12))))),
        below > 0 ? (React.createElement(Box, null,
            React.createElement(Text, { dimColor: true },
                "\u2193 ",
                below,
                " hidden below"))) : null));
}
function TaskTimeline({ task }) {
    const lifecycle = lifecycleForTask(task);
    const active = lifecycle === "done" || task.state === "merged"
        ? 4
        : lifecycle === "applying" || task.state === "merging"
            ? 3
            : lifecycle === "ready" || task.state === "ready" || task.state === "idle"
                ? 2
                : lifecycle === "archived" || lifecycle === "cancelled" || lifecycle === "failed"
                    ? 5
                    : 1;
    const steps = ["spawned", "working", "review", "apply", "done"];
    return (React.createElement(Box, null,
        React.createElement(Text, { color: UI.accent }, padRight("Flow", 10)),
        steps.map((step, index) => {
            const done = index <= active;
            const current = index === active;
            return (React.createElement(Text, { key: step, color: current ? UI.accent : done ? UI.success : UI.subtle, dimColor: !done },
                index > 0 ? " -> " : "",
                step));
        }),
        active === 5 ? (React.createElement(Text, { color: lifecycle === "failed" || lifecycle === "cancelled" ? UI.danger : UI.subtle },
            " -> ",
            lifecycle)) : null));
}
function paneSummary(task) {
    if (task.state === "ready")
        return "no live pane";
    if (task.state === "merging")
        return "background merge";
    if (task.state === "permission")
        return "permission prompt";
    if (task.state === "waiting")
        return "waiting for input";
    if (task.state === "idle")
        return `${formatStateLabel(task)} pane`;
    return `${formatStateLabel(task)} pane`;
}
function nextAction(task, targetBranch) {
    if (task.state === "permission") {
        return "Permission prompt detected; focus the pane or restart it with current launch flags.";
    }
    if (task.state === "waiting") {
        return "Respond to the agent with i or enter to focus.";
    }
    if (task.state === "running") {
        return "Let the agent continue or inspect the live transcript.";
    }
    if (task.state === "idle") {
        return "Check the transcript; the pane has not changed recently.";
    }
    if (task.state === "ready") {
        return `Review the diff, apply to ${targetBranch} with m, or enter to resume.`;
    }
    if (task.state === "merging") {
        return `Merge to ${task.operation?.targetBranch ?? targetBranch} is running; keep working or press esc to cancel.`;
    }
    if (task.failure) {
        return `Review the failure below, then press m to retry or X to discard.`;
    }
    if (task.state === "merged")
        return `Task has been applied to ${targetBranch}.`;
    return "Inspect the task and decide whether to resume or discard.";
}
function failureDetailRows(task) {
    const rows = [];
    if (!task.failure && !task.error)
        return rows;
    rows.push(["Issue", task.failure?.message ?? task.error ?? "Task failed."]);
    if (task.failure?.targetBranch) {
        rows.push(["Target", task.failure.targetBranch]);
    }
    const detailLines = (task.errorDetail ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 8);
    for (const [index, line] of detailLines.entries()) {
        rows.push([index === 0 ? "Why" : "Detail", line]);
    }
    return rows;
}
function PlainText({ text, maxLines, offset, placeholder, }) {
    if (!text) {
        return React.createElement(Text, { dimColor: true }, placeholder ?? "(empty)");
    }
    const lines = text.split("\n");
    const { visible, above, below } = windowWithMarkers(lines, maxLines, offset);
    return (React.createElement(Box, { flexDirection: "column" },
        above > 0 ? (React.createElement(Box, null,
            React.createElement(Text, { dimColor: true },
                "\u2191 ",
                above,
                " hidden above"))) : null,
        visible.map((l, i) => (React.createElement(Box, { key: i },
            React.createElement(Text, null, l || " ")))),
        below > 0 ? (React.createElement(Box, null,
            React.createElement(Text, { dimColor: true },
                "\u2193 ",
                below,
                " hidden below"))) : null));
}
function modeLabel(mode, targetBranch) {
    switch (mode) {
        case "task":
            return "task view";
        case "files":
            return `files vs ${targetBranch}`;
        case "diff":
            return `final patch vs ${targetBranch}`;
        case "log":
            return `log (commits ahead of ${targetBranch})`;
        case "agent":
            return "agent transcript (live)";
    }
}
//# sourceMappingURL=Inspector.js.map