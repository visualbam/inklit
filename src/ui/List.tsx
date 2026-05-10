import React from "react";
import { Box, Text } from "ink";
import type { Task } from "../model.js";
import { lifecycleForTask } from "../model.js";
import {
  STATE_ICON,
  STATE_COLOR,
  LIFECYCLE_LABEL,
  LIFECYCLE_COLOR,
  formatStateLabel,
  formatAge,
} from "./icons.js";
import { UI } from "./theme.js";

interface Props {
  tasks: Task[];
  selectedSlug: string | null;
  totalTasks: number;
  filterQuery: string;
  width: number;
}

export function TaskList({
  tasks,
  selectedSlug,
  totalTasks,
  filterQuery,
  width,
}: Props) {
  if (tasks.length === 0) {
    const query = filterQuery.trim();
    return (
      <Box paddingX={1} flexDirection="column">
        {query ? (
          <Text dimColor>
            No tasks match "{query}" — edit with <Text color={UI.accent}>/</Text>{" "}
            or clear the filter.
          </Text>
        ) : (
          <Text dimColor>
            No worktrees yet — press{" "}
            <Text color={UI.accent} bold>
              n
            </Text>{" "}
            to launch an agent task.
          </Text>
        )}
      </Box>
    );
  }

  // Reserve roughly: rail+icon + stage + pane + age + review + spacing.
  const fixed = 48;
  const slugCol = Math.max(10, Math.floor((width - fixed) * 0.34));
  const subjectCol = Math.max(8, width - fixed - slugCol - 2);
  const divider = "─".repeat(Math.max(0, width - 2));

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text dimColor>
          {pad("", 4)} {pad("task", slugCol)} {pad("subject", subjectCol)}{" "}
          {pad("stage", 8)} {pad("pane", 9)} {pad("review", 11)}{" "}
          {pad("age", 5)}
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text dimColor>{divider}</Text>
      </Box>
      {tasks.map((t) => {
        const sel = t.slug === selectedSlug;
        const icon = STATE_ICON[t.state];
        const color = STATE_COLOR[t.state];
        const stateLabel = formatStateLabel(t);
        const lifecycle = lifecycleForTask(t);
        const lifecycleLabel = LIFECYCLE_LABEL[lifecycle];
        const lifecycleColor = LIFECYCLE_COLOR[lifecycle];
        const review = formatReview(t);
        return (
          <Box key={t.slug} paddingX={1}>
            <Text>
              <Text color={sel ? UI.accent : UI.subtle}>
                {sel ? "▌" : " "}
              </Text>
              <Text> </Text>
              <Text bold={sel} color={color}>
                {icon}
              </Text>
              <Text> </Text>
              <Text bold={sel}>
                {pad(t.slug, slugCol)}{" "}
              </Text>
              <Text bold={sel} dimColor={!sel}>
                {pad(t.error ?? t.subject, subjectCol)}
              </Text>
              <Text> </Text>
              <Text bold={sel} color={lifecycleColor}>
                {pad(lifecycleLabel, 8)}
              </Text>
              <Text> </Text>
              <Text bold={sel} color={color}>
                {pad(stateLabel, 9)}
              </Text>
              <Text> </Text>
              <Text bold={sel} dimColor={review.dim} color={review.color}>
                {pad(review.text, 11)}
              </Text>
              <Text> </Text>
              <Text bold={sel} dimColor={!sel}>
                {pad(formatAge(t.ageSeconds), 5)}
              </Text>
            </Text>
          </Box>
        );
      })}
      {filterQuery.trim() && tasks.length < totalTasks ? (
        <Box paddingX={1}>
          <Text dimColor>
            showing {tasks.length}/{totalTasks} · clear filter with /
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

function formatReview(task: Task): { text: string; color?: string; dim?: boolean } {
  if (task.state === "merged") return { text: "applied", dim: true };
  const stats = task.review;
  if (!stats) return { text: "checking…", dim: true };
  if (stats.files === 0 && stats.commitsAhead === 0 && stats.untracked === 0) {
    return { text: "clean", dim: true };
  }
  const parts = [`${stats.files}f`];
  if (stats.commitsAhead > 0) parts.push(`${stats.commitsAhead}c`);
  if (stats.untracked > 0) parts.push(`${stats.untracked}u`);
  return {
    text: parts.join(" "),
    color: stats.untracked > 0 ? UI.warning : UI.accent,
  };
}
