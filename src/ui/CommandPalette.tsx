import React from "react";
import { Box, Text } from "ink";
import type { Task, TaskListDensity } from "../model.js";
import { lifecycleForTask } from "../model.js";
import { LIFECYCLE_LABEL, formatStateLabel } from "./icons.js";
import { UI } from "./theme.js";
import { suggestedFollowUps } from "./followUps.js";

interface Props {
  selectedTask: Task | null;
  density: TaskListDensity;
  targetBranch: string;
  showArchived: boolean;
  inSession: boolean;
  height: number;
  width: number;
}

interface CommandRow {
  key: string;
  label: string;
  muted?: boolean;
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
  const rows = commandRows(
    selectedTask,
    density,
    targetBranch,
    showArchived,
    inSession
  );
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

function commandRows(
  task: Task | null,
  density: TaskListDensity,
  targetBranch: string,
  showArchived: boolean,
  inSession: boolean
): CommandRow[] {
  const rows: CommandRow[] = [
    { key: "n", label: inSession ? "new agent task" : "new task unavailable outside zellij", muted: !inSession },
    { key: "r", label: "refresh task board and visible inspector caches" },
    { key: "/", label: "filter task board" },
    { key: "v", label: `switch to ${density === "compact" ? "detailed" : "compact"} board` },
    { key: "z", label: showArchived ? "hide archived tasks" : "show archived tasks" },
  ];

  if (!task) {
    rows.push({ key: "?", label: "open keybind help" });
    return rows;
  }

  rows.push(
    { key: "enter", label: live(task) ? "focus selected agent pane" : "resume selected task" },
    { key: "i", label: live(task) ? "message selected agent" : "message unavailable without a live pane", muted: !live(task) },
    { key: "m", label: task.state === "merged" ? "already applied" : `review and apply to ${targetBranch}`, muted: task.state === "merged" },
    { key: "X", label: task.state === "merged" ? "kill unavailable after apply" : "kill selected task with confirmation", muted: task.state === "merged" },
    { key: "A", label: lifecycleForTask(task) === "archived" ? "restore archived task" : "archive selected task" },
    { key: "t/f/d/l/a", label: "switch inspector mode" }
  );

  const suggestions = suggestedFollowUps(task);
  if (suggestions[0]) rows.push({ key: "T / 1", label: `start next task: ${suggestions[0].title}` });
  if (suggestions[1]) rows.push({ key: "2", label: `start next task: ${suggestions[1].title}` });
  rows.push({ key: "?", label: "open keybind help" });
  return rows;
}

function live(task: Task): boolean {
  return task.state === "running" || task.state === "waiting" || task.state === "permission" || task.state === "idle";
}

function padRight(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function truncate(s: string, max: number): string {
  if (max <= 1) return s.slice(0, Math.max(0, max));
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
