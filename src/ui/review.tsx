import React from "react";
import { Text } from "ink";
import type { Task } from "../model.js";
import { UI } from "./theme.js";
import { truncate } from "./text.js";

export interface ReviewBadge {
  label: string;
  color?: string;
  dim?: boolean;
}

export function reviewBadges(task: Task): ReviewBadge[] {
  if (task.state === "merged") return [{ label: "applied", dim: true }];
  if (task.state === "merging") return [{ label: "merging", color: UI.warning }];
  if (task.failure) return [{ label: "merge failed", color: UI.danger }];
  const stats = task.review;
  if (!stats) return [{ label: "checking", dim: true }];
  if (stats.files === 0 && stats.commitsAhead === 0 && stats.untracked === 0) {
    return [{ label: "clean", dim: true }];
  }
  const badges: ReviewBadge[] = [];
  if (stats.files > 0) badges.push({ label: plural(stats.files, "file"), color: UI.warning });
  if (stats.commitsAhead > 0) badges.push({ label: plural(stats.commitsAhead, "commit"), color: UI.info });
  if (stats.untracked > 0) badges.push({ label: plural(stats.untracked, "untracked"), color: UI.danger });
  return badges;
}

export function ReviewBadges({ task, maxWidth }: { task: Task; maxWidth?: number }) {
  const badges = reviewBadges(task);
  let used = 0;
  return (
    <>
      {badges.map((badge, index) => {
        const prefix = index === 0 ? "" : " ";
        const raw = `${prefix}${badge.label}`;
        const remaining = maxWidth === undefined ? raw.length : maxWidth - used;
        if (remaining <= 0) return null;
        const text = truncate(raw, remaining);
        used += text.length;
        return (
          <Text key={`${badge.label}:${index}`} color={badge.color} dimColor={badge.dim}>
            {text}
          </Text>
        );
      })}
    </>
  );
}

export function reviewSummary(task: Task): string {
  return reviewBadges(task)
    .map((badge) => badge.label)
    .join(", ");
}

export function reviewSentence(task: Task): string {
  if (task.state === "merged") return "Applied to the target branch.";
  if (task.state === "merging") {
    const target = task.operation?.targetBranch ?? "target branch";
    return `Background merge to ${target} is running.`;
  }
  if (task.failure) return `Merge failed: ${task.failure.message}`;
  const stats = task.review;
  if (!stats) return "Review stats are still being sampled.";
  if (stats.files === 0 && stats.commitsAhead === 0 && stats.untracked === 0) {
    return "No file changes, commits ahead, or untracked files detected.";
  }
  return `Review readiness: ${reviewSummary(task)}.`;
}

function plural(count: number, word: string): string {
  if (word === "untracked") return `${count} ${word}`;
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
