import React from "react";
import { Box, Text } from "ink";

interface Props {
  diff: string;
  maxLines: number;
}

export function DiffView({ diff, maxLines }: Props) {
  if (!diff) {
    return (
      <Box paddingX={1}>
        <Text dimColor>(empty)</Text>
      </Box>
    );
  }
  const lines = diff.split("\n");
  const visible = lines.slice(0, maxLines);
  const overflow = lines.length - visible.length;

  return (
    <Box flexDirection="column">
      {visible.map((line, i) => (
        <Text key={i} {...colorFor(line)}>
          {line || " "}
        </Text>
      ))}
      {overflow > 0 ? (
        <Text dimColor>
          …{overflow} more line{overflow === 1 ? "" : "s"} (resize terminal to
          see more)
        </Text>
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
