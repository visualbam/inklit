import React from "react";
import { Box, Text } from "ink";
import type { Task, InspectorMode } from "../model.js";
import { lifecycleForTask } from "../model.js";
import type { StatusEntry } from "../wt.js";
import { DiffView } from "./DiffView.js";
import { FilesView } from "./FilesView.js";
import {
  LIFECYCLE_COLOR,
  LIFECYCLE_LABEL,
  formatStateLabel,
} from "./icons.js";
import { UI } from "./theme.js";
import { suggestedFollowUps } from "./followUps.js";

interface Props {
  task: Task | null;
  mode: InspectorMode;
  /** Mode-specific content. Strings for diff/log/agent; structured for files. */
  diff: string;
  log: string;
  agent: string;
  files: StatusEntry[];
  loading: boolean;
  height: number;
  width: number;
  /** Lines hidden above the viewport (already clamped by App). */
  offset: number;
}

export function Inspector({
  task,
  mode,
  diff,
  log,
  agent,
  files,
  loading,
  height,
  width,
  offset,
}: Props) {
  // Reserve header, status strip, mode tabs, footer, and spacing inside the box.
  const maxLines = Math.max(3, height - 6);
  const title = task ? task.slug : "(no selection)";
  const header = task
    ? `${title} · ${modeLabel(mode)} · ${task.shortSha || "no sha"}`
    : `${title} · ${modeLabel(mode)}`;
  const contentWidth = Math.max(10, width - 4);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={task ? UI.border : UI.subtle}
      paddingX={1}
      flexGrow={1}
    >
      <Box>
        <Text bold>
          {truncate(header, width - 2)}
        </Text>
      </Box>
      {task ? <TaskStatusStrip task={task} width={width} /> : null}
      <ModeTabs active={mode} />
      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        {!task ? (
          <Text dimColor>nothing selected</Text>
        ) : loading ? (
          <Text dimColor>loading…</Text>
        ) : mode === "task" ? (
          <TaskOverview
            task={task}
            maxLines={maxLines}
            offset={offset}
            width={width}
          />
        ) : mode === "diff" ? (
          <DiffView
            diff={diff}
            maxLines={maxLines}
            offset={offset}
            width={contentWidth}
          />
        ) : mode === "files" ? (
          <FilesView
            entries={files}
            maxLines={maxLines}
            offset={offset}
            width={contentWidth}
          />
        ) : mode === "log" ? (
          <PlainText text={log} maxLines={maxLines} offset={offset} />
        ) : (
          <PlainText
            text={agent}
            maxLines={maxLines}
            offset={offset}
            placeholder="(agent transcript empty — pane may not be live)"
          />
        )}
      </Box>
      <Box>
        <Text dimColor>
          scroll <Text bold>J/K</Text> ^d/^u <Text bold>gg/G</Text> ·{" "}
          <Text bold>?</Text> help
        </Text>
      </Box>
    </Box>
  );
}

function ModeTabs({ active }: { active: InspectorMode }) {
  const tabs: Array<[InspectorMode, string, string]> = [
    ["task", "t", "task"],
    ["files", "f", "files"],
    ["diff", "d", "diff"],
    ["log", "l", "log"],
    ["agent", "a", "agent"],
  ];
  return (
    <Box marginTop={1}>
      {tabs.map(([mode, key, label], index) => {
        const isActive = mode === active;
        return (
          <Text key={mode}>
            {index > 0 ? <Text dimColor> </Text> : null}
            <Text color={isActive ? UI.accent : undefined} bold={isActive}>
              [{key}:{label}]
            </Text>
          </Text>
        );
      })}
    </Box>
  );
}

function TaskStatusStrip({ task, width }: { task: Task; width: number }) {
  const lifecycle = lifecycleForTask(task);
  const label = LIFECYCLE_LABEL[lifecycle];
  const line = `${label} task · ${paneSummary(task)} · ${
    task.dirty ? "changes pending review" : "clean worktree"
  } · ${nextAction(task)}`;
  return (
    <Box>
      <Text color={LIFECYCLE_COLOR[lifecycle]}>{label}</Text>
      <Text dimColor>
        {" "}
        {truncate(line.slice(label.length + 1), width - 10)}
      </Text>
    </Box>
  );
}

