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
import { spawnAgent } from "../agent.js";
import type { AgentKind, AppState, InspectorMode, Task } from "../model.js";
import { initialState } from "../model.js";

interface ModeContent {
  diff: string;
  log: string;
  agent: string;
  files: StatusEntry[];
}

const EMPTY_CONTENT: ModeContent = { diff: "", log: "", agent: "", files: [] };

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
  | { type: "mode/list" }
  | { type: "inspector/setMode"; mode: InspectorMode }
  | { type: "inspector/data"; slug: string; key: keyof ModeContent; value: any }
  | { type: "inspector/loading"; loading: boolean }
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
    case "mode/list":
      return { ...s, mode: "list", newTaskDescription: "" };
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

      // gg chord.
      if (state.pendingChord === "g") {
        dispatch({ type: "chord/set", key: null });
        if (input === "g") {
          dispatch({ type: "select/first" });
          return;
        }
      }

      if (input === "q" || (key.ctrl && input === "c")) {
        exit();
        return;
      }
      if (input === "j" || key.downArrow) {
        dispatch({ type: "select/next" });
        return;
      }
      if (input === "k" || key.upArrow) {
        dispatch({ type: "select/prev" });
        return;
      }
      if (input === "g") {
        dispatch({ type: "chord/set", key: "g" });
        return;
      }
      if (input === "G") {
        dispatch({ type: "select/last" });
        return;
      }
      if (key.ctrl && input === "d") {
        for (let i = 0; i < Math.floor(rows / 4); i++)
          dispatch({ type: "select/next" });
        return;
      }
      if (key.ctrl && input === "u") {
        for (let i = 0; i < Math.floor(rows / 4); i++)
          dispatch({ type: "select/prev" });
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
          dispatch({ type: "flash", message: "Not in zellij — focus disabled." });
          return;
        }
        focusPaneByName(slug).then((ok) => {
          if (!ok) {
            dispatch({
              type: "flash",
              message: `No live pane named "${slug}".`,
            });
          }
        });
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
      if (input === "K") {
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

  const listHeight = Math.max(5, Math.floor(rows / 3));
  const showConfirm =
    state.mode === "confirmMerge" ||
    state.mode === "confirmKill" ||
    state.mode === "merging" ||
    state.mode === "killing";
  const confirmHeight = showConfirm ? 5 : 0;
  const inspectorHeight = Math.max(8, rows - listHeight - confirmHeight - 3);
  const content = getContent(state, state.selectedSlug);

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
          <AgentPicker description={state.pendingDescription} />
        ) : state.mode === "spawning" ? (
          <Box paddingX={1}>
            <Text color="yellow">spawning…</Text>
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
        inSession={inSess}
      />
    </Box>
  );
}
