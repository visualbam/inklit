import React from "react";
import { Box, Text } from "ink";
import type { StatusEntry } from "../wt.js";

interface Props {
  entries: StatusEntry[];
  maxLines: number;
  offset: number;
  width: number;
}

const LABEL_WIDTH = 10;

export function FilesView({ entries, maxLines, offset, width }: Props) {
  if (entries.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>(no task changes vs main version)</Text>
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
            <Text color={fg}>{padEnd(label, LABEL_WIDTH)}</Text>
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

function padEnd(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
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

function truncateMiddle(s: string, max: number): string {
  if (max <= 1) return s.slice(0, Math.max(0, max));
  if (s.length <= max) return s;
  const head = Math.max(1, Math.ceil((max - 1) * 0.4));
  const tail = Math.max(1, max - head - 1);
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
