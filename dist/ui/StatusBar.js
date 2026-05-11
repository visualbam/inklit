import React from "react";
import { Box, Text } from "ink";
import { lifecycleForTask } from "../model.js";
import { LIFECYCLE_LABEL, formatStateLabel } from "./icons.js";
import { UI } from "./theme.js";
import { suggestedFollowUps } from "./followUps.js";
import { truncate } from "./text.js";
export function StatusBar({ flash, error, taskCount, selectedTask, inSession, filterQuery, visibleTaskCount, density, showArchived, width, }) {
    const selectedSummary = selectedTask
        ? ` · ${truncate(selectedTask.slug, 16)} [${LIFECYCLE_LABEL[lifecycleForTask(selectedTask)]}/${formatStateLabel(selectedTask)}]`
        : "";
    const filterSummary = filterQuery.trim()
        ? ` · filter ${visibleTaskCount}/${taskCount}`
        : "";
    const visibilitySummary = !filterQuery.trim() && visibleTaskCount < taskCount
        ? ` · visible ${visibleTaskCount}/${taskCount}`
        : "";
    const next = nextAction(selectedTask, inSession);
    const followUpHint = suggestedFollowUps(selectedTask).length > 0 ? " · T follow-up" : "";
    const archiveHint = showArchived ? " · z hide archived" : " · z archived";
    const densityHint = density === "compact" ? " · v detailed" : " · v compact";
    return (React.createElement(Box, { paddingX: 1 }, error ? (React.createElement(Text, { color: UI.danger }, truncate(`! ${error}`, width))) : flash ? (React.createElement(Text, { color: UI.warning }, truncate(flash, width))) : (React.createElement(Text, null,
        React.createElement(Text, { color: UI.accent }, next),
        React.createElement(Text, { dimColor: true }, truncate(` · ${taskCount} task${taskCount === 1 ? "" : "s"}${selectedSummary}${filterSummary}${visibilitySummary}${inSession ? "" : " · not in zellij"} · : commands · j/k move${followUpHint} · / filter · r refresh${densityHint}${archiveHint} · ? help`, Math.max(0, width - next.length)))))));
}
function nextAction(task, inSession) {
    if (!task)
        return "Next: launch a task with n";
    if (task.state === "permission")
        return "Next: focus pane to clear permission prompt";
    if (task.state === "waiting")
        return "Next: respond with i";
    if (task.state === "running") {
        return inSession ? "Next: watch transcript with a" : "Next: inspect task";
    }
    if (task.state === "idle")
        return "Next: inspect idle agent with a";
    if (task.state === "ready")
        return "Next: review diff or T follow-up";
    if (task.state === "merged")
        return "Next: T follow-up or let it fade out";
    return "Next: inspect task";
}
//# sourceMappingURL=StatusBar.js.map