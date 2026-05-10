import React, { useEffect, useMemo, useReducer, useRef } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { TaskList } from "./List.js";
import { Inspector } from "./Inspector.js";
import { StatusBar } from "./StatusBar.js";
import { DescriptionPrompt, AgentPicker } from "./NewTaskPrompt.js";
import { ConfirmPrompt } from "./ConfirmPrompt.js";
import {
  listTasks,
  gitDiff,
  gitFiles,
  gitLog,
  detectWaiting,
  mergeToMain,
  removeWorktree,
  type StatusEntry,
} from "../wt.js";
import {
  findPaneByName,
  inSession,
  dumpScreen,
  focusPaneByName,
  closePaneByName,
} from "../zellij.js";
import { spawnAgent, resumeAgent } from "../agent.js";
import { getAgent, recordRemove } from "../state.js";
import type { AgentKind, AppState, InspectorMode, Task } from "../model.js";
import { initialState } from "../model.js";

interface ModeContent {
  diff: string;
  log: string;
  agent: string;
  files: StatusEntry[];
}

const EMPTY_CONTENT: ModeContent = { diff: "", log: "", agent: "", files: [] };

type ScrollKind = "lineUp" | "lineDown" | "halfUp" | "halfDown" | "top" | "bottom";

type Action =
  | { type: "tasks/loaded"; tasks: Task[]; agents: Map<string, string> }
  | { type: "tasks/error"; message: string }
  | { type: "select/next" }
  | { type: "select/prev" }
  | { type: "select/first" }
  | { type: "select/last" }
  | { type: "mode/newTaskDescription" }
  | { type: "mode/newTaskAgent"; description: string }
  | { type: "mode/spawning" }
  | { type: "mode/confirmMerge" }
  | { type: "mode/confirmKill" }
  | { type: "mode/merging" }
  | { type: "mode/killing" }
  | { type: "mode/resumeAgentPicker"; slug: string }
  | { type: "mode/resuming" }
  | { type: "mode/list" }
  | { type: "inspector/setMode"; mode: InspectorMode }
  | { type: "inspector/data"; slug: string; key: keyof ModeContent; value: any }
  | { type: "inspector/loading"; loading: boolean }
  | { type: "inspector/scroll"; kind: ScrollKind; maxLines: number }
  | { type: "newTask/setDescription"; value: string }
  | { type: "flash"; message: string | null }
  | { type: "error"; message: string | null }
  | { type: "chord/set"; key: string | null };

interface RenderState extends AppState {
  /** Per-slug per-mode cache. */
  content: Map<string, ModeContent>;
  inspectorLoading: boolean;
  /** Live tail from `dump-screen` per running slug; feeds agent mode + waiting. */
  agentTails: Map<string, string>;
}

const initial: RenderState = {
  ...initialState,
  content: new Map(),
  inspectorLoading: false,
  agentTails: new Map(),
};

function getContent(s: RenderState, slug: string | null): ModeContent {
  if (!slug) return EMPTY_CONTENT;
  return s.content.get(slug) ?? EMPTY_CONTENT;
}

function setContent(
  s: RenderState,
  slug: string,
  patch: Partial<ModeContent>
): Map<string, ModeContent> {
  const next = new Map(s.content);
  const prev = next.get(slug) ?? EMPTY_CONTENT;
  next.set(slug, { ...prev, ...patch });
  return next;
}

function scrollKey(slug: string, mode: InspectorMode): string {
  return `${slug}:${mode}`;
}

/** Total renderable units (lines or file rows) in the current inspector view. */
function totalLinesFor(s: RenderState): number {
  const slug = s.selectedSlug;
  if (!slug) return 0;
  const c = s.content.get(slug);
  if (!c) return 0;
  switch (s.inspectorMode) {
    case "diff":
      return c.diff ? c.diff.split("\n").length : 0;
    case "log":
      return c.log ? c.log.split("\n").length : 0;
    case "agent":
      return c.agent ? c.agent.split("\n").length : 0;
    case "files":
      return c.files.length;
  }
}

