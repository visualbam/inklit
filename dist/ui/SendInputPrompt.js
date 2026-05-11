import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { UI } from "./theme.js";
/**
 * One-line input that streams characters straight into the agent's pane via
 * `zellij action write --pane-id`. Submit fires the text plus a CR so
 * the agent treats it as a completed line. Empty submit cancels — for raw
 * "press enter" you can focus the pane the old-fashioned way.
 */
export function SendInputPrompt({ slug, value, onChange, onSubmit, busy, }) {
    return (React.createElement(Box, { borderStyle: "round", borderColor: UI.accent, paddingX: 1, flexDirection: "column" },
        React.createElement(Text, { bold: true, color: UI.accent }, busy ? `sending → ${slug}…` : `→ send to ${slug}`),
        React.createElement(Text, { dimColor: true }, "Lands at the agent's next prompt. Enter sends; esc cancels."),
        React.createElement(Box, { marginTop: 1 },
            React.createElement(Text, { color: UI.accent }, ">  "),
            busy ? (React.createElement(Text, { dimColor: true }, value)) : (React.createElement(TextInput, { value: value, onChange: onChange, onSubmit: onSubmit })))));
}
//# sourceMappingURL=SendInputPrompt.js.map