import React from "react";
import { Box, Text } from "ink";
import { UI } from "./theme.js";
export function DescriptionPrompt({ value, cursor, width, hasClipboardImage }) {
    const before = value.slice(0, cursor);
    const at = value.slice(cursor, cursor + 1) || " ";
    const after = value.slice(cursor + 1);
    return (React.createElement(Box, { borderStyle: "round", borderColor: UI.accent, paddingX: 1, width: width, flexDirection: "column" },
        React.createElement(Text, { bold: true, color: UI.accent }, "New agent task"),
        React.createElement(Text, { dimColor: true }, "Describe what the agent should do. Enter to continue, esc to cancel."),
        hasClipboardImage ? (React.createElement(Text, { dimColor: true }, "ctrl+v  attach clipboard image")) : null,
        React.createElement(Box, { marginTop: 1 },
            React.createElement(Text, null,
                React.createElement(Text, { color: UI.accent }, ">  "),
                React.createElement(Text, null, before),
                React.createElement(Text, { inverse: true }, at),
                React.createElement(Text, null, after)))));
}
export function AgentPicker({ label, intent = "spawn" }) {
    const heading = intent === "resume" ? "Resume which agent?" : "Pick agent for:";
    return (React.createElement(Box, { borderStyle: "round", borderColor: UI.accent, paddingX: 1, flexDirection: "column" },
        React.createElement(Text, { bold: true, color: UI.accent },
            heading,
            " ",
            React.createElement(Text, { color: "white" }, label)),
        React.createElement(Box, { marginTop: 1, flexDirection: "column" },
            React.createElement(Text, null,
                React.createElement(Text, { color: UI.accent, bold: true }, "c"),
                "  ",
                "claude code",
                " ",
                intent === "resume" ? React.createElement(Text, { dimColor: true }, "(--continue)") : null),
            React.createElement(Text, null,
                React.createElement(Text, { color: UI.accent, bold: true }, "x"),
                "  ",
                "codex",
                " ",
                intent === "resume" ? React.createElement(Text, { dimColor: true }, "(resume --last)") : null),
            React.createElement(Text, null,
                React.createElement(Text, { color: UI.accent, bold: true }, "o"),
                "  ",
                "opencode",
                " ",
                intent === "resume" ? React.createElement(Text, { dimColor: true }, "(--continue)") : null),
            React.createElement(Text, { dimColor: true }, "esc  cancel"))));
}
//# sourceMappingURL=NewTaskPrompt.js.map