/** Resolve stored offset to an effective top-line index for the viewport. */
function resolveOffset(
  stored: number | undefined,
  mode: InspectorMode,
  totalLines: number,
  maxLines: number
): number {
  const maxOffset = Math.max(0, totalLines - maxLines);
  if (stored === undefined) {
    return mode === "agent" ? maxOffset : 0;
  }
  if (stored < 0) return maxOffset;
  return Math.min(stored, maxOffset);
}

function reducer(s: RenderState, a: Action): RenderState {
  switch (a.type) {
    case "tasks/loaded": {
      const tasks = a.tasks;
      let selectedSlug = s.selectedSlug;
      if (!selectedSlug || !tasks.find((t) => t.slug === selectedSlug)) {
        selectedSlug = tasks[0]?.slug ?? null;
      }
      return { ...s, tasks, selectedSlug, error: null, agentTails: a.agents };
    }
    case "tasks/error":
      return { ...s, error: a.message };
    case "select/next": {
      const idx = s.tasks.findIndex((t) => t.slug === s.selectedSlug);
      const next = s.tasks[Math.min(s.tasks.length - 1, idx + 1)] ?? s.tasks[0];
      return { ...s, selectedSlug: next?.slug ?? null };
    }
    case "select/prev": {
      const idx = s.tasks.findIndex((t) => t.slug === s.selectedSlug);
      const prev = s.tasks[Math.max(0, idx - 1)] ?? s.tasks[0];
      return { ...s, selectedSlug: prev?.slug ?? null };
    }
    case "select/first":
      return { ...s, selectedSlug: s.tasks[0]?.slug ?? null };
    case "select/last":
      return {
        ...s,
        selectedSlug: s.tasks[s.tasks.length - 1]?.slug ?? null,
      };
    case "mode/newTaskDescription":
      return { ...s, mode: "newTaskDescription", newTaskDescription: "" };
    case "mode/newTaskAgent":
      return {
        ...s,
        mode: "newTaskAgent",
        pendingDescription: a.description,
      };
    case "mode/spawning":
      return { ...s, mode: "spawning" };
    case "mode/confirmMerge":
      // Switch inspector to diff so user reviews before confirming.
      return { ...s, mode: "confirmMerge", inspectorMode: "diff" };
    case "mode/confirmKill":
      return { ...s, mode: "confirmKill", inspectorMode: "diff" };
    case "mode/merging":
      return { ...s, mode: "merging" };
    case "mode/killing":
      return { ...s, mode: "killing" };
    case "mode/resumeAgentPicker":
      return {
        ...s,
        mode: "resumeAgentPicker",
        pendingResumeSlug: a.slug,
      };
    case "mode/resuming":
      return { ...s, mode: "resuming" };
    case "mode/list":
      return {
        ...s,
        mode: "list",
        newTaskDescription: "",
        pendingResumeSlug: null,
      };
    case "inspector/setMode":
      return { ...s, inspectorMode: a.mode };
    case "inspector/data":
      return {
        ...s,
        content: setContent(s, a.slug, { [a.key]: a.value } as Partial<ModeContent>),
        inspectorLoading: false,
      };
    case "inspector/loading":
      return { ...s, inspectorLoading: a.loading };
    case "inspector/scroll": {
      if (!s.selectedSlug) return s;
      const key = scrollKey(s.selectedSlug, s.inspectorMode);
      const isAgent = s.inspectorMode === "agent";
      const total = totalLinesFor(s);
      const maxOffset = Math.max(0, total - a.maxLines);
      const half = Math.max(1, Math.floor(a.maxLines / 2));
      const current = resolveOffset(s.inspectorOffsets.get(key), s.inspectorMode, total, a.maxLines);
      let next = current;
      switch (a.kind) {
        case "top": next = 0; break;
        case "bottom": next = isAgent ? -1 : maxOffset; break;
        case "lineUp": next = Math.max(0, current - 1); break;
        case "lineDown": next = Math.min(maxOffset, current + 1); break;
        case "halfUp": next = Math.max(0, current - half); break;
        case "halfDown": next = Math.min(maxOffset, current + half); break;
      }
      // Re-anchor agent transcripts to live tail when the user lands on bottom.
      if (isAgent && a.kind !== "top" && next === maxOffset) next = -1;
      const map = new Map(s.inspectorOffsets);
      map.set(key, next);
      return { ...s, inspectorOffsets: map };
    }
    case "newTask/setDescription":
      return { ...s, newTaskDescription: a.value };
    case "flash":
      return { ...s, flash: a.message };
    case "error":
      return { ...s, error: a.message };
    case "chord/set":
      return { ...s, pendingChord: a.key };
    default:
      return s;
  }
}

