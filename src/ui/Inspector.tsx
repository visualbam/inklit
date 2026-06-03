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
import { reviewSentence, reviewSummary } from "./review.js";
import { padRight, truncate } from "./text.js";
import { windowWithMarkers } from "./windowing.js";

interface Props {
  task: Task | null;
  mode: InspectorMode;
  targetBranch: string;
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
  /** Slugs that share changed files with this task's ready changes. */
  overlaps?: string[];
}

export function Inspector({
  task,
  mode,
  targetBranch,
  diff,
  log,
  agent,
  files,
  loading,
  height,
  width,
  offset,
  overlaps,
}: Props) {
  // Reserve header, status strip, mode tabs, footer, and spacing inside the box.
  const maxLines = Math.max(3, height - 6);
  const title = task ? task.slug : "(no selection)";
  const header = task
    ? `${title} · ${modeLabel(mode, targetBranch)} · ${task.shortSha || "no sha"}`
    : `${title} · ${modeLabel(mode, targetBranch)}`;
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
      {task ? (
        <TaskStatusStrip
          task={task}
          targetBranch={targetBranch}
          width={width}
        />
      ) : null}
      <ModeTabs active={mode} />
      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        {!task ? (
          <Text dimColor>nothing selected</Text>
        ) : loading ? (
          <Text dimColor>loading…</Text>
        ) : mode === "task" ? (
          <TaskOverview
            task={task}
            targetBranch={targetBranch}
            maxLines={maxLines}
            offset={offset}
            width={width}
            overlaps={overlaps}
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
            targetBranch={targetBranch}
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

function TaskStatusStrip({
  task,
  targetBranch,
  width,
}: {
  task: Task;
  targetBranch: string;
  width: number;
}) {
  const lifecycle = lifecycleForTask(task);
  const label = LIFECYCLE_LABEL[lifecycle];
  const line = `${label} task · ${paneSummary(task)} · ${
    task.state === "merging"
      ? "applying in background"
      : task.dirty
        ? "changes pending review"
        : "clean worktree"
  } · ${nextAction(task, targetBranch)}`;
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
  targetBranch,
  maxLines,
  offset,
  width,
  overlaps,
}: {
  task: Task;
  targetBranch: string;
  maxLines: number;
  offset: number;
  width: number;
  overlaps?: string[];
}) {
  const rows: [string, string][] = [
    [
      "Status",
      `${LIFECYCLE_LABEL[lifecycleForTask(task)]} task, ${paneSummary(task)}`,
    ],
    ["Next", nextAction(task, targetBranch)],
    ["Readiness", reviewSentence(task)],
    ["Signals", reviewSummary(task)],
    [
      "Controls",
      `Open files/diff/log, then apply to ${targetBranch} with m or discard with X.`,
    ],
    [
      "Thread",
      task.paneId
        ? "Agent transcript is live; i sends a line without focusing."
        : "No live pane; enter resumes the recorded agent.",
    ],
    ["Checkpoint", `${task.shortSha || "unknown"} on ${task.slug}`],
    ["Preview", task.preview?.url ?? "not running yet"],
    [
      "Changes",
      task.dirty
        ? "Uncommitted changes are present."
        : "No uncommitted changes; committed task changes may still exist.",
    ],
    ["Worktree", task.path],
  ];
  const failureRows = failureDetailRows(task);
  if (failureRows.length > 0) rows.splice(2, 0, ...failureRows);
  if (overlaps && overlaps.length > 0) {
    rows.splice(2, 0, [
      "⚠ Conflicts",
      `File overlap with: ${overlaps.join(", ")} — apply in order or rebase first.`,
    ]);
  }
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
  const { visible, above, below } = windowWithMarkers(
    rows,
    Math.max(1, maxLines - 1),
    offset
  );
  return (
    <Box flexDirection="column">
      <TaskTimeline task={task} />
      {above > 0 ? (
        <Box>
          <Text dimColor>↑ {above} hidden above</Text>
        </Box>
      ) : null}
      {visible.map(([label, value]) => (
        <Box key={`${label}:${value}`}>
          <Text color={UI.accent}>{padRight(label, 10)}</Text>
          <Text>{padRight(truncate(value, width - 12), width - 12)}</Text>
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

function TaskTimeline({ task }: { task: Task }) {
  const lifecycle = lifecycleForTask(task);
  const active =
    lifecycle === "done" || task.state === "merged"
      ? 4
      : lifecycle === "applying" || task.state === "merging"
        ? 3
        : lifecycle === "ready" || task.state === "ready" || task.state === "idle"
        ? 2
        : lifecycle === "archived" || lifecycle === "cancelled" || lifecycle === "failed"
          ? 5
          : 1;
  const steps = ["spawned", "working", "review", "apply", "done"];
  return (
    <Box>
      <Text color={UI.accent}>{padRight("Flow", 10)}</Text>
      {steps.map((step, index) => {
        const done = index <= active;
        const current = index === active;
        return (
          <Text key={step} color={current ? UI.accent : done ? UI.success : UI.subtle} dimColor={!done}>
            {index > 0 ? " -> " : ""}
            {step}
          </Text>
        );
      })}
      {active === 5 ? (
        <Text color={lifecycle === "failed" || lifecycle === "cancelled" ? UI.danger : UI.subtle}>
          {" -> "}
          {lifecycle}
        </Text>
      ) : null}
    </Box>
  );
}

function paneSummary(task: Task): string {
  if (task.state === "ready") return "no live pane";
  if (task.state === "merging") return "background merge";
  if (task.state === "permission") return "permission prompt";
  if (task.state === "waiting") return "waiting for input";
  if (task.state === "idle") return `${formatStateLabel(task)} pane`;
  return `${formatStateLabel(task)} pane`;
}

function nextAction(task: Task, targetBranch: string): string {
  if (task.state === "permission") {
    return "Permission prompt detected; focus the pane or restart it with current launch flags.";
  }
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
    return `Review the diff, apply to ${targetBranch} with m, or enter to resume.`;
  }
  if (task.state === "merging") {
    return `Merge to ${task.operation?.targetBranch ?? targetBranch} is running; keep working or press esc to cancel.`;
  }
  if (task.failure) {
    return `Review the failure below, then press m to retry or X to discard.`;
  }
  if (task.state === "merged") return `Task has been applied to ${targetBranch}.`;
  return "Inspect the task and decide whether to resume or discard.";
}

function failureDetailRows(task: Task): [string, string][] {
  const rows: [string, string][] = [];
  if (!task.failure && !task.error) return rows;
  rows.push(["Issue", task.failure?.message ?? task.error ?? "Task failed."]);
  if (task.failure?.targetBranch) {
    rows.push(["Target", task.failure.targetBranch]);
  }
  const detailLines = (task.errorDetail ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
  for (const [index, line] of detailLines.entries()) {
    rows.push([index === 0 ? "Why" : "Detail", line]);
  }
  return rows;
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

function modeLabel(mode: InspectorMode, targetBranch: string): string {
  switch (mode) {
    case "task":
      return "task view";
    case "files":
      return `files vs ${targetBranch}`;
    case "diff":
      return `final patch vs ${targetBranch}`;
    case "log":
      return `log (commits ahead of ${targetBranch})`;
    case "agent":
      return "agent transcript (live)";
  }
}
