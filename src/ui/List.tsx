import React from "react";
import { Box, Text } from "ink";
import type { Task } from "../model.js";
import { STATE_ICON, STATE_COLOR, STATE_LABEL, formatAge } from "./icons.js";

interface Props {
  tasks: Task[];
  selectedSlug: string | null;
  width: number;
}

export function TaskList({ tasks, selectedSlug, width }: Props) {
  if (tasks.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>
          No worktrees yet — press{" "}
          <Text color="cyan" bold>
            n
          </Text>{" "}
          to launch an agent task.
        </Text>
      </Box>
    );
  }

  // Reserve roughly: 2 (icon) + 12 (state) + 8 (age) + 1 padding = 23.
  const fixed = 23;
  const slugCol = Math.max(12, Math.floor((width - fixed) * 0.45));
  const subjectCol = Math.max(10, width - fixed - slugCol - 2);

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text dimColor>
          {pad("", 2)} {pad("task", slugCol)} {pad("subject", subjectCol)}{" "}
          {pad("state", 9)} {pad("age", 5)}
        </Text>
      </Box>
      {tasks.map((t) => {
        const selected = t.slug === selectedSlug;
        const icon = STATE_ICON[t.state];
        const color = STATE_COLOR[t.state];
        const stateLabel = STATE_LABEL[t.state];
        const dirtyMark = t.dirty ? "*" : " ";
        return (
          <Box key={t.slug} paddingX={1}>
            <Text
              backgroundColor={selected ? "blueBright" : undefined}
              color={selected ? "white" : undefined}
            >
              <Text color={color}>{icon}</Text>
              <Text>{dirtyMark}</Text>
              <Text bold={selected}>{pad(t.slug, slugCol)}</Text>{" "}
              <Text dimColor={!selected}>
                {pad(t.error ?? t.subject, subjectCol)}
              </Text>{" "}
              <Text color={color}>{pad(stateLabel, 9)}</Text>{" "}
              <Text dimColor>{pad(formatAge(t.ageSeconds), 5)}</Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}
