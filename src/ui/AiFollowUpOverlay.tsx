import React from "react";
import { Box, Text } from "ink";
import type { SuggestedFollowUp } from "../model.js";
import { UI } from "./theme.js";
import { truncate } from "./text.js";

interface Props {
  followUps: SuggestedFollowUp[];
  selectedIndex: number;
  taskSlug: string;
  width: number;
}

/** Picker overlay for AI-generated follow-up task suggestions. */
export function AiFollowUpOverlay({
  followUps,
  selectedIndex,
  taskSlug,
  width,
}: Props) {
  return (
    <Box
      borderStyle="round"
      borderColor={UI.accent}
      paddingX={1}
      flexDirection="column"
    >
      <Text bold color={UI.accent}>
        Suggested next tasks after applying{" "}
        <Text color="white">{taskSlug}</Text>
      </Text>
      <Text dimColor>j/k select · enter spawn · esc dismiss</Text>
      <Box marginTop={1} flexDirection="column">
        {followUps.length === 0 ? (
          <Text dimColor>No suggestions available.</Text>
        ) : (
          followUps.map((f, i) => {
            const isSelected = i === selectedIndex;
            return (
              <Box key={i} flexDirection="column" marginBottom={1}>
                <Box>
                  <Text color={isSelected ? UI.accent : undefined} bold={isSelected}>
                    {isSelected ? "▸ " : "  "}
                  </Text>
                  <Text bold={isSelected} color={isSelected ? "white" : undefined}>
                    {i + 1}. {truncate(f.title, width - 8)}
                  </Text>
                </Box>
                <Box>
                  <Text>{"    "}</Text>
                  <Text dimColor>{truncate(f.detail, width - 8)}</Text>
                </Box>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
