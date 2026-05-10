import { execa, ExecaError } from "execa";

interface ZellijPane {
  id?: number;
  pane_id?: string;
  name?: string;
  title?: string;
  is_focused?: boolean;
  is_floating?: boolean;
  exited?: boolean;
  exit_status?: number | null;
  command?: string;
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
      ["action", "list-panes", "--json", "--state", "--command"],
      { reject: true, stripFinalNewline: true }
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

/** Resolve a pane id like `terminal_3` into the form zellij expects. */
function paneIdArg(p: ZellijPane): string | null {
  if (p.pane_id) return p.pane_id;
  if (typeof p.id === "number") return `terminal_${p.id}`;
  return null;
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
  try {
    await execa("zellij", ["action", "focus-pane-id", id], {
      reject: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Focus the pane named `name` and then close it.
 * Returns true on success, false when no pane with that name was found.
 *
 * Zellij has no `close-pane-by-id`, so the only way to close a specific pane
 * is to focus it first. There's a benign race if the user moves focus
 * mid-call; in practice the two actions are <50ms apart.
 */
export async function closePaneByName(name: string): Promise<boolean> {
  const focused = await focusPaneByName(name);
  if (!focused) return false;
  try {
    await execa("zellij", ["action", "close-pane"], { reject: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn a new named pane running `command`. Returns the created pane id, or
 * null when zellij doesn't echo one (rare).
 *
 * Note: `--floating` is omitted; the user controls layout in Zellij itself.
 */
export async function spawnPane(opts: {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
}): Promise<string | null> {
  if (!inSession()) {
    throw new ZellijError(
      "Not in a zellij session. Launch lazyagent inside zellij so it can spawn panes."
    );
  }
  try {
    const { stdout } = await execa(
      "zellij",
      [
        "action",
        "new-pane",
        "--name",
        opts.name,
        "--close-on-exit",
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
  }
}
