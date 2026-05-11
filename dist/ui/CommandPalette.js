import React from "react";
import { Box, Text } from "ink";
import { lifecycleForTask } from "../model.js";
import { LIFECYCLE_LABEL, formatStateLabel } from "./icons.js";
import { UI } from "./theme.js";
import { commandRows } from "./commands.js";
import { padRight, truncate } from "./text.js";
export function CommandPalette({ selectedTask, density, targetBranch, showArchived, inSession, height, width, }) {
    const rows = commandRows({
        task: selectedTask,
        density,
        targetBranch,
        showArchived,
        inSession,
    });
    const maxRows = Math.max(3, height - (selectedTask ? 4 : 3));
    const visibleRows = rows.length > maxRows
        ? [
            ...rows.slice(0, Math.max(0, maxRows - 1)),
            {
                key: "...",
                label: `${rows.length - maxRows + 1} more commands hidden - keys still work`,
                muted: true,
            },
        ]
        : rows;
    const labelWidth = Math.max(12, width - 17);
    return (React.createElement(Box, { borderStyle: "round", borderColor: UI.border, paddingX: 1, paddingY: 0, flexDirection: "column", flexGrow: 1 },
        React.createElement(Box, null,
            React.createElement(Text, { bold: true, color: UI.accent }, "command palette"),
            React.createElement(Text, { dimColor: true },
                " ",
                "- press a key to run, esc to close")),
        selectedTask ? (React.createElement(Box, null,
            React.createElement(Text, { dimColor: true },
                "selected ",
                selectedTask.slug,
                " \u00B7",
                " ",
                LIFECYCLE_LABEL[lifecycleForTask(selectedTask)],
                "/",
                formatStateLabel(selectedTask)))) : null,
        visibleRows.map((row) => (React.createElement(Box, { key: `${row.key}:${row.label}` },
            React.createElement(Text, { color: row.muted ? UI.subtle : UI.accent }, padRight(row.key, 8)),
            React.createElement(Text, { dimColor: row.muted }, padRight(truncate(row.label, labelWidth), labelWidth)))))));
}
//# sourceMappingURL=CommandPalette.js.map