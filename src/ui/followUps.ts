import type { Task, SuggestedFollowUp } from "../model.js";

export type { SuggestedFollowUp };

export function suggestedFollowUps(task: Task | null): SuggestedFollowUp[] {
  if (!task) return [];
  if (task.state === "ready") return readyFollowUps(task);
  if (task.state === "merged") return mergedFollowUps(task);
  return [];
}

function readyFollowUps(task: Task): SuggestedFollowUp[] {
  const scope = reviewScope(task);
  const suggestions: SuggestedFollowUp[] = [
    {
      title: "Harden before apply",
      detail: `${scope}: run focused checks and fix regressions.`,
      prompt: `Review and harden ${task.slug} before applying: inspect the diff against the target branch for ${scope}, run the relevant linters and tests, fix any regressions or warnings, and ensure the task is clean and review-ready.`,
    },
  ];

  if ((task.review?.untracked ?? 0) > 0) {
    suggestions.push({
      title: "Clean untracked files",
      detail: `${fileCount(task.review?.untracked ?? 0, "untracked file")}: commit intentional files or update ignores.`,
      prompt: `Audit the untracked files in ${task.slug}: review each file and decide whether it should be committed (stage it), ignored (add to .gitignore), or deleted. Leave the task with a clean working tree and no stray files.`,
    });
  } else {
    suggestions.push({
      title: "Add regression coverage",
      detail:
        (task.review?.files ?? 0) > 0
          ? `Add or update tests around ${fileCount(task.review?.files ?? 0, "changed file")}.`
          : "Add focused tests or verification notes for the patch.",
      prompt: `Add regression coverage for ${task.slug}: inspect the diff to identify changed behaviors, write or update focused tests that would catch regressions in those behaviors, and document any manual verification steps needed for changes that can't be unit-tested.`,
    });
  }

  return suggestions.slice(0, 2);
}

function mergedFollowUps(task: Task): SuggestedFollowUp[] {
  return [
    {
      title: "Verify applied work",
      detail: "Run target-checkout checks for the applied task.",
      prompt: `Verify ${task.slug} on the target branch after applying: run the relevant linters, tests, and checks for the changed files, confirm there are no regressions or broken integrations, and fix any issues found.`,
    },
    {
      title: "Polish follow-through",
      detail: "Clean docs, UX copy, edge cases, and nearby cleanup.",
      prompt: `Polish the work from ${task.slug}: review the applied change for missing documentation, unclear error messages, edge cases not handled, or nearby code that would benefit from cleanup. Make any small improvements that build on the change without introducing new scope.`,
    },
  ];
}

function reviewScope(task: Task): string {
  const stats = task.review;
  if (!stats) return "the task patch";
  if (stats.files === 0 && stats.commitsAhead === 0 && stats.untracked === 0) {
    return "the task patch";
  }

  const parts: string[] = [];
  if (stats.files > 0) {
    parts.push(fileCount(stats.files, "changed file"));
  }
  if (stats.commitsAhead > 0) {
    parts.push(
      `${stats.commitsAhead} commit${stats.commitsAhead === 1 ? "" : "s"} ahead`
    );
  }
  if (stats.untracked > 0) {
    parts.push(fileCount(stats.untracked, "untracked file"));
  }
  return parts.length > 0 ? parts.join(", ") : "the task patch";
}

function fileCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
