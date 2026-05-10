import React from "react";
import { Box, Text } from "ink";

interface Props {
  diff: string;
  maxLines: number;
  offset: number;
}

export function DiffView({ diff, maxLines, offset }: Props) {
  if (!diff) {
    return (
      <Box paddingX={1}>
        <Text dimColor>(empty)</Text>
      </Box>
    );
  }
  const lines = diff.split("\n");
  const maxOffset = Math.max(0, lines.length - maxLines);
  const start = Math.min(Math.max(0, offset), maxOffset);
  const visible = lines.slice(start, start + maxLines);
  const above = start;
  const below = Math.max(0, lines.length - start - visible.length);

  return (
    <Box flexDirection="column">
      {above > 0 ? (
        <Text dimColor>↑ {above} hidden above</Text>
      ) : null}
      {visible.map((line, i) => (
        <Text key={i} {...colorFor(line)}>
          {line || " "}
        </Text>
      ))}
      {below > 0 ? (
        <Text dimColor>↓ {below} hidden below</Text>
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