function TaskOverview({
  task,
  maxLines,
  offset,
  width,
}: {
  task: Task;
  maxLines: number;
  offset: number;
  width: number;
}) {
  const rows: [string, string][] = [
    [
      "Status",
      `${LIFECYCLE_LABEL[lifecycleForTask(task)]} task, ${paneSummary(task)}`,
    ],
    ["Next", nextAction(task)],
    ["Review", "Open files/diff/log, then apply to main with m or discard with X."],
    [
      "Thread",
      task.paneId
        ? "Agent transcript is live; i sends a line without focusing."
        : "No live pane; enter resumes the recorded agent.",
    ],
    ["Checkpoint", `${task.shortSha || "unknown"} on ${task.slug}`],
    [
      "Changes",
      task.dirty
        ? "Uncommitted changes are present."
        : "No uncommitted changes; committed task changes may still exist.",
    ],
    ["Worktree", task.path],
  ];
  const followUps = suggestedFollowUps(task);
  if (followUps[0]) {
    rows.push([
      "Next task",
      `T/1: ${followUps[0].title} - ${followUps[0].detail}`,
    ]);
  }
  if (followUps[1]) {
    rows.push([
      "Task 2",
      `2: ${followUps[1].title} - ${followUps[1].detail}`,
    ]);
  }
  const { visible, above, below } = windowWithMarkers(rows, maxLines, offset);
  return (
    <Box flexDirection="column">
      {above > 0 ? (
        <Box>
          <Text dimColor>↑ {above} hidden above</Text>
        </Box>
      ) : null}
      {visible.map(([label, value]) => (
        <Box key={`${label}:${value}`}>
          <Text color={UI.accent}>{padRight(label, 10)}</Text>
          <Text>{truncate(value, width - 12)}</Text>
        </Box>
      ))}
      {below > 0 ? (
        <Box>
          <Text dimColor>↓ {below} hidden below</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function paneSummary(task: Task): string {
  if (task.state === "ready") return "no live pane";
  if (task.state === "waiting") return "waiting for input";
  if (task.state === "idle") return `${formatStateLabel(task)} pane`;
  return `${formatStateLabel(task)} pane`;
}

function nextAction(task: Task): string {
  if (task.state === "waiting") {
    return "Respond to the agent with i or enter to focus.";
  }
  if (task.state === "running") {
    return "Let the agent continue or inspect the live transcript.";
  }
  if (task.state === "idle") {
    return "Check the transcript; the pane has not changed recently.";
  }
  if (task.state === "ready") {
    return "Review the diff, apply to main with m, or enter to resume.";
  }
  if (task.state === "merged") return "Task has been applied to main.";
  return "Inspect the task and decide whether to resume or discard.";
}

function PlainText({
  text,
  maxLines,
  offset,
  placeholder,
}: {
  text: string;
  maxLines: number;
  offset: number;
  placeholder?: string;
}) {
  if (!text) {
    return <Text dimColor>{placeholder ?? "(empty)"}</Text>;
  }
  const lines = text.split("\n");
  const { visible, above, below } = windowWithMarkers(lines, maxLines, offset);
  return (
    <Box flexDirection="column">
      {above > 0 ? (
        <Box>
          <Text dimColor>↑ {above} hidden above</Text>
        </Box>
      ) : null}
      {visible.map((l, i) => (
        <Box key={i}>
          <Text>{l || " "}</Text>
        </Box>
      ))}
      {below > 0 ? (
        <Box>
          <Text dimColor>↓ {below} hidden below</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function modeLabel(mode: InspectorMode): string {
  switch (mode) {
    case "task":
      return "task view";
    case "files":
      return "files vs main version";
    case "diff":
      return "final patch vs main version";
    case "log":
      return "log (commits ahead of main version)";
    case "agent":
      return "agent transcript (live)";
  }
}

function truncate(s: string, max: number): string {
  if (max <= 1) return s.slice(0, Math.max(0, max));
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function padRight(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function windowWithMarkers<T>(items: T[], maxLines: number, offset: number) {
  const total = items.length;
  const maxOffset =
    total <= maxLines ? 0 : total - Math.max(1, maxLines - 1);
  const start = Math.min(Math.max(0, offset), Math.max(0, maxOffset));
  const above = start;
  const hasAbove = above > 0;
  let budget = Math.max(0, maxLines - (hasAbove ? 1 : 0));
  let visible = items.slice(start, start + budget);
  let below = Math.max(0, total - start - visible.length);
  if (below > 0 && budget > 0) {
    budget -= 1;
    visible = items.slice(start, start + budget);
    below = Math.max(0, total - start - visible.length);
  }
  return { visible, above, below };
}
