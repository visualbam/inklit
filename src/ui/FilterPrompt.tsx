import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { UI } from "./theme.js";

interface Props {
  value: string;
  matched: number;
  total: number;
  onChange: (s: string) => void;
  onSubmit: () => void;
}

export function FilterPrompt({
  value,
  matched,
  total,
  onChange,
  onSubmit,
}: Props) {
  return (
    <Box
      borderStyle="round"
      borderColor={UI.accent}
      paddingX={1}
      flexDirection="column"
    >
      <Text bold color={UI.accent}>
        Filter tasks
        <Text dimColor>
          {" "}
          {matched}/{total}
        </Text>
      </Text>
      <Text dimColor>
        Type to filter. Enter keeps, esc closes, clear query shows all.
      </Text>
      <Box marginTop={1}>
        <Text color={UI.accent}>{">  "}</Text>
        <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
      </Box>
    </Box>
  );
}
