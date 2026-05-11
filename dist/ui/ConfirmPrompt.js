import React from "react";
import { Box, Text } from "ink";
import { UI } from "./theme.js";
export function ConfirmPrompt({ action, slug, targetBranch = "main", busy, }) {
    const color = action === "kill" ? UI.danger : UI.warning;
    const verb = action === "kill"
        ? "kill"
        : action === "closeAll"
            ? "close all live panes"
            : `apply to ${targetBranch}`;
    const detail = action === "kill"
        ? "Closes the zellij pane and runs `wt remove -f -D` (force, even if unmerged)."
        : action === "closeAll"
            ? "Closes live zellij agent panes only. Worktrees and task records survive; enter resumes later."
            : `Runs \`wt merge ${targetBranch}\` to apply this task (squash + remove on success).`;
    return (React.createElement(Box, { borderStyle: "round", borderColor: color, paddingX: 1, flexDirection: "column" },
        React.createElement(Text, { bold: true, color: color }, busy
            ? `${verb}…`
            : action === "closeAll"
                ? `Confirm: close ${slug}?`
                : `Confirm: ${verb} "${slug}"?`),
        React.createElement(Text, { dimColor: true }, detail),
        !busy ? (React.createElement(Box, { marginTop: 1 },
            React.createElement(Text, null,
                React.createElement(Text, { color: color, bold: true }, "y"),
                " ",
                "confirm",
                "   ",
                React.createElement(Text, { bold: true }, "n"),
                "/",
                React.createElement(Text, { bold: true }, "esc"),
                " cancel"))) : null));
}
//# sourceMappingURL=ConfirmPrompt.js.map