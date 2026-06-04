import { readFile } from "node:fs/promises";
import { execa } from "execa";
import { spawnAgent } from "./agent.js";
const DEFAULT_MAIN_BRANCH = process.env.INKLIT_MAIN_BRANCH || "main";
export async function detectCurrentBranch(cwd) {
    try {
        const { stdout } = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
        const branch = stdout.trim();
        return branch && branch !== "HEAD" ? branch : "main";
    }
    catch {
        return "main";
    }
}
export function parseGlobalArgs(args) {
    let mainBranch = DEFAULT_MAIN_BRANCH;
    let explicitMain = !!process.env.INKLIT_MAIN_BRANCH;
    const rest = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i] ?? "";
        if (arg === "spawn") {
            return {
                command: "spawn",
                mainBranch,
                explicitMain,
                commandArgs: args.slice(i + 1),
            };
        }
        if (arg === "-h" || arg === "--help") {
            return { command: "help", mainBranch, explicitMain, commandArgs: [] };
        }
        if (arg === "-v" || arg === "--version") {
            return { command: "version", mainBranch, explicitMain, commandArgs: [] };
        }
        if (arg === "--main") {
            const value = args[++i];
            if (!value)
                throw new Error("--main requires a branch name");
            mainBranch = value;
            explicitMain = true;
            continue;
        }
        if (arg.startsWith("--main=")) {
            mainBranch = arg.slice("--main=".length);
            if (!mainBranch)
                throw new Error("--main requires a branch name");
            explicitMain = true;
            continue;
        }
        rest.push(arg);
    }
    if (rest.length > 0) {
        throw new Error(`Unknown command or option: ${rest[0]}`);
    }
    return { command: "tui", mainBranch, explicitMain, commandArgs: [] };
}
export async function runSpawnCommand(args, opts = {}) {
    const parsed = await parseSpawnArgs(args, opts);
    if (parsed.help) {
        console.log(spawnHelp());
        return 0;
    }
    const requests = parsed.requests;
    if (requests.length === 0) {
        throw new Error("No tasks to spawn");
    }
    const spawned = [];
    for (const req of requests) {
        const res = await spawnAgent({
            description: req.prompt,
            agent: req.agent,
            branch: req.branch,
            base: req.base,
            cwd: req.cwd,
        });
        spawned.push({
            branch: res.slug,
            agent: req.agent,
            base: req.base,
        });
    }
    if (parsed.format === "json") {
        console.log(JSON.stringify({ spawned }, null, 2));
    }
    else {
        for (const task of spawned) {
            const base = task.base ? ` from ${task.base}` : "";
            console.log(`spawned ${task.branch}${base} with ${task.agent}`);
        }
    }
    return 0;
}
function rootOptionValue(args, index, name) {
    const arg = args[index] ?? "";
    if (arg.startsWith(`${name}=`)) {
        const value = arg.slice(name.length + 1);
        if (!value)
            throw new Error(`${name} requires a value`);
        return { value, nextIndex: index };
    }
    const value = args[index + 1];
    if (!value)
        throw new Error(`${name} requires a value`);
    return { value, nextIndex: index + 1 };
}
async function parseSpawnArgs(args, opts) {
    let agent;
    let branch;
    let branchPrefix;
    let base = opts.defaultBase;
    let count = 1;
    let cwd;
    let file;
    let format = "text";
    const promptParts = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i] ?? "";
        if (arg === "--") {
            promptParts.push(...args.slice(i + 1));
            break;
        }
        if (arg === "-h" || arg === "--help") {
            return { help: true, format, requests: [] };
        }
        if (arg === "--agent" || arg.startsWith("--agent=")) {
            const parsed = rootOptionValue(args, i, "--agent");
            agent = parseAgent(parsed.value);
            i = parsed.nextIndex;
            continue;
        }
        if (arg === "--branch" || arg.startsWith("--branch=")) {
            const parsed = rootOptionValue(args, i, "--branch");
            branch = parsed.value;
            i = parsed.nextIndex;
            continue;
        }
        if (arg === "--branch-prefix" || arg.startsWith("--branch-prefix=")) {
            const parsed = rootOptionValue(args, i, "--branch-prefix");
            branchPrefix = parsed.value;
            i = parsed.nextIndex;
            continue;
        }
        if (arg === "--base" || arg.startsWith("--base=")) {
            const parsed = rootOptionValue(args, i, "--base");
            base = parsed.value;
            i = parsed.nextIndex;
            continue;
        }
        if (arg === "--count" || arg.startsWith("--count=")) {
            const parsed = rootOptionValue(args, i, "--count");
            count = parseCount(parsed.value);
            i = parsed.nextIndex;
            continue;
        }
        if (arg === "--cwd" || arg.startsWith("--cwd=")) {
            const parsed = rootOptionValue(args, i, "--cwd");
            cwd = parsed.value;
            i = parsed.nextIndex;
            continue;
        }
        if (arg === "--file" || arg.startsWith("--file=")) {
            const parsed = rootOptionValue(args, i, "--file");
            file = parsed.value;
            i = parsed.nextIndex;
            continue;
        }
        if (arg === "--format" || arg.startsWith("--format=")) {
            const parsed = rootOptionValue(args, i, "--format");
            format = parseFormat(parsed.value);
            i = parsed.nextIndex;
            continue;
        }
        if (arg.startsWith("-"))
            throw new Error(`Unknown spawn option: ${arg}`);
        promptParts.push(arg);
    }
    const inputs = file
        ? await readSpawnFile(file, { agent, base, cwd })
        : [
            {
                agent,
                branch,
                branchPrefix,
                base,
                count,
                cwd,
                prompt: promptParts.join(" ").trim(),
            },
        ];
    const requests = await expandSpawnInputs(inputs);
    return { help: false, format, requests };
}
async function readSpawnFile(file, defaults) {
    const raw = await readFile(file, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error("--file must contain a JSON array of task specs");
    }
    return parsed.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new Error(`Task spec ${index + 1} must be an object`);
        }
        return { ...defaults, ...item };
    });
}
async function expandSpawnInputs(inputs) {
    const requests = [];
    for (const [index, input] of inputs.entries()) {
        const prompt = (input.prompt ?? input.description ?? "").trim();
        if (!prompt)
            throw new Error(`Task spec ${index + 1} is missing prompt`);
        const agent = parseAgent(input.agent, `Task spec ${index + 1} agent`);
        const count = parseCount(input.count ?? 1);
        if (count > 1 && input.branch) {
            throw new Error(`Task spec ${index + 1} uses --count with an exact branch; use branchPrefix`);
        }
        if (count > 1 && !input.branchPrefix) {
            throw new Error(`Task spec ${index + 1} with count > 1 needs branchPrefix`);
        }
        for (let i = 1; i <= count; i++) {
            const branch = input.branchPrefix
                ? `${input.branchPrefix}-${i}`
                : input.branch;
            if (branch)
                await validateBranchName(branch, input.cwd);
            requests.push({
                agent,
                branch,
                base: input.base,
                cwd: input.cwd,
                prompt: templatePrompt(prompt, branch, i, count),
            });
        }
    }
    return requests;
}
function parseAgent(value, context = "--agent") {
    if (value === "claude" || value === "codex")
        return value;
    throw new Error(`${context} must be "claude" or "codex"`);
}
function parseCount(value) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 50) {
        throw new Error("--count must be an integer from 1 to 50");
    }
    return n;
}
function parseFormat(value) {
    if (value === "text" || value === "json")
        return value;
    throw new Error("--format must be text or json");
}
async function validateBranchName(branch, cwd) {
    if (!branch.trim())
        throw new Error("Branch name cannot be empty");
    if (branch.startsWith("-")) {
        throw new Error(`Invalid branch "${branch}": branch names cannot start with -`);
    }
    if (branch === "@" || branch === "-" || branch === "^") {
        throw new Error(`Invalid branch "${branch}": reserved by worktrunk shortcuts`);
    }
    if (/^(pr|mr):/i.test(branch)) {
        throw new Error(`Invalid branch "${branch}": pr:/mr: are worktrunk shortcuts`);
    }
    const { exitCode, stderr } = await execa("git", ["check-ref-format", "--branch", branch], { cwd, reject: false, stripFinalNewline: true });
    if (exitCode !== 0) {
        throw new Error(`Invalid branch "${branch}"${stderr ? `: ${stderr}` : ""}`);
    }
}
function templatePrompt(prompt, branch, index, count) {
    return prompt
        .replaceAll("{{branch}}", branch ?? "")
        .replaceAll("{{index}}", String(index))
        .replaceAll("{{count}}", String(count));
}
export function rootHelp() {
    return [
        "inklit - TUI for parallel AI coding agents in git worktrees.",
        "",
        "Usage:",
        "  inklit [--main <branch>]",
        "  inklit spawn [options] -- <prompt>",
        "",
        "Options:",
        "  --main <branch>       dashboard review/apply target (default: INKLIT_MAIN_BRANCH or main)",
        "  -h, --help            show this help",
        "  -v, --version         show version",
        "",
        "Run inside a zellij session for full functionality.",
    ].join("\n");
}
export function spawnHelp() {
    return [
        "inklit spawn - create one or more agent worktree tasks.",
        "",
        "Usage:",
        "  inklit spawn --agent <claude|codex> --branch <name> [--base <branch>] -- <prompt>",
        "  inklit spawn --agent <claude|codex> --branch-prefix <prefix> --count <n> -- <prompt>",
        "  inklit spawn --file tasks.json [--agent <claude|codex>] [--base <branch>] [--format json]",
        "",
        "Options:",
        "  --agent <kind>           claude or codex",
        "  --branch <name>          exact branch/worktree name for one task",
        "  --branch-prefix <prefix> branch prefix for --count; creates <prefix>-1, <prefix>-2, ...",
        "  --base <branch>          starting branch/ref passed to wt switch --base",
        "  --count <n>              number of tasks to create with --branch-prefix",
        "  --cwd <path>             repo checkout to run wt from",
        "  --file <path>            JSON array of task specs",
        "  --format <text|json>     output format",
        "",
        "Prompt templates in --count mode: {{branch}}, {{index}}, {{count}}.",
        "Spawned agents use no-prompt permission modes automatically.",
    ].join("\n");
}
//# sourceMappingURL=cli.js.map