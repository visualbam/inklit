import React from "react";
import { Box, Text } from "ink";
import { truncate } from "./text.js";
import { windowWithMarkers } from "./windowing.js";
export function DiffView({ diff, maxLines, offset, width }) {
    if (!diff) {
        return (React.createElement(Box, { paddingX: 1 },
            React.createElement(Text, { dimColor: true }, "(empty)")));
    }
    const lines = diff.split("\n");
    const { visible, above, below } = windowWithMarkers(lines, maxLines, offset);
    return (React.createElement(Box, { flexDirection: "column" },
        above > 0 ? (React.createElement(Box, null,
            React.createElement(Text, { dimColor: true },
                "\u2191 ",
                above,
                " hidden above"))) : null,
        visible.map((line, i) => (React.createElement(Box, { key: i },
            React.createElement(Text, { ...colorFor(line) }, truncate(line || " ", width))))),
        below > 0 ? (React.createElement(Box, null,
            React.createElement(Text, { dimColor: true },
                "\u2193 ",
                below,
                " hidden below"))) : null));
}
function colorFor(line) {
    if (line.startsWith("+++") || line.startsWith("---")) {
        return { dimColor: true, bold: true };
    }
    if (line.startsWith("diff --git") || line.startsWith("index ")) {
        return { dimColor: true };
    }
    if (line.startsWith("@@"))
        return { color: "cyan" };
    if (line.startsWith("+"))
        return { color: "green" };
    if (line.startsWith("-"))
        return { color: "red" };
    return {};
}
//# sourceMappingURL=DiffView.js.map