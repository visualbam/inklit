import { promises as fs } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
export class AiError extends Error {
    constructor(message) {
        super(message);
        this.name = "AiError";
    }
}
async function claudeQuery(prompt) {
    const { stdout, stderr } = await execa("claude", ["-p", prompt], {
        reject: false,
        timeout: 60_000,
    });
    if (!stdout && stderr)
        throw new AiError(`claude -p failed: ${stderr.slice(0, 200)}`);
    return stdout;
}
function extractJson(raw) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const text = fenced ? fenced[1] : raw;
    const startBracket = text.indexOf("[");
    const startBrace = text.indexOf("{");
    let start = -1;
    if (startBracket !== -1 && (startBrace === -1 || startBracket < startBrace)) {
        start = startBracket;
    }
    else if (startBrace !== -1) {
        start = startBrace;
    }
    if (start === -1)
        throw new AiError("No JSON found in claude output");
    const lastBracket = text.lastIndexOf("]");
    const lastBrace = text.lastIndexOf("}");
    const end = Math.max(lastBracket, lastBrace);
    if (end <= start)
        throw new AiError("Malformed JSON in claude output");
    return JSON.parse(text.slice(start, end + 1));
}
async function readTaskSummaries(cwd, maxChars = 4000) {
    const tasksDir = join(cwd, ".inklit", "tasks");
    let files;
    try {
        files = (await fs.readdir(tasksDir)).filter((f) => f.endsWith(".md"));
    }
    catch {
        return "";
    }
    if (files.length === 0)
        return "";
    // Sort newest-first so the char cap keeps the most recently completed work.
    const withMtime = await Promise.all(files.map(async (f) => ({
        f,
        mtime: await fs.stat(join(tasksDir, f)).then((s) => s.mtimeMs).catch(() => 0),
    })));
    withMtime.sort((a, b) => b.mtime - a.mtime);
    const parts = [];
    let total = 0;
    for (const { f } of withMtime) {
        const content = await fs.readFile(join(tasksDir, f), "utf-8").catch(() => "");
        if (!content.trim())
            continue;
        const entry = `### ${f}\n${content.trim()}`;
        if (total + entry.length > maxChars)
            break;
        parts.push(entry);
        total += entry.length;
    }
    return parts.join("\n\n");
}
async function readProjectContext(cwd) {
    try {
        const content = await fs.readFile(join(cwd, ".inklit", "project.md"), "utf-8");
        return content.trim() ? content : "";
    }
    catch {
        return "";
    }
}
/**
 * Call Claude to suggest 3 follow-up tasks based on what was just applied.
 * Uses `claude -p` (non-interactive) with the existing subscription auth.
 * Injects error context at the end (decision-time guidance) if the task failed.
 */
