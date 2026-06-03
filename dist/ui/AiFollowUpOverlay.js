import React from "react";
import { Box, Text } from "ink";
import { UI } from "./theme.js";
import { truncate } from "./text.js";
/** Picker overlay for AI-generated follow-up task suggestions. */
export function AiFollowUpOverlay({ followUps, selectedIndex, taskSlug, width, }) {
    return (React.createElement(Box, { borderStyle: "round", borderColor: UI.accent, paddingX: 1, flexDirection: "column" },
        React.createElement(Text, { bold: true, color: UI.accent },
            "Suggested next tasks after applying",
            " ",
            React.createElement(Text, { color: "white" }, taskSlug)),
        React.createElement(Text, { dimColor: true }, "j/k select \u00B7 enter spawn \u00B7 esc dismiss"),
        React.createElement(Box, { marginTop: 1, flexDirection: "column" }, followUps.length === 0 ? (React.createElement(Text, { dimColor: true }, "No suggestions available.")) : (followUps.map((f, i) => {
            const isSelected = i === selectedIndex;
            return (React.createElement(Box, { key: i, flexDirection: "column", marginBottom: 1 },
                React.createElement(Box, null,
                    React.createElement(Text, { color: isSelected ? UI.accent : undefined, bold: isSelected }, isSelected ? "▸ " : "  "),
                    React.createElement(Text, { bold: isSelected, color: isSelected ? "white" : undefined },
                        i + 1,
                        ". ",
                        truncate(f.title, width - 8))),
                React.createElement(Box, null,
                    React.createElement(Text, null, "    "),
                    React.createElement(Text, { dimColor: true }, truncate(f.detail, width - 8)))));
        })))));
}
//# sourceMappingURL=AiFollowUpOverlay.js.map