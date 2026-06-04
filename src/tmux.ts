/**
 * Headless agent sessions via a dedicated tmux server (`tmux -L inklit`).
 *
 * Using a separate server keeps inklit's sessions completely isolated from any
 * tmux the user may already have running. The server is started automatically
 * by the first `tmux -L inklit` command and exits when its last session ends.
 *
 * All agent sessions are identified by their slug — the same slug used for
 * the git worktree — so no separate ID tracking is needed.
 *
 * The server is configured with no status bar and no prefix key so that
 * attaching inside a zellij floating pane is completely transparent.
 */

import { execa } from "execa";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { inSession } from "./zellij.js";

const SERVER = "inklit";

/** Path to the minimal tmux config inklit writes on first use. */
function tmuxConfPath(): string {
  const base =
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "inklit", "tmux.conf");
}

async function ensureTmuxConf(): Promise<string> {
  const path = tmuxConfPath();
  const conf = [
    "set -g status off",
    "set -g prefix None",
    "set -g escape-time 0",
    "set -g mouse off",
    "",
  ].join("\n");
  await fs.mkdir(join(path, ".."), { recursive: true });
  // Only write when absent or stale — avoids churn on every spawn.
  const existing = await fs.readFile(path, "utf-8").catch(() => "");
  if (existing !== conf) await fs.writeFile(path, conf, "utf-8");
  return path;
}

function tmux(args: string[], opts?: { timeout?: number }): ReturnType<typeof execa> {
  return execa("tmux", ["-L", SERVER, ...args], {
    reject: true,
    stripFinalNewline: true,
    timeout: opts?.timeout ?? 5000,
  });
}

export async function tmuxAvailable(): Promise<boolean> {
  try {
    await execa("tmux", ["-V"], { reject: true, timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn an agent in a new detached tmux session named `slug`.
 * The session is invisible — no zellij pane is created.
 */
export async function spawnSession(
  slug: string,
  command: string,
  args: string[],
  cwd?: string
): Promise<void> {
  const conf = await ensureTmuxConf();
  // -d: start detached  -s: session name  -x/-y: initial terminal size
  await execa(
    "tmux",
    ["-L", SERVER, "-f", conf, "new-session", "-d", "-s", slug, "-x", "220", "-y", "50", "--", command, ...args],
    {
      cwd,
      reject: true,
      timeout: 10_000,
    }
  );
  // Apply config options to the newly created session.
  await tmux(["set-option", "-t", slug, "status", "off"]).catch(() => {});
  await tmux(["set-option", "-t", slug, "prefix", "None"]).catch(() => {});
}

/** Returns true when the tmux session named `slug` is still alive. */
export async function sessionAlive(slug: string): Promise<boolean> {
  try {
    await tmux(["has-session", "-t", slug], { timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture the current visible content of the session's pane.
 * Returns "" when the session doesn't exist or tmux is unreachable.
 */
export async function capturePane(
  slug: string,
  opts: { lines?: number } = {}
): Promise<string> {
  const lines = opts.lines ?? 200;
  try {
    const { stdout } = await tmux(
      ["capture-pane", "-t", slug, "-p", "-S", `-${lines}`],
      { timeout: 1000 }
    );
    return typeof stdout === "string" ? stdout : "";
  } catch {
    return "";
  }
}

/**
 * Send a line of text to the agent session (simulates typing + Enter).
 * Returns true on success.
 */
export async function sendKeys(slug: string, text: string): Promise<boolean> {
  try {
    await tmux(["send-keys", "-t", slug, text, "Enter"]);
    return true;
  } catch {
    return false;
  }
}

/** Terminate a tmux session (kills the agent process). */
export async function killSession(slug: string): Promise<boolean> {
  try {
    await tmux(["kill-session", "-t", slug], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Open the agent session in a zellij floating pane.
 * Closing the pane detaches from tmux; the session (and agent) keeps running.
 * Returns the zellij pane id of the float, or null if zellij isn't available.
 */
export async function openFloat(slug: string): Promise<string | null> {
  if (!inSession()) return null;
  try {
    const { stdout } = await execa(
      "zellij",
      [
        "action",
        "new-pane",
        "--floating",
        "--close-on-exit",
        "--width", "90%",
        "--height", "90%",
        "--",
        "tmux",
        "-L",
        SERVER,
        "attach-session",
        "-t",
        slug,
      ],
      { reject: true, stripFinalNewline: true, timeout: 5000 }
    );
    const out = typeof stdout === "string" ? stdout : "";
    const match = out.match(/(terminal_\d+|plugin_\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Kill all inklit-managed tmux sessions.
 * Returns the count of sessions that were killed.
 */
export async function killAllSessions(): Promise<number> {
  const sessions = await listSessions();
  let killed = 0;
  for (const s of sessions) {
    if (await killSession(s)) killed++;
  }
  return killed;
}

/** List all session names on the inklit tmux server. */
export async function listSessions(): Promise<string[]> {
  try {
    const { stdout } = await tmux(["list-sessions", "-F", "#{session_name}"], {
      timeout: 1000,
    });
    return (typeof stdout === "string" ? stdout : "")
      .split("\n")
      .map((s: string) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
