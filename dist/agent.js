import { promises as fs } from "node:fs";
import { join } from "node:path";
import { slugify } from "./wt.js";
import { recordSpawn, recordResume, signalPath, ensureWrapper } from "./state.js";
import { refreshTaskPreview } from "./preview.js";
import { spawnSession } from "./tmux.js";
const INKLIT_INSTRUCTION = (tasksDir, slug) => `\n\n---\nBefore starting: check ${tasksDir}/ for prior-task summaries and read any that seem relevant.\nWhen done: write a compact summary to ${tasksDir}/${slug}.md — goal, outcome (2–3 sentences), key files changed.`;
const INKLIT_RESUME_REMINDER = (tasksDir, slug) => `Resuming task. Reminder: when done, write a compact summary to ${tasksDir}/${slug}.md — goal, outcome (2–3 sentences), key files changed. Check other summaries in ${tasksDir}/ if relevant context is missing.`;
/** Remove the .inklit task summary for a killed/abandoned task. No-op if not found. */
export async function removeTaskSummary(slug, cwd) {
    const mainPath = cwd ?? process.cwd();
    const summaryPath = join(mainPath, ".inklit", "tasks", `${slug}.md`);
    await fs.unlink(summaryPath).catch(() => { });
}
/**
 * Spawn a new agent task in its own worktree + headless tmux session.
 *
 * The agent runs invisibly — no zellij pane or tab is created.
 * Use tmux.openFloat(slug) to attach interactively when needed.
 */
export async function spawnAgent(opts) {
    const slug = opts.branch ?? slugify(opts.description);
    const mainPath = opts.cwd ?? process.cwd();
    const tasksDir = join(mainPath, ".inklit", "tasks");
    await fs.mkdir(tasksDir, { recursive: true }).catch(() => { });
    const imageSection = opts.imagePaths?.length
        ? "\n\nImage context:\n" +
            opts.imagePaths.map((p, i) => `[image #${i + 1}]: ${p}`).join("\n")
        : "";
    const baseDescription = opts.description + imageSection;
    const effectiveDescription = baseDescription + INKLIT_INSTRUCTION(tasksDir, slug);
    let switchArgs;
    if (opts.agent === "claude") {
        switchArgs = ["switch", "-c"];
        if (opts.base)
            switchArgs.push("--base", opts.base);
        switchArgs.push(slug, "-x", "claude", "--", ...launchArgsFor("claude", effectiveDescription));
    }
    else {
        const wrapPath = await ensureWrapper();
        const agentArgs = [opts.agent, ...launchArgsFor(opts.agent, baseDescription)];
        switchArgs = wrappedAgentSwitchArgs(slug, true, opts.base, agentArgs, wrapPath);
    }
    await spawnSession(slug, "wt", switchArgs, opts.cwd);
    await recordSpawn(slug, opts.agent, slug).catch(() => { });
    void refreshTaskPreview(slug, opts.cwd).catch(() => { });
    if (opts.agent === "claude") {
        void scheduleStopHook(slug, mainPath + "." + slug);
    }
    return { slug };
}
/** Resume an existing agent session in a fresh headless tmux session. */
export async function resumeAgent(opts) {
    let switchArgs;
    if (opts.agent === "claude") {
        const mainPath = opts.cwd ?? process.cwd();
        const tasksDir = join(mainPath, ".inklit", "tasks");
        const reminder = INKLIT_RESUME_REMINDER(tasksDir, opts.slug);
        switchArgs = ["switch", opts.slug, "-x", "claude", "--", ...resumeArgsFor("claude"), reminder];
    }
    else {
        const wrapPath = await ensureWrapper();
        const agentArgs = [opts.agent, ...resumeArgsFor(opts.agent)];
        switchArgs = wrappedAgentSwitchArgs(opts.slug, false, undefined, agentArgs, wrapPath);
    }
    await spawnSession(opts.slug, "wt", switchArgs, opts.cwd);
    await recordResume(opts.slug, opts.agent, opts.slug).catch(() => { });
    void refreshTaskPreview(opts.slug, opts.cwd).catch(() => { });
    if (opts.agent === "claude") {
        const mainPath = opts.cwd ?? process.cwd();
        void scheduleStopHook(opts.slug, mainPath + "." + opts.slug);
    }
    return { slug: opts.slug };
}
export function launchArgsFor(agent, description) {
    return [...approvalArgsFor(agent), description];
}
export function resumeArgsFor(agent) {
    switch (agent) {
        case "claude":
            return [...approvalArgsFor(agent), "--continue"];
        case "codex":
            return [...approvalArgsFor(agent), "resume", "--last"];
        case "opencode":
            return [...approvalArgsFor(agent), "--continue"];
    }
}
function wrappedAgentSwitchArgs(slug, create, base, agentArgs, wrapPath) {
    const args = ["switch"];
    if (create)
        args.push("-c");
    if (base)
        args.push("--base", base);
    // signalPath(slug) is $1 to the wrapper; agentArgs (agent binary + flags) follow as $@
    args.push(slug, "-x", wrapPath, "--", signalPath(slug), ...agentArgs);
    return args;
}
function approvalArgsFor(agent) {
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
async function scheduleStopHook(slug, worktreePath) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        try {
            await fs.access(worktreePath);
            break;
        }
        catch {
            await new Promise((r) => setTimeout(r, 150));
        }
    }
    try {
        await fs.access(worktreePath);
    }
    catch {
        return; // worktree never appeared, skip
    }
    await injectStopHook(slug, worktreePath);
}
async function injectStopHook(slug, worktreePath) {
    const settingsPath = join(worktreePath, ".claude", "settings.local.json");
    const command = `touch ${signalPath(slug)}`;
    let existing = {};
    try {
        const raw = await fs.readFile(settingsPath, "utf-8");
        existing = JSON.parse(raw);
    }
    catch {
        // No existing file or invalid JSON — start fresh.
    }
    const hooks = (existing.hooks ?? {});
    const stopHooks = [...(hooks.Stop ?? [])];
    // Avoid duplicating the inklit hook on resume.
    const hasInklit = stopHooks.some((e) => typeof e === "object" &&
        e !== null &&
        Array.isArray(e.hooks) &&
        (e.hooks ?? []).some((h) => h.command?.includes("inklit")));
    if (!hasInklit) {
        stopHooks.push({ hooks: [{ type: "command", command }] });
    }
    await fs.mkdir(join(worktreePath, ".claude"), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify({ ...existing, hooks: { ...hooks, Stop: stopHooks } }, null, 2), "utf-8");
}
//# sourceMappingURL=agent.js.map