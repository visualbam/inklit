import { execa, ExecaError } from "execa";

interface ZellijPane {
  id?: number;
  pane_id?: string;
  name?: string;
  title?: string;
  is_focused?: boolean;
  is_floating?: boolean;
  is_plugin?: boolean;
  exited?: boolean;
  exit_status?: number | null;
  command?: string;
  tab_id?: number;
  /** Working directory of the pane's foreground process (zellij ≥0.44). */
  pane_cwd?: string;
}

export class ZellijError extends Error {
  constructor(message: string, public stderr?: string) {
    super(message);
    this.name = "ZellijError";
  }
}

/** Whether the process is running inside a zellij session. */
export function inSession(): boolean {
  return Boolean(process.env.ZELLIJ);
}

/**
 * Best-effort list of panes in the current session.
 * Returns [] when not in a session — caller should fall back to "ready" state.
 */
export async function listPanes(): Promise<ZellijPane[]> {
  if (!inSession()) return [];
  try {
    const { stdout } = await execa(
      "zellij",
      ["action", "list-panes", "--json", "--state", "--command", "--tab"],
      { reject: true, stripFinalNewline: true, timeout: 1000 }
    );
    const parsed = JSON.parse(stdout || "[]");
    return Array.isArray(parsed) ? (parsed as ZellijPane[]) : [];
  } catch (err) {
    const e = err as ExecaError;
    if (e.code === "ENOENT") {
      throw new ZellijError("`zellij` not found in PATH");
    }
    // Inside a session list-panes can fail transiently — treat as empty.
    return [];
  }
}

/** Map pane name → first matching pane (zellij allows duplicate names). */
export async function findPaneByName(name: string): Promise<ZellijPane | null> {
  const panes = await listPanes();
  return panes.find((p) => (p.name ?? p.title) === name && !p.exited) ?? null;
}

/**
 * Single list-panes call → cwd / id / title-keyed views of every
 * non-exited pane. The poll loop prefers `byCwd` (matching the task's
 * worktree path) — it survives both OSC title rewrites and pane id
 * churn (close+respawn yields new ids). `byId` is the secondary lookup
 * for legacy state-file entries; `byTitle` is last-ditch for slugs whose
 * agent hasn't yet rewritten its title.
 */
export interface PaneSnapshot {
  byId: Map<string, { paneId: string }>;
  byTitle: Map<string, { paneId: string }>;
  byCwd: Map<string, { paneId: string }>;
}

export async function panesSnapshot(): Promise<PaneSnapshot> {
  const panes = await listPanes();
  const byId = new Map<string, { paneId: string }>();
  const byTitle = new Map<string, { paneId: string }>();
  const byCwd = new Map<string, { paneId: string }>();
  for (const p of panes) {
    if (p.exited) continue;
    const id = paneIdArg(p);
    if (!id) continue;
    byId.set(id, { paneId: id });
    const t = p.name ?? p.title;
    if (t && !byTitle.has(t)) byTitle.set(t, { paneId: id });
    if (p.pane_cwd && !byCwd.has(p.pane_cwd)) {
      byCwd.set(p.pane_cwd, { paneId: id });
    }
  }
  return { byId, byTitle, byCwd };
}

/** Resolve a pane id like `terminal_3` into the form zellij expects. */
function paneIdArg(p: ZellijPane): string | null {
  if (p.pane_id) return p.pane_id;
  if (typeof p.id === "number") return `terminal_${p.id}`;
  return null;
}

/** Our own pane id (inklit's host pane), if discoverable. */
function ourPaneId(): string | null {
  const raw = process.env.ZELLIJ_PANE_ID;
  if (!raw) return null;
  return /^\d+$/.test(raw) ? `terminal_${raw}` : raw;
}

/**
 * Rename the current tab. No-op when not in a session.
 */
export async function renameOwnTab(name: string): Promise<void> {
  if (!inSession()) return;
  try {
    await execa("zellij", ["action", "rename-tab", name], {
      reject: true,
      timeout: 1000,
    });
  } catch {
    // older zellij builds may not support rename-tab — ignore.
  }
}

/**
 * Rename our own pane to `name`. Tries the zellij action first (requires the
 * pane to be focused, which it normally is at startup); also emits the OSC 0
 * title sequence so the rename survives a zellij session reload.
 */
