import { execa, ExecaError } from "execa";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
    if (!combined) return `(no changes vs ${target})`;
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

async function gitFullPatch(
  worktreePath: string,
  target: string
): Promise<string> {
  const base = await gitDiffBase(worktreePath, target);
  const parts: string[] = [];
  const { stdout: tracked } = await execa(
    "git",
    ["-C", worktreePath, "diff", "--binary", "--find-renames", base],
    { reject: false, stripFinalNewline: true, maxBuffer: 50_000_000 }
  );
  if (tracked) parts.push(tracked);

  const untracked = await gitUntrackedFiles(worktreePath);
  for (const file of untracked) {
    const { stdout } = await execa(
      "git",
      [
        "-C",
        worktreePath,
        "diff",
        "--no-index",
        "--binary",
        "--",
        "/dev/null",
        file,
      ],
      { reject: false, stripFinalNewline: true, maxBuffer: 50_000_000 }
    );
    if (stdout) parts.push(stdout);
  }

  return parts.join("\n");
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
    return stdout || `(no commits ahead of ${target})`;
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
  // Inklit-launched agents use no-prompt modes; keep detecting prompts for
  // older sessions, externally spawned panes, or unsupported agent versions.
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

async function mainWorktreePath(fromPath: string): Promise<string> {
  const { stdout } = await execa("git", ["-C", fromPath, "worktree", "list", "--porcelain"]);
  const line = stdout.split("\n").find((l) => l.startsWith("worktree "));
  if (!line) throw new Error("Could not find main worktree");
  return line.slice("worktree ".length).trim();
}

async function currentBranchName(repoPath: string): Promise<string> {
  const { stdout } = await execa(
    "git",
    ["-C", repoPath, "branch", "--show-current"],
    { reject: false, stripFinalNewline: true }
  );
  return stdout.trim();
}

async function hasLocalChanges(repoPath: string): Promise<boolean> {
  const { stdout } = await execa(
    "git",
    ["-C", repoPath, "status", "--porcelain"],
    { reject: false, stripFinalNewline: true }
  );
  return stdout.length > 0;
}

async function stashIfDirty(
  repoPath: string,
  message: string,
  signal?: AbortSignal
): Promise<boolean> {
  if (!(await hasLocalChanges(repoPath))) return false;
  await execa(
    "git",
    ["-C", repoPath, "stash", "push", "--include-untracked", "-m", message],
    { reject: true, cancelSignal: signal }
  );
  return true;
}

async function popStash(repoPath: string): Promise<void> {
  await execa("git", ["-C", repoPath, "stash", "pop"], { reject: false });
}

async function conflictedFiles(repoPath: string): Promise<string[]> {
  const { stdout } = await execa(
    "git", ["-C", repoPath, "diff", "--name-only", "--diff-filter=U"],
    { reject: false }
  );
  return stdout.split("\n").filter(Boolean);
}

function containsConflictMarkers(content: string): boolean {
  return /^(<<<<<<<|=======|>>>>>>>)(?:\s|$)/m.test(content);
}

async function filesWithConflictMarkers(
  repoPath: string,
  files: string[]
): Promise<string[]> {
  const marked: string[] = [];
  for (const file of files) {
    const content = await readFile(path.join(repoPath, file), "utf8");
    if (containsConflictMarkers(content)) marked.push(file);
  }
  return marked;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function gitInternalPath(
  repoPath: string,
  gitPath: string
): Promise<string> {
  const { stdout } = await execa(
    "git",
    ["-C", repoPath, "rev-parse", "--git-path", gitPath],
    { reject: true, stripFinalNewline: true }
  );
  const resolved = stdout.trim();
  return path.isAbsolute(resolved) ? resolved : path.join(repoPath, resolved);
}

async function rebaseInProgress(repoPath: string): Promise<boolean> {
  const [mergePath, applyPath] = await Promise.all([
    gitInternalPath(repoPath, "rebase-merge"),
    gitInternalPath(repoPath, "rebase-apply"),
  ]);
  return (await pathExists(mergePath)) || (await pathExists(applyPath));
}

export function isSkippableRebaseStop(output: string): boolean {
  return (
    /No changes - did you forget to use 'git add'\?/i.test(output) ||
    /previous cherry-pick is now empty/i.test(output) ||
    /patch contents already upstream/i.test(output) ||
    /nothing to commit, working tree clean/i.test(output)
  );
}

function firstOutputLine(output: string): string {
  return (
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "unknown error"
  );
}

const MAX_REBASE_STEPS = 50;

async function continueRebaseUntilDone(
  repoPath: string,
  signal?: AbortSignal
): Promise<void> {
  for (let step = 0; step < MAX_REBASE_STEPS; step++) {
    if (signal?.aborted) throw new Error("Cancelled");

    const inProgress = await rebaseInProgress(repoPath);
    const stuck = await conflictedFiles(repoPath);
    if (!inProgress) {
      if (stuck.length > 0) {
        await resolveConflicts(repoPath, signal);
      }
      return;
    }

    if (stuck.length > 0) {
      await resolveConflicts(repoPath, signal);
    }

    const result = await execa(
      "git",
      ["-C", repoPath, "rebase", "--continue"],
      {
        env: { ...process.env, GIT_EDITOR: "true" },
        reject: false,
        cancelSignal: signal,
      }
    );
    const output = [result.stderr, result.stdout].filter(Boolean).join("\n");

    if (result.exitCode === 0) {
      if (!(await rebaseInProgress(repoPath))) return;
      continue;
    }

    if (signal?.aborted) throw new Error("Cancelled");

    const stillStuck = await conflictedFiles(repoPath);
    if (stillStuck.length > 0) continue;

    if (isSkippableRebaseStop(output)) {
      await execa("git", ["-C", repoPath, "rebase", "--skip"], {
        reject: true,
        cancelSignal: signal,
      });
      if (!(await rebaseInProgress(repoPath))) return;
      continue;
    }

    if (!(await rebaseInProgress(repoPath)) && /No rebase in progress/i.test(output)) {
      return;
    }

    throw new WtError(
      `git rebase --continue failed: ${firstOutputLine(output)}`,
      output || undefined
    );
  }

  throw new WtError(
    `git rebase did not complete after ${MAX_REBASE_STEPS} steps`
  );
}

// Per-file budget for the AI conflict resolvers. Without these, a hung CLI
// (auth prompt, slow generation, stalled network) would freeze the merge with
// no way for the user to recover.
const CLAUDE_RESOLVE_TIMEOUT_MS = 120_000;
const CODEX_RESOLVE_TIMEOUT_MS = 180_000;

// AI conflict resolvers must NOT inherit our controlling TTY. If they did
// (claude/codex CLIs sometimes open /dev/tty directly for auth or permission
// prompts), they'd silently fight inklit for the user's keystrokes and the
// whole terminal would appear frozen. `detached: true` calls setsid() on
// Unix, putting the child in a new session with no controlling terminal —
// so any /dev/tty open() fails fast instead of hanging.
const detachedAiOptions = {
  stdin: "ignore",
  detached: true,
  forceKillAfterDelay: 2_000,
} as const;

async function resolveConflicts(repoPath: string, signal?: AbortSignal): Promise<void> {
  const files = await conflictedFiles(repoPath);
  if (files.length === 0) return;

  // Try Claude for each file. On any failure, stop and let Codex handle the rest.
  let claudeFailed = false;
  for (const file of files) {
    if (claudeFailed) break;
    if (signal?.aborted) throw new Error("Cancelled");
    try {
      const fullPath = path.join(repoPath, file);
      const content = await readFile(fullPath, "utf8");
      const prompt =
        `Resolve all git conflict markers in this file. Choose the semantically correct result, ` +
        `preserve the intended behavior from both sides when compatible, and do not leave any conflict markers. ` +
        `Return ONLY the resolved file content — no explanation, no markdown, no code fences.\n\n${content}`;
      const { stdout } = await execa(
        "claude", ["-p", prompt, "--output-format", "text", "--bare"],
        {
          reject: true,
          timeout: CLAUDE_RESOLVE_TIMEOUT_MS,
          cancelSignal: signal,
          ...detachedAiOptions,
        }
      );
      if (containsConflictMarkers(stdout)) {
        throw new Error(`Claude left conflict markers in ${file}`);
      }
      await writeFile(fullPath, stdout);
      await execa("git", ["-C", repoPath, "add", file], { cancelSignal: signal });
    } catch (err) {
      if (signal?.aborted) throw err;
      claudeFailed = true;
    }
  }

  if (!claudeFailed) return;
  if (signal?.aborted) throw new Error("Cancelled");

  // Codex fallback: agent edits remaining conflicted files in place.
  const remaining = await conflictedFiles(repoPath);
  if (remaining.length === 0) return;
  const prompt =
    `Resolve all git conflict markers in these files: ${remaining.join(", ")}. ` +
    `Choose the semantically correct result for each conflict, preserve compatible intent from both sides, ` +
    `remove every conflict marker, and edit the files in place.`;
  await execa("codex", ["exec", prompt], {
    cwd: repoPath,
    reject: true,
    timeout: CODEX_RESOLVE_TIMEOUT_MS,
    cancelSignal: signal,
    ...detachedAiOptions,
  });
  const stillMarked = await filesWithConflictMarkers(repoPath, remaining);
  if (stillMarked.length > 0) {
    throw new Error(
      `AI conflict resolver left conflict markers in ${stillMarked.join(", ")}`
    );
  }
  await execa("git", ["-C", repoPath, "add", ...remaining], { cancelSignal: signal });
  const stillUnmerged = await conflictedFiles(repoPath);
  if (stillUnmerged.length > 0) {
    throw new Error(
      `AI conflict resolver left unmerged files: ${stillUnmerged.join(", ")}`
    );
  }
}

/**
 * Squash-merge a worktree's branch into `target` (default `main`) and let
 * worktrunk remove the worktree. Handles common failure modes automatically:
 *
 *  1. Main has uncommitted changes → stash, merge, unstash.
 *  2. Worktree is mid-rebase (detached HEAD) → Claude resolves conflicts,
 *     rebase continues, then merge retries.
 *  3. Last resort → apply the full task patch with AI conflict resolution.
 */
export async function mergeToMain(
  worktreePath: string,
  target = "main",
  signal?: AbortSignal
): Promise<void> {
  try {
    await mergeToMainInner(worktreePath, target, signal);
  } catch (err) {
    if (signal?.aborted) throw new WtError("Merge cancelled");
    throw err;
  }
}

async function mergeToMainInner(
  worktreePath: string,
  target: string,
  signal?: AbortSignal
): Promise<void> {
  const originalBranch = await currentBranchName(worktreePath);
  const wtMerge = () =>
    execa("wt", ["-C", worktreePath, "merge", target, "-y"], {
      reject: true,
      cancelSignal: signal,
    });

  // First attempt.
  try {
    await wtMerge();
    return;
  } catch (firstErr) {
    const e = firstErr as ExecaError;
    const stderr = typeof e.stderr === "string" ? e.stderr : "";

    // Case 1: main has uncommitted changes blocking the push step.
    if (stderr.includes("conflicting uncommitted changes")) {
      const mainPath = await mainWorktreePath(worktreePath);
      const stashedMain = await stashIfDirty(
        mainPath,
        "inklit-auto-stash-before-merge",
        signal
      );
      try {
        await wtMerge();
        return;
      } finally {
        if (stashedMain) await popStash(mainPath);
      }
    }

    // Case 2: worktree is mid-rebase (wt merge triggered a rebase that conflicted).
    if (
      stderr.includes("not on a branch") ||
      stderr.includes("detached HEAD") ||
      stderr.includes("rebase") ||
      (await rebaseInProgress(worktreePath))
    ) {
      await continueRebaseUntilDone(worktreePath, signal);
      try {
        await wtMerge();
        return;
      } catch {
        /* fall through to last-resort below */
      }
    }

    // Last resort: manual squash merge via git so wt pre-checks can't block us.
    const mainPath = await mainWorktreePath(worktreePath);
    const branch = originalBranch || (await currentBranchName(worktreePath));
    if (!branch) {
      throw new WtError(
        `wt merge ${target} failed: ${e.shortMessage ?? e.message}`,
        stderr
      );
    }

    const patch = await gitFullPatch(worktreePath, target);
    if (!patch.trim()) {
      throw new WtError(`no changes to merge from ${branch}`, stderr);
    }

    const stashedMain = await stashIfDirty(
      mainPath,
      "inklit-auto-stash-before-manual-merge",
      signal
    );
    try {
      const apply = await execa(
        "git",
        ["-C", mainPath, "apply", "--index", "--3way"],
        {
          input: patch,
          reject: false,
          cancelSignal: signal,
          maxBuffer: 50_000_000,
        }
      );
      if (apply.exitCode !== 0) {
        const output = [apply.stderr, apply.stdout].filter(Boolean).join("\n");
        const stuck = await conflictedFiles(mainPath);
        if (stuck.length === 0) {
          throw new WtError(
            `git apply fallback patch failed: ${firstOutputLine(output)}`,
            output || stderr
          );
        }
        await resolveConflicts(mainPath, signal);
      }

      await execa(
        "git",
        ["-C", mainPath, "commit", "--no-edit", "-m", `squash: ${branch}`],
        { reject: true, cancelSignal: signal }
      );
    } finally {
      if (stashedMain) await popStash(mainPath);
    }

    // Clean up the worktree now that we've merged manually.
    await execa("wt", ["remove", branch, "-y", "-f", "-D", "--foreground"], {
      reject: false,
    });
  }
}

/**
 * Rebase the task branch onto `target` (default `main`), pulling the latest
 * main changes into the worktree. Conflict cycles are resolved automatically
 * via Claude until the rebase completes. The rebase is aborted if resolution
 * itself fails, leaving the worktree in its original state.
 */
export async function syncFromMain(
  worktreePath: string,
  target = "main",
  signal?: AbortSignal
): Promise<void> {
  try {
    await syncFromMainInner(worktreePath, target, signal);
  } catch (err) {
    if (signal?.aborted) throw new WtError("Sync cancelled");
    throw err;
  }
}

async function syncFromMainInner(
  worktreePath: string,
  target: string,
  signal?: AbortSignal
): Promise<void> {
  try {
    await execa("git", ["-C", worktreePath, "rebase", "--autostash", target], {
      reject: true,
      cancelSignal: signal,
    });
  } catch (err) {
    const e = err as ExecaError;
    const stderr = typeof e.stderr === "string" ? e.stderr : "";
    const stuck = await conflictedFiles(worktreePath);
    const inProgress = await rebaseInProgress(worktreePath);
    if (!inProgress && stuck.length === 0) {
      throw new WtError(
        `sync from ${target} failed: ${e.shortMessage ?? e.message}`,
        stderr
      );
    }
    try {
      await continueRebaseUntilDone(worktreePath, signal);
      return;
    } catch (resolveErr) {
      await execa("git", ["-C", worktreePath, "rebase", "--abort"], {
        reject: false,
      });
      const message =
        resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
      const resolveDetails =
        resolveErr instanceof WtError
          ? resolveErr.stderr
          : resolveErr instanceof Error
            ? resolveErr.message
            : String(resolveErr);
      const details = [stderr, resolveDetails].filter(Boolean).join("\n\n");
      throw new WtError(
        `sync from ${target} failed: ${message}`,
        details || stderr
      );
    }
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
