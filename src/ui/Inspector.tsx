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
          <DiffView diff={diff} maxLines={maxLines} />
        ) : mode === "files" ? (
          <FilesView entries={files} maxLines={maxLines} />
        ) : mode === "log" ? (
          <PlainText text={log} maxLines={maxLines} />
        ) : (
          <PlainText
            text={agent}
            maxLines={maxLines}
            placeholder="(agent transcript empty — pane may not be live)"
          />
        )}
      </Box>
      <Box>
        <Text dimColor>
          [<Text bold>f</Text>]iles · [<Text bold>d</Text>]iff · [
          <Text bold>l</Text>]og · [<Text bold>a</Text>]gent
        </Text>
      </Box>
    </Box>
  );
}

function PlainText({
  text,
  maxLines,
  placeholder,
}: {
  text: string;
  maxLines: number;
  placeholder?: string;
}) {
  if (!text) {
    return <Text dimColor>{placeholder ?? "(empty)"}</Text>;
  }
  const lines = text.split("\n");
  const visible = lines.slice(-maxLines); // tail by default
  return (
    <Box flexDirection="column">
      {visible.map((l, i) => (
        <Text key={i}>{l || " "}</Text>
      ))}
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
