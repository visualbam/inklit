export type AgentKind = "claude" | "codex";

export type TaskState = "running" | "waiting" | "ready" | "failed" | "merged";

export interface Task {
  /** Branch name from worktrunk; doubles as the zellij pane name. */
  slug: string;
  /** Absolute path to the worktree. */
  path: string;
  /** Short SHA of HEAD in the worktree. */
  shortSha: string;
  /** Last commit subject. */
  subject: string;
  /** Seconds since the last commit (used as task age proxy). */
  ageSeconds: number;
  /** Heuristic state. */
  state: TaskState;
  /** Set when zellij has a pane named after this slug. */
  paneId?: string;
  /** Per-task error from wt parsing or git probing; rendered inline. */
  error?: string;
  /** Working tree dirty flag, surfaced as a glyph. */
  dirty: boolean;
  /** Symbols string from `wt list` for richer detail in inspector. */
  symbols: string;
}

export type InspectorMode = "files" | "diff" | "log" | "agent";

export interface AppState {
  tasks: Task[];
  selectedSlug: string | null;
  mode: "list" | "newTaskDescription" | "newTaskAgent" | "spawning" | "error";
  inspectorMode: InspectorMode;
  newTaskDescription: string;
  flash: string | null;
  error: string | null;
  pendingChord: string | null;
  /** Filled by NewTaskPrompt → handed to spawn(). */
  pendingDescription: string;
}

export const initialState: AppState = {
  tasks: [],
  selectedSlug: null,
  mode: "list",
  inspectorMode: "files",
  newTaskDescription: "",
  flash: null,
  error: null,
  pendingChord: null,
  pendingDescription: "",
};
