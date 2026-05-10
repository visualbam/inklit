import { spawnPane } from "./zellij.js";
import { slugify } from "./wt.js";
import { recordSpawn, recordResume } from "./state.js";
import type { AgentKind } from "./model.js";

export interface SpawnResult {
  slug: string;
  paneId: string | null;
}

/**
 * Spawn a new agent task in its own worktree + zellij pane.
 *
 * Composes one shell-free command:
 *   zellij action new-pane -n <slug> -- wt switch -c <slug> -x <agent> -- <description>
 *
 * worktrunk handles worktree creation and `cd`; the agent inherits that cwd
 * and receives the description as its first prompt.
 */
export async function spawnAgent(opts: {
  description: string;
  agent: AgentKind;
  cwd?: string;
}): Promise<SpawnResult> {
  const slug = slugify(opts.description);
  const paneId = await spawnPane({
    name: slug,
    command: "wt",
    args: ["switch", "-c", slug, "-x", opts.agent, "--", opts.description],
    cwd: opts.cwd,
  });
  // Record the agent kind so later resumes know which CLI to relaunch.
  // Best-effort: a state-file failure must not block the spawn from succeeding.
  recordSpawn(slug, opts.agent).catch(() => {});
  return { slug, paneId };
}

/**
 * Resume an existing agent session in a fresh zellij pane. The worktree
 * already exists (we don't pass `-c` to `wt switch`), and we hand the agent
 * its CLI-specific resume incantation so it picks up the prior session
 * stored under that cwd.
 *
 *   claude --continue        → most recent session in cwd
 *   codex resume --last      → most recent codex session
 */
export async function resumeAgent(opts: {
  slug: string;
  agent: AgentKind;
  cwd?: string;
}): Promise<SpawnResult> {
  const resumeArgs = resumeArgsFor(opts.agent);
  const paneId = await spawnPane({
    name: opts.slug,
    command: "wt",
    args: ["switch", opts.slug, "-x", opts.agent, "--", ...resumeArgs],
    cwd: opts.cwd,
  });
  recordResume(opts.slug, opts.agent).catch(() => {});
  return { slug: opts.slug, paneId };
}

function resumeArgsFor(agent: AgentKind): string[] {
  switch (agent) {
    case "claude":
      return ["--continue"];
    case "codex":
      return ["resume", "--last"];
  }
}
