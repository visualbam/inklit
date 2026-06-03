import React from "react";
import { Box, Text } from "ink";
import { lifecycleForTask } from "../model.js";
import { UI } from "./theme.js";
import { truncate } from "./text.js";
/** Lists recent tasks so the user can pick one to inherit context from. */
export function ContextPickerPrompt({ tasks, selectedIndex, description, width, }) {
    const eligible = tasks.filter((t) => {
        const lc = lifecycleForTask(t);
        return lc === "done" || lc === "ready" || lc === "failed";
    });
    return (React.createElement(Box, { borderStyle: "round", borderColor: UI.accent, paddingX: 1, flexDirection: "column" },
        React.createElement(Text, { bold: true, color: UI.accent }, "Inherit context from a previous task?"),
        React.createElement(Text, { dimColor: true },
            "For: ",
            React.createElement(Text, { color: "white" }, truncate(description, width - 20))),
        React.createElement(Text, { dimColor: true }, "j/k select \u00B7 enter pick \u00B7 s/esc skip"),
        React.createElement(Box, { marginTop: 1, flexDirection: "column" }, eligible.length === 0 ? (React.createElement(Text, { dimColor: true }, "No eligible tasks \u2014 press s or esc to skip.")) : (eligible.map((task, i) => {
            const isSelected = i === selectedIndex;
            const lc = lifecycleForTask(task);
            return (React.createElement(Box, { key: task.slug },
                React.createElement(Text, { color: isSelected ? UI.accent : undefined, bold: isSelected }, isSelected ? "▸ " : "  "),
                React.createElement(Text, { color: isSelected ? "white" : undefined }, truncate(task.slug, 24)),
                React.createElement(Text, { dimColor: true }, "  "),
                React.createElement(Text, { dimColor: true },
                    "[",
                    lc,
                    "] ",
                    truncate(task.subject, width - 40))));
        })))));
}
//# sourceMappingURL=ContextPickerPrompt.js.map