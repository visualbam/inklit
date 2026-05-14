import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type {
  AgentKind,
  TaskFailure,
  ReviewStats,
  Task,
  TaskLifecycle,
  TaskListDensity,
  TaskOperation,
  TaskPreview,
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
  /** Background operation currently running for this task. */
  operation?: TaskOperation;
  /** Last operation failure details, kept until retry/success/removal. */
  failure?: TaskFailure;
  /** Best-effort local preview server metadata. */
  preview?: TaskPreview;
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
  return join(base, "inklit", "tasks.json");
}

export function signalDir(): string {
  const base =
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(base, "inklit", "signals");
}

export function signalPath(slug: string): string {
  return join(signalDir(), slug);
}

export function wrapperPath(): string {
  const base =
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(base, "inklit", "bin", "inklit-agent-wrap");
}

export async function ensureWrapper(): Promise<string> {
  const path = wrapperPath();
  const script = [
    "#!/bin/bash",
    "# inklit agent wrapper — do not edit manually",
    'INKLIT_SIGNAL="$1"; shift',
    '"$@"',
    '[ -n "$INKLIT_SIGNAL" ] && touch "$INKLIT_SIGNAL"',
    'exec "${SHELL:-bash}"',
    "",
  ].join("\n");

  try {
    const existing = await fs.readFile(path, "utf-8");
    if (existing === script) return path;
  } catch {
    /* not found or unreadable — write it */
  }

  await fs.mkdir(join(path, ".."), { recursive: true });
  await fs.writeFile(path, script, { encoding: "utf-8", mode: 0o755 });
  await fs.chmod(path, 0o755);
  return path;
}

async function readFile(): Promise<StateFile> {
  try {
    const raw = await fs.readFile(statePath(), "utf-8");
    const parsed = JSON.parse(raw) as StateFile;
    if (
      parsed.version === 1 &&
      parsed.tasks &&
      typeof parsed.tasks === "object" &&
      !Array.isArray(parsed.tasks)
    ) {
      return parsed;
    }
  } catch (err) {
    // Missing file or invalid JSON → treat as fresh state. We never throw
    // from here because state is best-effort: inklit must work the first
    // time you run it before the file exists.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      // Corrupt file — log to stderr but proceed.
      // eslint-disable-next-line no-console
      console.error(`inklit: state file unreadable, starting fresh: ${err}`);
    }
  }
  return { version: 1, tasks: {} };
}

