import React from "react";
import { Box, Text } from "ink";
import type { Task, InspectorMode } from "../model.js";
import type { StatusEntry } from "../wt.js";
import { DiffView } from "./DiffView.js";
import { FilesView } from "./FilesView.js";

interface Props {
  task: Task | null;
  mode: InspectorMode;
  /** Mode-specific content. Strings for diff/log/agent; structured for files. */
  diff: string;
  log: string;
  agent: string;
  files: StatusEntry[];
  loading: boolean;
  height: number;
  /** Lines hidden above the viewport (already clamped by App). */
  offset: number;
}

export function Inspector({
  task,
  mode,
  diff,
  log,
  agent,
  files,
  loading,
  height,
  offset,
}: Props) {
  // Reserve 2 lines for header + 1 for spacing inside the box.
  const maxLines = Math.max(3, height - 4);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      flexGrow={1}
    >
      <Box justifyContent="space-between">
        <Text bold>
          {task ? task.slug : "(no selection)"}{" "}
          <Text dimColor>· {modeLabel(mode)}</Text>
        </Text>
        {task ? (
          <Text dimColor>
            {task.shortSha} · {truncatePath(task.path, 50)}
          </Text>
        ) : null}
      </Box>
      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        {!task ? (
          <Text dimColor>nothing selected</Text>
        ) : loading ? (
          <Text dimColor>loading…</Text>
        ) : mode === "diff" ? (
          <DiffView diff={diff} maxLines={maxLines} offset={offset} />
        ) : mode === "files" ? (
          <FilesView entries={files} maxLines={maxLines} offset={offset} />
        ) : mode === "log" ? (
          <PlainText text={log} maxLines={maxLines} offset={offset} />
        ) : (
          <PlainText
            text={agent}
            maxLines={maxLines}
            offset={offset}
            placeholder="(agent transcript empty — pane may not be live)"
          />
        )}
      </Box>
      <Box>
        <Text dimColor>
          [<Text bold>f</Text>]iles · [<Text bold>d</Text>]iff · [
          <Text bold>l</Text>]og · [<Text bold>a</Text>]gent · scroll{" "}
          <Text bold>J/K</Text> ^d/^u <Text bold>gg/G</Text>
        </Text>
      </Box>
    </Box>
  );
}

function PlainText({
  text,
  maxLines,
  offset,
  placeholder,
}: {
  text: string;
  maxLines: number;
  offset: number;
  placeholder?: string;
}) {
  if (!text) {
    return <Text dimColor>{placeholder ?? "(empty)"}</Text>;
  }
  const lines = text.split("\n");
  const maxOffset = Math.max(0, lines.length - maxLines);
  const start = Math.min(Math.max(0, offset), maxOffset);
  const visible = lines.slice(start, start + maxLines);
  const above = start;
  const below = Math.max(0, lines.length - start - visible.length);
  return (
    <Box flexDirection="column">
      {above > 0 ? <Text dimColor>↑ {above} hidden above</Text> : null}
      {visible.map((l, i) => (
        <Text key={i}>{l || " "}</Text>
      ))}
      {below > 0 ? <Text dimColor>↓ {below} hidden below</Text> : null}
    </Box>
  );
}

function modeLabel(mode: InspectorMode): string {
  switch (mode) {
    case "files":
      return "files (uncommitted)";
    case "diff":
      return "diff vs main";
    case "log":
      return "log (commits ahead of main)";
    case "agent":
      return "agent transcript (live)";
  }
}

function truncatePath(p: string, max: number): string {
  if (p.length <= max) return p;
  return "…" + p.slice(-(max - 1));
}
