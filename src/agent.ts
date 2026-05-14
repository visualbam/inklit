import { promises as fs } from "node:fs";
import { join } from "node:path";
import { spawnPane } from "./zellij.js";
import { slugify } from "./wt.js";
import { recordSpawn, recordResume, signalPath, ensureWrapper } from "./state.js";
import { refreshTaskPreview } from "./preview.js";
import type { AgentKind } from "./model.js";

export interface SpawnResult {
  slug: string;
  paneId: string | null;
}

/**
 * Spawn a new agent task in its own worktree + zellij pane.
 *
 * Composes one shell-free command:
 *   zellij action new-pane -n <slug> -- wt switch -c [--base <base>] <slug> -x <agent> -- <agent args>
 *
 * worktrunk handles worktree creation and `cd`; the agent inherits that cwd
 * and receives the description as its first prompt.
 */
export async function spawnAgent(opts: {
  description: string;
  agent: AgentKind;
  /** Branch/worktree name. Defaults to a slug derived from the description. */
  branch?: string;
  /** Optional base branch/ref passed through to `wt switch --base`. */
  base?: string;
  cwd?: string;
  /** Optional pane id of an existing agent to stack onto. */
  anchorPaneId?: string | null;
}): Promise<SpawnResult> {
  const slug = opts.branch ?? slugify(opts.description);

  let switchArgs: string[];
  if (opts.agent === "claude") {
    switchArgs = ["switch", "-c"];
    if (opts.base) switchArgs.push("--base", opts.base);
    switchArgs.push(slug, "-x", "claude", "--", ...launchArgsFor("claude", opts.description));
  } else {
    const wrapPath = await ensureWrapper();
    // Wrapper's $@ must be a complete command: agent binary + its args.
    const agentArgs = [opts.agent, ...launchArgsFor(opts.agent, opts.description)];
    switchArgs = wrappedAgentSwitchArgs(slug, true, opts.base, agentArgs, wrapPath);
  }

  const paneId = await spawnPane({
    name: slug,
    command: "wt",
    args: switchArgs,
    cwd: opts.cwd,
    anchorPaneId: opts.anchorPaneId,
  });
  // Record agent kind + paneId so resume + poll-loop pane lookup work even
  // after claude-code OSC-rewrites the pane title. Awaited so the next
  // poll tick can read it from disk (~5-20ms cost; spawn already takes
  // hundreds of ms because zellij + wt + agent boot).
  await recordSpawn(slug, opts.agent, paneId).catch(() => {});
  void refreshTaskPreview(slug, opts.cwd).catch(() => {});
  if (opts.agent === "claude") {
    const mainPath = opts.cwd ?? process.cwd();
    void scheduleStopHook(slug, mainPath + "." + slug);
  }
  return { slug, paneId };
}

/**
 * Resume an existing agent session in a fresh zellij pane. The worktree
 * already exists (we don't pass `-c` to `wt switch`), and we hand the agent
 * its CLI-specific resume incantation so it picks up the prior session
 * stored under that cwd.
 *
 *   claude --permission-mode bypassPermissions --continue
 *   codex --ask-for-approval never resume --last
 */
export async function resumeAgent(opts: {
  slug: string;
  agent: AgentKind;
  cwd?: string;
  /** Optional pane id of an existing agent to stack onto. */
  anchorPaneId?: string | null;
}): Promise<SpawnResult> {
  let switchArgs: string[];
  if (opts.agent === "claude") {
    switchArgs = ["switch", opts.slug, "-x", "claude", "--", ...resumeArgsFor("claude")];
  } else {
    const wrapPath = await ensureWrapper();
    const agentArgs = [opts.agent, ...resumeArgsFor(opts.agent)];
    switchArgs = wrappedAgentSwitchArgs(opts.slug, false, undefined, agentArgs, wrapPath);
  }

  const paneId = await spawnPane({
    name: opts.slug,
    command: "wt",
    args: switchArgs,
    cwd: opts.cwd,
    anchorPaneId: opts.anchorPaneId,
  });
  await recordResume(opts.slug, opts.agent, paneId).catch(() => {});
  void refreshTaskPreview(opts.slug, opts.cwd).catch(() => {});
  if (opts.agent === "claude") {
    const mainPath = opts.cwd ?? process.cwd();
    void scheduleStopHook(opts.slug, mainPath + "." + opts.slug);
  }
  return { slug: opts.slug, paneId };
}

export function launchArgsFor(agent: AgentKind, description: string): string[] {
  return [...approvalArgsFor(agent), description];
}

export function resumeArgsFor(agent: AgentKind): string[] {
  switch (agent) {
    case "claude":
      return [...approvalArgsFor(agent), "--continue"];
    case "codex":
      return [...approvalArgsFor(agent), "resume", "--last"];
    case "opencode":
      return [...approvalArgsFor(agent), "--continue"];
  }
}

function wrappedAgentSwitchArgs(
  slug: string,
  create: boolean,
  base: string | undefined,
  agentArgs: string[],
  wrapPath: string
): string[] {
  const args = ["switch"];
  if (create) args.push("-c");
  if (base) args.push("--base", base);
  // signalPath(slug) is $1 to the wrapper; agentArgs (agent binary + flags) follow as $@
  args.push(slug, "-x", wrapPath, "--", signalPath(slug), ...agentArgs);
  return args;
}

function approvalArgsFor(agent: AgentKind): string[] {
  // Inklit-spawned agents run unattended in panes; avoid permission dialogs
  // that would otherwise stall a worktree until the user focuses it.
  switch (agent) {
    case "claude":
      return ["--permission-mode", "bypassPermissions"];
    case "codex":
      return ["--ask-for-approval", "never"];
    case "opencode":
      return ["run", "--dangerously-skip-permissions"];
  }
}

/**
 * Wait for the worktree directory to appear (wt switch -c creates it
 * asynchronously in the pane), then write a Stop hook into the worktree's
 * .claude/settings.local.json so Claude signals inklit when it finishes.
 */
async function scheduleStopHook(slug: string, worktreePath: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      await fs.access(worktreePath);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  try {
    await fs.access(worktreePath);
  } catch {
    return; // worktree never appeared, skip
  }
  await injectStopHook(slug, worktreePath);
}

async function injectStopHook(slug: string, worktreePath: string): Promise<void> {
  const settingsPath = join(worktreePath, ".claude", "settings.local.json");
  const command = `touch ${signalPath(slug)}`;

  let existing: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(settingsPath, "utf-8");
    existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // No existing file or invalid JSON — start fresh.
  }

  const hooks = (existing.hooks ?? {}) as Record<string, unknown[]>;
  const stopHooks = [...((hooks.Stop ?? []) as unknown[])];

  // Avoid duplicating the inklit hook on resume.
  const hasInklit = stopHooks.some(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      Array.isArray((e as { hooks?: unknown[] }).hooks) &&
      ((e as { hooks: { command?: string }[] }).hooks ?? []).some((h) =>
        h.command?.includes("inklit")
      )
  );

  if (!hasInklit) {
    stopHooks.push({ hooks: [{ type: "command", command }] });
  }

  await fs.mkdir(join(worktreePath, ".claude"), { recursive: true });
  await fs.writeFile(
    settingsPath,
    JSON.stringify({ ...existing, hooks: { ...hooks, Stop: stopHooks } }, null, 2),
    "utf-8"
  );
}
