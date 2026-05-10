import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { AgentKind } from "./model.js";

export interface TaskRecord {
  agent: AgentKind;
  spawnedAt: number;
  lastResumedAt?: number;
}

interface StateFile {
  version: 1;
  tasks: Record<string, TaskRecord>;
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
  agent: AgentKind
): Promise<void> {
  const state = await readFile();
  state.tasks[slug] = {
    agent,
    spawnedAt: state.tasks[slug]?.spawnedAt ?? Date.now(),
  };
  await writeFile(state);
}

/** Touch the task's lastResumedAt. Creates the entry if missing. */
export async function recordResume(
  slug: string,
  agent: AgentKind
): Promise<void> {
  const state = await readFile();
  const existing = state.tasks[slug];
  state.tasks[slug] = {
    agent,
    spawnedAt: existing?.spawnedAt ?? Date.now(),
    lastResumedAt: Date.now(),
  };
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
