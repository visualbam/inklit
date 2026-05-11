import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { UI } from "./theme.js";
export function DescriptionPrompt({ value, onChange, onSubmit }) {
    return (React.createElement(Box, { borderStyle: "round", borderColor: UI.accent, paddingX: 1, flexDirection: "column" },
        React.createElement(Text, { bold: true, color: UI.accent }, "New agent task"),
        React.createElement(Text, { dimColor: true }, "Describe what the agent should do. Enter to continue, esc to cancel."),
        React.createElement(Box, { marginTop: 1 },
            React.createElement(Text, { color: UI.accent }, ">  "),
            React.createElement(TextInput, { value: value, onChange: onChange, onSubmit: onSubmit }))));
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
            React.createElement(Text, { dimColor: true }, "esc  cancel"))));
}
//# sourceMappingURL=NewTaskPrompt.js.map