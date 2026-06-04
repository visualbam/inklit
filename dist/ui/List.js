import React from "react";
import { Box, Text } from "ink";
import { lifecycleForTask } from "../model.js";
import { STATE_ICON, STATE_COLOR, LIFECYCLE_LABEL, LIFECYCLE_COLOR, formatStateLabel, formatAge, } from "./icons.js";
import { UI } from "./theme.js";
import { ReviewBadges, reviewSummary } from "./review.js";
import { truncate } from "./text.js";
export function TaskList({ tasks, selectedSlug, totalTasks, filterQuery, density, width, height, overlaps, }) {
    if (tasks.length === 0) {
        return React.createElement(EmptyBoard, { filterQuery: filterQuery, totalTasks: totalTasks });
    }
    const windowed = windowTasks({
        tasks,
        selectedSlug,
        totalTasks,
        filterQuery,
        density,
        height,
    });
    return density === "compact" ? (React.createElement(CompactTaskList, { tasks: windowed.tasks, selectedSlug: selectedSlug, totalTasks: totalTasks, filterQuery: filterQuery, matchedTaskCount: tasks.length, hiddenAbove: windowed.hiddenAbove, hiddenBelow: windowed.hiddenBelow, width: width, overlaps: overlaps })) : (React.createElement(DetailedTaskList, { tasks: windowed.tasks, selectedSlug: selectedSlug, totalTasks: totalTasks, filterQuery: filterQuery, matchedTaskCount: tasks.length, hiddenAbove: windowed.hiddenAbove, hiddenBelow: windowed.hiddenBelow, width: width, overlaps: overlaps }));
}
export function taskListLineCount(tasks, totalTasks, filterQuery, density) {
    if (tasks.length === 0)
        return filterQuery.trim() ? 4 : 6;
    const groupCount = countGroups(tasks);
    const filterFooter = filterQuery.trim() && tasks.length < totalTasks ? 1 : 0;
    if (density === "compact")
        return groupCount + tasks.length * 2 + filterFooter;
    return 2 + groupCount + tasks.length + filterFooter;
}
export function taskListMinimumHeight(tasks, totalTasks, filterQuery, density) {
    if (tasks.length === 0)
        return filterQuery.trim() ? 4 : 6;
    const targetRows = Math.min(tasks.length, density === "compact" ? 3 : 4);
    const sample = tasks.slice(0, targetRows);
    const hasOverflow = tasks.length > targetRows;
    return taskListLineCountForSlice({
        tasks: sample,
        totalTasks,
        matchedTaskCount: tasks.length,
        filterQuery,
        density,
        hiddenAbove: false,
        hiddenBelow: hasOverflow,
    });
}
function windowTasks({ tasks, selectedSlug, totalTasks, filterQuery, density, height, }) {
    if (taskListLineCountForSlice({
        tasks,
        totalTasks,
        matchedTaskCount: tasks.length,
        filterQuery,
        density,
        hiddenAbove: false,
        hiddenBelow: false,
    }) <= height) {
        return { tasks, hiddenAbove: 0, hiddenBelow: 0 };
    }
    const selectedIndex = Math.max(0, tasks.findIndex((task) => task.slug === selectedSlug));
    let start = selectedIndex;
    let end = selectedIndex + 1;
    while (start > 0 || end < tasks.length) {
        const visibleAbove = selectedIndex - start;
        const visibleBelow = end - selectedIndex - 1;
        const preferAbove = visibleAbove <= visibleBelow;
        const added = preferAbove
            ? tryGrowWindow("above") || tryGrowWindow("below")
            : tryGrowWindow("below") || tryGrowWindow("above");
        if (added)
            continue;
        break;
    }
    return {
        tasks: tasks.slice(start, end),
        hiddenAbove: start,
        hiddenBelow: tasks.length - end,
    };
    function tryGrowWindow(direction) {
        const nextStart = direction === "above" ? start - 1 : start;
        const nextEnd = direction === "below" ? end + 1 : end;
        if (nextStart < 0 || nextEnd > tasks.length)
            return false;
        const fits = taskListLineCountForSlice({
            tasks: tasks.slice(nextStart, nextEnd),
            totalTasks,
            matchedTaskCount: tasks.length,
            filterQuery,
            density,
            hiddenAbove: nextStart > 0,
            hiddenBelow: nextEnd < tasks.length,
        }) <= height;
        if (!fits)
            return false;
        start = nextStart;
        end = nextEnd;
        return true;
    }
}
function taskListLineCountForSlice({ tasks, totalTasks, matchedTaskCount, filterQuery, density, hiddenAbove, hiddenBelow, }) {
    const filterFooter = filterQuery.trim() && matchedTaskCount < totalTasks ? 1 : 0;
    const hiddenMarkers = (hiddenAbove ? 1 : 0) + (hiddenBelow ? 1 : 0);
    if (tasks.length === 0)
        return filterFooter + hiddenMarkers;
    const groupCount = countGroups(tasks);
    const itemLines = density === "compact" ? tasks.length * 2 : tasks.length;
    const headerLines = density === "compact" ? 0 : 2;
    return headerLines + groupCount + itemLines + filterFooter + hiddenMarkers;
}
function DetailedTaskList({ tasks, selectedSlug, totalTasks, filterQuery, matchedTaskCount, hiddenAbove, hiddenBelow, width, overlaps, }) {
    // Reserve roughly: rail+icon + stage + pane + age + review + spacing.
    const reviewCol = 18;
    const fixed = 55 + reviewCol;
    const slugCol = Math.max(10, width - fixed - 2);
    const rule = "╌".repeat(Math.max(0, width - 2));
    let currentGroup = null;
    return (React.createElement(Box, { flexDirection: "column" },
        React.createElement(Box, { paddingX: 1 },
            React.createElement(Text, { dimColor: true },
                "    ",
                pad("TASK", slugCol),
                " ",
                pad("STAGE", 8),
                " ",
                pad("PANE", 9),
                " ",
                pad("REVIEW", reviewCol),
                " ",
                "  ",
                pad("AGE", 5))),
        React.createElement(Box, { paddingX: 1 },
            React.createElement(Text, { dimColor: true }, rule)),
        hiddenAbove > 0 ? React.createElement(HiddenMarker, { count: hiddenAbove, direction: "above" }) : null,
        tasks.map((t) => {
            const group = groupForTask(t);
            const showGroup = group.key !== currentGroup;
            currentGroup = group.key;
            const sel = t.slug === selectedSlug;
            const icon = STATE_ICON[t.state];
            const color = STATE_COLOR[t.state];
            const stateLabel = formatStateLabel(t);
            const lifecycle = lifecycleForTask(t);
            const lifecycleLabel = LIFECYCLE_LABEL[lifecycle];
            const lifecycleColor = LIFECYCLE_COLOR[lifecycle];
            return (React.createElement(React.Fragment, { key: t.slug },
                showGroup ? React.createElement(GroupHeader, { group: group }) : null,
                React.createElement(Box, { paddingX: 1 },
                    React.createElement(Text, null,
                        React.createElement(Text, { color: sel ? UI.accent : UI.subtle }, sel ? "▌" : " "),
                        React.createElement(Text, null, " "),
                        React.createElement(Text, { bold: sel, color: color }, icon),
                        React.createElement(Text, null, " "),
                        React.createElement(Text, { bold: sel },
                            pad(t.error ?? t.slug, slugCol),
                            " "),
                        React.createElement(Text, { bold: sel, color: lifecycleColor }, pad(lifecycleLabel, 8)),
                        React.createElement(Text, null, " "),
                        React.createElement(Text, { bold: sel, color: color }, pad(stateLabel, 9)),
                        React.createElement(Text, null, " "),
                        React.createElement(Text, { bold: sel },
                            React.createElement(ReviewBadges, { task: t, maxWidth: reviewCol }),
                            pad("", Math.max(0, reviewCol - reviewSummary(t).length))),
                        React.createElement(Text, null, " "),
                        React.createElement(Text, { color: overlaps?.has(t.slug) ? "yellow" : undefined }, overlaps?.has(t.slug) ? "⚠ " : "  "),
                        React.createElement(Text, { bold: sel, dimColor: !sel }, pad(formatAge(t.ageSeconds), 5))))));
        }),
        hiddenBelow > 0 ? React.createElement(HiddenMarker, { count: hiddenBelow, direction: "below" }) : null,
        filterQuery.trim() && matchedTaskCount < totalTasks ? (React.createElement(Box, { paddingX: 1 },
            React.createElement(Text, { dimColor: true },
                "showing ",
                matchedTaskCount,
                "/",
                totalTasks,
                " \u00B7 clear filter with /"))) : null));
}
function CompactTaskList({ tasks, selectedSlug, totalTasks, filterQuery, matchedTaskCount, hiddenAbove, hiddenBelow, width, overlaps, }) {
    let currentGroup = null;
    return (React.createElement(Box, { flexDirection: "column" },
        hiddenAbove > 0 ? React.createElement(HiddenMarker, { count: hiddenAbove, direction: "above" }) : null,
        tasks.map((t) => {
            const group = groupForTask(t);
            const showGroup = group.key !== currentGroup;
            currentGroup = group.key;
            const sel = t.slug === selectedSlug;
            const color = STATE_COLOR[t.state];
            const lifecycle = lifecycleForTask(t);
            const meta = `${LIFECYCLE_LABEL[lifecycle]} · ${formatStateLabel(t)} · ${formatAge(t.ageSeconds)}`;
            return (React.createElement(React.Fragment, { key: t.slug },
                showGroup ? React.createElement(GroupHeader, { group: group }) : null,
                React.createElement(Box, { paddingX: 1 },
                    React.createElement(Text, null,
                        React.createElement(Text, { color: sel ? UI.accent : UI.subtle }, sel ? "▌" : " "),
                        React.createElement(Text, null, " "),
                        React.createElement(Text, { bold: sel, color: color }, STATE_ICON[t.state]),
                        React.createElement(Text, null, " "),
                        React.createElement(Text, { bold: sel }, truncate(t.error ?? t.slug, Math.max(18, width - 28))))),
                React.createElement(Box, { paddingX: 1 },
                    React.createElement(Text, null,
                        React.createElement(Text, { color: sel ? UI.accent : UI.subtle }, " "),
                        React.createElement(Text, { dimColor: true },
                            "   ",
                            truncate(meta, 28),
                            " \u00B7 "),
                        React.createElement(ReviewBadges, { task: t, maxWidth: Math.max(12, width - 38) }),
                        overlaps?.has(t.slug) ? React.createElement(Text, { color: "yellow" }, " \u26A0") : null))));
        }),
        hiddenBelow > 0 ? React.createElement(HiddenMarker, { count: hiddenBelow, direction: "below" }) : null,
        filterQuery.trim() && matchedTaskCount < totalTasks ? (React.createElement(Box, { paddingX: 1 },
            React.createElement(Text, { dimColor: true },
                "showing ",
                matchedTaskCount,
                "/",
                totalTasks,
                " \u00B7 clear filter with /"))) : null));
}
function HiddenMarker({ count, direction, }) {
    return (React.createElement(Box, { paddingX: 1 },
        React.createElement(Text, { dimColor: true },
            direction === "above" ? "↑" : "↓",
            " ",
            count,
            " task",
            count === 1 ? "" : "s",
            " ",
            "hidden ",
            direction)));
}
function EmptyBoard({ filterQuery, totalTasks, }) {
    const query = filterQuery.trim();
    if (query) {
        return (React.createElement(Box, { paddingX: 1, flexDirection: "column" },
            React.createElement(Text, null,
                "No tasks match \"",
                query,
                "\"."),
            React.createElement(Text, { dimColor: true },
                "Edit with ",
                React.createElement(Text, { color: UI.accent }, "/"),
                ", clear the query, or press",
                " ",
                React.createElement(Text, { color: UI.accent }, "r"),
                " to refresh.")));
    }
    return (React.createElement(Box, { paddingX: 1, flexDirection: "column" },
        React.createElement(Text, { bold: true }, "No agent tasks yet"),
        React.createElement(Text, { dimColor: true },
            React.createElement(Text, { color: UI.accent }, "n"),
            " new task \u00B7 ",
            React.createElement(Text, { color: UI.accent }, ":"),
            " ",
            "command palette \u00B7 ",
            React.createElement(Text, { color: UI.accent }, "?"),
            " help"),
        React.createElement(Text, { dimColor: true }, "Agents run headlessly in tmux; quitting this board leaves them running."),
        totalTasks > 0 ? (React.createElement(Text, { dimColor: true }, "Archived tasks are hidden. Press z to show them.")) : null));
}
function GroupHeader({ group }) {
    return (React.createElement(Box, { paddingX: 1, marginTop: 0 },
        React.createElement(Text, { color: group.color, bold: true }, group.label)));
}
function groupForTask(task) {
    const lifecycle = lifecycleForTask(task);
    if (lifecycle === "archived") {
        return { key: "archived", label: "Archived", color: UI.subtle };
    }
    if (lifecycle === "cancelled") {
        return { key: "cancelled", label: "Cancelled", color: UI.danger };
    }
    switch (task.state) {
        case "permission":
        case "waiting":
        case "running":
        case "idle":
            return { key: "active", label: "Active", color: UI.accent };
        case "merging":
            return { key: "merging", label: "Merging", color: UI.warning };
        case "ready":
            return { key: "ready", label: "Ready", color: UI.success };
        case "failed":
            return { key: "failed", label: "Failed", color: UI.danger };
        case "merged":
            return { key: "done", label: "Done", color: UI.subtle };
    }
}
function countGroups(tasks) {
    let count = 0;
    let current = null;
    for (const task of tasks) {
        const key = groupForTask(task).key;
        if (key === current)
            continue;
        current = key;
        count += 1;
    }
    return count;
}
function pad(s, n) {
    if (s.length >= n)
        return s.slice(0, n);
    return s + " ".repeat(n - s.length);
}
//# sourceMappingURL=List.js.map