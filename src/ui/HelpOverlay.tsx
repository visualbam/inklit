import React from "react";
import { Box, Text } from "ink";
import { helpSections } from "./commands.js";
import { UI } from "./theme.js";
import { padRight } from "./text.js";

export function HelpOverlay({ targetBranch }: { targetBranch: string }) {
  const sections = helpSections(targetBranch);
  const maxKey = Math.max(
    ...sections.flatMap((s) => s.rows.map((r) => r[0].length))
  );
  return (
    <Box
      borderStyle="round"
      borderColor={UI.accent}
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      flexGrow={1}
    >
      <Box marginBottom={1}>
        <Text bold color={UI.accent}>
          inklit — keybinds
        </Text>
      </Box>
      {sections.map((s, i) => (
        <Box
          key={s.title}
          flexDirection="column"
          marginTop={i === 0 ? 0 : 1}
        >
          <Text bold>{s.title}</Text>
          {s.rows.map(([k, v]) => (
            <Box key={k}>
              <Text color={UI.accent}>{padRight(k, maxKey)}</Text>
              <Text>{"  "}</Text>
              <Text dimColor={false}>{v}</Text>
            </Box>
          ))}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>Press ? or esc to close.</Text>
      </Box>
    </Box>
  );
}
