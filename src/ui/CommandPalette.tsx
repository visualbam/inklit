import React from "react";
import { Box, Text } from "ink";
import type { Task, TaskListDensity } from "../model.js";
import { lifecycleForTask } from "../model.js";
import { LIFECYCLE_LABEL, formatStateLabel } from "./icons.js";
import { UI } from "./theme.js";
import { commandRows } from "./commands.js";
import { padRight, truncate } from "./text.js";

interface Props {
  selectedTask: Task | null;
  density: TaskListDensity;
  targetBranch: string;
  showArchived: boolean;
  inSession: boolean;
  height: number;
  width: number;
}

export function CommandPalette({
  selectedTask,
  density,
  targetBranch,
  showArchived,
  inSession,
  height,
  width,
}: Props) {
  const rows = commandRows({
    task: selectedTask,
    density,
    targetBranch,
    showArchived,
    inSession,
  });
  const maxRows = Math.max(3, height - (selectedTask ? 4 : 3));
  const visibleRows =
    rows.length > maxRows
      ? [
          ...rows.slice(0, Math.max(0, maxRows - 1)),
          {
            key: "...",
            label: `${rows.length - maxRows + 1} more commands hidden - keys still work`,
            muted: true,
          },
        ]
      : rows;
  const labelWidth = Math.max(12, width - 17);
  return (
    <Box
      borderStyle="round"
      borderColor={UI.border}
      paddingX={1}
      paddingY={0}
      flexDirection="column"
      flexGrow={1}
    >
      <Box>
        <Text bold color={UI.accent}>
          command palette
        </Text>
        <Text dimColor>
          {" "}
          - press a key to run, esc to close
        </Text>
      </Box>
      {selectedTask ? (
        <Box>
          <Text dimColor>
            selected {selectedTask.slug} ·{" "}
            {LIFECYCLE_LABEL[lifecycleForTask(selectedTask)]}/
            {formatStateLabel(selectedTask)}
          </Text>
        </Box>
      ) : null}
      {visibleRows.map((row) => (
        <Box key={`${row.key}:${row.label}`}>
          <Text color={row.muted ? UI.subtle : UI.accent}>
            {padRight(row.key, 8)}
          </Text>
          <Text dimColor={row.muted}>
            {padRight(truncate(row.label, labelWidth), labelWidth)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
