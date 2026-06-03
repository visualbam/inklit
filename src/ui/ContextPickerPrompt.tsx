import React from "react";
import { Box, Text } from "ink";
import type { Task } from "../model.js";
import { lifecycleForTask } from "../model.js";
import { UI } from "./theme.js";
import { truncate } from "./text.js";

interface Props {
  tasks: Task[];
  selectedIndex: number;
  description: string;
  width: number;
}

/** Lists recent tasks so the user can pick one to inherit context from. */
export function ContextPickerPrompt({
  tasks,
  selectedIndex,
  description,
  width,
}: Props) {
  const eligible = tasks.filter((t) => {
    const lc = lifecycleForTask(t);
    return lc === "done" || lc === "ready" || lc === "failed";
  });

  return (
    <Box
      borderStyle="round"
      borderColor={UI.accent}
      paddingX={1}
      flexDirection="column"
    >
      <Text bold color={UI.accent}>
        Inherit context from a previous task?
      </Text>
      <Text dimColor>
        For: <Text color="white">{truncate(description, width - 20)}</Text>
      </Text>
      <Text dimColor>
        j/k select · enter pick · s/esc skip
      </Text>
      <Box marginTop={1} flexDirection="column">
        {eligible.length === 0 ? (
          <Text dimColor>No eligible tasks — press s or esc to skip.</Text>
        ) : (
          eligible.map((task, i) => {
            const isSelected = i === selectedIndex;
            const lc = lifecycleForTask(task);
            return (
              <Box key={task.slug}>
                <Text color={isSelected ? UI.accent : undefined} bold={isSelected}>
                  {isSelected ? "▸ " : "  "}
                </Text>
                <Text color={isSelected ? "white" : undefined}>
                  {truncate(task.slug, 24)}
                </Text>
                <Text dimColor>{"  "}</Text>
                <Text dimColor>
                  [{lc}] {truncate(task.subject, width - 40)}
                </Text>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
