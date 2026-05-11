export function truncate(s, max) {
    if (max <= 1)
        return s.slice(0, Math.max(0, max));
    if (s.length <= max)
        return s;
    return s.slice(0, max - 1) + "…";
}
export function truncateMiddle(s, max) {
    if (max <= 1)
        return s.slice(0, Math.max(0, max));
    if (s.length <= max)
        return s;
    const head = Math.max(1, Math.ceil((max - 1) * 0.4));
    const tail = Math.max(1, max - head - 1);
    return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
export function padRight(s, n) {
    return s.length >= n ? s : s + " ".repeat(n - s.length);
}
export function compactPath(path, max) {
    if (path.length <= max)
        return path;
    const parts = path.split("/").filter(Boolean);
    const tail = parts.slice(-2).join("/");
    if (!tail)
        return truncate(path, max);
    const compact = `…/${tail}`;
    return compact.length <= max ? compact : truncate(compact, max);
}
//# sourceMappingURL=text.js.map