import React from "react";
import { Box, Text } from "ink";
import { padRight, truncateMiddle } from "./text.js";
import { windowWithMarkers } from "./windowing.js";
const LABEL_WIDTH = 10;
export function FilesView({ entries, targetBranch, maxLines, offset, width, }) {
    if (entries.length === 0) {
        return (React.createElement(Box, { paddingX: 1 },
            React.createElement(Text, { dimColor: true },
                "(no task changes vs ",
                targetBranch,
                ")")));
    }
    const { visible, above, below } = windowWithMarkers(entries, maxLines, offset);
    return (React.createElement(Box, { flexDirection: "column" },
        above > 0 ? (React.createElement(Box, null,
            React.createElement(Text, { dimColor: true },
                "\u2191 ",
                above,
                " hidden above"))) : null,
        visible.map((e) => {
            const { fg, label } = describe(e.code);
            const stat = e.added || e.deleted ? `+${e.added} -${e.deleted}` : "";
            const statReserve = stat ? stat.length + 2 : 0;
            const pathWidth = Math.max(1, width - LABEL_WIDTH - 1 - statReserve);
            return (React.createElement(Box, { key: e.path },
                React.createElement(Text, { color: fg }, padRight(label, LABEL_WIDTH)),
                React.createElement(Text, null, " "),
                React.createElement(Text, null, truncateMiddle(e.path, pathWidth)),
                stat ? (React.createElement(React.Fragment, null,
                    React.createElement(Text, null, "  "),
                    React.createElement(Text, { color: "green" },
                        "+",
                        e.added),
                    React.createElement(Text, null, " "),
                    React.createElement(Text, { color: "red" },
                        "-",
                        e.deleted))) : null));
        }),
        below > 0 ? (React.createElement(Box, null,
            React.createElement(Text, { dimColor: true },
                "\u2193 ",
                below,
                " hidden below"))) : null));
}
function describe(code) {
    const c = code.trim();
    if (c === "??")
        return { fg: "yellow", label: "untracked" };
    if (c.startsWith("A"))
        return { fg: "green", label: "added" };
    if (c.startsWith("M") || c.endsWith("M"))
        return { fg: "yellow", label: "modified" };
    if (c.startsWith("D") || c.endsWith("D"))
        return { fg: "red", label: "deleted" };
    if (c.startsWith("R"))
        return { fg: "magenta", label: "renamed" };
    return { fg: "white", label: code };
}
//# sourceMappingURL=FilesView.js.map