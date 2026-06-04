import React from "react";
import { Box, Text } from "ink";
import type { Task, TaskListDensity } from "../model.js";
import { lifecycleForTask } from "../model.js";
import {
  STATE_ICON,
  STATE_COLOR,
  LIFECYCLE_LABEL,
  LIFECYCLE_COLOR,
  formatStateLabel,
  formatAge,
} from "./icons.js";
import { UI } from "./theme.js";
import { ReviewBadges, reviewSummary } from "./review.js";
import { truncate } from "./text.js";

const DETAIL_LEADING_COL = 4;
const DETAIL_STAGE_COL = 8;
const DETAIL_PANE_COL = 9;
const DETAIL_REVIEW_COL = 18;
const DETAIL_OVERLAP_COL = 2;
const DETAIL_COLUMN_GAP = 3;

interface Props {
  tasks: Task[];
  selectedSlug: string | null;
  totalTasks: number;
  filterQuery: string;
  density: TaskListDensity;
  width: number;
  height: number;
  /** Maps task slug to list of conflicting slugs (file overlap with another ready task). */
  overlaps?: Map<string, string[]>;
}

export function TaskList({
  tasks,
  selectedSlug,
  totalTasks,
  filterQuery,
  density,
  width,
  height,
  overlaps,
}: Props) {
  if (tasks.length === 0) {
    return <EmptyBoard filterQuery={filterQuery} totalTasks={totalTasks} />;
  }

  const windowed = windowTasks({
    tasks,
    selectedSlug,
    totalTasks,
    filterQuery,
    density,
    height,
  });

  return density === "compact" ? (
    <CompactTaskList
      tasks={windowed.tasks}
      selectedSlug={selectedSlug}
      totalTasks={totalTasks}
      filterQuery={filterQuery}
      matchedTaskCount={tasks.length}
      hiddenAbove={windowed.hiddenAbove}
      hiddenBelow={windowed.hiddenBelow}
      width={width}
      overlaps={overlaps}
    />
  ) : (
    <DetailedTaskList
      tasks={windowed.tasks}
      selectedSlug={selectedSlug}
      totalTasks={totalTasks}
      filterQuery={filterQuery}
      matchedTaskCount={tasks.length}
      hiddenAbove={windowed.hiddenAbove}
      hiddenBelow={windowed.hiddenBelow}
      width={width}
      overlaps={overlaps}
    />
  );
}

export function taskListLineCount(
  tasks: Task[],
  totalTasks: number,
  filterQuery: string,
  density: TaskListDensity
): number {
  if (tasks.length === 0) return filterQuery.trim() ? 4 : 6;
  const groupCount = countGroups(tasks);
  const filterFooter = filterQuery.trim() && tasks.length < totalTasks ? 1 : 0;
  if (density === "compact") return groupCount + tasks.length * 2 + filterFooter;
  return 2 + groupCount + tasks.length + filterFooter;
}

export function taskListMinimumHeight(
  tasks: Task[],
  totalTasks: number,
  filterQuery: string,
  density: TaskListDensity
): number {
  if (tasks.length === 0) return filterQuery.trim() ? 4 : 6;
  const targetRows = Math.min(tasks.length, 5);
  const sample = tasks.slice(0, targetRows);
  const hasOverflow = tasks.length > targetRows;
  return taskListLineCountForSlice({
    tasks: sample,
    totalTasks,
    matchedTaskCount: tasks.length,
    filterQuery,
    density,
    hiddenAbove: false,
    hiddenBelow: hasOverflow,
  });
}

interface WindowTasksArgs {
  tasks: Task[];
  selectedSlug: string | null;
  totalTasks: number;
  filterQuery: string;
  density: TaskListDensity;
  height: number;
}

interface WindowedTasks {
  tasks: Task[];
  hiddenAbove: number;
  hiddenBelow: number;
}

