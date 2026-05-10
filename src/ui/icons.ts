import type { TaskState } from "../model.js";

export const STATE_ICON: Record<TaskState, string> = {
  running: "●",
  waiting: "⊙",
  ready: "✓",
  failed: "✗",
  merged: "·",
};

export const STATE_COLOR: Record<TaskState, string> = {
  running: "magenta",
  waiting: "yellow",
  ready: "green",
  failed: "red",
  merged: "gray",
};

export const STATE_LABEL: Record<TaskState, string> = {
  running: "running",
  waiting: "waiting",
  ready: "ready",
  failed: "failed",
  merged: "merged",
};

export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
