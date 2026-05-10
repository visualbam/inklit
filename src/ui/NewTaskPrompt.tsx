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
  /** Human-readable target for the picker — task description or slug. */
  label: string;
  /** Headline verb: "Pick agent for" (default) or "Resume", etc. */
  intent?: "spawn" | "resume";
}

export function AgentPicker({ label, intent = "spawn" }: AgentPickerProps) {
  const heading =
    intent === "resume" ? "Resume which agent?" : "Pick agent for:";
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      flexDirection="column"
    >
      <Text bold color="cyan">
        {heading} <Text color="white">{label}</Text>
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color="cyan" bold>
            c
          </Text>
          {"  "}claude code{" "}
          {intent === "resume" ? <Text dimColor>(--continue)</Text> : null}
        </Text>
        <Text>
          <Text color="cyan" bold>
            x
          </Text>
          {"  "}codex{" "}
          {intent === "resume" ? <Text dimColor>(resume --last)</Text> : null}
        </Text>
        <Text dimColor>esc  cancel</Text>
      </Box>
    </Box>
  );
}
