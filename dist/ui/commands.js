import { lifecycleForTask } from "../model.js";
import { suggestedFollowUps } from "./followUps.js";
export function commandRows({ task, density, targetBranch, showArchived, inSession, }) {
    const rows = [
        {
            key: "n",
            label: inSession ? "new agent task" : "new task unavailable outside zellij",
            muted: !inSession,
        },
        { key: "r", label: "refresh task board and visible inspector caches" },
        { key: "/", label: "filter task board" },
        {
            key: "v",
            label: `switch to ${density === "compact" ? "detailed" : "compact"} board`,
        },
        {
            key: "z",
            label: showArchived ? "hide archived tasks" : "show archived tasks",
        },
    ];
    if (!task) {
        rows.push({ key: "?", label: "open keybind help" });
        return rows;
    }
    rows.push({
        key: "enter",
        label: isLiveTask(task) ? "focus selected agent pane" : "resume selected task",
    }, {
        key: "i",
        label: isLiveTask(task)
            ? "message selected agent"
            : "message unavailable without a live pane",
        muted: !isLiveTask(task),
    }, {
        key: "m",
        label: task.state === "merged"
            ? "already applied"
            : `review and apply to ${targetBranch}`,
        muted: task.state === "merged",
    }, {
        key: "X",
        label: task.state === "merged"
            ? "kill unavailable after apply"
            : "kill selected task with confirmation",
        muted: task.state === "merged",
    }, {
        key: "A",
        label: lifecycleForTask(task) === "archived"
            ? "restore archived task"
            : "archive selected task",
    }, { key: "t/f/d/l/a", label: "switch inspector mode" });
    const suggestions = suggestedFollowUps(task);
    if (suggestions[0]) {
        rows.push({ key: "T / 1", label: `start next task: ${suggestions[0].title}` });
    }
    if (suggestions[1]) {
        rows.push({ key: "2", label: `start next task: ${suggestions[1].title}` });
    }
    rows.push({ key: "?", label: "open keybind help" });
    return rows;
}
export function helpSections(targetBranch) {
    return [
        {
            title: "Navigation",
            rows: [
                ["j / ↓", "next task"],
                ["k / ↑", "previous task"],
                ["[", "jump to first task"],
                ["]", "jump to last task"],
                ["/", "filter the task list"],
                ["r", "force refresh task board"],
                ["v", "toggle detailed / compact task board"],
                ["z", "show / hide archived tasks"],
                [":", "open command palette"],
            ],
        },
        {
            title: "Inspector",
            rows: [
                ["t", "task view (Replit-style status, next action, checkpoint)"],
                ["f", `files changed vs ${targetBranch}`],
                ["d", `final patch vs ${targetBranch} (tracked + untracked)`],
                ["l", `log of commits ahead of ${targetBranch}`],
                ["a", "live agent transcript (auto-tail)"],
                ["J / K", "scroll inspector down / up by line"],
                ["Ctrl-D / Ctrl-U", "scroll inspector by half-page"],
                ["gg / G", "jump inspector to top / bottom"],
            ],
        },
        {
            title: "Actions",
            rows: [
                ["n", "new agent task - prompts for description, then agent (c/x)"],
                ["T / 1", "start the top suggested next task"],
                ["2", "start the second suggested next task when shown"],
                ["enter", "focus pane (live) · resume agent (ready)"],
                ["i", "send a one-line message to the selected agent"],
                ["m", `apply selected task to ${targetBranch} (review then confirm)`],
                ["s", `sync ${targetBranch} -> selected task (rebase)`],
                ["A", "archive or restore selected ready/done task"],
                ["X", "kill selected - close pane + remove worktree"],
                ["Q", "close all live agent panes (worktrees survive)"],
            ],
        },
        {
            title: "Quit",
            rows: [["q / Ctrl-C", "exit dashboard only; agents keep running"]],
        },
        {
            title: "Prompts",
            rows: [
                ["esc", "cancel the current prompt"],
                ["y / n", "answer confirm prompts (apply / kill)"],
                ["c / x", "pick claude / codex in the agent picker"],
            ],
        },
        {
            title: "CLI",
            rows: [
                ["--main", `review/apply target: ${targetBranch}`],
                ["spawn", "spawn --branch <name> --agent codex -- <prompt>"],
                ["batch", "spawn --branch-prefix <prefix> --count <n>"],
                ["permissions", "spawn/resume use agent no-prompt modes"],
            ],
        },
    ];
}
export function isLiveTask(task) {
    return (task.state === "running" ||
        task.state === "waiting" ||
        task.state === "permission" ||
        task.state === "idle");
}
//# sourceMappingURL=commands.js.map