import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { UI } from "./theme.js";

interface Props {
  value: string;
  onChange: (s: string) => void;
  onSubmit: (s: string) => void;
  onCancel: () => void;
  /** Image detected in clipboard on mode entry but not yet attached. */
  hasClipboardImage?: boolean;
}

export function DescriptionPrompt({ value, onChange, onSubmit, hasClipboardImage }: Props) {
  return (
    <Box
      borderStyle="round"
      borderColor={UI.accent}
      paddingX={1}
      flexDirection="column"
    >
      <Text bold color={UI.accent}>
        New agent task
      </Text>
      <Text dimColor>
        Describe what the agent should do. Enter to continue, esc to cancel.
      </Text>
      {hasClipboardImage ? (
        <Text dimColor>ctrl+v  attach clipboard image</Text>
      ) : null}
      <Box marginTop={1}>
        <Text color={UI.accent}>{">  "}</Text>
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
      borderColor={UI.accent}
      paddingX={1}
      flexDirection="column"
    >
      <Text bold color={UI.accent}>
        {heading} <Text color="white">{label}</Text>
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color={UI.accent} bold>
            c
          </Text>
          {"  "}claude code{" "}
          {intent === "resume" ? <Text dimColor>(--continue)</Text> : null}
        </Text>
        <Text>
          <Text color={UI.accent} bold>
            x
          </Text>
          {"  "}codex{" "}
          {intent === "resume" ? <Text dimColor>(resume --last)</Text> : null}
        </Text>
        <Text>
          <Text color={UI.accent} bold>
            o
          </Text>
          {"  "}opencode{" "}
          {intent === "resume" ? <Text dimColor>(--continue)</Text> : null}
        </Text>
        <Text dimColor>esc  cancel</Text>
      </Box>
    </Box>
  );
}
