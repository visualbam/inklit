import { execFile } from "node:child_process";
/**
 * Best-effort desktop notification. Detached + unref'd so it can never block
 * the poll loop or throw into render. macOS only for now (uses osascript);
 * silent no-op elsewhere.
 *
 * Sound choice: short, cuts through editor focus — that's the whole point.
 * Pass `sound: ""` to suppress.
 */
export function notify(title, body, opts = {}) {
    if (process.platform !== "darwin")
        return;
    const sound = opts.sound ?? "Glass";
    const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const soundClause = sound ? ` sound name "${esc(sound)}"` : "";
    const script = `display notification "${esc(body)}" with title "${esc(title)}"${soundClause}`;
    try {
        const child = execFile("osascript", ["-e", script], { timeout: 2000 }, () => {
            /* swallow */
        });
        child.unref();
    }
    catch {
        /* swallow */
    }
}
//# sourceMappingURL=notify.js.map