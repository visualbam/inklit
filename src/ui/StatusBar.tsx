import React from "react";
import { Box, Text } from "ink";
import type { Task, TaskListDensity } from "../model.js";
import { lifecycleForTask } from "../model.js";
import { LIFECYCLE_LABEL, formatStateLabel } from "./icons.js";
import { UI } from "./theme.js";
import { suggestedFollowUps } from "./followUps.js";
import { truncate } from "./text.js";

interface Props {
  flash: string | null;
  error: string | null;
  taskCount: number;
  selectedTask: Task | null;
  inSession: boolean;
  filterQuery: string;
  visibleTaskCount: number;
  density: TaskListDensity;
  showArchived: boolean;
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
  density,
  showArchived,
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
  const visibilitySummary =
    !filterQuery.trim() && visibleTaskCount < taskCount
      ? ` · visible ${visibleTaskCount}/${taskCount}`
      : "";
  const next = nextAction(selectedTask, inSession);
  const followUpHint =
    suggestedFollowUps(selectedTask).length > 0 ? " · T follow-up" : "";
  const archiveHint = showArchived ? " · z hide archived" : " · z archived";
  const densityHint = density === "compact" ? " · v detailed" : " · v compact";

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
              ` · ${taskCount} task${taskCount === 1 ? "" : "s"}${selectedSummary}${filterSummary}${visibilitySummary}${
                inSession ? "" : " · not in zellij"
              } · : commands · j/k move${followUpHint} · / filter · r refresh${densityHint}${archiveHint} · ? help`,
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
  if (task.state === "permission") return "Next: enter pane to approve permission";
  if (task.state === "waiting") return "Next: respond with i";
  if (task.state === "running") {
    return inSession ? "Next: watch transcript with a" : "Next: inspect task";
  }
  if (task.state === "idle") return "Next: inspect idle agent with a";
  if (task.state === "ready") return "Next: review diff or T follow-up";
  if (task.state === "merged") return "Next: T follow-up or let it fade out";
  return "Next: inspect task";
}
