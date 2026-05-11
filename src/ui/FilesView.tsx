import React from "react";
import { Box, Text } from "ink";
import type { StatusEntry } from "../wt.js";
import { padRight, truncateMiddle } from "./text.js";
import { windowWithMarkers } from "./windowing.js";

interface Props {
  entries: StatusEntry[];
  targetBranch: string;
  maxLines: number;
  offset: number;
  width: number;
}

const LABEL_WIDTH = 10;

export function FilesView({
  entries,
  targetBranch,
  maxLines,
  offset,
  width,
}: Props) {
  if (entries.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>(no task changes vs {targetBranch})</Text>
      </Box>
    );
  }
  const { visible, above, below } = windowWithMarkers(
    entries,
    maxLines,
    offset
  );

  return (
    <Box flexDirection="column">
      {above > 0 ? (
        <Box>
          <Text dimColor>↑ {above} hidden above</Text>
        </Box>
      ) : null}
      {visible.map((e) => {
        const { fg, label } = describe(e.code);
        const stat =
          e.added || e.deleted ? `+${e.added} -${e.deleted}` : "";
        const statReserve = stat ? stat.length + 2 : 0;
        const pathWidth = Math.max(1, width - LABEL_WIDTH - 1 - statReserve);
        return (
          <Box key={e.path}>
            <Text color={fg}>{padRight(label, LABEL_WIDTH)}</Text>
            <Text> </Text>
            <Text>{truncateMiddle(e.path, pathWidth)}</Text>
            {stat ? (
              <>
                <Text>{"  "}</Text>
                <Text color="green">+{e.added}</Text>
                <Text> </Text>
                <Text color="red">-{e.deleted}</Text>
              </>
            ) : null}
          </Box>
        );
      })}
      {below > 0 ? (
        <Box>
          <Text dimColor>↓ {below} hidden below</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function describe(code: string): { fg: string; label: string } {
  const c = code.trim();
  if (c === "??") return { fg: "yellow", label: "untracked" };
  if (c.startsWith("A")) return { fg: "green", label: "added" };
  if (c.startsWith("M") || c.endsWith("M")) return { fg: "yellow", label: "modified" };
  if (c.startsWith("D") || c.endsWith("D")) return { fg: "red", label: "deleted" };
  if (c.startsWith("R")) return { fg: "magenta", label: "renamed" };
  return { fg: "white", label: code };
}
