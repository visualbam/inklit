export function activeFollowUps(task, aiFollowUps = [], aiFollowUpSlug = "") {
    if (!task)
        return [];
    if (task.state === "merged" && task.slug === aiFollowUpSlug) {
        return aiFollowUps;
    }
    return suggestedFollowUps(task);
}
export function suggestedFollowUps(task) {
    if (!task)
        return [];
    if (task.state === "ready")
        return readyFollowUps(task);
    return [];
}
export function mergedFallbackFollowUps(task, diff = "", limit = 3) {
    const files = changedFilesFromDiff(diff);
    const fileSummary = describeFiles(files);
    const fileList = files.length > 0 ? files.join(", ") : "the merged change";
    const verificationScope = files.length > 0 ? fileSummary : "the merged behavior";
    const integrationScope = files.length > 0
        ? `the target-branch integration points around ${fileSummary}`
        : "the target-branch integration points around the merged behavior";
    const followThroughScope = files.length > 0
        ? `${fileSummary} for unfinished edge cases, docs, and cleanup`
        : "the merged behavior for unfinished edge cases, docs, and cleanup";
    return [
        {
            title: "Verify merged behavior",
            detail: `Run focused checks around ${verificationScope}.`,
            prompt: `Verify the change from ${task.slug} after it was applied: inspect ${fileList}, run the most relevant tests and checks for the affected behavior, confirm the merged path works on the target branch, and fix any regressions you find.`,
        },
        {
            title: "Harden branch integration",
            detail: `Check ${integrationScope}.`,
            prompt: `Review the target-branch integration after applying ${task.slug}: inspect ${fileList}, look for assumptions that may no longer hold after the merge, tighten any fragile joins with nearby code, and add focused regression coverage for the integration risks you identify.`,
        },
        {
            title: "Finish follow-through cleanup",
            detail: `Review ${followThroughScope}.`,
            prompt: `Build on the merged work from ${task.slug}: inspect ${fileList}, look for missing docs, unclear copy, edge-case handling, or small cleanup that should ship immediately after this change, and implement the highest-leverage follow-through improvements without expanding scope.`,
        },
    ].slice(0, limit);
}
function readyFollowUps(task) {
    const scope = reviewScope(task);
    const suggestions = [
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
    }
    else {
        suggestions.push({
            title: "Add regression coverage",
            detail: (task.review?.files ?? 0) > 0
                ? `Add or update tests around ${fileCount(task.review?.files ?? 0, "changed file")}.`
                : "Add focused tests or verification notes for the patch.",
            prompt: `Add regression coverage for ${task.slug}: inspect the diff to identify changed behaviors, write or update focused tests that would catch regressions in those behaviors, and document any manual verification steps needed for changes that can't be unit-tested.`,
        });
    }
    return suggestions.slice(0, 2);
}
function reviewScope(task) {
    const stats = task.review;
    if (!stats)
        return "the task patch";
    if (stats.files === 0 && stats.commitsAhead === 0 && stats.untracked === 0) {
        return "the task patch";
    }
    const parts = [];
    if (stats.files > 0) {
        parts.push(fileCount(stats.files, "changed file"));
    }
    if (stats.commitsAhead > 0) {
        parts.push(`${stats.commitsAhead} commit${stats.commitsAhead === 1 ? "" : "s"} ahead`);
    }
    if (stats.untracked > 0) {
        parts.push(fileCount(stats.untracked, "untracked file"));
    }
    return parts.length > 0 ? parts.join(", ") : "the task patch";
}
function fileCount(count, noun) {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
function changedFilesFromDiff(diff) {
    const files = [];
    const seen = new Set();
    for (const line of diff.split("\n")) {
        const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (!match)
            continue;
        const candidate = match[2] || match[1];
        if (!candidate || seen.has(candidate))
            continue;
        seen.add(candidate);
        files.push(candidate);
    }
    return files;
}
function describeFiles(files) {
    if (files.length === 0)
        return "the merged change";
    if (files.length === 1)
        return `\`${files[0]}\``;
    if (files.length === 2)
        return `\`${files[0]}\` and \`${files[1]}\``;
    return `\`${files[0]}\`, \`${files[1]}\`, and ${files.length - 2} more file${files.length === 3 ? "" : "s"}`;
}
//# sourceMappingURL=followUps.js.map