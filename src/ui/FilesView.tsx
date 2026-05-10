import React from "react";
import { Box, Text } from "ink";
import type { StatusEntry } from "../wt.js";

interface Props {
  entries: StatusEntry[];
  maxLines: number;
}

export function FilesView({ entries, maxLines }: Props) {
  if (entries.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>(no uncommitted changes)</Text>
      </Box>
    );
  }
  const visible = entries.slice(0, maxLines);
  const overflow = entries.length - visible.length;

  return (
    <Box flexDirection="column">
      {visible.map((e) => {
        const { fg, label } = describe(e.code);
        const stat =
          e.added || e.deleted ? `+${e.added} -${e.deleted}` : "";
        return (
          <Box key={e.path}>
            <Text color={fg}>{padEnd(label, 8)}</Text>
            <Text>{e.path}</Text>
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
      {overflow > 0 ? (
        <Text dimColor>…{overflow} more file{overflow === 1 ? "" : "s"}</Text>
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

function padEnd(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
