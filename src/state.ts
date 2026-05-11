import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type {
  AgentKind,
  ReviewStats,
  Task,
  TaskLifecycle,
  TaskListDensity,
} from "./model.js";

export interface TaskSnapshot {
  path: string;
  shortSha: string;
  subject: string;
  ageSeconds: number;
  dirty: boolean;
  symbols: string;
  review?: ReviewStats;
}

export interface TaskRecord {
  agent?: AgentKind;
  spawnedAt: number;
  lastResumedAt?: number;
  lifecycle?: TaskLifecycle;
  lifecycleAt?: number;
  snapshot?: TaskSnapshot;
  /**
   * The zellij pane id (e.g. `terminal_47`) we spawned this slug into.
   * Used by the poll loop to identify the pane by id instead of title —
   * agent CLIs (especially claude-code) emit OSC set-title shortly after
   * boot, which would otherwise make title-based lookup fail and the task
   * incorrectly drift to `ready`.
   */
  paneId?: string;
}

export interface UiPrefs {
  listDensity?: TaskListDensity;
}

interface StateFile {
  version: 1;
  tasks: Record<string, TaskRecord>;
  ui?: UiPrefs;
}

function statePath(): string {
  // Per XDG Base Directory: $XDG_STATE_HOME defaults to $HOME/.local/state.
  const base =
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(base, "lazyagent", "tasks.json");
}

async function readFile(): Promise<StateFile> {
  try {
    const raw = await fs.readFile(statePath(), "utf-8");
    const parsed = JSON.parse(raw) as StateFile;
    if (parsed.version === 1 && parsed.tasks && typeof parsed.tasks === "object") {
      return parsed;
    }
  } catch (err) {
    // Missing file or invalid JSON → treat as fresh state. We never throw
    // from here because state is best-effort: lazyagent must work the first
    // time you run it before the file exists.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      // Corrupt file — log to stderr but proceed.
      // eslint-disable-next-line no-console
      console.error(`lazyagent: state file unreadable, starting fresh: ${err}`);
    }
  }
  return { version: 1, tasks: {} };
}

async function writeFile(state: StateFile): Promise<void> {
  const path = statePath();
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(state, null, 2), "utf-8");
}

/** Record that we spawned `slug` with `agent`. Idempotent. */
export async function recordSpawn(
  slug: string,
  agent: AgentKind,
  paneId?: string | null
): Promise<void> {
  const state = await readFile();
  state.tasks[slug] = {
    agent,
    spawnedAt: state.tasks[slug]?.spawnedAt ?? Date.now(),
    paneId: paneId ?? state.tasks[slug]?.paneId,
    lifecycle: "active",
    lifecycleAt: Date.now(),
  };
  await writeFile(state);
}

/** Touch the task's lastResumedAt. Creates the entry if missing. */
export async function recordResume(
  slug: string,
  agent: AgentKind,
  paneId?: string | null
): Promise<void> {
  const state = await readFile();
  const existing = state.tasks[slug] ?? { spawnedAt: Date.now() };
  state.tasks[slug] = {
    agent,
    spawnedAt: existing?.spawnedAt ?? Date.now(),
    lastResumedAt: Date.now(),
    paneId: paneId ?? existing?.paneId,
    lifecycle: "active",
    lifecycleAt: Date.now(),
  };
  await writeFile(state);
}

/** Persist an explicit lifecycle marker. `null` clears the override. */
export async function recordLifecycle(
  slug: string,
  lifecycle: TaskLifecycle | null,
  snapshot?: TaskSnapshot
): Promise<void> {
  const state = await readFile();
  const existing = state.tasks[slug] ?? { spawnedAt: Date.now() };
  if (lifecycle === null) {
    state.tasks[slug] = {
      ...existing,
      lifecycle: undefined,
      lifecycleAt: undefined,
      snapshot: undefined,
    };
  } else {
    state.tasks[slug] = {
      ...existing,
      lifecycle,
      lifecycleAt: Date.now(),
      snapshot: snapshot ?? existing.snapshot,
    };
  }
  await writeFile(state);
}

export function snapshotTask(task: Task): TaskSnapshot {
  return {
    path: task.path,
    shortSha: task.shortSha,
    subject: task.subject,
    ageSeconds: task.ageSeconds,
    dirty: task.dirty,
    symbols: task.symbols,
    review: task.review,
  };
}

/** Persist dashboard-level UI preferences. */
export async function recordListDensity(
  listDensity: TaskListDensity
): Promise<void> {
  const state = await readFile();
  state.ui = {
    ...state.ui,
    listDensity,
  };
  await writeFile(state);
}

export async function loadUiPrefs(): Promise<UiPrefs> {
  const state = await readFile();
  return {
    listDensity: isListDensity(state.ui?.listDensity)
      ? state.ui.listDensity
      : undefined,
  };
}

/**
 * Adopt a paneId for a slug discovered via title-based lookup. Used as a
 * one-shot upgrade for legacy tasks (spawned before paneId tracking) when
 * the poll loop happens to catch the pane before its title is rewritten.
 * No-op if the slug isn't already tracked or already has the same paneId.
 */
export async function recordPane(
  slug: string,
  paneId: string
): Promise<void> {
  const state = await readFile();
  const existing = state.tasks[slug];
  if (!existing) return;
  if (existing.paneId === paneId) return;
  state.tasks[slug] = { ...existing, paneId };
  await writeFile(state);
}

/**
 * Drop a stale paneId (the pane is gone — agent exited or was closed).
 * Keeps the task record so resume still knows the agent kind.
 */
export async function clearPane(slug: string): Promise<void> {
  const state = await readFile();
  const existing = state.tasks[slug];
  if (!existing || !existing.paneId) return;
  state.tasks[slug] = { ...existing, paneId: undefined };
  await writeFile(state);
}

/** Drop a task entry (e.g. after `X` kill succeeds). Best-effort. */
export async function recordRemove(slug: string): Promise<void> {
  const state = await readFile();
  if (!(slug in state.tasks)) return;
  delete state.tasks[slug];
  await writeFile(state);
}

/** Look up the agent kind we recorded for `slug`. Returns null when unknown. */
export async function getAgent(slug: string): Promise<AgentKind | null> {
  const state = await readFile();
  return state.tasks[slug]?.agent ?? null;
}

/** Read the entire map at once (used by App for batched lookups). */
export async function loadAll(): Promise<Record<string, TaskRecord>> {
  const state = await readFile();
  return state.tasks;
}

function isListDensity(value: unknown): value is TaskListDensity {
  return value === "detailed" || value === "compact";
}
