import React from "react";
import { Box, Text } from "ink";
import type { Task, InspectorMode } from "../model.js";

interface Props {
  task: Task | null;
  mode: InspectorMode;
  content: string;
  loading: boolean;
}

export function Inspector({ task, mode, content, loading }: Props) {
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
            {task.shortSha} · {task.path}
          </Text>
        ) : null}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {loading ? (
          <Text dimColor>loading…</Text>
        ) : (
          <Text>{content || "(empty)"}</Text>
        )}
      </Box>
    </Box>
  );
}

function modeLabel(mode: InspectorMode): string {
  switch (mode) {
    case "files":
      return "files (git status)";
    case "diff":
      return "diff (TODO phase 2)";
    case "log":
      return "log (TODO phase 2)";
    case "agent":
      return "agent transcript (TODO phase 2)";
  }
}
