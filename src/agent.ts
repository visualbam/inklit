import { spawnPane } from "./zellij.js";
import { slugify } from "./wt.js";
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
  return { slug, paneId };
}
