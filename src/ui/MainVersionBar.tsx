import React from "react";
import { Box, Text } from "ink";
import type { MainVersion, Task } from "../model.js";
import { lifecycleForTask } from "../model.js";
import { UI } from "./theme.js";
import { compactPath, truncate } from "./text.js";

interface Props {
  mainVersion: MainVersion | null;
  targetBranch: string;
  tasks: Task[];
  visibleTaskCount: number;
  filterQuery: string;
  width: number;
}

export function MainVersionBar({
  mainVersion,
  targetBranch,
  tasks,
  visibleTaskCount,
  filterQuery,
  width,
}: Props) {
  if (!mainVersion) {
    return (
      <Box paddingX={1}>
        <Text bold color={UI.accent}>inklit</Text>
        <Text dimColor> · main version loading…</Text>
      </Box>
    );
  }

  if (mainVersion.error) {
    return (
      <Box paddingX={1}>
        <Text bold color={UI.accent}>inklit</Text>
        <Text dimColor>
          {" "}· main version unavailable ·{" "}
          {truncate(mainVersion.error, Math.max(12, width - 38))}
        </Text>
      </Box>
    );
  }

  const path = compactPath(mainVersion.path, 28);
  const counts = summarize(tasks);
  const filter = filterQuery.trim()
    ? ` · filter "${filterQuery.trim()}" ${visibleTaskCount}/${tasks.length}`
    : "";
  const target =
    targetBranch && targetBranch !== mainVersion.branch
      ? ` · target ${targetBranch}`
      : "";
  const summary = ` · main version ${mainVersion.branch || "unknown"} ${
    mainVersion.shortSha || "no sha"
  } ${mainVersion.dirty ? "dirty" : "clean"} · active ${counts.active} ready ${
    counts.ready
  }${counts.applying ? ` applying ${counts.applying}` : ""}${
    counts.failed ? ` failed ${counts.failed}` : ""
  } done ${counts.done}${target}${filter} · ${path}`;
  const maxSummary = Math.max(12, width - "inklit ".length - 2);

  return (
    <Box paddingX={1}>
      <Text bold color={UI.accent}>inklit</Text>
      <Text dimColor>{truncate(summary, maxSummary)}</Text>
    </Box>
  );
}

function summarize(tasks: Task[]): {
  active: number;
  ready: number;
  applying: number;
  failed: number;
  done: number;
} {
  const counts = { active: 0, ready: 0, applying: 0, failed: 0, done: 0 };
  for (const task of tasks) {
    const lifecycle = lifecycleForTask(task);
    if (lifecycle === "active") counts.active += 1;
    if (lifecycle === "ready") counts.ready += 1;
    if (lifecycle === "applying") counts.applying += 1;
    if (lifecycle === "failed") counts.failed += 1;
    if (lifecycle === "done") counts.done += 1;
  }
  return counts;
}