export async function renameOwnPane(name: string): Promise<void> {
  if (!inSession()) return;
  // OSC 0: set terminal / pane title — zellij intercepts this.
  process.stdout.write(`\x1b]0;${name}\x07`);
  // Belt-and-suspenders: call the rename-pane action on our pane id.
  const id = ourPaneId();
  if (!id) return;
  try {
    await execa("zellij", ["action", "rename-pane", name, "-p", id], {
      reject: true,
      timeout: 1000,
    });
  } catch {
    // rename-pane without --pane-id support (older zellij) — OSC already fired.
  }
}

/** Refocus inklit's own pane after actions that had to focus another pane. */
export async function focusOwnPane(): Promise<boolean> {
  const home = ourPaneId();
  if (!home) return false;
  return focusPaneId(home);
}

/** Focus a pane by id. Returns true on success. */
export async function focusPaneId(id: string): Promise<boolean> {
  try {
    await execa("zellij", ["action", "focus-pane-id", id], { reject: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Close the pane with `id` directly via `close-pane --pane-id`.
 * No focus change needed — safe to call while inklit is active.
 */
export async function closePaneById(id: string): Promise<boolean> {
  if (!inSession()) return false;
  try {
    await execa("zellij", ["action", "close-pane", "-p", id], { reject: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find a pane to anchor a new agent's stack onto.
 *
 * We can't match panes by slug because agent CLIs emit OSC set-title which
 * overwrites our `--name`. Instead, identify our home pane by its env-var id
 * and pick any other non-plugin pane in the same tab as the anchor — most
 * recently created wins (highest id) so successive spawns chain onto the
 * latest stack member.
 *
 * Returns null when no anchor exists (first agent: inklit is alone in the
 * tab) or zellij isn't reachable.
 */
async function discoverStackAnchor(): Promise<string | null> {
  const homeRaw = process.env.ZELLIJ_PANE_ID;
  if (!homeRaw) return null;
  const homeIdNum = Number(homeRaw);
  if (!Number.isFinite(homeIdNum)) return null;

  const panes = await listPanes();
  const home = panes.find((p) => p.id === homeIdNum && !p.is_plugin);
  if (!home) return null;

  let best: ZellijPane | null = null;
  for (const p of panes) {
    if (p.id === homeIdNum) continue;
    if (p.is_plugin) continue;
    if (p.exited) continue;
    if (typeof p.id !== "number") continue;
    if (home.tab_id !== undefined && p.tab_id !== home.tab_id) continue;
    if (!best || (p.id ?? -1) > (best.id ?? -1)) best = p;
  }
  if (!best) return null;
  return best.pane_id ?? `terminal_${best.id}`;
}

/**
 * Focus the pane whose name matches `slug`. Returns true on success.
 * Returns false when no pane is found or zellij rejects the focus.
 */
export async function focusPaneByName(name: string): Promise<boolean> {
  const pane = await findPaneByName(name);
  if (!pane) return false;
  const id = paneIdArg(pane);
  if (!id) return false;
  return focusPaneId(id);
}

/**
 * Dump the current viewport of a pane (no scrollback by default).
 * Returns "" when zellij isn't reachable or the pane is gone.
 */
export async function dumpScreen(
  paneId: string,
  opts: { full?: boolean; timeoutMs?: number } = {}
): Promise<string> {
  if (!inSession()) return "";
  const args = ["action", "dump-screen", "-p", paneId];
  if (opts.full) args.push("--full");
  try {
    const { stdout } = await execa("zellij", args, {
      reject: true,
      stripFinalNewline: true,
      timeout: opts.timeoutMs ?? 1000,
    });
    return stdout;
  } catch {
    return "";
  }
}

/**
 * Close the pane whose name matches `name` via `close-pane --pane-id`.
 * Looks up the pane id from the current snapshot; no focus change needed.
 */
export async function closePaneByName(name: string): Promise<boolean> {
  if (!inSession()) return false;
  const pane = await findPaneByName(name);
  if (!pane) return false;
  const id = paneIdArg(pane);
  if (!id) return false;
  try {
    await execa("zellij", ["action", "close-pane", "-p", id], { reject: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a string + Enter to a pane identified by name. Returns false when the
 * pane is gone or zellij rejects the write.
 *
 * Uses `--pane-id` (zellij ≥0.42) so we never have to focus the target pane —
 * the user's inklit view stays put. We re-resolve the pane id by name
 * right before writing so a pane that died between the last poll and this
 * keystroke fails closed instead of leaking text into the focused pane.
 *
 * Why raw `write` instead of `write-chars`: zellij's `write-chars` wraps the
 * payload in a bracketed-paste sequence (\e[200~ … \e[201~) when the target
 * pane has paste mode on. claude-code and codex treat the contents of a
 * bracketed paste as a single chunk where Enter is a literal newline, so a
 * trailing CR lands inside the paste and never submits. Emitting each
 * character as its own keypress via `write` sidesteps the wrapper entirely
 * and the CR at the end registers as a real Enter.
 *
 * Why the delay between text and CR: codex's TUI also runs a *non-bracketed*
 * paste-burst detector — a stream of ≥3 chars arriving within 8ms gaps is
 * classified as paste, after which Enter is suppressed (treated as newline)
 * for 120ms past the last burst activity (PASTE_ENTER_SUPPRESS_WINDOW in
 * codex-rs/tui/src/bottom_pane/paste_burst.rs). Sending the CR in a separate
 * `write` call after a 180ms gap puts it safely outside that window so codex
 * processes it as a real submit. Claude doesn't have this detector — the
 * delay is harmless there (~one extra frame of latency).
 */
const CODEX_BURST_GAP_MS = 180;

export async function sendKeysToSlug(
  name: string,
  text: string
): Promise<boolean> {
  if (!inSession()) return false;
  const pane = await findPaneByName(name);
  if (!pane) return false;
  const id = paneIdArg(pane);
  if (!id) return false;
  return sendKeysToPaneId(id, text);
}

/** Send a string + Enter directly to a pane id. */
export async function sendKeysToPaneId(
  id: string,
  text: string
): Promise<boolean> {
  if (!inSession()) return false;
  try {
    if (text) {
      const buf = Buffer.from(text, "utf-8");
      const bytes: string[] = [];
      for (const b of buf) bytes.push(String(b));
      await execa("zellij", ["action", "write", "-p", id, ...bytes], {
        reject: true,
      });
      await new Promise<void>((r) => setTimeout(r, CODEX_BURST_GAP_MS));
    }
    await execa("zellij", ["action", "write", "-p", id, "13"], {
      reject: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn a new named pane running `command`. Returns the created pane id, or
 * null when zellij doesn't echo one (rare).
 *
 * Layout policy: inklit (left) stays out of the agent stack.
 *   - With `anchorPaneId` (an existing agent pane): focus it, then `--stacked`
 *     adds the new pane to that pane's stack. zellij will create the stack on
 *     first sibling and append to it after.
 *   - Without an anchor (no live agent panes yet): split right with `-d right`
 *     so the first agent lives next to inklit, not on top of it.
 * After spawning we refocus inklit's pane so the user can keep navigating.
 */
export async function spawnPane(opts: {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  /** Existing agent pane id (terminal_N) to anchor the stack on. */
  anchorPaneId?: string | null;
}): Promise<string | null> {
  if (!inSession()) {
    throw new ZellijError(
      "Not in a zellij session. Launch inklit inside zellij so it can spawn panes."
    );
  }

  const home = ourPaneId();
  // Caller-provided anchor wins; otherwise scan zellij for any sibling pane
  // in our tab. This keeps the stacking working even after inklit restarts
  // when no React-side paneId tracking is available.
  const anchor = opts.anchorPaneId ?? (await discoverStackAnchor());
  const useStack = anchor ? await focusPaneId(anchor) : false;

  const layoutFlags = useStack ? ["--stacked"] : ["-d", "right"];

  try {
    const { stdout } = await execa(
      "zellij",
      [
        "action",
        "new-pane",
        "--name",
        opts.name,
        "--close-on-exit",
        ...layoutFlags,
        "--",
        opts.command,
        ...opts.args,
      ],
      {
        cwd: opts.cwd,
        reject: true,
        stripFinalNewline: true,
      }
    );
    const match = stdout.match(/(terminal_\d+|plugin_\d+)/);
    return match ? (match[1] ?? null) : null;
  } catch (err) {
    const e = err as ExecaError;
    throw new ZellijError(
      `zellij new-pane failed: ${e.shortMessage ?? e.message}`,
      typeof e.stderr === "string" ? e.stderr : undefined
    );
  } finally {
    // Refocus inklit so the user keeps interacting with the list.
    if (home) await focusPaneId(home);
  }
}
