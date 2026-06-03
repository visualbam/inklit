/** Extract normalized file paths from gitFiles() StatusEntry results. */
export function extractFilePaths(entries) {
    const paths = new Set();
    for (const e of entries) {
        if (e.path.includes(" -> ")) {
            const parts = e.path.split(" -> ");
            for (const p of parts) {
                const trimmed = p.trim();
                if (trimmed)
                    paths.add(trimmed);
            }
        }
        else if (e.path) {
            paths.add(e.path);
        }
    }
    return paths;
}
/**
 * Given a map of task slug → set of changed file paths, return a map of
 * slug → list of conflicting slugs (those that share at least one file).
 * Only slugs with at least one conflict are included in the result.
 */
export function computeOverlaps(fileMap) {
    const result = new Map();
    const entries = [...fileMap.entries()];
    for (let i = 0; i < entries.length; i++) {
        const [slugA, filesA] = entries[i];
        const conflicts = [];
        for (let j = 0; j < entries.length; j++) {
            if (i === j)
                continue;
            const [slugB, filesB] = entries[j];
            for (const f of filesA) {
                if (filesB.has(f)) {
                    conflicts.push(slugB);
                    break;
                }
            }
        }
        if (conflicts.length > 0) {
            result.set(slugA, conflicts);
        }
    }
    return result;
}
//# sourceMappingURL=overlap.js.map