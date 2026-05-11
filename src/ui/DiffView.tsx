import React from "react";
import { Box, Text } from "ink";
import { truncate } from "./text.js";
import { windowWithMarkers } from "./windowing.js";

interface Props {
  diff: string;
  maxLines: number;
  offset: number;
  width: number;
}

export function DiffView({ diff, maxLines, offset, width }: Props) {
  if (!diff) {
    return (
      <Box paddingX={1}>
        <Text dimColor>(empty)</Text>
      </Box>
    );
  }
  const lines = diff.split("\n");
  const { visible, above, below } = windowWithMarkers(
    lines,
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
      {visible.map((line, i) => (
        <Box key={i}>
          <Text {...colorFor(line)}>{truncate(line || " ", width)}</Text>
        </Box>
      ))}
      {below > 0 ? (
        <Box>
          <Text dimColor>↓ {below} hidden below</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function colorFor(line: string): { color?: string; dimColor?: boolean; bold?: boolean } {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return { dimColor: true, bold: true };
  }
  if (line.startsWith("diff --git") || line.startsWith("index ")) {
    return { dimColor: true };
  }
  if (line.startsWith("@@")) return { color: "cyan" };
  if (line.startsWith("+")) return { color: "green" };
  if (line.startsWith("-")) return { color: "red" };
  return {};
}
