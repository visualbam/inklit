import { spawnPane } from "./zellij.js";
import { slugify } from "./wt.js";
import { recordSpawn, recordResume } from "./state.js";
/**
 * Spawn a new agent task in its own worktree + zellij pane.
 *
 * Composes one shell-free command:
 *   zellij action new-pane -n <slug> -- wt switch -c [--base <base>] <slug> -x <agent> -- <description>
 *
 * worktrunk handles worktree creation and `cd`; the agent inherits that cwd
 * and receives the description as its first prompt.
 */
export async function spawnAgent(opts) {
    const slug = opts.branch ?? slugify(opts.description);
    const switchArgs = ["switch", "-c"];
    if (opts.base)
        switchArgs.push("--base", opts.base);
    switchArgs.push(slug, "-x", opts.agent, "--", opts.description);
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
    await recordSpawn(slug, opts.agent, paneId).catch(() => { });
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
export async function resumeAgent(opts) {
    const resumeArgs = resumeArgsFor(opts.agent);
    const paneId = await spawnPane({
        name: opts.slug,
        command: "wt",
        args: ["switch", opts.slug, "-x", opts.agent, "--", ...resumeArgs],
        cwd: opts.cwd,
        anchorPaneId: opts.anchorPaneId,
    });
    await recordResume(opts.slug, opts.agent, paneId).catch(() => { });
    return { slug: opts.slug, paneId };
}
function resumeArgsFor(agent) {
    switch (agent) {
        case "claude":
            return ["--continue"];
        case "codex":
            return ["resume", "--last"];
    }
}
//# sourceMappingURL=agent.js.map