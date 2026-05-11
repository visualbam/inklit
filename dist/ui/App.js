import React, { useEffect, useMemo, useReducer, useRef } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { createHash } from "node:crypto";
import { TaskList, taskListLineCount, taskListMinimumHeight, } from "./List.js";
import { Inspector } from "./Inspector.js";
import { MainVersionBar } from "./MainVersionBar.js";
import { StatusBar } from "./StatusBar.js";
import { DescriptionPrompt, AgentPicker } from "./NewTaskPrompt.js";
import { ConfirmPrompt } from "./ConfirmPrompt.js";
import { SendInputPrompt } from "./SendInputPrompt.js";
import { FilterPrompt } from "./FilterPrompt.js";
import { HelpOverlay } from "./HelpOverlay.js";
import { CommandPalette } from "./CommandPalette.js";
import { agentTranscriptTail } from "./agentTranscript.js";
import { UI } from "./theme.js";
import { suggestedFollowUps } from "./followUps.js";
import { listProject, gitDiff, gitFiles, gitLog, gitReviewStats, detectPermissionRequest, detectWaiting, mergeToMain, syncFromMain, removeWorktree, } from "../wt.js";
import { inSession, dumpScreen, focusPaneByName, focusPaneId, focusOwnPane, closePaneByName, closePaneById, sendKeysToPaneId, sendKeysToSlug, panesSnapshot, } from "../zellij.js";
import { spawnAgent, resumeAgent } from "../agent.js";
import { getAgent, loadAll, recordPane, clearPane, recordRemove, recordLifecycle, recordListDensity, loadUiPrefs, snapshotTask, } from "../state.js";
import { notify } from "../notify.js";
import { initialState, lifecycleForTask } from "../model.js";
const EMPTY_CONTENT = { diff: "", log: "", agent: "", files: [] };
const initial = {
    ...initialState,
    content: new Map(),
    inspectorLoading: false,
    agentTails: new Map(),
};
function getContent(s, slug) {
    if (!slug)
        return EMPTY_CONTENT;
    return s.content.get(slug) ?? EMPTY_CONTENT;
}
function setContent(s, slug, patch) {
    const next = new Map(s.content);
    const prev = next.get(slug) ?? EMPTY_CONTENT;
    next.set(slug, { ...prev, ...patch });
    return next;
}
function scrollKey(slug, mode) {
    return `${slug}:${mode}`;
}
function sortTasks(tasks) {
    return [...tasks].sort((a, b) => {
        const rankDiff = urgencyRank(a) - urgencyRank(b);
        if (rankDiff !== 0)
            return rankDiff;
        return a.slug.localeCompare(b.slug);
    });
}
function urgencyRank(task) {
    if (task.lifecycle === "cancelled")
        return 6;
    if (task.lifecycle === "archived")
        return 7;
    switch (task.state) {
        case "permission":
            return 0;
        case "waiting":
            return 1;
        case "running":
            return 2;
        case "idle":
            return 3;
        case "ready":
            return 4;
        case "failed":
            return 5;
        case "merged":
            return 6;
    }
}
function matchesFilter(task, query) {
    const q = query.trim().toLowerCase();
    if (!q)
        return true;
    const haystack = [
        task.slug,
        task.subject,
        task.path,
        task.state,
        lifecycleForTask(task),
        task.shortSha,
    ]
        .join(" ")
        .toLowerCase();
    return haystack.includes(q);
}
function isHiddenLifecycle(task) {
    return task.lifecycle === "archived" || task.lifecycle === "cancelled";
}
function visibleTasksFor(tasks, query, showArchived) {
    return sortTasks(tasks).filter((task) => (showArchived || !isHiddenLifecycle(task)) && matchesFilter(task, query));
}
function firstVisibleSlug(tasks, query, showArchived) {
    return visibleTasksFor(tasks, query, showArchived)[0]?.slug ?? null;
}
function keepVisibleSelection(selectedSlug, tasks, query, showArchived) {
    if (selectedSlug &&
        visibleTasksFor(tasks, query, showArchived).some((t) => t.slug === selectedSlug)) {
        return selectedSlug;
    }
    return firstVisibleSlug(tasks, query, showArchived);
}
/** Total renderable units (lines or file rows) in the current inspector view. */
function totalLinesFor(s) {
    const slug = s.selectedSlug;
    if (!slug)
        return 0;
    if (s.inspectorMode === "task") {
        const task = s.tasks.find((t) => t.slug === slug) ?? null;
        return 9 + suggestedFollowUps(task).length;
    }
    const c = s.content.get(slug);
    if (!c)
        return 0;
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
function resolveOffset(stored, mode, totalLines, maxLines) {
    const maxOffset = maxOffsetFor(totalLines, maxLines);
    if (stored === undefined) {
        return mode === "agent" ? maxOffset : 0;
    }
    if (stored < 0)
        return maxOffset;
    return Math.min(stored, maxOffset);
}
function maxOffsetFor(totalLines, maxLines) {
    if (totalLines <= maxLines)
        return 0;
    return Math.max(0, totalLines - Math.max(1, maxLines - 1));
}
function reducer(s, a) {
    switch (a.type) {
        case "tasks/loaded": {
            const tasks = sortTasks(a.tasks);
            let selectedSlug = s.selectedSlug;
            selectedSlug = keepVisibleSelection(selectedSlug, tasks, s.filterQuery, s.showArchived);
            return {
                ...s,
                mainVersion: a.mainVersion,
                tasks,
                selectedSlug,
                error: null,
                agentTails: a.agents,
            };
        }
        case "tasks/error":
            return { ...s, error: a.message };
        case "select/next": {
            const visible = visibleTasksFor(s.tasks, s.filterQuery, s.showArchived);
            const idx = visible.findIndex((t) => t.slug === s.selectedSlug);
            const next = visible[Math.min(visible.length - 1, idx + 1)] ?? visible[0];
            return { ...s, selectedSlug: next?.slug ?? null };
        }
        case "select/prev": {
            const visible = visibleTasksFor(s.tasks, s.filterQuery, s.showArchived);
            const idx = visible.findIndex((t) => t.slug === s.selectedSlug);
            const prev = visible[Math.max(0, idx - 1)] ?? visible[0];
            return { ...s, selectedSlug: prev?.slug ?? null };
        }
        case "select/first":
            return {
                ...s,
                selectedSlug: firstVisibleSlug(s.tasks, s.filterQuery, s.showArchived),
            };
        case "select/last":
            {
                const visible = visibleTasksFor(s.tasks, s.filterQuery, s.showArchived);
                return {
                    ...s,
                    selectedSlug: visible[visible.length - 1]?.slug ?? null,
                };
            }
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
        case "mode/confirmCloseAll":
            return { ...s, mode: "confirmCloseAll" };
        case "mode/merging":
            return { ...s, mode: "merging" };
        case "mode/syncing":
            return { ...s, mode: "syncing" };
        case "mode/killing":
            return { ...s, mode: "killing" };
        case "mode/closingAll":
            return { ...s, mode: "closingAll" };
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
                sendInputValue: "",
            };
        case "mode/sendInput":
            // Snap inspector to the live agent transcript so the user can see
            // exactly what they're typing into.
            return {
                ...s,
                mode: "sendInput",
                sendInputValue: "",
                inspectorMode: "agent",
            };
        case "mode/sending":
            return { ...s, mode: "sending" };
        case "mode/filter":
            return { ...s, mode: "filter" };
        case "mode/commandPalette":
            return { ...s, mode: "commandPalette" };
        case "mode/help":
            return { ...s, mode: "help" };
        case "prefs/loaded":
            return a.listDensity ? { ...s, listDensity: a.listDensity } : s;
        case "list/toggleDensity":
            return {
                ...s,
                listDensity: s.listDensity === "compact" ? "detailed" : "compact",
            };
        case "archive/toggleVisibility":
            return {
                ...s,
                showArchived: !s.showArchived,
                selectedSlug: keepVisibleSelection(s.selectedSlug, s.tasks, s.filterQuery, !s.showArchived),
            };
        case "sendInput/setValue":
            return { ...s, sendInputValue: a.value };
        case "filter/set": {
            const query = a.value;
            return {
                ...s,
                filterQuery: query,
                selectedSlug: keepVisibleSelection(s.selectedSlug, s.tasks, query, s.showArchived),
            };
        }
        case "filter/clear":
            return {
                ...s,
                filterQuery: "",
                selectedSlug: keepVisibleSelection(s.selectedSlug, s.tasks, "", s.showArchived),
            };
        case "task/reviewStats": {
            const tasks = s.tasks.map((t) => t.slug === a.slug ? { ...t, review: a.stats } : t);
            return { ...s, tasks };
        }
        case "task/merged": {
            const tasks = sortTasks(s.tasks.map((t) => (t.slug === a.slug ? a.task : t)));
            return {
                ...s,
                tasks,
                inspectorMode: "task",
                selectedSlug: keepVisibleSelection(s.selectedSlug, tasks, s.filterQuery, s.showArchived),
            };
        }
        case "task/lifecycle": {
            const tasks = sortTasks(s.tasks.map((t) => t.slug === a.slug
                ? { ...t, lifecycle: a.lifecycle, lifecycleAt: a.lifecycleAt }
                : t));
            return {
                ...s,
                tasks,
                selectedSlug: keepVisibleSelection(s.selectedSlug, tasks, s.filterQuery, s.showArchived),
            };
        }
        case "inspector/setMode": {
            const selected = s.tasks.find((t) => t.slug === s.selectedSlug);
            if (selected?.state === "merged" && a.mode !== "task") {
                return {
                    ...s,
                    inspectorMode: "task",
                    flash: "Applied task has no worktree to inspect.",
                };
            }
            return { ...s, inspectorMode: a.mode };
        }
        case "inspector/data":
            return {
                ...s,
                content: setContent(s, a.slug, { [a.key]: a.value }),
                inspectorLoading: false,
            };
        case "inspector/loading":
            return { ...s, inspectorLoading: a.loading };
        case "inspector/scroll": {
            if (!s.selectedSlug)
                return s;
            const key = scrollKey(s.selectedSlug, s.inspectorMode);
            const isAgent = s.inspectorMode === "agent";
            const total = totalLinesFor(s);
            const maxOffset = maxOffsetFor(total, a.maxLines);
            const half = Math.max(1, Math.floor(a.maxLines / 2));
            const current = resolveOffset(s.inspectorOffsets.get(key), s.inspectorMode, total, a.maxLines);
            let next = current;
            switch (a.kind) {
                case "top":
                    next = 0;
                    break;
                case "bottom":
                    next = isAgent ? -1 : maxOffset;
                    break;
                case "lineUp":
                    next = Math.max(0, current - 1);
                    break;
                case "lineDown":
                    next = Math.min(maxOffset, current + 1);
                    break;
                case "halfUp":
                    next = Math.max(0, current - half);
                    break;
                case "halfDown":
                    next = Math.min(maxOffset, current + half);
                    break;
            }
            // Re-anchor agent transcripts to live tail when the user lands on bottom.
            if (isAgent && a.kind !== "top" && next === maxOffset)
                next = -1;
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
const PROJECT_POLL_MS = 2500;
const SCREEN_TICK_MS = 750;
const SELECTED_SCREEN_POLL_MS = 1000;
const BACKGROUND_SCREEN_POLL_MS = 6000;
const DUMP_SCREEN_TIMEOUT_MS = 700;
const AGENT_TAIL_LINES = 200;
const REVIEW_STATS_TICK_MS = 2500;
const REVIEW_STATS_POLL_MS = 10_000;
const MERGED_FADE_MS = 30_000;
function completedTaskFromRecord(slug, record, now) {
    if (record.lifecycle !== "done" || !record.lifecycleAt || !record.snapshot) {
        return null;
    }
    if (now - record.lifecycleAt > MERGED_FADE_MS)
        return null;
    return {
        slug,
        path: record.snapshot.path,
        shortSha: record.snapshot.shortSha,
        subject: record.snapshot.subject,
        ageSeconds: Math.max(0, Math.floor((now - record.lifecycleAt) / 1000)),
        state: "merged",
        lifecycle: "done",
        lifecycleAt: record.lifecycleAt,
        dirty: false,
        review: record.snapshot.review ?? {
            files: 0,
            commitsAhead: 0,
            untracked: 0,
        },
        symbols: record.snapshot.symbols,
    };
}
function applyPersistedLifecycle(task, record) {
    if (record?.lifecycle === "archived" || record?.lifecycle === "cancelled") {
        return {
            ...task,
            lifecycle: record.lifecycle,
            lifecycleAt: record.lifecycleAt,
        };
    }
    return task;
}
/**
 * "Live" = a zellij pane backs the task. Idle counts: the pane is still
 * there, the agent process is alive, the user just hasn't seen the screen
 * change in a while. Focus/anchor flows treat it the same as running.
 */
function isLivePane(s) {
    return s === "running" || s === "waiting" || s === "permission" || s === "idle";
}
function screenTail(text) {
    return agentTranscriptTail(text, AGENT_TAIL_LINES);
}
/**
 * After this many ms with no change in a running pane's viewport, we promote
 * the task from `running` to `idle` so the dashboard distinguishes "agent is
 * actively typing" from "agent has been frozen on a tool call." 30s is short
 * enough to catch real stalls without flapping during normal pauses
 * (file reads, model thinking) which usually resolve in <10s.
 */
const IDLE_AFTER_MS = 15_000;
export function App({ mainBranch = "main" }) {
    const { exit } = useApp();
    const { stdout } = useStdout();
    const cols = stdout?.columns ?? 80;
    const rows = stdout?.rows ?? 24;
    const targetBranch = mainBranch.trim() || "main";
    const [state, dispatch] = useReducer(reducer, initial);
    const inSess = useMemo(() => inSession(), []);
    const fetchedRef = useRef(new Map());
    const refreshProjectRef = useRef(() => { });
    const latestTasksRef = useRef([]);
    const latestSelectedSlugRef = useRef(null);
    const backgroundScanIndexRef = useRef(0);
    const screenCacheRef = useRef(new Map());
    const reviewStatsRef = useRef(new Map());
    const completedTasksRef = useRef(new Map());
    const reviewScanIndexRef = useRef(0);
    const densityTouchedRef = useRef(false);
    /** Last observed state per slug — used to fire one notification per transition. */
    const prevStatesRef = useRef(new Map());
    /**
     * Per-slug pane viewport hash + when it last changed. Used to promote
     * `running` to `idle` after IDLE_AFTER_MS without screen activity.
     */
    const screenHashRef = useRef(new Map());
    /** Slugs already notified as idle this episode; cleared on waiting/ready/failed. */
    const notifiedIdleRef = useRef(new Set());
    /** Re-entrancy guard so repeated Q/y presses don't double-close panes. */
    const closingAllRef = useRef(false);
    useEffect(() => {
        let cancelled = false;
        void loadUiPrefs()
            .then((prefs) => {
            if (cancelled || densityTouchedRef.current)
                return;
            dispatch({ type: "prefs/loaded", listDensity: prefs.listDensity });
        })
            .catch(() => { });
        return () => {
            cancelled = true;
        };
    }, []);
    useEffect(() => {
        latestTasksRef.current = state.tasks;
        latestSelectedSlugRef.current = state.selectedSlug;
    }, [state.tasks, state.selectedSlug]);
    // Poll wt + zellij pane metadata only. Pane screen dumps are throttled in a
    // separate sampler below so a few active agents cannot stall dashboard input.
    useEffect(() => {
        let cancelled = false;
        let timer = null;
        let running = false;
        let queued = false;
        const schedule = () => {
            if (!cancelled)
                timer = setTimeout(run, PROJECT_POLL_MS);
        };
        const run = async () => {
            if (running) {
                queued = true;
                return;
            }
            running = true;
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            try {
                // One worktrunk snapshot + one `zellij list-panes` + one state-file
                // read per tick. Pane lookup per task is then prefer-by-id (stable),
                // fall-back-to-title (works only before the agent OSC-rewrites it).
                const [project, panes, records] = await Promise.all([
                    listProject(),
                    panesSnapshot(),
                    loadAll(),
                ]);
                const { tasks, mainVersion } = project;
                const agents = new Map();
                const adoptions = [];
                const dropped = [];
                const refined = await Promise.all(tasks.map(async (t) => {
                    try {
                        const record = records[t.slug];
                        const recordedPaneId = record?.paneId;
                        // Primary: match by cwd. This is the only identifier that
                        // survives both OSC title rewrites (claude-code) and pane id
                        // churn (user closes pane and respawns). Worktree paths are
                        // unique per task, so collisions are impossible.
                        let pane = panes.byCwd.get(t.path);
                        // Secondary: stable paneId we recorded at spawn — works when
                        // cwd matching fails (e.g., agent chdir'd somewhere).
                        if (!pane && recordedPaneId)
                            pane = panes.byId.get(recordedPaneId);
                        // Tertiary: title — only succeeds before OSC rewrite, so
                        // mostly catches just-spawned tasks.
                        if (!pane) {
                            const fallback = panes.byTitle.get(t.slug);
                            if (fallback) {
                                pane = fallback;
                                if (records[t.slug])
                                    adoptions.push([t.slug, fallback.paneId]);
                            }
                        }
                        // Adopt paneId via cwd hit too, so the state file stays
                        // accurate even when ids change across sessions.
                        if (pane && records[t.slug] && recordedPaneId !== pane.paneId) {
                            adoptions.push([t.slug, pane.paneId]);
                        }
                        if (!pane) {
                            if (recordedPaneId)
                                dropped.push(t.slug);
                            return applyPersistedLifecycle({ ...t, state: "ready", paneId: undefined }, record);
                        }
                        const paneId = pane.paneId;
                        const cached = screenCacheRef.current.get(t.slug);
                        const screen = cached && cached.paneId === paneId ? cached.screen : "";
                        const permReq = screen ? detectPermissionRequest(screen) : false;
                        const waiting = !permReq && (screen ? detectWaiting(screen) : false);
                        const liveState = permReq
                            ? "permission"
                            : waiting
                                ? "waiting"
                                : "running";
                        return applyPersistedLifecycle({ ...t, state: liveState, paneId }, record);
                    }
                    catch {
                        return t;
                    }
                }));
                // Persist adoptions / drops sequentially after the tick. Best-effort.
                for (const [slug, pid] of adoptions) {
                    await recordPane(slug, pid).catch(() => { });
                }
                for (const slug of dropped) {
                    await clearPane(slug).catch(() => { });
                }
                // Idle promotion: hash each running pane's viewport; if unchanged for
                // IDLE_AFTER_MS, flip the task to `idle` and surface idleSeconds for
                // the row label. Keeps idle detection state out of the reducer so the
                // UI stays a pure projection of the latest poll.
                const now = Date.now();
                const aliveSlugs = new Set();
                let finalTasks = refined.map((t) => {
                    aliveSlugs.add(t.slug);
                    if (t.state !== "running") {
                        screenHashRef.current.delete(t.slug);
                        return t;
                    }
                    const cached = screenCacheRef.current.get(t.slug);
                    const screen = cached && cached.paneId === t.paneId ? cached.screen : "";
                    if (!screen)
                        return t;
                    const hash = createHash("sha1").update(screen).digest("hex");
                    const prev = screenHashRef.current.get(t.slug);
                    if (!prev || prev.hash !== hash) {
                        screenHashRef.current.set(t.slug, { hash, sinceMs: now });
                        return t;
                    }
                    const idleMs = now - prev.sinceMs;
                    if (idleMs < IDLE_AFTER_MS)
                        return t;
                    return {
                        ...t,
                        state: "idle",
                        idleSeconds: Math.floor(idleMs / 1000),
                    };
                });
                for (const slug of [...screenHashRef.current.keys()]) {
                    if (!aliveSlugs.has(slug))
                        screenHashRef.current.delete(slug);
                }
                for (const slug of [...screenCacheRef.current.keys()]) {
                    if (!aliveSlugs.has(slug))
                        screenCacheRef.current.delete(slug);
                }
                for (const slug of [...notifiedIdleRef.current]) {
                    if (!aliveSlugs.has(slug))
                        notifiedIdleRef.current.delete(slug);
                }
                // Attach cached review stats and keep recently-applied tasks visible
                // briefly so the board acknowledges the completed action instead of
                // making the row disappear immediately after `wt merge`.
                finalTasks = finalTasks.map((t) => {
                    const cachedStats = reviewStatsRef.current.get(t.slug)?.stats;
                    return cachedStats ? { ...t, review: cachedStats } : t;
                });
                const boardSlugs = new Set(finalTasks.map((t) => t.slug));
                for (const [slug, entry] of completedTasksRef.current) {
                    if (Date.now() > entry.untilMs) {
                        completedTasksRef.current.delete(slug);
                        continue;
                    }
                    if (boardSlugs.has(slug)) {
                        completedTasksRef.current.delete(slug);
                        continue;
                    }
                    finalTasks.push(entry.task);
                    boardSlugs.add(slug);
                }
                for (const [slug, record] of Object.entries(records)) {
                    if (boardSlugs.has(slug))
                        continue;
                    const completed = completedTaskFromRecord(slug, record, Date.now());
                    if (!completed)
                        continue;
                    finalTasks.push(completed);
                    boardSlugs.add(slug);
                }
                for (const slug of [...reviewStatsRef.current.keys()]) {
                    if (!boardSlugs.has(slug))
                        reviewStatsRef.current.delete(slug);
                }
                // Transition-based desktop notifications. Only fire when we've seen
                // the slug before (so freshly-loaded tasks don't pop on startup) and
                // the state actually changed. Keep the trigger list intentionally
                // narrow: waiting/idle/ready/failed are the states that justify pulling
                // the user back from their editor.
                for (const t of finalTasks) {
                    const prev = prevStatesRef.current.get(t.slug);
                    if (!prev || prev === t.state)
                        continue;
                    if (t.state === "permission") {
                        notify("inklit", `${t.slug} needs a permission change`, {
                            sound: "Basso",
                        });
                    }
                    else if (t.state === "waiting") {
                        notifiedIdleRef.current.delete(t.slug);
                        notify("inklit", `${t.slug} is waiting for input`);
                    }
                    else if (t.state === "idle") {
                        if (!notifiedIdleRef.current.has(t.slug)) {
                            notifiedIdleRef.current.add(t.slug);
                            notify("inklit", `${t.slug} stopped — review when ready`);
                        }
                    }
                    else if (t.state === "ready") {
                        notifiedIdleRef.current.delete(t.slug);
                        notify("inklit", `${t.slug} is ready for review`, { sound: "" });
                    }
                    else if (t.state === "failed") {
                        notifiedIdleRef.current.delete(t.slug);
                        notify("inklit", `${t.slug} failed`, { sound: "Basso" });
                    }
                }
                const nextStates = new Map();
                for (const t of finalTasks)
                    nextStates.set(t.slug, t.state);
                prevStatesRef.current = nextStates;
                if (!cancelled) {
                    dispatch({
                        type: "tasks/loaded",
                        tasks: finalTasks,
                        agents,
                        mainVersion,
                    });
                }
            }
            catch (err) {
                if (!cancelled) {
                    dispatch({
                        type: "tasks/error",
                        message: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            finally {
                running = false;
                if (queued && !cancelled) {
                    queued = false;
                    void run();
                    return;
                }
                schedule();
            }
        };
        refreshProjectRef.current = () => {
            if (running)
                queued = true;
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            void run();
        };
        void run();
        return () => {
            cancelled = true;
            refreshProjectRef.current = () => { };
            if (timer)
                clearTimeout(timer);
        };
    }, []);
    // Throttled pane-screen sampler. The selected pane gets near-live updates;
    // background panes are scanned round-robin for waiting/idle detection.
    useEffect(() => {
        let cancelled = false;
        let timer = null;
        const due = (task, intervalMs, now) => {
            const cached = screenCacheRef.current.get(task.slug);
            if (!cached || cached.paneId !== task.paneId)
                return true;
            return now - cached.lastDumpMs >= intervalMs;
        };
        const queueBackground = (tasks, selectedSlug, now) => {
            const background = tasks.filter((t) => t.slug !== selectedSlug);
            if (background.length === 0)
                return null;
            for (let i = 0; i < background.length; i++) {
                const idx = (backgroundScanIndexRef.current + i) % background.length;
                const task = background[idx];
                if (!task || !due(task, BACKGROUND_SCREEN_POLL_MS, now))
                    continue;
                backgroundScanIndexRef.current = (idx + 1) % background.length;
                return task;
            }
            return null;
        };
        const updateTail = (slug, screen, prevScreen) => {
            const tail = screenTail(screen);
            if (tail === screenTail(prevScreen ?? ""))
                return;
            dispatch({ type: "inspector/data", slug, key: "agent", value: tail });
        };
        const tick = async () => {
            const now = Date.now();
            const selectedSlug = latestSelectedSlugRef.current;
            const live = latestTasksRef.current.filter((t) => t.paneId && isLivePane(t.state));
            const selected = live.find((t) => t.slug === selectedSlug) ?? null;
            const toDump = [];
            if (selected && due(selected, SELECTED_SCREEN_POLL_MS, now)) {
                toDump.push(selected);
            }
            const background = queueBackground(live, selectedSlug, now);
            if (background)
                toDump.push(background);
            for (const task of toDump) {
                if (!task.paneId)
                    continue;
                const prev = screenCacheRef.current.get(task.slug);
                const screen = await dumpScreen(task.paneId, {
                    timeoutMs: DUMP_SCREEN_TIMEOUT_MS,
                });
                if (cancelled)
                    return;
                if (!screen)
                    continue;
                screenCacheRef.current.set(task.slug, {
                    paneId: task.paneId,
                    screen,
                    lastDumpMs: Date.now(),
                });
                if (task.slug === latestSelectedSlugRef.current) {
                    updateTail(task.slug, screen, prev?.screen);
                }
            }
            if (!cancelled)
                timer = setTimeout(tick, SCREEN_TICK_MS);
        };
        tick();
        return () => {
            cancelled = true;
            if (timer)
                clearTimeout(timer);
        };
    }, []);
    // Background review-stat sampler. It updates the compact board indicators
    // without making the main project poll wait on per-worktree git probes.
    useEffect(() => {
        let cancelled = false;
        let timer = null;
        const due = (task, now) => {
            if (task.state === "merged")
                return false;
            const cached = reviewStatsRef.current.get(task.slug);
            return !cached || now - cached.lastProbeMs >= REVIEW_STATS_POLL_MS;
        };
        const queueBackground = (tasks, selectedSlug, now) => {
            const background = tasks.filter((t) => t.slug !== selectedSlug);
            if (background.length === 0)
                return null;
            for (let i = 0; i < background.length; i++) {
                const idx = (reviewScanIndexRef.current + i) % background.length;
                const task = background[idx];
                if (!task || !due(task, now))
                    continue;
                reviewScanIndexRef.current = (idx + 1) % background.length;
                return task;
            }
            return null;
        };
        const tick = async () => {
            const now = Date.now();
            const tasks = latestTasksRef.current.filter((t) => t.state !== "merged");
            const selectedSlug = latestSelectedSlugRef.current;
            const selected = tasks.find((t) => t.slug === selectedSlug) ?? null;
            const toProbe = [];
            if (selected && due(selected, now))
                toProbe.push(selected);
            const background = queueBackground(tasks, selectedSlug, now);
            if (background && !toProbe.some((t) => t.slug === background.slug)) {
                toProbe.push(background);
            }
            for (const task of toProbe) {
                const stats = await gitReviewStats(task.path, targetBranch);
                if (cancelled)
                    return;
                reviewStatsRef.current.set(task.slug, {
                    stats,
                    lastProbeMs: Date.now(),
                });
                dispatch({ type: "task/reviewStats", slug: task.slug, stats });
            }
            if (!cancelled)
                timer = setTimeout(tick, REVIEW_STATS_TICK_MS);
        };
        void tick();
        return () => {
            cancelled = true;
            if (timer)
                clearTimeout(timer);
        };
    }, [targetBranch]);
    // If the user switches to an already-sampled agent pane, show the cached tail
    // immediately instead of waiting for the next selected-pane sampler tick.
    useEffect(() => {
        const slug = state.selectedSlug;
        if (!slug || state.inspectorMode !== "agent")
            return;
        const cached = screenCacheRef.current.get(slug);
        if (!cached?.screen)
            return;
        const tail = screenTail(cached.screen);
        const existing = state.content.get(slug)?.agent;
        if (existing !== tail) {
            dispatch({ type: "inspector/data", slug, key: "agent", value: tail });
        }
    }, [state.selectedSlug, state.inspectorMode, state.content]);
    // Legacy path for batches supplied by the project poll. Usually empty now:
    // screen sampling moved out of the main refresh loop to avoid input stalls.
    useEffect(() => {
        for (const [slug, text] of state.agentTails) {
            // Only the last N lines to keep state small.
            const tail = screenTail(text);
            const existing = state.content.get(slug)?.agent;
            if (existing !== tail) {
                dispatch({ type: "inspector/data", slug, key: "agent", value: tail });
            }
        }
    }, [state.agentTails]);
    // Fetch inspector content for the selection on mode change / selection change.
    useEffect(() => {
        const slug = state.selectedSlug;
        if (!slug)
            return;
        const task = state.tasks.find((t) => t.slug === slug);
        if (!task)
            return;
        const mode = state.inspectorMode;
        if (mode === "task")
            return;
        if (mode === "agent")
            return; // fed by poll loop
        const cacheKey = `${slug}:${mode}`;
        const last = fetchedRef.current.get(cacheKey) ?? 0;
        const now = Date.now();
        // Refetch every 3s for the visible mode.
        if (now - last < 3000)
            return;
        fetchedRef.current.set(cacheKey, now);
        let cancelled = false;
        dispatch({ type: "inspector/loading", loading: true });
        (async () => {
            try {
                if (mode === "diff") {
                    const value = await gitDiff(task.path, targetBranch);
                    if (!cancelled)
                        dispatch({ type: "inspector/data", slug, key: "diff", value });
                }
                else if (mode === "log") {
                    const value = await gitLog(task.path, targetBranch);
                    if (!cancelled)
                        dispatch({ type: "inspector/data", slug, key: "log", value });
                }
                else if (mode === "files") {
                    const value = await gitFiles(task.path, targetBranch);
                    if (!cancelled)
                        dispatch({ type: "inspector/data", slug, key: "files", value });
                }
            }
            finally {
                if (!cancelled)
                    dispatch({ type: "inspector/loading", loading: false });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [state.selectedSlug, state.inspectorMode, state.tasks, targetBranch]);
    // Flash auto-clear.
    useEffect(() => {
        if (!state.flash)
            return;
        const id = setTimeout(() => dispatch({ type: "flash", message: null }), 2000);
        return () => clearTimeout(id);
    }, [state.flash]);
    // Error auto-clear.
    useEffect(() => {
        if (!state.error)
            return;
        const id = setTimeout(() => dispatch({ type: "error", message: null }), 8000);
        return () => clearTimeout(id);
    }, [state.error]);
    useInput((input, key) => {
        // Prompts handle their own input.
        if (state.mode === "newTaskDescription") {
            if (key.escape)
                dispatch({ type: "mode/list" });
            return;
        }
        if (state.mode === "newTaskAgent") {
            if (key.escape)
                dispatch({ type: "mode/list" });
            if (input === "c")
                void doSpawn(state.pendingDescription, "claude");
            if (input === "x")
                void doSpawn(state.pendingDescription, "codex");
            return;
        }
        if (state.mode === "spawning")
            return;
        if (state.mode === "merging" ||
            state.mode === "syncing" ||
            state.mode === "killing" ||
            state.mode === "closingAll") {
            return;
        }
        if (state.mode === "resuming")
            return;
        if (state.mode === "sending")
            return;
        if (state.mode === "help") {
            // Any of ?, esc, q (or Ctrl-C) closes. Other keys ignored so a
            // mistyped action while reading doesn't trigger something
            // destructive in the background.
            if (input === "?" ||
                input === "q" ||
                key.escape ||
                (key.ctrl && input === "c")) {
                dispatch({ type: "mode/list" });
            }
            return;
        }
        if (state.mode === "sendInput") {
            // TextInput handles its own keystrokes; we just trap escape to bail.
            if (key.escape)
                dispatch({ type: "mode/list" });
            return;
        }
        if (state.mode === "filter") {
            // TextInput handles search text. Escape leaves the active filter in
            // place; clear it by deleting the query.
            if (key.escape || (key.ctrl && input === "c")) {
                dispatch({ type: "mode/list" });
            }
            return;
        }
        if (state.mode === "commandPalette") {
            if (key.escape || input === ":") {
                dispatch({ type: "mode/list" });
                return;
            }
            const command = key.return ? "enter" : input;
            if (command && runPaletteCommand(command))
                return;
            dispatch({ type: "flash", message: `Unknown command: ${command}` });
            return;
        }
        if (state.mode === "resumeAgentPicker") {
            if (key.escape)
                dispatch({ type: "mode/list" });
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
                if (slug)
                    void doMerge(slug);
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
                if (slug)
                    void doKill(slug);
                return;
            }
            if (input === "n" || input === "N" || key.escape) {
                dispatch({ type: "mode/list" });
                return;
            }
            return;
        }
        if (state.mode === "confirmCloseAll") {
            if (input === "y" || input === "Y") {
                void doCloseAllPanes();
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
            doQuit();
            return;
        }
        if (input === "Q") {
            if (!inSess) {
                dispatch({
                    type: "flash",
                    message: "Not in zellij — no agent panes to close.",
                });
                return;
            }
            dispatch({ type: "mode/confirmCloseAll" });
            return;
        }
        if (input === "/") {
            dispatch({ type: "mode/filter" });
            return;
        }
        if (input === ":") {
            dispatch({ type: "mode/commandPalette" });
            return;
        }
        if (input === "r") {
            refreshBoard();
            return;
        }
        if (input === "v") {
            toggleDensity();
            return;
        }
        if (input === "z") {
            toggleArchivedVisibility();
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
            requestNewTask();
            return;
        }
        if (input === "T" || input === "1" || input === "2") {
            startFollowUp(input === "2" ? 1 : 0);
            return;
        }
        if (key.return) {
            requestFocusOrResume();
            return;
        }
        // Inspector mode toggles.
        if (input === "t") {
            dispatch({ type: "inspector/setMode", mode: "task" });
            return;
        }
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
            requestApplySelected();
            return;
        }
        if (input === "s") {
            const slug = state.selectedSlug;
            if (slug)
                void doSync(slug);
            return;
        }
        if (input === "X") {
            requestKillSelected();
            return;
        }
        if (input === "A") {
            void doArchiveSelected();
            return;
        }
        if (input === "i") {
            requestSendSelected();
            return;
        }
        if (input === "?") {
            dispatch({ type: "mode/help" });
            return;
        }
    }, { isActive: true });
    const visibleTasks = visibleTasksFor(state.tasks, state.filterQuery, state.showArchived);
    const selectedTask = state.tasks.find((t) => t.slug === state.selectedSlug) ?? null;
    function startFollowUp(index) {
        const task = state.tasks.find((t) => t.slug === state.selectedSlug) ?? null;
        const followUp = suggestedFollowUps(task)[index];
        if (!task || !followUp) {
            dispatch({
                type: "flash",
                message: "No suggested next task for this selection.",
            });
            return;
        }
        if (!inSess) {
            dispatch({
                type: "flash",
                message: "Not in zellij — launch inklit inside a zellij session.",
            });
            return;
        }
        dispatch({ type: "mode/newTaskAgent", description: followUp.prompt });
    }
    function refreshBoard() {
        fetchedRef.current.clear();
        dispatch({ type: "flash", message: "Refreshing task board…" });
        refreshProjectRef.current();
    }
    function toggleDensity() {
        const next = state.listDensity === "compact" ? "detailed" : "compact";
        densityTouchedRef.current = true;
        dispatch({ type: "list/toggleDensity" });
        recordListDensity(next).catch(() => { });
        dispatch({ type: "flash", message: `Task board: ${next}` });
    }
    function toggleArchivedVisibility() {
        const next = !state.showArchived;
        dispatch({ type: "archive/toggleVisibility" });
        dispatch({
            type: "flash",
            message: next ? "Showing archived tasks." : "Hiding archived tasks.",
        });
    }
    function requestNewTask() {
        if (!inSess) {
            dispatch({
                type: "flash",
                message: "Not in zellij - launch inklit inside a zellij session.",
            });
            return;
        }
        dispatch({ type: "mode/newTaskDescription" });
    }
    function requestFocusOrResume() {
        const slug = state.selectedSlug;
        if (!slug)
            return;
        if (!inSess) {
            dispatch({
                type: "flash",
                message: "Not in zellij - focus/resume disabled.",
            });
            return;
        }
        const task = state.tasks.find((t) => t.slug === slug);
        if (task?.state === "merged") {
            dispatch({ type: "flash", message: `${slug} is already applied.` });
            return;
        }
        if (task && isLivePane(task.state)) {
            const focusP = task.paneId ? focusPaneId(task.paneId) : focusPaneByName(slug);
            focusP.then((ok) => {
                if (!ok)
                    void enterResume(slug);
            });
        }
        else {
            void enterResume(slug);
        }
    }
    function requestApplySelected() {
        if (!state.selectedSlug)
            return;
        const task = state.tasks.find((t) => t.slug === state.selectedSlug);
        if (task?.state === "merged") {
            dispatch({
                type: "flash",
                message: `${state.selectedSlug} is already applied.`,
            });
            return;
        }
        dispatch({ type: "mode/confirmMerge" });
    }
    function requestKillSelected() {
        if (!state.selectedSlug)
            return;
        const task = state.tasks.find((t) => t.slug === state.selectedSlug);
        if (task?.state === "merged") {
            dispatch({
                type: "flash",
                message: `${state.selectedSlug} is already applied.`,
            });
            return;
        }
        dispatch({ type: "mode/confirmKill" });
    }
    function requestSendSelected() {
        const slug = state.selectedSlug;
        if (!slug)
            return;
        if (!inSess) {
            dispatch({
                type: "flash",
                message: "Not in zellij - send disabled.",
            });
            return;
        }
        const task = state.tasks.find((t) => t.slug === slug);
        if (!task || !isLivePane(task.state)) {
            dispatch({
                type: "flash",
                message: `Cannot send: ${slug} has no live pane.`,
            });
            return;
        }
        dispatch({ type: "mode/sendInput" });
    }
    function runPaletteCommand(input) {
        if (input === "n")
            requestNewTask();
        else if (input === "r") {
            dispatch({ type: "mode/list" });
            refreshBoard();
        }
        else if (input === "/")
            dispatch({ type: "mode/filter" });
        else if (input === "v") {
            dispatch({ type: "mode/list" });
            toggleDensity();
        }
        else if (input === "z") {
            dispatch({ type: "mode/list" });
            toggleArchivedVisibility();
        }
        else if (input === "enter") {
            dispatch({ type: "mode/list" });
            requestFocusOrResume();
        }
        else if (input === "i")
            requestSendSelected();
        else if (input === "m")
            requestApplySelected();
        else if (input === "X")
            requestKillSelected();
        else if (input === "A")
            void doArchiveSelected();
        else if (input === "T" || input === "1")
            startFollowUp(0);
        else if (input === "2")
            startFollowUp(1);
        else if (input === "t") {
            dispatch({ type: "mode/list" });
            dispatch({ type: "inspector/setMode", mode: "task" });
        }
        else if (input === "f") {
            dispatch({ type: "mode/list" });
            dispatch({ type: "inspector/setMode", mode: "files" });
        }
        else if (input === "d") {
            dispatch({ type: "mode/list" });
            dispatch({ type: "inspector/setMode", mode: "diff" });
        }
        else if (input === "l") {
            dispatch({ type: "mode/list" });
            dispatch({ type: "inspector/setMode", mode: "log" });
        }
        else if (input === "a") {
            dispatch({ type: "mode/list" });
            dispatch({ type: "inspector/setMode", mode: "agent" });
        }
        else if (input === "?")
            dispatch({ type: "mode/help" });
        else
            return false;
        return true;
    }
    /**
     * Pick any live agent pane as the stack anchor. Excludes a slug we're
     * about to operate on (resume) so we don't anchor onto a pane that's
     * about to be replaced.
     */
    function pickStackAnchor(excludeSlug) {
        for (const t of state.tasks) {
            if (excludeSlug && t.slug === excludeSlug)
                continue;
            if (!t.paneId)
                continue;
            if (isLivePane(t.state))
                return t.paneId;
        }
        return null;
    }
    async function doSpawn(description, agent) {
        dispatch({ type: "mode/spawning" });
        try {
            const res = await spawnAgent({
                description,
                agent,
                base: targetBranch === "main" ? undefined : targetBranch,
                anchorPaneId: pickStackAnchor(),
            });
            dispatch({ type: "mode/list" });
            dispatch({ type: "flash", message: `Spawned ${res.slug} (${agent})` });
        }
        catch (err) {
            dispatch({ type: "mode/list" });
            dispatch({
                type: "error",
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    async function doMerge(slug) {
        const task = state.tasks.find((t) => t.slug === slug);
        if (!task)
            return;
        dispatch({ type: "mode/merging" });
        try {
            await mergeToMain(task.path, targetBranch);
            await recordLifecycle(slug, "done", snapshotTask(task)).catch(() => { });
            const mergedTask = {
                ...task,
                state: "merged",
                lifecycle: "done",
                lifecycleAt: Date.now(),
                paneId: undefined,
                dirty: false,
                review: { files: 0, commitsAhead: 0, untracked: 0 },
            };
            completedTasksRef.current.set(slug, {
                task: mergedTask,
                untilMs: Date.now() + MERGED_FADE_MS,
            });
            reviewStatsRef.current.delete(slug);
            dispatch({ type: "task/merged", slug, task: mergedTask });
            dispatch({ type: "mode/list" });
            dispatch({ type: "flash", message: `Applied ${slug} → ${targetBranch}` });
        }
        catch (err) {
            dispatch({ type: "mode/list" });
            const base = err instanceof Error ? err.message : String(err);
            const firstStderrLine = err.stderr
                ?.split("\n")
                .map((l) => l.replace(/^[✗✓◎→↳\s]+/, "").trim())
                .find((l) => l.length > 0);
            dispatch({
                type: "error",
                message: firstStderrLine ? `${base}: ${firstStderrLine}` : base,
            });
        }
    }
    async function doSync(slug) {
        const task = state.tasks.find((t) => t.slug === slug);
        if (!task)
            return;
        dispatch({ type: "mode/syncing" });
        try {
            await syncFromMain(task.path, targetBranch);
            dispatch({ type: "mode/list" });
            dispatch({ type: "flash", message: `Synced ${targetBranch} → ${slug}` });
        }
        catch (err) {
            dispatch({ type: "mode/list" });
            const base = err instanceof Error ? err.message : String(err);
            const firstStderrLine = err.stderr
                ?.split("\n")
                .map((l) => l.replace(/^[✗✓◎→↳\s]+/, "").trim())
                .find((l) => l.length > 0);
            dispatch({
                type: "error",
                message: firstStderrLine ? `${base}: ${firstStderrLine}` : base,
            });
        }
    }
    async function doArchiveSelected() {
        const slug = state.selectedSlug;
        if (!slug)
            return;
        const task = state.tasks.find((t) => t.slug === slug);
        if (!task)
            return;
        const archived = lifecycleForTask(task) === "archived";
        if (!archived && isLivePane(task.state)) {
            dispatch({
                type: "flash",
                message: "Archive is only available after a task is ready, failed, or applied.",
            });
            return;
        }
        const nextLifecycle = archived ? null : "archived";
        const lifecycleAt = Date.now();
        try {
            await recordLifecycle(slug, nextLifecycle, nextLifecycle ? snapshotTask(task) : undefined);
            dispatch({
                type: "task/lifecycle",
                slug,
                lifecycle: nextLifecycle ?? undefined,
                lifecycleAt: nextLifecycle ? lifecycleAt : undefined,
            });
            dispatch({ type: "mode/list" });
            dispatch({
                type: "flash",
                message: archived ? `Restored ${slug}` : `Archived ${slug}`,
            });
        }
        catch (err) {
            dispatch({ type: "mode/list" });
            dispatch({
                type: "error",
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    function doQuit() {
        // Replit-style background model: leaving the dashboard does not kill
        // agents. Use explicit `Q` when you intentionally want to close panes.
        exit();
    }
    async function collectAgentPaneIds() {
        // Build the close set from EVERY signal we have, not just in-memory
        // state — the poll loop's "is this pane live?" detection is fragile
        // (title rewrites, stale paneIds) and we'd rather over-close than
        // leak panes when the user explicitly asks to close all. The union of:
        //   - in-memory task.paneId for live tasks
        //   - state-file recorded paneIds (catches panes inklit spawned
        //     even if the poll loop has lost track of them)
        //   - zellij panes whose cwd matches any current worktree path
        //     (catches panes whose recorded paneId is stale but the agent
        //     is still running in the worktree)
        const toClose = new Set();
        for (const t of state.tasks) {
            if (t.paneId && isLivePane(t.state))
                toClose.add(t.paneId);
        }
        try {
            const records = await loadAll();
            const snapshot = await panesSnapshot();
            for (const slug of Object.keys(records)) {
                const pid = records[slug]?.paneId;
                if (pid && snapshot.byId.has(pid))
                    toClose.add(pid);
            }
            for (const t of state.tasks) {
                const cwdHit = snapshot.byCwd.get(t.path);
                if (cwdHit)
                    toClose.add(cwdHit.paneId);
            }
        }
        catch {
            /* best-effort augmentation; fall through with whatever we have */
        }
        return toClose;
    }
    async function doCloseAllPanes() {
        if (closingAllRef.current)
            return;
        closingAllRef.current = true;
        dispatch({ type: "mode/closingAll" });
        try {
            const toClose = await collectAgentPaneIds();
            if (toClose.size === 0) {
                dispatch({ type: "mode/list" });
                dispatch({ type: "flash", message: "No live agent panes found." });
                return;
            }
            // Sequential — zellij re-arranges layout per close, and parallel calls
            // produced inconsistent results in informal testing.
            for (const id of toClose) {
                try {
                    await closePaneById(id);
                }
                catch {
                    /* swallow */
                }
            }
            await focusOwnPane().catch(() => false);
            dispatch({ type: "mode/list" });
            dispatch({
                type: "flash",
                message: `Closed ${toClose.size} live agent pane${toClose.size === 1 ? "" : "s"}.`,
            });
        }
        catch (err) {
            dispatch({ type: "mode/list" });
            dispatch({
                type: "error",
                message: err instanceof Error ? err.message : String(err),
            });
        }
        finally {
            closingAllRef.current = false;
        }
    }
    async function doSendInput(slug, text) {
        dispatch({ type: "mode/sending" });
        try {
            const task = state.tasks.find((t) => t.slug === slug);
            const ok = task?.paneId
                ? await sendKeysToPaneId(task.paneId, text)
                : await sendKeysToSlug(slug, text);
            dispatch({ type: "mode/list" });
            if (ok) {
                const preview = text.length > 30 ? text.slice(0, 30) + "…" : text;
                dispatch({
                    type: "flash",
                    message: `→ ${slug}: ${preview || "(enter)"}`,
                });
            }
            else {
                dispatch({
                    type: "error",
                    message: `Could not send to ${slug} — pane may have closed.`,
                });
            }
        }
        catch (err) {
            dispatch({ type: "mode/list" });
            dispatch({
                type: "error",
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    async function doKill(slug) {
        dispatch({ type: "mode/killing" });
        try {
            if (inSess) {
                const task = state.tasks.find((t) => t.slug === slug);
                if (task?.paneId) {
                    await closePaneById(task.paneId);
                }
                else {
                    // Legacy slug or not yet observed — fall back to title lookup.
                    await closePaneByName(slug);
                }
            }
            await removeWorktree(slug);
            // Drop the state-file entry so a future task with the same slug
            // doesn't inherit the wrong agent kind.
            recordRemove(slug).catch(() => { });
            dispatch({ type: "mode/list" });
            dispatch({ type: "flash", message: `Killed ${slug}` });
        }
        catch (err) {
            dispatch({ type: "mode/list" });
            dispatch({
                type: "error",
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    async function enterResume(slug) {
        const recorded = await getAgent(slug);
        if (recorded) {
            void doResume(slug, recorded);
            return;
        }
        // Unrecorded slug — happens for tasks created before inklit (or
        // outside it). Ask the user which agent to relaunch.
        dispatch({ type: "mode/resumeAgentPicker", slug });
    }
    async function doResume(slug, agent) {
        dispatch({ type: "mode/resuming" });
        try {
            await resumeAgent({
                slug,
                agent,
                anchorPaneId: pickStackAnchor(slug),
            });
            dispatch({ type: "mode/list" });
            dispatch({
                type: "flash",
                message: `Resumed ${slug} (${agent})`,
            });
        }
        catch (err) {
            dispatch({ type: "mode/list" });
            dispatch({
                type: "error",
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    const showConfirm = state.mode === "confirmMerge" ||
        state.mode === "confirmKill" ||
        state.mode === "confirmCloseAll" ||
        state.mode === "merging" ||
        state.mode === "syncing" ||
        state.mode === "killing" ||
        state.mode === "closingAll";
    const showSendInput = state.mode === "sendInput" || state.mode === "sending";
    const showFilter = state.mode === "filter";
    // Bordered prompt + title + hint + input/confirm row. The explicit slot
    // prevents Ink from letting prompt rows overlap the inspector.
    const bottomStripHeight = showConfirm || showSendInput || showFilter ? 7 : 0;
    const desiredListHeight = taskListLineCount(visibleTasks, state.tasks.length, state.filterQuery, state.listDensity);
    const minimumListHeight = taskListMinimumHeight(visibleTasks, state.tasks.length, state.filterQuery, state.listDensity);
    const preferredListHeight = Math.max(minimumListHeight, Math.floor(rows * (state.listDensity === "compact" ? 0.5 : 0.42)));
    const availableListHeight = Math.max(4, rows - bottomStripHeight - 8 - 2);
    const listHeight = Math.max(4, Math.min(desiredListHeight, preferredListHeight, availableListHeight));
    const inspectorHeight = Math.max(8, rows - listHeight - bottomStripHeight - 2);
    // Same formula as Inspector — the reducer needs it so it can clamp scrolls.
    const inspectorMaxLines = Math.max(3, inspectorHeight - 6);
    const content = getContent(state, state.selectedSlug);
    const offsetForView = state.selectedSlug
        ? resolveOffset(state.inspectorOffsets.get(scrollKey(state.selectedSlug, state.inspectorMode)), state.inspectorMode, totalLinesFor(state), inspectorMaxLines)
        : 0;
    if (state.mode === "help") {
        return (React.createElement(Box, { flexDirection: "column", height: rows },
            React.createElement(Box, { paddingX: 1 },
                React.createElement(Text, { bold: true, color: UI.accent }, "inklit"),
                React.createElement(Text, { dimColor: true }, " \u2014 parallel agents in worktrees")),
            React.createElement(Box, { flexGrow: 1, flexDirection: "column" },
                React.createElement(HelpOverlay, { targetBranch: targetBranch })),
            React.createElement(StatusBar, { flash: state.flash, error: state.error, taskCount: state.tasks.length, selectedTask: selectedTask, inSession: inSess, filterQuery: state.filterQuery, visibleTaskCount: visibleTasks.length, density: state.listDensity, showArchived: state.showArchived, width: cols - 2 })));
    }
    return (React.createElement(Box, { flexDirection: "column", height: rows },
        React.createElement(MainVersionBar, { mainVersion: state.mainVersion, targetBranch: targetBranch, tasks: state.tasks, visibleTaskCount: visibleTasks.length, filterQuery: state.filterQuery, width: cols - 2 }),
        React.createElement(Box, { flexDirection: "column", height: listHeight },
            React.createElement(TaskList, { tasks: visibleTasks, selectedSlug: state.selectedSlug, totalTasks: state.tasks.length, filterQuery: state.filterQuery, density: state.listDensity, width: cols - 2, height: listHeight })),
        React.createElement(Box, { flexGrow: 1, flexDirection: "column" }, state.mode === "newTaskDescription" ? (React.createElement(DescriptionPrompt, { value: state.newTaskDescription, onChange: (v) => dispatch({ type: "newTask/setDescription", value: v }), onSubmit: (v) => {
                const trimmed = v.trim();
                if (!trimmed) {
                    dispatch({ type: "mode/list" });
                    return;
                }
                dispatch({ type: "mode/newTaskAgent", description: trimmed });
            }, onCancel: () => dispatch({ type: "mode/list" }) })) : state.mode === "newTaskAgent" ? (React.createElement(AgentPicker, { label: state.pendingDescription, intent: "spawn" })) : state.mode === "resumeAgentPicker" ? (React.createElement(AgentPicker, { label: state.pendingResumeSlug ?? "(unknown)", intent: "resume" })) : state.mode === "spawning" ? (React.createElement(Box, { paddingX: 1 },
            React.createElement(Text, { color: "yellow" }, "spawning\u2026"))) : state.mode === "resuming" ? (React.createElement(Box, { paddingX: 1 },
            React.createElement(Text, { color: "yellow" }, "resuming\u2026"))) : state.mode === "closingAll" ? (React.createElement(Box, { paddingX: 1 },
            React.createElement(Text, { color: "yellow" }, "closing live agent panes\u2026"))) : state.mode === "commandPalette" ? (React.createElement(CommandPalette, { selectedTask: selectedTask, density: state.listDensity, targetBranch: targetBranch, showArchived: state.showArchived, inSession: inSess, height: inspectorHeight, width: cols - 4 })) : (React.createElement(Inspector, { task: selectedTask, mode: state.inspectorMode, targetBranch: targetBranch, diff: content.diff, log: content.log, agent: content.agent, files: content.files, loading: state.inspectorLoading, height: inspectorHeight, width: cols - 4, offset: offsetForView }))),
        bottomStripHeight > 0 ? (React.createElement(Box, { height: bottomStripHeight, flexDirection: "column" }, showConfirm ? (React.createElement(ConfirmPrompt, { action: state.mode === "confirmKill" || state.mode === "killing"
                ? "kill"
                : state.mode === "confirmCloseAll" ||
                    state.mode === "closingAll"
                    ? "closeAll"
                    : "merge", slug: state.mode === "confirmCloseAll" || state.mode === "closingAll"
                ? "live agent panes"
                : state.selectedSlug ?? "", busy: state.mode === "merging" ||
                state.mode === "syncing" ||
                state.mode === "killing" ||
                state.mode === "closingAll", targetBranch: targetBranch })) : showSendInput ? (React.createElement(SendInputPrompt, { slug: state.selectedSlug ?? "", value: state.sendInputValue, busy: state.mode === "sending", onChange: (v) => dispatch({ type: "sendInput/setValue", value: v }), onSubmit: (v) => {
                const slug = state.selectedSlug;
                if (!slug) {
                    dispatch({ type: "mode/list" });
                    return;
                }
                const text = v;
                if (!text.trim()) {
                    dispatch({ type: "mode/list" });
                    return;
                }
                void doSendInput(slug, text);
            } })) : showFilter ? (React.createElement(FilterPrompt, { value: state.filterQuery, matched: visibleTasks.length, total: state.tasks.length, onChange: (v) => dispatch({ type: "filter/set", value: v }), onSubmit: () => dispatch({ type: "mode/list" }) })) : null)) : null,
        React.createElement(StatusBar, { flash: state.flash, error: state.error, taskCount: state.tasks.length, selectedTask: selectedTask, inSession: inSess, filterQuery: state.filterQuery, visibleTaskCount: visibleTasks.length, density: state.listDensity, showArchived: state.showArchived, width: cols - 2 })));
}
//# sourceMappingURL=App.js.map