const POLL_MS = 1500;
const AGENT_TAIL_LINES = 200;

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const rows = stdout?.rows ?? 24;

  const [state, dispatch] = useReducer(reducer, initial);
  const inSess = useMemo(() => inSession(), []);
  const fetchedRef = useRef<Map<string, number>>(new Map());

  // Poll wt + zellij. dump-screen for each running pane to feed waiting + agent.
  useEffect(() => {
    let cancelled = false;
    let timer: NodeJS.Timeout | null = null;

    const tick = async () => {
      try {
        const tasks = await listTasks();
        const agents = new Map<string, string>();
        const refined = await Promise.all(
          tasks.map(async (t) => {
            try {
              const pane = await findPaneByName(t.slug);
              if (!pane) return { ...t, state: "ready" as const };
              const paneId =
                pane.pane_id ??
                (typeof pane.id === "number" ? `terminal_${pane.id}` : null);
              let screen = "";
              if (paneId) {
                screen = await dumpScreen(paneId);
                if (screen) agents.set(t.slug, screen);
              }
              const waiting = screen ? detectWaiting(screen) : false;
              return {
                ...t,
                state: waiting ? ("waiting" as const) : ("running" as const),
                paneId: paneId ?? undefined,
              };
            } catch {
              return t;
            }
          })
        );
        if (!cancelled) dispatch({ type: "tasks/loaded", tasks: refined, agents });
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: "tasks/error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Push agent tails into per-slug content so Inspector renders without extra fetch.
  useEffect(() => {
    for (const [slug, text] of state.agentTails) {
      // Only the last N lines to keep state small.
      const lines = text.split("\n");
      const tail = lines.slice(-AGENT_TAIL_LINES).join("\n");
      const existing = state.content.get(slug)?.agent;
      if (existing !== tail) {
        dispatch({ type: "inspector/data", slug, key: "agent", value: tail });
      }
    }
  }, [state.agentTails]);

  // Fetch inspector content for the selection on mode change / selection change.
  useEffect(() => {
    const slug = state.selectedSlug;
    if (!slug) return;
    const task = state.tasks.find((t) => t.slug === slug);
    if (!task) return;
    const mode = state.inspectorMode;
    if (mode === "agent") return; // fed by poll loop

    const cacheKey = `${slug}:${mode}`;
    const last = fetchedRef.current.get(cacheKey) ?? 0;
    const now = Date.now();
    // Refetch every 3s for the visible mode.
    if (now - last < 3000) return;
    fetchedRef.current.set(cacheKey, now);

    let cancelled = false;
    dispatch({ type: "inspector/loading", loading: true });
    (async () => {
      try {
        if (mode === "diff") {
          const value = await gitDiff(task.path);
          if (!cancelled)
            dispatch({ type: "inspector/data", slug, key: "diff", value });
        } else if (mode === "log") {
          const value = await gitLog(task.path);
          if (!cancelled)
            dispatch({ type: "inspector/data", slug, key: "log", value });
        } else if (mode === "files") {
          const value = await gitFiles(task.path);
          if (!cancelled)
            dispatch({ type: "inspector/data", slug, key: "files", value });
        }
      } finally {
        if (!cancelled) dispatch({ type: "inspector/loading", loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.selectedSlug, state.inspectorMode, state.tasks]);

  // Flash auto-clear.
  useEffect(() => {
    if (!state.flash) return;
    const id = setTimeout(() => dispatch({ type: "flash", message: null }), 2000);
    return () => clearTimeout(id);
  }, [state.flash]);

  useInput(
    (input, key) => {
      // Prompts handle their own input.
      if (state.mode === "newTaskDescription") {
        if (key.escape) dispatch({ type: "mode/list" });
        return;
      }
      if (state.mode === "newTaskAgent") {
        if (key.escape) dispatch({ type: "mode/list" });
        if (input === "c") void doSpawn(state.pendingDescription, "claude");
        if (input === "x") void doSpawn(state.pendingDescription, "codex");
        return;
      }
      if (state.mode === "spawning") return;
      if (state.mode === "merging" || state.mode === "killing") return;
      if (state.mode === "resuming") return;

      if (state.mode === "resumeAgentPicker") {
        if (key.escape) dispatch({ type: "mode/list" });
        if (input === "c" && state.pendingResumeSlug) {
          void doResume(state.pendingResumeSlug, "claude");
        }
        if (input === "x" && state.pendingResumeSlug) {
          void doResume(state.pendingResumeSlug, "codex");
        }
        return;
      }

      if (state.mode === "confirmMerge") {
        if (input === "y" || input === "Y") {
          const slug = state.selectedSlug;
          if (slug) void doMerge(slug);
          return;
        }
        if (input === "n" || input === "N" || key.escape) {
          dispatch({ type: "mode/list" });
          return;
        }
        return;
      }
      if (state.mode === "confirmKill") {
        if (input === "y" || input === "Y") {
          const slug = state.selectedSlug;
          if (slug) void doKill(slug);
          return;
        }
        if (input === "n" || input === "N" || key.escape) {
          dispatch({ type: "mode/list" });
          return;
        }
        return;
      }

      // gg chord — now scrolls inspector to top instead of jumping list selection.
      if (state.pendingChord === "g") {
        dispatch({ type: "chord/set", key: null });
        if (input === "g") {
          dispatch({
            type: "inspector/scroll",
            kind: "top",
            maxLines: inspectorMaxLines,
          });
          return;
        }
      }

      if (input === "q" || (key.ctrl && input === "c")) {
        exit();
        return;
      }
      // Lowercase j/k + arrows still drive the list selection.
      if (input === "j" || key.downArrow) {
        dispatch({ type: "select/next" });
        return;
      }
      if (input === "k" || key.upArrow) {
        dispatch({ type: "select/prev" });
        return;
      }
      // [ / ] jump list selection to first / last (vim ]g-style).
      if (input === "[") {
        dispatch({ type: "select/first" });
        return;
      }
      if (input === "]") {
        dispatch({ type: "select/last" });
        return;
      }
      // Inspector scroll: J/K (lines), ctrl-d/u (half-page), gg/G (top/bottom).
      if (input === "J") {
        dispatch({
          type: "inspector/scroll",
          kind: "lineDown",
          maxLines: inspectorMaxLines,
        });
        return;
      }
      if (input === "K") {
        dispatch({
          type: "inspector/scroll",
          kind: "lineUp",
          maxLines: inspectorMaxLines,
        });
        return;
      }
      if (input === "g") {
        dispatch({ type: "chord/set", key: "g" });
        return;
      }
      if (input === "G") {
        dispatch({
          type: "inspector/scroll",
          kind: "bottom",
          maxLines: inspectorMaxLines,
        });
        return;
      }
      if (key.ctrl && input === "d") {
        dispatch({
          type: "inspector/scroll",
          kind: "halfDown",
          maxLines: inspectorMaxLines,
        });
        return;
      }
      if (key.ctrl && input === "u") {
        dispatch({
          type: "inspector/scroll",
          kind: "halfUp",
          maxLines: inspectorMaxLines,
        });
        return;
      }
      if (input === "n") {
        if (!inSess) {
          dispatch({
            type: "flash",
            message: "Not in zellij — launch lazyagent inside a zellij session.",
          });
          return;
        }
        dispatch({ type: "mode/newTaskDescription" });
        return;
      }
      if (key.return) {
        const slug = state.selectedSlug;
        if (!slug) return;
        if (!inSess) {
          dispatch({
            type: "flash",
            message: "Not in zellij — focus/resume disabled.",
          });
          return;
        }
        const task = state.tasks.find((t) => t.slug === slug);
        // Live pane → focus. Otherwise → resume (start a new pane in the
        // existing worktree with the agent's resume flag).
        if (task && (task.state === "running" || task.state === "waiting")) {
          focusPaneByName(slug).then((ok) => {
            if (!ok) {
              // Pane state changed between poll and keystroke — fall through
              // to resume.
              void enterResume(slug);
            }
          });
        } else {
          void enterResume(slug);
        }
        return;
      }

      // Inspector mode toggles.
      if (input === "f") {
        dispatch({ type: "inspector/setMode", mode: "files" });
        return;
      }
      if (input === "d") {
        dispatch({ type: "inspector/setMode", mode: "diff" });
        return;
      }
      if (input === "l") {
        dispatch({ type: "inspector/setMode", mode: "log" });
        return;
      }
      if (input === "a") {
        dispatch({ type: "inspector/setMode", mode: "agent" });
        return;
      }

      if (input === "m") {
        if (!state.selectedSlug) return;
        dispatch({ type: "mode/confirmMerge" });
        return;
      }
      if (input === "X") {
        if (!state.selectedSlug) return;
        dispatch({ type: "mode/confirmKill" });
        return;
      }

      // Stubs.
      if (input === "/" || input === "?" || input === "r") {
        dispatch({
          type: "flash",
          message: `'${input}' not yet implemented (see README → TODOs)`,
        });
      }
    },
    { isActive: true }
  );

  const selectedTask =
    state.tasks.find((t) => t.slug === state.selectedSlug) ?? null;

  async function doSpawn(description: string, agent: AgentKind) {
    dispatch({ type: "mode/spawning" });
    try {
      const res = await spawnAgent({ description, agent });
      dispatch({ type: "mode/list" });
      dispatch({ type: "flash", message: `Spawned ${res.slug} (${agent})` });
    } catch (err) {
      dispatch({ type: "mode/list" });
      dispatch({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function doMerge(slug: string) {
    const task = state.tasks.find((t) => t.slug === slug);
    if (!task) return;
    dispatch({ type: "mode/merging" });
    try {
      await mergeToMain(task.path);
      dispatch({ type: "mode/list" });
      dispatch({ type: "flash", message: `Merged ${slug} → main` });
    } catch (err) {
      dispatch({ type: "mode/list" });
      dispatch({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function doKill(slug: string) {
    dispatch({ type: "mode/killing" });
    try {
      if (inSess) await closePaneByName(slug);
      await removeWorktree(slug);
      // Drop the state-file entry so a future task with the same slug
      // doesn't inherit the wrong agent kind.
      recordRemove(slug).catch(() => {});
      dispatch({ type: "mode/list" });
      dispatch({ type: "flash", message: `Killed ${slug}` });
    } catch (err) {
      dispatch({ type: "mode/list" });
      dispatch({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function enterResume(slug: string) {
    const recorded = await getAgent(slug);
    if (recorded) {
      void doResume(slug, recorded);
      return;
    }
    // Unrecorded slug — happens for tasks created before lazyagent (or
    // outside it). Ask the user which agent to relaunch.
    dispatch({ type: "mode/resumeAgentPicker", slug });
  }

  async function doResume(slug: string, agent: AgentKind) {
    dispatch({ type: "mode/resuming" });
    try {
      await resumeAgent({ slug, agent });
      dispatch({ type: "mode/list" });
      dispatch({
        type: "flash",
        message: `Resumed ${slug} (${agent})`,
      });
    } catch (err) {
      dispatch({ type: "mode/list" });
      dispatch({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const listHeight = Math.max(5, Math.floor(rows / 3));
  const showConfirm =
    state.mode === "confirmMerge" ||
    state.mode === "confirmKill" ||
    state.mode === "merging" ||
    state.mode === "killing";
  const confirmHeight = showConfirm ? 5 : 0;
  const inspectorHeight = Math.max(8, rows - listHeight - confirmHeight - 3);
  // Same formula as Inspector — the reducer needs it so it can clamp scrolls.
  const inspectorMaxLines = Math.max(3, inspectorHeight - 4);
  const content = getContent(state, state.selectedSlug);
  const offsetForView = state.selectedSlug
    ? resolveOffset(
        state.inspectorOffsets.get(scrollKey(state.selectedSlug, state.inspectorMode)),
        state.inspectorMode,
        totalLinesFor(state),
        inspectorMaxLines
      )
    : 0;

  return (
    <Box flexDirection="column" height={rows}>
      <Box paddingX={1}>
        <Text bold color="cyan">
          lazyagent
        </Text>
        <Text dimColor> — parallel agents in worktrees</Text>
      </Box>
      <Box flexDirection="column" height={listHeight}>
        <TaskList
          tasks={state.tasks}
          selectedSlug={state.selectedSlug}
          width={cols - 2}
        />
      </Box>
      <Box flexGrow={1} flexDirection="column">
        {state.mode === "newTaskDescription" ? (
          <DescriptionPrompt
            value={state.newTaskDescription}
            onChange={(v) =>
              dispatch({ type: "newTask/setDescription", value: v })
            }
            onSubmit={(v) => {
              const trimmed = v.trim();
              if (!trimmed) {
                dispatch({ type: "mode/list" });
                return;
              }
              dispatch({ type: "mode/newTaskAgent", description: trimmed });
            }}
            onCancel={() => dispatch({ type: "mode/list" })}
          />
        ) : state.mode === "newTaskAgent" ? (
          <AgentPicker label={state.pendingDescription} intent="spawn" />
        ) : state.mode === "resumeAgentPicker" ? (
          <AgentPicker
            label={state.pendingResumeSlug ?? "(unknown)"}
            intent="resume"
          />
        ) : state.mode === "spawning" ? (
          <Box paddingX={1}>
            <Text color="yellow">spawning…</Text>
          </Box>
        ) : state.mode === "resuming" ? (
          <Box paddingX={1}>
            <Text color="yellow">resuming…</Text>
          </Box>
        ) : (
          <Inspector
            task={selectedTask}
            mode={state.inspectorMode}
            diff={content.diff}
            log={content.log}
            agent={content.agent}
            files={content.files}
            loading={state.inspectorLoading}
            height={inspectorHeight}
            offset={offsetForView}
          />
        )}
      </Box>
      {showConfirm ? (
        <ConfirmPrompt
          action={
            state.mode === "confirmKill" || state.mode === "killing"
              ? "kill"
              : "merge"
          }
          slug={state.selectedSlug ?? ""}
          busy={state.mode === "merging" || state.mode === "killing"}
        />
      ) : null}
      <StatusBar
        flash={state.flash}
        error={state.error}
        taskCount={state.tasks.length}
        selected={state.selectedSlug}
        selectedState={selectedTask?.state ?? null}
        inSession={inSess}
      />
    </Box>
  );
}
