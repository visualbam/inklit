import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { UI } from "./theme.js";
export function FilterPrompt({ value, matched, total, onChange, onSubmit, }) {
    return (React.createElement(Box, { borderStyle: "round", borderColor: UI.accent, paddingX: 1, flexDirection: "column" },
        React.createElement(Text, { bold: true, color: UI.accent },
            "Filter tasks",
            React.createElement(Text, { dimColor: true },
                " ",
                matched,
                "/",
                total)),
        React.createElement(Text, { dimColor: true }, "Type to filter. Enter keeps, esc closes, clear query shows all."),
        React.createElement(Box, { marginTop: 1 },
            React.createElement(Text, { color: UI.accent }, ">  "),
            React.createElement(TextInput, { value: value, onChange: onChange, onSubmit: onSubmit }))));
}
//# sourceMappingURL=FilterPrompt.js.map