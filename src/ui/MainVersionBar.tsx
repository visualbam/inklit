import React from "react";
import { Box, Text } from "ink";
import type { MainVersion, Task } from "../model.js";
import { lifecycleForTask } from "../model.js";
import { UI } from "./theme.js";

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
  } done ${counts.done}${target}${filter} · ${path}`;
  const maxSummary = Math.max(12, width - "inklit ".length - 2);

  return (
    <Box paddingX={1}>
      <Text bold color={UI.accent}>inklit</Text>
      <Text dimColor>{truncate(summary, maxSummary)}</Text>
    </Box>
  );
}

function summarize(tasks: Task[]): { active: number; ready: number; done: number } {
  const counts = { active: 0, ready: 0, done: 0 };
  for (const task of tasks) {
    const lifecycle = lifecycleForTask(task);
    if (lifecycle === "active") counts.active += 1;
    if (lifecycle === "ready") counts.ready += 1;
    if (lifecycle === "done") counts.done += 1;
  }
  return counts;
}

function compactPath(path: string, max: number): string {
  if (path.length <= max) return path;
  const parts = path.split("/").filter(Boolean);
  const tail = parts.slice(-2).join("/");
  if (!tail) return truncate(path, max);
  const compact = `…/${tail}`;
  return compact.length <= max ? compact : truncate(compact, max);
}

function truncate(s: string, max: number): string {
  if (max <= 1) return s.slice(0, Math.max(0, max));
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
