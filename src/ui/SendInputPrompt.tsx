import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { UI } from "./theme.js";

interface Props {
  slug: string;
  value: string;
  onChange: (s: string) => void;
  onSubmit: (s: string) => void;
  busy?: boolean;
}

/**
 * One-line input that streams characters straight into the agent's pane via
 * `zellij action write --pane-id`. Submit fires the text plus a CR so
 * the agent treats it as a completed line. Empty submit cancels — for raw
 * "press enter" you can focus the pane the old-fashioned way.
 */
export function SendInputPrompt({
  slug,
  value,
  onChange,
  onSubmit,
  busy,
}: Props) {
  return (
    <Box
      borderStyle="round"
      borderColor={UI.accent}
      paddingX={1}
      flexDirection="column"
    >
      <Text bold color={UI.accent}>
        {busy ? `sending → ${slug}…` : `→ send to ${slug}`}
      </Text>
      <Text dimColor>
        Lands at the agent's next prompt. Enter sends; esc cancels.
      </Text>
      <Box marginTop={1}>
        <Text color={UI.accent}>{">  "}</Text>
        {busy ? (
          <Text dimColor>{value}</Text>
        ) : (
          <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
        )}
      </Box>
    </Box>
  );
}
