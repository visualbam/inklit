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

/**
 * Parsed entry from `git status --short`. Codes follow git's two-letter
 * convention: index status + worktree status (e.g. " M", "A ", "??").
 */
export interface StatusEntry {
  code: string;
  path: string;
  added: number;
  deleted: number;
}

const NUMSTAT_LINE = /^(\d+|-)\s+(\d+|-)\s+(.+)$/;

/**
 * Parse `git status --short` plus `git diff --numstat HEAD` into a single
 * structured list. Falls back gracefully when either command errors.
 */
export async function gitFiles(path: string): Promise<StatusEntry[]> {
  let statusOut = "";
  let numstatOut = "";
  try {
    const { stdout } = await execa(
      "git",
      ["-C", path, "status", "--short", "--no-renames"],
      { reject: true, stripFinalNewline: true }
    );
    statusOut = stdout;
  } catch {
    return [];
  }
  try {
    const { stdout } = await execa(
      "git",
      ["-C", path, "diff", "--numstat", "HEAD"],
      { reject: true, stripFinalNewline: true }
    );
    numstatOut = stdout;
  } catch {
    /* numstat is best-effort */
  }

  const counts = new Map<string, { added: number; deleted: number }>();
  for (const line of numstatOut.split("\n")) {
    const m = line.match(NUMSTAT_LINE);
    if (!m) continue;
    const [, a = "0", d = "0", p = ""] = m;
    counts.set(p, {
      added: a === "-" ? 0 : Number(a),
      deleted: d === "-" ? 0 : Number(d),
    });
  }

  const entries: StatusEntry[] = [];
  for (const line of statusOut.split("\n")) {
    if (!line) continue;
    const code = line.slice(0, 2);
    const p = line.slice(3);
    const c = counts.get(p) ?? { added: 0, deleted: 0 };
    entries.push({ code, path: p, added: c.added, deleted: c.deleted });
  }
  return entries;
}

/** Unified diff between the worktree branch and `target`, capped to ~maxBytes. */
export async function gitDiff(
  worktreePath: string,
  target = "main",
  maxBytes = 200_000
): Promise<string> {
  try {
    // diff main..HEAD shows what this branch has added on top of main.
    const { stdout } = await execa(
      "git",
      ["-C", worktreePath, "diff", `${target}...HEAD`],
      { reject: true, stripFinalNewline: true, maxBuffer: maxBytes * 4 }
    );
    if (!stdout) {
      // Also include uncommitted changes when there are no committed ones.
      const { stdout: uncommitted } = await execa(
        "git",
        ["-C", worktreePath, "diff", "HEAD"],
        { reject: false, stripFinalNewline: true }
      );
      return uncommitted || "(no changes vs main)";
    }
    if (stdout.length > maxBytes) {
      return (
        stdout.slice(0, maxBytes) +
        `\n\n…truncated (${stdout.length - maxBytes} more bytes)`
      );
    }
    return stdout;
  } catch (err) {
    const e = err as ExecaError;
    return `git diff failed: ${e.shortMessage ?? e.message}`;
  }
}

/** Commit log for the branch ahead of `target`. */
export async function gitLog(
  worktreePath: string,
  target = "main"
): Promise<string> {
  try {
    const { stdout } = await execa(
      "git",
      [
        "-C",
        worktreePath,
        "log",
        "--oneline",
        "--decorate",
        `${target}..HEAD`,
      ],
      { reject: true, stripFinalNewline: true }
    );
    return stdout || "(no commits ahead of main)";
  } catch (err) {
    const e = err as ExecaError;
    return `git log failed: ${e.shortMessage ?? e.message}`;
  }
}

/**
 * Heuristic: does this terminal viewport look like the agent is awaiting input?
 * Strips ANSI, looks at the last ~15 non-blank lines for prompt markers.
 *
 * False positives are tolerable (we just show ⊙ instead of ●). False
 * negatives are also tolerable (we miss the wait but the user still sees it
 * by entering the pane). So lean conservative: only fire on clear signals.
 */
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export function detectWaiting(screen: string): boolean {
  const cleaned = screen.replace(ANSI_RE, "");
  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  const tail = lines.slice(-15);
  if (tail.length === 0) return false;
  const joined = tail.join("\n");
  // Yes/no-style prompts.
  if (/\([yY]\/[nN]\)/.test(joined)) return true;
  if (/\[[yY]\/[nN]\]/.test(joined)) return true;
  // Question markers (Claude Code uses these for confirmations).
  if (/(^|\n)\s*\?\s+\S/.test(joined)) return true;
  // Trailing arrow/chevron prompt on the last line.
  const last = tail[tail.length - 1] ?? "";
  if (/[❯>›→]\s*$/.test(last)) return true;
  return false;
}

/** TODO phase 2: derive TaskState from wt + zellij + state file. */
export function refineState(task: Task, paneAlive: boolean): TaskState {
  if (paneAlive) return "running";
  return task.state; // remains "ready" by default in v0
}

/**
 * Squash-merge a worktree's branch into `target` (default `main`) and let
 * worktrunk remove the worktree. `-y` skips the interactive approval; we've
 * already confirmed in the UI.
 */
export async function mergeToMain(
  worktreePath: string,
  target = "main"
): Promise<void> {
  try {
    await execa("wt", ["-C", worktreePath, "merge", target, "-y"], {
      reject: true,
    });
  } catch (err) {
    const e = err as ExecaError;
    const stderr = typeof e.stderr === "string" ? e.stderr : "";
    throw new WtError(
      `wt merge ${target} failed: ${e.shortMessage ?? e.message}`,
      stderr
    );
  }
}

/**
 * Remove a worktree by branch name. Forces both worktree removal (uncommitted
 * changes) and unmerged-branch deletion — `K` is "I want this gone."
 */
export async function removeWorktree(slug: string): Promise<void> {
  try {
    await execa("wt", ["remove", slug, "-y", "-f", "-D", "--foreground"], {
      reject: true,
    });
  } catch (err) {
    const e = err as ExecaError;
    const stderr = typeof e.stderr === "string" ? e.stderr : "";
    throw new WtError(
      `wt remove ${slug} failed: ${e.shortMessage ?? e.message}`,
      stderr
    );
  }
}
