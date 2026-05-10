import React from "react";
import { Box, Text } from "ink";
import type { TaskState } from "../model.js";

interface Props {
  flash: string | null;
  error: string | null;
  taskCount: number;
  selected: string | null;
  selectedState: TaskState | null;
  inSession: boolean;
}

export function StatusBar({
  flash,
  error,
  taskCount,
  selected,
  selectedState,
  inSession,
}: Props) {
  // Contextual verb for `enter` based on what's under the cursor.
  let enterVerb = "focus";
  if (selectedState === "ready") enterVerb = "resume";
  if (selectedState === null) enterVerb = "—";

  return (
    <Box paddingX={1}>
      {error ? (
        <Text color="red">! {error}</Text>
      ) : flash ? (
        <Text color="yellow">{flash}</Text>
      ) : (
        <Text dimColor>
          {taskCount} task{taskCount === 1 ? "" : "s"}
          {selected ? ` · ${selected}` : ""}
          {inSession ? "" : " · not in zellij (spawn disabled)"}
          {"  "}
          <Text>
            j/k move · J/K scroll · n new · enter {enterVerb} · m merge · X kill · q quit
          </Text>
        </Text>
      )}
    </Box>
  );
}
