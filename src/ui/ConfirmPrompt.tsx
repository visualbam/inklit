import React from "react";
import { Box, Text } from "ink";
import { UI } from "./theme.js";

interface Props {
  action: "merge" | "kill" | "closeAll";
  slug: string;
  busy?: boolean;
}

export function ConfirmPrompt({ action, slug, busy }: Props) {
  const color = action === "kill" ? UI.danger : UI.warning;
  const verb =
    action === "kill"
      ? "kill"
      : action === "closeAll"
        ? "close all live panes"
        : "apply to main";
  const detail =
    action === "kill"
      ? "Closes the zellij pane and runs `wt remove -f -D` (force, even if unmerged)."
      : action === "closeAll"
        ? "Closes live zellij agent panes only. Worktrees and task records survive; enter resumes later."
      : "Runs `wt merge main` to apply this task into the main version (squash + remove on success).";
  return (
    <Box
      borderStyle="round"
      borderColor={color}
      paddingX={1}
      flexDirection="column"
    >
      <Text bold color={color}>
        {busy
          ? `${verb}…`
          : action === "closeAll"
            ? `Confirm: close ${slug}?`
            : `Confirm: ${verb} "${slug}"?`}
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
