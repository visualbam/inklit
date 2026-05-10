import React, { useEffect, useMemo, useReducer, useRef } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { TaskList } from "./List.js";
import { Inspector } from "./Inspector.js";
import { StatusBar } from "./StatusBar.js";
import { DescriptionPrompt, AgentPicker } from "./NewTaskPrompt.js";
import { ConfirmPrompt } from "./ConfirmPrompt.js";
import {
  listTasks,
  gitStatusShort,
  refineState,
  mergeToMain,
  removeWorktree,
} from "../wt.js";
import { findPaneByName, inSession } from "../zellij.js";
import { spawnAgent } from "../agent.js";
import { focusPaneByName, closePaneByName } from "../zellij.js";
import type { AgentKind, AppState, Task } from "../model.js";
import { initialState } from "../model.js";

type Action =
  | { type: "tasks/loaded"; tasks: Task[] }
  | { type: "tasks/error"; message: string }
  | { type: "select/next" }
  | { type: "select/prev" }
  | { type: "select/first" }
  | { type: "select/last" }
  | { type: "mode/setListSelection"; slug: string | null }
  | { type: "mode/newTaskDescription" }
  | { type: "mode/newTaskAgent"; description: string }
  | { type: "mode/spawning" }
  | { type: "mode/confirmMerge" }
  | { type: "mode/confirmKill" }
  | { type: "mode/merging" }
  | { type: "mode/killing" }
  | { type: "mode/list" }
  | { type: "newTask/setDescription"; value: string }
  | { type: "flash"; message: string | null }
  | { type: "error"; message: string | null }
  | { type: "chord/set"; key: string | null }
  | { type: "inspector/content"; content: string }
  | { type: "inspector/loading" };

interface RenderState extends AppState {
  inspectorContent: string;
  inspectorLoading: boolean;
}

const initial: RenderState = {
  ...initialState,
  inspectorContent: "",
  inspectorLoading: false,
};

function reducer(s: RenderState, a: Action): RenderState {
  switch (a.type) {
    case "tasks/loaded": {
      const tasks = a.tasks;
      let selectedSlug = s.selectedSlug;
      if (!selectedSlug || !tasks.find((t) => t.slug === selectedSlug)) {
        selectedSlug = tasks[0]?.slug ?? null;
      }
      return { ...s, tasks, selectedSlug, error: null };
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
      return { ...s, mode: "confirmMerge" };
    case "mode/confirmKill":
      return { ...s, mode: "confirmKill" };
    case "mode/merging":
      return { ...s, mode: "merging" };
    case "mode/killing":
      return { ...s, mode: "killing" };
    case "mode/list":
      return { ...s, mode: "list", newTaskDescription: "" };
    case "newTask/setDescription":
      return { ...s, newTaskDescription: a.value };
    case "flash":
      return { ...s, flash: a.message };
    case "error":
      return { ...s, error: a.message };
    case "chord/set":
      return { ...s, pendingChord: a.key };
    case "inspector/content":
      return { ...s, inspectorContent: a.content, inspectorLoading: false };
    case "inspector/loading":
      return { ...s, inspectorLoading: true };
    default:
      return s;
  }
}

const POLL_MS = 1500;

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const rows = stdout?.rows ?? 24;

  const [state, dispatch] = useReducer(reducer, initial);
  const inSess = useMemo(() => inSession(), []);
  const lastInspectedRef = useRef<{ slug: string; mtime: number } | null>(null);

  // Poll wt + zellij.
  useEffect(() => {
    let cancelled = false;
    let timer: NodeJS.Timeout | null = null;

    const tick = async () => {
      try {
        const tasks = await listTasks();
        // Refine state with zellij pane probe (best-effort).
        const refined = await Promise.all(
          tasks.map(async (t) => {
            try {
              const pane = await findPaneByName(t.slug);
              return {
                ...t,
                state: refineState(t, !!pane),
                paneId: pane?.pane_id,
              };
            } catch {
              return t;
            }
          })
        );
        if (!cancelled) dispatch({ type: "tasks/loaded", tasks: refined });
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

  // Inspector content for selection.
  useEffect(() => {
    const slug = state.selectedSlug;
    const task = state.tasks.find((t) => t.slug === slug);
    if (!task) {
      dispatch({ type: "inspector/content", content: "" });
      return;
    }
    // Avoid re-fetching on every poll for the same selection.
    const now = Date.now();
    const last = lastInspectedRef.current;
    if (last && last.slug === task.slug && now - last.mtime < POLL_MS) return;
    lastInspectedRef.current = { slug: task.slug, mtime: now };

    let cancelled = false;
    dispatch({ type: "inspector/loading" });
    gitStatusShort(task.path).then((content) => {
      if (!cancelled) dispatch({ type: "inspector/content", content });
    });
    return () => {
      cancelled = true;
    };
  }, [state.selectedSlug, state.tasks]);

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

      // Confirmations (block other input until resolved).
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
      if (
        input === "/" ||
        input === "?" ||
        input === "r" ||
        input === "f" ||
        input === "d" ||
        input === "l" ||
        input === "a"
      ) {
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
      dispatch({
        type: "flash",
        message: `Spawned ${res.slug} (${agent})`,
      });
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
      // Best-effort pane closure first; ignore failure (pane may already be gone).
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

  const listHeight = Math.max(5, Math.floor(rows / 2));

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
        ) : state.mode === "confirmMerge" ? (
          <ConfirmPrompt action="merge" slug={state.selectedSlug ?? ""} />
        ) : state.mode === "confirmKill" ? (
          <ConfirmPrompt action="kill" slug={state.selectedSlug ?? ""} />
        ) : state.mode === "merging" ? (
          <ConfirmPrompt action="merge" slug={state.selectedSlug ?? ""} busy />
        ) : state.mode === "killing" ? (
          <ConfirmPrompt action="kill" slug={state.selectedSlug ?? ""} busy />
        ) : (
          <Inspector
            task={selectedTask}
            mode={state.inspectorMode}
            content={state.inspectorContent}
            loading={state.inspectorLoading}
          />
        )}
      </Box>
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
