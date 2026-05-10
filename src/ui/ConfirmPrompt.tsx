import React from "react";
import { Box, Text } from "ink";

interface Props {
  action: "merge" | "kill";
  slug: string;
  busy?: boolean;
}

export function ConfirmPrompt({ action, slug, busy }: Props) {
  const color = action === "kill" ? "red" : "yellow";
  const verb = action === "kill" ? "kill" : "merge to main";
  const detail =
    action === "kill"
      ? "Closes the zellij pane and runs `wt remove -f -D` (force, even if unmerged)."
      : "Runs `wt merge main` inside the worktree (squash + remove on success).";
  return (
    <Box
      borderStyle="round"
      borderColor={color}
      paddingX={1}
      flexDirection="column"
    >
      <Text bold color={color}>
        {busy ? `${verb}…` : `Confirm: ${verb} "${slug}"?`}
      </Text>
      <Text dimColor>{detail}</Text>
      {!busy ? (
        <Box marginTop={1}>
          <Text>
            <Text color={color} bold>
              y
            </Text>{" "}
            confirm{"   "}
            <Text bold>n</Text>/<Text bold>esc</Text> cancel
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
