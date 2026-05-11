import React from "react";
import { Box, Text } from "ink";
import { UI } from "./theme.js";

interface Section {
  title: string;
  rows: [string, string][];
}

const SECTIONS: Section[] = [
  {
    title: "Navigation",
    rows: [
      ["j / ↓", "next task"],
      ["k / ↑", "previous task"],
      ["[", "jump to first task"],
      ["]", "jump to last task"],
      ["/", "filter the task list"],
      ["r", "force refresh task board"],
      ["v", "toggle detailed / compact task board"],
      ["z", "show / hide archived tasks"],
      [":", "open command palette"],
    ],
  },
  {
    title: "Inspector",
    rows: [
      ["t", "task view (Replit-style status, next action, checkpoint)"],
      ["f", "files changed vs main version"],
      ["d", "final patch vs main version (tracked + untracked)"],
      ["l", "log of commits ahead of main version"],
      ["a", "live agent transcript (auto-tail)"],
      ["J / K", "scroll inspector down / up by line"],
      ["Ctrl-D / Ctrl-U", "scroll inspector by half-page"],
      ["gg / G", "jump inspector to top / bottom"],
    ],
  },
  {
    title: "Actions",
    rows: [
      ["n", "new agent task — prompts for description, then agent (c/x)"],
      ["T / 1", "start the top suggested next task"],
      ["2", "start the second suggested next task when shown"],
      ["enter", "focus pane (live) · resume agent (ready)"],
      ["i", "send a one-line message to the selected agent"],
      ["m", "apply selected task to main (review then confirm)"],
      ["s", "sync main → selected task (rebase, auto-resolve conflicts)"],
      ["A", "archive or restore selected ready/done task"],
      ["X", "kill selected — close pane + remove worktree"],
      ["Q", "close all live agent panes (worktrees survive)"],
    ],
  },
  {
    title: "Quit",
    rows: [
      ["q / Ctrl-C", "exit dashboard only; agents keep running"],
    ],
  },
  {
    title: "Prompts",
    rows: [
      ["esc", "cancel the current prompt"],
      ["y / n", "answer confirm prompts (apply / kill)"],
      ["c / x", "pick claude / codex in the agent picker"],
    ],
  },
];

export function HelpOverlay() {
  const maxKey = Math.max(
    ...SECTIONS.flatMap((s) => s.rows.map((r) => r[0].length))
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
      {SECTIONS.map((s, i) => (
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

function padRight(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
