import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface Props {
  value: string;
  onChange: (s: string) => void;
  onSubmit: (s: string) => void;
  onCancel: () => void;
}

export function DescriptionPrompt({ value, onChange, onSubmit }: Props) {
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      flexDirection="column"
    >
      <Text bold color="cyan">
        New agent task
      </Text>
      <Text dimColor>
        Describe what the agent should do. Enter to continue, esc to cancel.
      </Text>
      <Box marginTop={1}>
        <Text color="cyan">{">  "}</Text>
        <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
      </Box>
    </Box>
  );
}

interface AgentPickerProps {
  description: string;
}

export function AgentPicker({ description }: AgentPickerProps) {
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      flexDirection="column"
    >
      <Text bold color="cyan">
        Pick agent for: <Text color="white">{description}</Text>
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color="cyan" bold>
            c
          </Text>
          {"  "}claude code
        </Text>
        <Text>
          <Text color="cyan" bold>
            x
          </Text>
          {"  "}codex
        </Text>
        <Text dimColor>esc  cancel</Text>
      </Box>
    </Box>
  );
}
