import React from "react";
import { Box, Text } from "ink";
import { helpSections } from "./commands.js";
import { UI } from "./theme.js";
import { padRight } from "./text.js";
export function HelpOverlay({ targetBranch }) {
    const sections = helpSections(targetBranch);
    const maxKey = Math.max(...sections.flatMap((s) => s.rows.map((r) => r[0].length)));
    return (React.createElement(Box, { borderStyle: "round", borderColor: UI.accent, paddingX: 2, paddingY: 1, flexDirection: "column", flexGrow: 1 },
        React.createElement(Box, { marginBottom: 1 },
            React.createElement(Text, { bold: true, color: UI.accent }, "inklit \u2014 keybinds")),
        sections.map((s, i) => (React.createElement(Box, { key: s.title, flexDirection: "column", marginTop: i === 0 ? 0 : 1 },
            React.createElement(Text, { bold: true }, s.title),
            s.rows.map(([k, v]) => (React.createElement(Box, { key: k },
                React.createElement(Text, { color: UI.accent }, padRight(k, maxKey)),
                React.createElement(Text, null, "  "),
                React.createElement(Text, { dimColor: false }, v))))))),
        React.createElement(Box, { marginTop: 1 },
            React.createElement(Text, { dimColor: true }, "Press ? or esc to close."))));
}
//# sourceMappingURL=HelpOverlay.js.map