export async function fetchAiFollowUps(task, diff, cwd) {
    const diffSnippet = diff.length > 8000 ? diff.slice(0, 8000) + "\n…(truncated)" : diff;
    const summaries = cwd ? await readTaskSummaries(cwd) : "";
    const projectContext = cwd ? await readProjectContext(cwd) : "";
    const summarySection = summaries
        ? `\nPreviously completed tasks (avoid re-suggesting these):\n${summaries}\n`
        : "";
    const projectSection = projectContext
        ? `\nProject context:\n${projectContext}\n`
        : "";
    const errorSection = task.error
        ? `\nNote: This task had a prior failure — ${task.error}${task.errorDetail ? `: ${task.errorDetail}` : ""}. Suggest follow-ups that help address the root cause, or alternatives if this task's goal is unachievable.`
        : "";
    let prompt = `You are an elite Senior Technical Project Strategist with deep software engineering experience. Your specialty is identifying the highest-leverage next moves after a code change lands — tasks that maximize progress while minimizing risk and technical debt.

Task just merged: "${task.subject || task.slug}"
${projectSection}${summarySection}
Diff of the merged change:
${diffSnippet}

Analyze the merged change and generate exactly 3 high-quality follow-up task suggestions.

For each suggestion, think step-by-step through these dimensions before writing it:
1. Strategic value — does this directly advance the core goal?
2. Leverage — does it unblock other work or multiply the value of what was just merged?
3. Sequencing — is now the right time, given what was just changed?
4. Risk vs reward — is the effort proportionate to the benefit?
5. Cohesion — does it fit naturally with the existing architecture and patterns in the diff?

Composition rules:
- At least one task should be validation/testing of the merged work (edge cases, error paths, integration)
- At least one task should extend or build on the merged work (a natural next feature or improvement)
- One may be cleanup/debt reduction if it is truly high-leverage right now
- Be specific and concrete — never vague suggestions like "improve performance" or "add tests"; name the specific files, functions, or behaviors from the diff
- Each task's "prompt" field is passed directly to an AI coding agent — write it as a self-contained instruction with enough context for the agent to act immediately, without follow-up questions
- Never suggest tasks already captured in the previously completed tasks list above

Return ONLY a JSON array with no other text:
[
  {"title": "concise 5-8 word title", "detail": "one sentence on why this is the highest-leverage next step", "prompt": "detailed, self-contained task description referencing specific files and behaviors from the diff"},
  ...
]`;
    // Decision-time guidance: inject error context at the end for recency bias effect
    if (errorSection) {
        prompt += "\n" + errorSection;
    }
    const raw = await claudeQuery(prompt);
    const parsed = extractJson(raw);
    if (!Array.isArray(parsed))
        throw new AiError("Expected array from claude");
    return parsed
        .filter((s) => s && typeof s.title === "string" && typeof s.prompt === "string")
        .slice(0, 3)
        .map((s) => ({
        title: String(s.title),
        detail: String(s.detail ?? ""),
        prompt: String(s.prompt),
    }));
}
/**
 * Call Claude to decompose a high-level goal into 3-5 parallel subtasks.
 * Returns an array of task description strings ready to spawn.
 * Uses the same strategic reasoning framework as fetchAiFollowUps.
 */
export async function decomposeGoal(goal, fileList, cwd) {
    const fileContext = fileList.length > 0
        ? `\nRepo files (sample):\n${fileList.slice(0, 100).join("\n")}\n`
        : "";
    const summaries = cwd ? await readTaskSummaries(cwd) : "";
    const projectContext = cwd ? await readProjectContext(cwd) : "";
    const summarySection = summaries
        ? `\nAlready completed tasks (do not suggest these as subtasks):\n${summaries}\n`
        : "";
    const projectSection = projectContext
        ? `\nProject context:\n${projectContext}\n`
        : "";
    const prompt = `You are an elite Senior Technical Project Strategist breaking a high-level coding goal into parallel subtasks for AI agents. Your goal is to decompose the work into independent, high-leverage chunks that maximize progress while minimizing risk.

Goal: "${goal}"
${projectSection}${summarySection}${fileContext}
Break this goal into 3-5 independent subtasks that can be worked on in parallel by separate AI coding agents.

For each subtask, think through these dimensions:
1. Strategic value — does it directly advance the goal?
2. Independence — can it succeed without waiting for other subtasks?
3. Sequencing — if ordering matters, note it explicitly
4. Risk vs reward — is the effort proportionate to the benefit?
5. Cohesion — does it fit the existing codebase patterns?

Composition rules:
- All subtasks should be self-contained and not depend on each other completing first (unless explicitly ordered)
- Cover different angles: tests, core implementation, integration
- Be specific and concrete — name the files, functions, or components to work on
- Each subtask description will be passed directly to an AI coding agent — write it as a clear, self-contained instruction with enough context for the agent to start immediately

Return ONLY a JSON array of full task description strings with no other text:
["Full description of subtask 1 for an AI agent", "Full description of subtask 2", ...]`;
    const raw = await claudeQuery(prompt);
    const parsed = extractJson(raw);
    if (!Array.isArray(parsed))
        throw new AiError("Expected array from claude");
    return parsed
        .filter((s) => typeof s === "string" && s.trim())
        .slice(0, 5)
        .map((s) => String(s).trim());
}
/**
 * Call Claude to generate a concise kebab-case slug (3-5 words, ≤30 chars)
 * summarizing the task description. Throws on failure so callers can fall back.
 */
export async function generateSlug(description) {
    const prompt = `Summarize this coding task as a short git branch name. Use 3-5 words in kebab-case, 30 characters max. Return ONLY the branch name, nothing else.

Task: "${description}"`;
    const raw = await claudeQuery(prompt);
    const slug = raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 30)
        .replace(/-+$/g, "");
    if (!slug)
        throw new AiError("Empty slug from claude");
    return slug;
}
//# sourceMappingURL=ai.js.map