function windowTasks({
  tasks,
  selectedSlug,
  totalTasks,
  filterQuery,
  density,
  height,
}: WindowTasksArgs): WindowedTasks {
  if (
    taskListLineCountForSlice({
      tasks,
      totalTasks,
      matchedTaskCount: tasks.length,
      filterQuery,
      density,
      hiddenAbove: false,
      hiddenBelow: false,
    }) <= height
  ) {
    return { tasks, hiddenAbove: 0, hiddenBelow: 0 };
  }

  const selectedIndex = Math.max(
    0,
    tasks.findIndex((task) => task.slug === selectedSlug)
  );
  let start = selectedIndex;
  let end = selectedIndex + 1;

  while (start > 0 || end < tasks.length) {
    const visibleAbove = selectedIndex - start;
    const visibleBelow = end - selectedIndex - 1;
    const preferAbove = visibleAbove <= visibleBelow;
    const added = preferAbove
      ? tryGrowWindow("above") || tryGrowWindow("below")
      : tryGrowWindow("below") || tryGrowWindow("above");
    if (added) continue;
    break;
  }

  return {
    tasks: tasks.slice(start, end),
    hiddenAbove: start,
    hiddenBelow: tasks.length - end,
  };

  function tryGrowWindow(direction: "above" | "below"): boolean {
    const nextStart = direction === "above" ? start - 1 : start;
    const nextEnd = direction === "below" ? end + 1 : end;
    if (nextStart < 0 || nextEnd > tasks.length) return false;
    const fits =
      taskListLineCountForSlice({
        tasks: tasks.slice(nextStart, nextEnd),
        totalTasks,
        matchedTaskCount: tasks.length,
        filterQuery,
        density,
        hiddenAbove: nextStart > 0,
        hiddenBelow: nextEnd < tasks.length,
      }) <= height;
    if (!fits) return false;
    start = nextStart;
    end = nextEnd;
    return true;
  }
}

function taskListLineCountForSlice({
  tasks,
  totalTasks,
  matchedTaskCount,
  filterQuery,
  density,
  hiddenAbove,
  hiddenBelow,
}: {
  tasks: Task[];
  totalTasks: number;
  matchedTaskCount: number;
  filterQuery: string;
  density: TaskListDensity;
  hiddenAbove: boolean;
  hiddenBelow: boolean;
}): number {
  const filterFooter = filterQuery.trim() && matchedTaskCount < totalTasks ? 1 : 0;
  const hiddenMarkers = (hiddenAbove ? 1 : 0) + (hiddenBelow ? 1 : 0);
  if (tasks.length === 0) return filterFooter + hiddenMarkers;
  const groupCount = countGroups(tasks);
  const itemLines = density === "compact" ? tasks.length * 2 : tasks.length;
  const headerLines = density === "compact" ? 0 : 2;
  return headerLines + groupCount + itemLines + filterFooter + hiddenMarkers;
}

