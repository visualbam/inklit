import React from "react";
import { Box, Text } from "ink";

interface Props {
  flash: string | null;
  error: string | null;
  taskCount: number;
  selected: string | null;
  inSession: boolean;
}

export function StatusBar({ flash, error, taskCount, selected, inSession }: Props) {
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
            j/k move · n new · enter focus · m merge · k kill · q quit
          </Text>
        </Text>
      )}
    </Box>
  );
}
