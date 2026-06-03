import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { UI } from "./theme.js";

interface Props {
  slug: string;
  value: string;
  onChange: (s: string) => void;
  onSubmit: (s: string) => void;
}

/** One-line prompt that resumes an agent with an additional instruction. */
export function ContinuePrompt({ slug, value, onChange, onSubmit }: Props) {
  return (
    <Box
      borderStyle="round"
      borderColor={UI.accent}
      paddingX={1}
      flexDirection="column"
    >
      <Text bold color={UI.accent}>
        continue {slug} with…
      </Text>
      <Text dimColor>
        Resumes the agent with this extra instruction. Enter continues; esc cancels.
      </Text>
      <Box marginTop={1}>
        <Text color={UI.accent}>{">  "}</Text>
        <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
      </Box>
    </Box>
  );
}
