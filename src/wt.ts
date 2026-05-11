import { execa, ExecaError } from "execa";
import type { MainVersion, ReviewStats, Task, TaskState } from "./model.js";

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

export interface ProjectSnapshot {
  mainVersion: MainVersion;
  tasks: Task[];
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
  return tasksFromRaw(raw);
}

export async function listProject(
  opts: { cwd?: string } = {}
): Promise<ProjectSnapshot> {
  const raw = await listRaw(opts.cwd);
  const tasks = tasksFromRaw(raw);
  const mainVersion = await mainVersionFromRaw(raw, opts.cwd);
  return { mainVersion, tasks };
}

function tasksFromRaw(raw: WtListEntry[]): Task[] {
  const now = Math.floor(Date.now() / 1000);
  const tasks: Task[] = [];

  for (const entry of raw) {
    if (entry.is_main) continue;
    if (!entry.branch || !entry.path) continue;

    const dirty = workingTreeDirty(entry.working_tree);

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

/**
 * Replit calls the trunk target the "main version"; locally this is the
 * checkout/worktree that receives applied task work. Prefer worktrunk's
 * explicit `is_main` entry, then fall back to plain git so the header still
 * works while setup is incomplete.
 */
export async function getMainVersion(
  opts: { cwd?: string } = {}
): Promise<MainVersion> {
  const cwd = opts.cwd;
  try {
    const raw = await listRaw(cwd);
    return mainVersionFromRaw(raw, cwd);
  } catch {
    /* Plain git fallback below. */
  }

  return gitMainVersionFromCwd(cwd);
}

async function mainVersionFromRaw(
  raw: WtListEntry[],
  cwd?: string
): Promise<MainVersion> {
  const mainEntry = raw.find((entry) => entry.is_main);
  if (mainEntry?.path) {
    return {
      path: mainEntry.path,
      branch: mainEntry.branch ?? (await gitBranch(mainEntry.path)),
      shortSha:
        mainEntry.commit?.short_sha ?? (await gitShortSha(mainEntry.path)),
      subject:
        mainEntry.commit?.message?.split("\n")[0] ??
        (await gitSubject(mainEntry.path)),
      dirty: mainEntry.working_tree
        ? workingTreeDirty(mainEntry.working_tree)
        : await gitDirty(mainEntry.path),
      current: !!mainEntry.is_current,
    };
  }
  return gitMainVersionFromCwd(cwd);
}

function workingTreeDirty(wt: WtListEntry["working_tree"]): boolean {
  return !!(
    wt?.staged ||
    wt?.modified ||
    wt?.untracked ||
    wt?.renamed ||
    wt?.deleted
  );
}

async function gitMainVersionFromCwd(cwd?: string): Promise<MainVersion> {
  const fallbackPath = cwd ?? process.cwd();
  try {
    const path = await gitTopLevel(cwd);
    const [branch, shortSha, subject, dirty] = await Promise.all([
      gitBranch(path),
      gitShortSha(path),
      gitSubject(path),
      gitDirty(path),
    ]);
    return {
      path,
      branch,
      shortSha,
      subject,
      dirty,
      current: true,
    };
  } catch (err) {
    return {
      path: fallbackPath,
      branch: "unknown",
      shortSha: "",
      subject: "",
      dirty: false,
      current: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function gitTopLevel(cwd?: string): Promise<string> {
  return gitOne(cwd, ["rev-parse", "--show-toplevel"]);
}

async function gitBranch(cwd: string): Promise<string> {
  const branch = await gitOne(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch === "HEAD" ? "detached" : branch;
}

async function gitShortSha(cwd: string): Promise<string> {
  return gitOne(cwd, ["rev-parse", "--short", "HEAD"]);
}

async function gitSubject(cwd: string): Promise<string> {
  return gitOne(cwd, ["log", "-1", "--pretty=%s"]);
}

async function gitDirty(cwd: string): Promise<boolean> {
  const status = await gitOne(cwd, ["status", "--porcelain"]);
  return status.length > 0;
}

async function gitOne(cwd: string | undefined, args: string[]): Promise<string> {
  const gitArgs = cwd ? ["-C", cwd, ...args] : args;
  const { stdout } = await execa("git", gitArgs, {
    reject: true,
    stripFinalNewline: true,
  });
  return stdout;
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
 * Parse the final task patch relative to the main version into file rows.
 * This includes committed, staged, unstaged, renamed, deleted, and untracked
 * files so review mode matches what `m` is about to apply.
 */
export async function gitFiles(
  path: string,
  target = "main"
): Promise<StatusEntry[]> {
  let nameStatusOut = "";
  let numstatOut = "";
  let base = target;
  try {
    base = await gitDiffBase(path, target);
    const { stdout } = await execa(
      "git",
      [
        "-C",
        path,
        "diff",
        "--name-status",
        "--find-renames",
        base,
      ],
      { reject: true, stripFinalNewline: true }
    );
    nameStatusOut = stdout;
  } catch {
    return [];
  }
  try {
    const { stdout: numstat } = await execa(
      "git",
      ["-C", path, "diff", "--numstat", "--find-renames", base],
      { reject: true, stripFinalNewline: true }
    );
    numstatOut = numstat;
  } catch {
    /* numstat is best-effort */
  }

  const counts = new Map<string, { added: number; deleted: number }>();
  for (const line of numstatOut.split("\n")) {
    const m = line.match(NUMSTAT_LINE);
    if (!m) continue;
    const [, a = "0", d = "0", p = ""] = m;
    const count = {
      added: a === "-" ? 0 : Number(a),
      deleted: d === "-" ? 0 : Number(d),
    };
    for (const key of countKeys(p)) counts.set(key, count);
  }

  const entries: StatusEntry[] = [];
  const seen = new Set<string>();
  for (const line of nameStatusOut.split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    const code = parts[0] ?? "";
    const status = code[0] ?? code;
    const oldPath = parts[1] ?? "";
    const newPath = parts[2] ?? "";
    const pathLabel =
      (status === "R" || status === "C") && newPath
        ? `${oldPath} -> ${newPath}`
        : oldPath;
    const countPath = newPath || oldPath;
    if (!pathLabel) continue;
    const c =
      counts.get(countPath) ??
      counts.get(pathLabel) ?? { added: 0, deleted: 0 };
    entries.push({ code, path: pathLabel, added: c.added, deleted: c.deleted });
    seen.add(pathLabel);
    if (countPath) seen.add(countPath);
  }

  const untracked = await gitUntrackedFiles(path);
  for (const file of untracked) {
    if (seen.has(file)) continue;
    const c = await gitUntrackedNumstat(path, file);
    entries.push({ code: "??", path: file, added: c.added, deleted: c.deleted });
  }

  return entries;
}

/**
 * Cheap board-level review summary. This intentionally avoids reading file
 * contents or numstat so it can run in the background without freezing input.
 */
export async function gitReviewStats(
  worktreePath: string,
  target = "main"
): Promise<ReviewStats> {
  try {
    const base = await gitDiffBase(worktreePath, target);
    const [tracked, untracked, commits] = await Promise.all([
      gitLines(
        worktreePath,
        ["diff", "--name-only", "--find-renames", base],
        1000
      ),
      gitUntrackedFiles(worktreePath),
      gitOneTimed(worktreePath, ["rev-list", "--count", `${base}..HEAD`], 1000),
    ]);
    const files = new Set([...tracked, ...untracked]);
    return {
      files: files.size,
      commitsAhead: Number(commits) || 0,
      untracked: untracked.length,
    };
  } catch {
    return { files: 0, commitsAhead: 0, untracked: 0 };
  }
}

/**
 * Unified final patch for everything this worktree has done relative to
 * `target`: committed + staged + unstaged tracked changes as one diff, plus
 * every untracked file's contents synthesized via `diff --no-index`. Capped to
 * ~maxBytes total.
 *
 * Untracked content matters: a brand-new file in a brand-new folder is invisible
 * to plain `git diff`, so without this the "diff" pane lies about what's there.
 */
export async function gitDiff(
  worktreePath: string,
  target = "main",
  maxBytes = 200_000
): Promise<string> {
  try {
    const parts: string[] = [];
    const base = await gitDiffBase(worktreePath, target);
    const { stdout: tracked } = await execa(
      "git",
      ["-C", worktreePath, "diff", "--find-renames", base],
      { reject: false, stripFinalNewline: true, maxBuffer: maxBytes * 4 }
    );
    if (tracked) parts.push(tracked);

    const untracked = await gitUntrackedFiles(worktreePath);
    for (const file of untracked) {
      // --no-index always exits 1 when files differ; reject:false swallows that.
      const { stdout } = await execa(
        "git",
        [
          "-C",
          worktreePath,
          "diff",
          "--no-index",
          "--",
          "/dev/null",
          file,
        ],
        { reject: false, stripFinalNewline: true, maxBuffer: maxBytes }
      );
      if (stdout) parts.push(stdout);
    }

    const combined = parts.join("\n");
    if (!combined) return "(no changes vs main version)";
    if (combined.length > maxBytes) {
      return (
        combined.slice(0, maxBytes) +
        `\n\n…truncated (${combined.length - maxBytes} more bytes)`
      );
    }
    return combined;
  } catch (err) {
    const e = err as ExecaError;
    return `git diff failed: ${e.shortMessage ?? e.message}`;
  }
}

async function gitDiffBase(
  worktreePath: string,
  target: string
): Promise<string> {
  const { stdout } = await execa(
    "git",
    ["-C", worktreePath, "merge-base", target, "HEAD"],
    { reject: false, stripFinalNewline: true }
  );
  return stdout.trim() || target;
}

async function gitUntrackedFiles(worktreePath: string): Promise<string[]> {
  const { stdout } = await execa(
    "git",
    ["-C", worktreePath, "ls-files", "--others", "--exclude-standard"],
    { reject: false, stripFinalNewline: true }
  );
  return stdout ? stdout.split("\n").filter(Boolean) : [];
}

async function gitLines(
  cwd: string,
  args: string[],
  timeout: number
): Promise<string[]> {
  const out = await gitOneTimed(cwd, args, timeout);
  return out ? out.split("\n").filter(Boolean) : [];
}

async function gitOneTimed(
  cwd: string,
  args: string[],
  timeout: number
): Promise<string> {
  const { stdout } = await execa("git", ["-C", cwd, ...args], {
    reject: false,
    stripFinalNewline: true,
    timeout,
  });
  return stdout;
}

async function gitUntrackedNumstat(
  worktreePath: string,
  file: string
): Promise<{ added: number; deleted: number }> {
  const { stdout } = await execa(
    "git",
    [
      "-C",
      worktreePath,
      "diff",
      "--no-index",
      "--numstat",
      "--",
      "/dev/null",
      file,
    ],
    { reject: false, stripFinalNewline: true }
  );
  const line = stdout.split("\n").find(Boolean) ?? "";
  const m = line.match(NUMSTAT_LINE);
  if (!m) return { added: 0, deleted: 0 };
  const [, a = "0", d = "0"] = m;
  return {
    added: a === "-" ? 0 : Number(a),
    deleted: d === "-" ? 0 : Number(d),
  };
}

function countKeys(path: string): string[] {
  const keys = [path];
  if (path.includes("=>")) {
    keys.push(path.replace(/\{([^{}]*?) => ([^{}]*?)\}/g, "$2"));
  }
  return keys;
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
    return stdout || "(no commits ahead of main version)";
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

export function detectPermissionRequest(screen: string): boolean {
  const cleaned = screen.replace(ANSI_RE, "");
  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  const tail = lines.slice(-15);
  if (tail.length === 0) return false;
  const joined = tail.join("\n");
  // Claude Code permission prompts: "? Allow <tool>" at line start.
  if (/(^|\n)\s*\?\s+Allow\b/i.test(joined)) return true;
  // Tool approval dialogs surface an "Always allow" option.
  if (/\bAlways allow\b/i.test(joined)) return true;
  return false;
}

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
 * changes) and unmerged-branch deletion — `X` is "I want this gone."
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
