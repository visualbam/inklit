import { execa, ExecaError } from "execa";
import type { Task, TaskState } from "./model.js";

/**
 * Shape of one entry from `wt list --format json` (worktrunk 0.48).
 * Defensive: every field optional on parse, since worktrunk schema is unstable.
 */
interface WtListEntry {
  branch?: string;
  path?: string;
  kind?: string;
  commit?: {
    sha?: string;
    short_sha?: string;
    message?: string;
    timestamp?: number;
  };
  working_tree?: {
    staged?: boolean;
    modified?: boolean;
    untracked?: boolean;
    renamed?: boolean;
    deleted?: boolean;
    diff?: { added?: number; deleted?: number };
  };
  main_state?: string;
  worktree?: { detached?: boolean };
  is_main?: boolean;
  is_current?: boolean;
  is_previous?: boolean;
  symbols?: string;
}

export class WtError extends Error {
  constructor(message: string, public stderr?: string) {
    super(message);
    this.name = "WtError";
  }
}

/**
 * Run `wt list --format json` and parse into Task[].
 * Filters out main and excludes detached worktrees (we treat those as system).
 */
export async function listTasks(opts: { cwd?: string } = {}): Promise<Task[]> {
  const raw = await listRaw(opts.cwd);
  const now = Math.floor(Date.now() / 1000);
  const tasks: Task[] = [];

  for (const entry of raw) {
    if (entry.is_main) continue;
    if (!entry.branch || !entry.path) continue;

    const wt = entry.working_tree;
    const dirty = !!(
      wt?.staged ||
      wt?.modified ||
      wt?.untracked ||
      wt?.renamed ||
      wt?.deleted
    );

    const ts = entry.commit?.timestamp ?? now;
    const age = Math.max(0, now - ts);

    tasks.push({
      slug: entry.branch,
      path: entry.path,
      shortSha: entry.commit?.short_sha ?? "",
      subject: entry.commit?.message?.split("\n")[0] ?? "",
      ageSeconds: age,
      state: "ready", // Refined later by zellij pane probe in App.
      dirty,
      symbols: entry.symbols ?? "",
    });
  }

  return tasks;
}

async function listRaw(cwd?: string): Promise<WtListEntry[]> {
  try {
    const { stdout } = await execa("wt", ["list", "--format", "json"], {
      cwd,
      reject: true,
      stripFinalNewline: true,
    });
    const parsed = JSON.parse(stdout || "[]");
    if (!Array.isArray(parsed)) {
      throw new WtError("wt list did not return an array", stdout);
    }
    return parsed as WtListEntry[];
  } catch (err) {
    if (err instanceof WtError) throw err;
    if (err instanceof SyntaxError) {
      throw new WtError(`wt list returned invalid JSON: ${err.message}`);
    }
    const e = err as ExecaError;
    if (e.code === "ENOENT") {
      throw new WtError(
        "`wt` not found in PATH. Install worktrunk from https://worktrunk.dev"
      );
    }
    throw new WtError(
      `wt list failed: ${e.shortMessage ?? e.message}`,
      typeof e.stderr === "string" ? e.stderr : undefined
    );
  }
}

/**
 * Squash to a kebab slug suitable for a branch name and zellij pane name.
 * Stable for the same input. No randomness — collisions raise from `wt switch -c`.
 */
export function slugify(input: string, maxLen = 40): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return base || "task";
}

/** Run `git status --short` inside a worktree. v0 inspector content. */
export async function gitStatusShort(path: string): Promise<string> {
  try {
    const { stdout } = await execa(
      "git",
      ["-C", path, "status", "--short", "--branch"],
      { reject: true, stripFinalNewline: true }
    );
    return stdout || "(clean)";
  } catch (err) {
    const e = err as ExecaError;
    return `git status failed: ${e.shortMessage ?? e.message}`;
  }
}

/** TODO phase 2: derive TaskState from wt + zellij + state file. */
export function refineState(task: Task, paneAlive: boolean): TaskState {
  if (paneAlive) return "running";
  return task.state; // remains "ready" by default in v0
}