async function writeFile(state: StateFile): Promise<void> {
  const path = statePath();
  const dir = dirname(path);
  const tmpPath = join(
    dir,
    `.tasks-${process.pid}-${Date.now()}-${randomUUID()}.json.tmp`
  );
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), "utf-8");
  try {
    await fs.rename(tmpPath, path);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

async function withState(
  mutate: (state: StateFile) => void | false | Promise<void | false>
): Promise<void> {
  const state = await readFile();
  const result = await mutate(state);
  if (result === false) return;
  await writeFile(state);
}

/** Record that we spawned `slug` with `agent`. Idempotent. */
export async function recordSpawn(
  slug: string,
  agent: AgentKind,
  paneId?: string | null
): Promise<void> {
  const now = Date.now();
  await withState((state) => {
    const existing = state.tasks[slug] ?? { spawnedAt: now };
    state.tasks[slug] = {
      ...existing,
      agent,
      spawnedAt: existing.spawnedAt ?? now,
      paneId: paneId ?? existing.paneId,
      lifecycle: "active",
      lifecycleAt: now,
      operation: undefined,
      failure: undefined,
      preview: existing.preview,
    };
  });
}

/** Touch the task's lastResumedAt. Creates the entry if missing. */
export async function recordResume(
  slug: string,
  agent: AgentKind,
  paneId?: string | null
): Promise<void> {
  const now = Date.now();
  await withState((state) => {
    const existing = state.tasks[slug] ?? { spawnedAt: now };
    state.tasks[slug] = {
      ...existing,
      agent,
      spawnedAt: existing.spawnedAt,
      lastResumedAt: now,
      paneId: paneId ?? existing.paneId,
      lifecycle: "active",
      lifecycleAt: now,
      operation: undefined,
      failure: undefined,
      preview: existing.preview,
    };
  });
}

/** Persist an explicit lifecycle marker. `null` clears the override. */
export async function recordLifecycle(
  slug: string,
  lifecycle: TaskLifecycle | null,
  snapshot?: TaskSnapshot
): Promise<void> {
  const now = Date.now();
  await withState((state) => {
    const existing = state.tasks[slug] ?? { spawnedAt: now };
    if (lifecycle === null) {
      state.tasks[slug] = {
        ...existing,
        lifecycle: undefined,
        lifecycleAt: undefined,
        snapshot: undefined,
        operation: undefined,
        failure: undefined,
      };
      return;
    }
    state.tasks[slug] = {
      ...existing,
      lifecycle,
      lifecycleAt: now,
      snapshot: snapshot ?? existing.snapshot,
      operation: lifecycle === "done" ? undefined : existing.operation,
      failure: lifecycle === "done" ? undefined : existing.failure,
    };
  });
}

/** Persist a background operation marker so polling can keep the task visible. */
export async function recordTaskOperation(
  slug: string,
  operation: TaskOperation,
  snapshot?: TaskSnapshot
): Promise<void> {
  await withState((state) => {
    const existing = state.tasks[slug] ?? { spawnedAt: operation.startedAt };
    state.tasks[slug] = {
      ...existing,
      lifecycle: "applying",
      lifecycleAt: operation.startedAt,
      operation,
      failure: undefined,
      snapshot: snapshot ?? existing.snapshot,
    };
  });
}

/** Persist a task operation failure so the inspector can explain what happened. */
export async function recordTaskFailure(
  slug: string,
  failure: TaskFailure,
  snapshot?: TaskSnapshot
): Promise<void> {
  await withState((state) => {
    const existing = state.tasks[slug] ?? { spawnedAt: failure.at };
    state.tasks[slug] = {
      ...existing,
      lifecycle: "failed",
      lifecycleAt: failure.at,
      operation: undefined,
      failure,
      snapshot: snapshot ?? existing.snapshot,
    };
  });
}

/**
 * On startup, convert any tasks that were mid-merge when inklit last exited
 * into a "failed" state. Without this, they show as permanently "merging"
 * with no UI escape (the Esc cancel requires an active abort controller).
 */
export async function clearStaleApplyOperations(): Promise<void> {
  const now = Date.now();
  await withState((state) => {
    for (const [slug, record] of Object.entries(state.tasks)) {
      if (record.operation?.phase === "merge") {
        const failure: TaskFailure = {
          phase: "merge",
          message: "Merge was interrupted (inklit exited during merge)",
          targetBranch: record.operation.targetBranch,
          at: now,
        };
        state.tasks[slug] = {
          ...record,
          lifecycle: "failed",
          lifecycleAt: now,
          operation: undefined,
          failure,
        };
      }
    }
  });
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
  await withState((state) => {
    state.ui = {
      ...state.ui,
      listDensity,
    };
  });
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
  await withState((state) => {
    const existing = state.tasks[slug];
    if (!existing) return false;
    if (existing.paneId === paneId) return false;
    state.tasks[slug] = { ...existing, paneId };
  });
}

/**
 * Drop a stale paneId (the pane is gone — agent exited or was closed).
 * Keeps the task record so resume still knows the agent kind.
 */
export async function clearPane(slug: string): Promise<void> {
  await withState((state) => {
    const existing = state.tasks[slug];
    if (!existing || !existing.paneId) return false;
    state.tasks[slug] = { ...existing, paneId: undefined };
  });
}

/** Persist or replace the task's preview server metadata. */
export async function recordPreview(
  slug: string,
  preview: TaskPreview
): Promise<void> {
  await withState((state) => {
    const existing = state.tasks[slug] ?? { spawnedAt: preview.startedAt };
    state.tasks[slug] = {
      ...existing,
      preview,
    };
  });
}

/** Clear a task's preview metadata without removing the rest of the record. */
export async function clearPreview(slug: string): Promise<void> {
  await withState((state) => {
    const existing = state.tasks[slug];
    if (!existing || !existing.preview) return false;
    state.tasks[slug] = { ...existing, preview: undefined };
  });
}

/** Drop a task entry (e.g. after `X` kill succeeds). Best-effort. */
export async function recordRemove(slug: string): Promise<void> {
  await withState((state) => {
    if (!(slug in state.tasks)) return false;
    delete state.tasks[slug];
  });
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