function DetailedTaskList({
  tasks,
  selectedSlug,
  totalTasks,
  filterQuery,
  matchedTaskCount,
  hiddenAbove,
  hiddenBelow,
  width,
  overlaps,
}: Omit<Props, "density" | "height" | "tasks"> & {
  tasks: Task[];
  matchedTaskCount: number;
  hiddenAbove: number;
  hiddenBelow: number;
}) {
  const contentWidth = Math.max(0, width - 2);
  const fixed =
    DETAIL_LEADING_COL +
    DETAIL_STAGE_COL +
    DETAIL_PANE_COL +
    DETAIL_REVIEW_COL +
    DETAIL_OVERLAP_COL +
    DETAIL_COLUMN_GAP * 4;
  const slugCol = Math.max(10, contentWidth - fixed);
  const gap = " ".repeat(DETAIL_COLUMN_GAP);
  const rule = "╌".repeat(Math.max(0, width - 2));
  let currentGroup: string | null = null;

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text dimColor>
          {pad("", DETAIL_LEADING_COL)}
          {pad("TASK", slugCol)}
          {gap}
          {pad("STAGE", DETAIL_STAGE_COL)}
          {gap}
          {pad("PANE", DETAIL_PANE_COL)}
          {gap}
          {pad("REVIEW", DETAIL_REVIEW_COL)}
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text dimColor>{rule}</Text>
      </Box>
      {hiddenAbove > 0 ? <HiddenMarker count={hiddenAbove} direction="above" /> : null}
      {tasks.map((t) => {
        const group = groupForTask(t);
        const showGroup = group.key !== currentGroup;
        currentGroup = group.key;
        return (
          <React.Fragment key={t.slug}>
            {showGroup ? <GroupHeader group={group} /> : null}
            <DetailedTaskRow
              task={t}
              selectedSlug={selectedSlug}
              slugCol={slugCol}
              overlaps={overlaps}
            />
          </React.Fragment>
        );
      })}
      {hiddenBelow > 0 ? <HiddenMarker count={hiddenBelow} direction="below" /> : null}
      {filterQuery.trim() && matchedTaskCount < totalTasks ? (
        <Box paddingX={1}>
          <Text dimColor>
            showing {matchedTaskCount}/{totalTasks} · clear filter with /
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function DetailedTaskRow({
  task: t,
  selectedSlug,
  slugCol,
  overlaps,
}: {
  task: Task;
  selectedSlug: string | null;
  slugCol: number;
  overlaps?: Map<string, string[]>;
}) {
  const sel = t.slug === selectedSlug;
  const icon = STATE_ICON[t.state];
  const color = STATE_COLOR[t.state];
  const stateLabel = formatStateLabel(t);
  const lifecycle = lifecycleForTask(t);
  const lifecycleLabel = LIFECYCLE_LABEL[lifecycle];
  const lifecycleColor = LIFECYCLE_COLOR[lifecycle];
  const gap = " ".repeat(DETAIL_COLUMN_GAP);
  return (
    <Box paddingX={1}>
      <Text>
        <Text color={sel ? UI.accent : UI.subtle}>{sel ? "▌" : " "}</Text>
        <Text> </Text>
        <Text bold={sel} color={color}>{icon}</Text>
        <Text> </Text>
        <Text bold={sel}>{pad(t.error ?? t.slug, slugCol)}</Text>
        <Text>{gap}</Text>
        <Text bold={sel} color={lifecycleColor}>
          {pad(lifecycleLabel, DETAIL_STAGE_COL)}
        </Text>
        <Text>{gap}</Text>
        <Text bold={sel} color={color}>
          {pad(stateLabel, DETAIL_PANE_COL)}
        </Text>
        <Text>{gap}</Text>
        <Text bold={sel}>
          <ReviewBadges task={t} maxWidth={DETAIL_REVIEW_COL} />
          {pad("", Math.max(0, DETAIL_REVIEW_COL - reviewSummary(t).length))}
        </Text>
        <Text>{gap}</Text>
        <Text color={overlaps?.has(t.slug) ? "yellow" : undefined}>
          {overlaps?.has(t.slug) ? "⚠ " : pad("", DETAIL_OVERLAP_COL)}
        </Text>
      </Text>
    </Box>
  );
}

function CompactTaskList({
  tasks,
  selectedSlug,
  totalTasks,
  filterQuery,
  matchedTaskCount,
  hiddenAbove,
  hiddenBelow,
  width,
  overlaps,
}: Omit<Props, "density" | "height" | "tasks"> & {
  tasks: Task[];
  matchedTaskCount: number;
  hiddenAbove: number;
  hiddenBelow: number;
}) {
  let currentGroup: string | null = null;
  return (
    <Box flexDirection="column">
      {hiddenAbove > 0 ? <HiddenMarker count={hiddenAbove} direction="above" /> : null}
      {tasks.map((t) => {
        const group = groupForTask(t);
        const showGroup = group.key !== currentGroup;
        currentGroup = group.key;
        return (
          <React.Fragment key={t.slug}>
            {showGroup ? <GroupHeader group={group} /> : null}
            <CompactTaskRow task={t} selectedSlug={selectedSlug} width={width} overlaps={overlaps} />
          </React.Fragment>
        );
      })}
      {hiddenBelow > 0 ? <HiddenMarker count={hiddenBelow} direction="below" /> : null}
      {filterQuery.trim() && matchedTaskCount < totalTasks ? (
        <Box paddingX={1}>
          <Text dimColor>
            showing {matchedTaskCount}/{totalTasks} · clear filter with /
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function CompactTaskRow({
  task: t,
  selectedSlug,
  width,
  overlaps,
}: {
  task: Task;
  selectedSlug: string | null;
  width: number;
  overlaps?: Map<string, string[]>;
}) {
  const sel = t.slug === selectedSlug;
  const color = STATE_COLOR[t.state];
  const lifecycle = lifecycleForTask(t);
  const meta = `${LIFECYCLE_LABEL[lifecycle]} · ${formatStateLabel(t)} · ${formatAge(t.ageSeconds)}`;
  return (
    <>
      <Box paddingX={1}>
        <Text>
          <Text color={sel ? UI.accent : UI.subtle}>{sel ? "▌" : " "}</Text>
          <Text> </Text>
          <Text bold={sel} color={color}>{STATE_ICON[t.state]}</Text>
          <Text> </Text>
          <Text bold={sel}>{truncate(t.error ?? t.slug, Math.max(18, width - 28))}</Text>
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text>
          <Text color={sel ? UI.accent : UI.subtle}> </Text>
          <Text dimColor>   {truncate(meta, 28)} · </Text>
          <ReviewBadges task={t} maxWidth={Math.max(12, width - 38)} />
          {overlaps?.has(t.slug) ? <Text color="yellow"> ⚠</Text> : null}
        </Text>
      </Box>
    </>
  );
}

function HiddenMarker({
  count,
  direction,
}: {
  count: number;
  direction: "above" | "below";
}) {
  return (
    <Box paddingX={1}>
      <Text dimColor>
        {direction === "above" ? "↑" : "↓"} {count} task{count === 1 ? "" : "s"}{" "}
        hidden {direction}
      </Text>
    </Box>
  );
}

function EmptyBoard({
  filterQuery,
  totalTasks,
}: {
  filterQuery: string;
  totalTasks: number;
}) {
  const query = filterQuery.trim();
  if (query) {
    return (
      <Box paddingX={1} flexDirection="column">
        <Text>No tasks match "{query}".</Text>
        <Text dimColor>
          Edit with <Text color={UI.accent}>/</Text>, clear the query, or press{" "}
          <Text color={UI.accent}>r</Text> to refresh.
        </Text>
      </Box>
    );
  }
  return (
    <Box paddingX={1} flexDirection="column">
      <Text bold>No agent tasks yet</Text>
      <Text dimColor>
        <Text color={UI.accent}>n</Text> new task · <Text color={UI.accent}>:</Text>{" "}
        command palette · <Text color={UI.accent}>?</Text> help
      </Text>
      <Text dimColor>
        Agents run headlessly in tmux; quitting this board leaves them running.
      </Text>
      {totalTasks > 0 ? (
        <Text dimColor>Archived tasks are hidden. Press z to show them.</Text>
      ) : null}
    </Box>
  );
}

interface TaskGroup {
  key: string;
  label: string;
  color: string;
}

function GroupHeader({ group }: { group: TaskGroup }) {
  return (
    <Box paddingX={1} marginTop={0}>
      <Text color={group.color} bold>
        {group.label}
      </Text>
    </Box>
  );
}

function groupForTask(task: Task): TaskGroup {
  const lifecycle = lifecycleForTask(task);
  if (lifecycle === "archived") {
    return { key: "archived", label: "Archived", color: UI.subtle };
  }
  if (lifecycle === "cancelled") {
    return { key: "cancelled", label: "Cancelled", color: UI.danger };
  }
  switch (task.state) {
    case "permission":
    case "waiting":
    case "running":
    case "idle":
      return { key: "active", label: "Active", color: UI.accent };
    case "merging":
      return { key: "merging", label: "Merging", color: UI.warning };
    case "ready":
      return { key: "ready", label: "Ready", color: UI.success };
    case "failed":
      return { key: "failed", label: "Failed", color: UI.danger };
    case "merged":
      return { key: "done", label: "Done", color: UI.subtle };
  }
}

function countGroups(tasks: Task[]): number {
  let count = 0;
  let current: string | null = null;
  for (const task of tasks) {
    const key = groupForTask(task).key;
    if (key === current) continue;
    current = key;
    count += 1;
  }
  return count;
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}
