import type { Task, TaskLifecycle, TaskState } from "../model.js";
import { UI } from "./theme.js";

export const STATE_ICON: Record<TaskState, string> = {
  running: "●",
  waiting: "⊙",
  permission: "!",
  idle: "◐",
  ready: "✓",
  failed: "✗",
  merged: "·",
};

export const STATE_COLOR: Record<TaskState, string> = {
  running: UI.accent,
  waiting: UI.warning,
  permission: UI.danger,
  idle: UI.info,
  ready: UI.success,
  failed: UI.danger,
  merged: UI.subtle,
};

export const STATE_LABEL: Record<TaskState, string> = {
  running: "running",
  waiting: "waiting",
  permission: "permission",
  idle: "idle",
  ready: "no pane",
  failed: "failed",
  merged: "applied",
};

export const LIFECYCLE_LABEL: Record<TaskLifecycle, string> = {
  draft: "draft",
  queued: "queued",
  active: "active",
  ready: "ready",
  applying: "applying",
  done: "done",
  archived: "archived",
  cancelled: "cancelled",
};

export const LIFECYCLE_COLOR: Record<TaskLifecycle, string> = {
  draft: UI.subtle,
  queued: UI.info,
  active: UI.accent,
  ready: UI.success,
  applying: UI.warning,
  done: UI.subtle,
  archived: UI.subtle,
  cancelled: UI.danger,
};

/**
 * Display label for the state column. Adds a duration suffix to `idle` so the
 * dashboard answers "how stuck?" at a glance — without drilling into the pane.
 */
export function formatStateLabel(task: Task): string {
  if (task.state === "idle" && task.idleSeconds !== undefined) {
    return `idle ${formatAge(task.idleSeconds)}`;
  }
  return STATE_LABEL[task.state];
}

export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
