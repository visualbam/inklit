export function windowWithMarkers(items, maxLines, offset) {
    const total = items.length;
    const maxOffset = total <= maxLines ? 0 : total - Math.max(1, maxLines - 1);
    const start = Math.min(Math.max(0, offset), Math.max(0, maxOffset));
    const above = start;
    const hasAbove = above > 0;
    let budget = Math.max(0, maxLines - (hasAbove ? 1 : 0));
    let visible = items.slice(start, start + budget);
    let below = Math.max(0, total - start - visible.length);
    if (below > 0 && budget > 0) {
        budget -= 1;
        visible = items.slice(start, start + budget);
        below = Math.max(0, total - start - visible.length);
    }
    return { visible, above, below };
}
//# sourceMappingURL=windowing.js.map