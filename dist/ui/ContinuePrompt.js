import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { UI } from "./theme.js";
/** One-line prompt that resumes an agent with an additional instruction. */
export function ContinuePrompt({ slug, value, onChange, onSubmit }) {
    return (React.createElement(Box, { borderStyle: "round", borderColor: UI.accent, paddingX: 1, flexDirection: "column" },
        React.createElement(Text, { bold: true, color: UI.accent },
            "continue ",
            slug,
            " with\u2026"),
        React.createElement(Text, { dimColor: true }, "Resumes the agent with this extra instruction. Enter continues; esc cancels."),
        React.createElement(Box, { marginTop: 1 },
            React.createElement(Text, { color: UI.accent }, ">  "),
            React.createElement(TextInput, { value: value, onChange: onChange, onSubmit: onSubmit }))));
}
//# sourceMappingURL=ContinuePrompt.js.map