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
      prompt: `Review and harden ${task.slug} before apply: inspect the diff against the target branch, run the relevant checks for ${scope}, and fix any regressions.`,
    },
  ];

  if ((task.review?.untracked ?? 0) > 0) {
    suggestions.push({
      title: "Clean untracked files",
      detail: `${fileCount(task.review?.untracked ?? 0, "untracked file")}: commit intentional files or update ignores.`,
      prompt: `Audit the untracked files in ${task.slug}: decide which files should be committed, ignored, or removed, then make the task review-ready.`,
    });
  } else {
    suggestions.push({
      title: "Add regression coverage",
      detail:
        (task.review?.files ?? 0) > 0
          ? `Add or update tests around ${fileCount(task.review?.files ?? 0, "changed file")}.`
          : "Add focused tests or verification notes for the patch.",
      prompt: `Add regression coverage for ${task.slug}: inspect the changed behavior, add or update focused tests where useful, and document any manual verification needed.`,
    });
  }

  return suggestions.slice(0, 2);
}

function mergedFollowUps(task: Task): SuggestedFollowUp[] {
  return [
    {
      title: "Verify applied work",
      detail: "Run target-checkout checks for the applied task.",
      prompt: `Verify ${task.slug} on the target branch: run the relevant checks after the applied change and fix any fallout.`,
    },
    {
      title: "Polish follow-through",
      detail: "Clean docs, UX copy, edge cases, and nearby cleanup.",
      prompt: `Polish the applied ${task.slug} work: review docs, UX copy, edge cases, and nearby cleanup that builds on the change.`,
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
