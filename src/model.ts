export type AgentKind = "claude" | "codex";

export type TaskState =
  | "running"
  | "waiting"
  | "idle"
  | "ready"
  | "failed"
  | "merged";

/**
 * Replit-style task lifecycle, separate from the local zellij pane/process
 * state above. A task can be "ready" for review even though its pane state is
 * "ready" only because no live pane currently backs it.
 */
export type TaskLifecycle =
  | "draft"
  | "queued"
  | "active"
  | "ready"
  | "applying"
  | "done"
  | "archived"
  | "cancelled";

export interface ReviewStats {
  /** Final patch file count relative to the main version. */
  files: number;
  /** Commits ahead of the main version. */
  commitsAhead: number;
  /** Untracked files included in the final patch. */
  untracked: number;
}

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
  /** Optional persisted lifecycle override, such as archived/done. */
  lifecycle?: TaskLifecycle;
  /** Timestamp for the persisted lifecycle override. */
  lifecycleAt?: number;
  /** Set when zellij has a pane named after this slug. */
  paneId?: string;
  /** Per-task error from wt parsing or git probing; rendered inline. */
  error?: string;
  /** Working tree dirty flag, surfaced as a glyph. */
  dirty: boolean;
  /** Compact review-readiness counts for the task board. */
  review?: ReviewStats;
  /** Symbols string from `wt list` for richer detail in inspector. */
  symbols: string;
  /**
   * Seconds since the agent's pane viewport last changed. Only set when
   * `state === "idle"` — the visual heartbeat suffix uses this.
   */
  idleSeconds?: number;
}

export interface MainVersion {
  /** Absolute path to the root checkout that receives applied task work. */
  path: string;
  /** Current branch name for the main checkout. */
  branch: string;
  /** Short SHA of HEAD in the main checkout. */
  shortSha: string;
  /** Last commit subject in the main checkout. */
  subject: string;
  /** Working tree dirty flag for the main checkout. */
  dirty: boolean;
  /** True when worktrunk reports this as the current checkout. */
  current: boolean;
  /** Best-effort error from probing the main checkout. */
  error?: string;
}

export type InspectorMode = "task" | "files" | "diff" | "log" | "agent";
export type TaskListDensity = "detailed" | "compact";

export interface AppState {
  mainVersion: MainVersion | null;
  tasks: Task[];
  selectedSlug: string | null;
  mode:
    | "list"
    | "newTaskDescription"
    | "newTaskAgent"
    | "spawning"
    | "confirmMerge"
    | "confirmKill"
    | "confirmCloseAll"
    | "merging"
    | "killing"
    | "closingAll"
    | "resumeAgentPicker"
    | "resuming"
    | "sendInput"
    | "sending"
    | "filter"
    | "commandPalette"
    | "help"
    | "error";
  inspectorMode: InspectorMode;
  /** Dense table vs stacked task-card board. */
  listDensity: TaskListDensity;
  /** Show archived/cancelled task records that are hidden by default. */
  showArchived: boolean;
  /** Persistent task board filter. */
  filterQuery: string;
  newTaskDescription: string;
  flash: string | null;
  error: string | null;
  pendingChord: string | null;
  /** Filled by NewTaskPrompt → handed to spawn(). */
  pendingDescription: string;
  /** Slug awaiting agent selection during a resume flow. */
  pendingResumeSlug: string | null;
  /** Buffer for the inline send-to-agent prompt (i keybind). */
  sendInputValue: string;
  /**
   * Inspector scroll offset, keyed by `${slug}:${mode}`. Value is the number of
   * lines hidden above the viewport. Sentinel `-1` means "auto-tail to the
   * bottom" — used by agent mode so live transcripts keep advancing as new
   * lines come in. Missing key falls back to the per-mode default in App.
   */
  inspectorOffsets: Map<string, number>;
}

export const initialState: AppState = {
  mainVersion: null,
  tasks: [],
  selectedSlug: null,
  mode: "list",
  inspectorMode: "task",
  listDensity: "detailed",
  showArchived: false,
  newTaskDescription: "",
  flash: null,
  error: null,
  pendingChord: null,
  pendingDescription: "",
  pendingResumeSlug: null,
  sendInputValue: "",
  filterQuery: "",
  inspectorOffsets: new Map(),
};

export function lifecycleForState(state: TaskState): TaskLifecycle {
  switch (state) {
    case "running":
    case "waiting":
    case "idle":
      return "active";
    case "ready":
      return "ready";
    case "merged":
      return "done";
    case "failed":
      return "cancelled";
  }
}

export function lifecycleForTask(
  task: Pick<Task, "state"> & { lifecycle?: TaskLifecycle }
): TaskLifecycle {
  return task.lifecycle ?? lifecycleForState(task.state);
}
