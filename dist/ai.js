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
/**
 * Call Claude to suggest 2-3 follow-up tasks based on what was just applied.
 * Uses `claude -p` (non-interactive) with the existing subscription auth.
 */
export async function fetchAiFollowUps(task, diff, cwd) {
    const diffSnippet = diff.length > 8000 ? diff.slice(0, 8000) + "\n…(truncated)" : diff;
    const summaries = cwd ? await readTaskSummaries(cwd) : "";
    const summarySection = summaries
        ? `\nPreviously completed tasks (avoid re-suggesting these):\n${summaries}\n`
        : "";
    const prompt = `You are helping a developer decide what to work on next after applying a code change.

Task that was just applied: "${task.subject || task.slug}"
${summarySection}
Diff summary:
${diffSnippet}

Suggest exactly 2-3 follow-up tasks that would naturally come next. Return ONLY a JSON array with no other text:
[
  {"title": "short title", "detail": "one sentence explaining why", "prompt": "full task description to pass to an AI coding agent"},
  ...
]`;
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
 */
export async function decomposeGoal(goal, fileList, cwd) {
    const fileContext = fileList.length > 0
        ? `\nRepo files (sample):\n${fileList.slice(0, 100).join("\n")}\n`
        : "";
    const summaries = cwd ? await readTaskSummaries(cwd) : "";
    const summarySection = summaries
        ? `\nAlready completed tasks (do not suggest these as subtasks):\n${summaries}\n`
        : "";
    const prompt = `You are helping a developer break a coding goal into parallel AI agent tasks.

Goal: "${goal}"
${summarySection}${fileContext}
Break this goal into 3-5 independent subtasks that can be worked on in parallel by separate AI coding agents. Each subtask should be self-contained and not depend on the others completing first.

Return ONLY a JSON array of task description strings with no other text:
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
//# sourceMappingURL=ai.js.map