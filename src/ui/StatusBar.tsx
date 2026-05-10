import React from "react";
import { Box, Text } from "ink";
import type { Task } from "../model.js";
import { lifecycleForTask } from "../model.js";
import { LIFECYCLE_LABEL, formatStateLabel } from "./icons.js";
import { UI } from "./theme.js";

interface Props {
  flash: string | null;
  error: string | null;
  taskCount: number;
  selectedTask: Task | null;
  inSession: boolean;
  filterQuery: string;
  visibleTaskCount: number;
  width: number;
}

export function StatusBar({
  flash,
  error,
  taskCount,
  selectedTask,
  inSession,
  filterQuery,
  visibleTaskCount,
  width,
}: Props) {
  const selectedSummary = selectedTask
    ? ` · ${truncate(selectedTask.slug, 16)} [${
        LIFECYCLE_LABEL[lifecycleForTask(selectedTask)]
      }/${formatStateLabel(selectedTask)}]`
    : "";
  const filterSummary = filterQuery.trim()
    ? ` · filter ${visibleTaskCount}/${taskCount}`
    : "";
  const next = nextAction(selectedTask, inSession);

  return (
    <Box paddingX={1}>
      {error ? (
        <Text color={UI.danger}>{truncate(`! ${error}`, width)}</Text>
      ) : flash ? (
        <Text color={UI.warning}>{truncate(flash, width)}</Text>
      ) : (
        <Text>
          <Text color={UI.accent}>{next}</Text>
          <Text dimColor>
            {truncate(
              ` · ${taskCount} task${taskCount === 1 ? "" : "s"}${selectedSummary}${filterSummary}${
                inSession ? "" : " · not in zellij"
              } · j/k move · / filter · r refresh · ? help`,
              Math.max(0, width - next.length)
            )}
          </Text>
        </Text>
      )}
    </Box>
  );
}

function nextAction(task: Task | null, inSession: boolean): string {
  if (!task) return "Next: launch a task with n";
  if (task.state === "waiting") return "Next: respond with i";
  if (task.state === "running") {
    return inSession ? "Next: watch transcript with a" : "Next: inspect task";
  }
  if (task.state === "idle") return "Next: inspect idle agent with a";
  if (task.state === "ready") return "Next: review diff, then apply with m";
  if (task.state === "merged") return "Next: applied task will fade out";
  return "Next: inspect task";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
