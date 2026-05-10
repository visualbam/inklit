import React from "react";
import { Box, Text } from "ink";

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

function windowWithMarkers<T>(items: T[], maxLines: number, offset: number) {
  const total = items.length;
  const maxOffset =
    total <= maxLines ? 0 : total - Math.max(1, maxLines - 1);
  const start = Math.min(Math.max(0, offset), Math.max(0, maxOffset));
  const above = start;
  const hasAbove = above > 0;
  let budget = Math.max(0, maxLines - (hasAbove ? 1 : 0));
  let visible = items.slice(start, start + budget);
  let below = Math.max(0, total - start - visible.length);
  if (below > 0 && budget > 0) {
    budget -= 1;
    visible = items.slice(start, start + budget);
    below = Math.max(0, total - start - visible.length);
  }
  return { visible, above, below };
}

function truncate(s: string, max: number): string {
  if (max <= 1) return s.slice(0, Math.max(0, max));
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
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
