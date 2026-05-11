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

interface Props {
  tasks: Task[];
  selectedSlug: string | null;
  totalTasks: number;
  filterQuery: string;
  density: TaskListDensity;
  width: number;
  height: number;
}

export function TaskList({
  tasks,
  selectedSlug,
  totalTasks,
  filterQuery,
  density,
  width,
  height,
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
  const targetRows = Math.min(tasks.length, density === "compact" ? 3 : 4);
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
}: Omit<Props, "density" | "height" | "tasks"> & {
  tasks: Task[];
  matchedTaskCount: number;
  hiddenAbove: number;
  hiddenBelow: number;
}) {
  // Reserve roughly: rail+icon + stage + pane + age + review + spacing.
  const reviewCol = 18;
  const fixed = 55 + reviewCol;
  const slugCol = Math.max(10, Math.floor((width - fixed) * 0.34));
  const subjectCol = Math.max(8, width - fixed - slugCol - 2);
  const divider = "─".repeat(Math.max(0, width - 2));
  let currentGroup: string | null = null;

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text dimColor>
          {pad("", 4)} {pad("task", slugCol)} {pad("subject", subjectCol)}{" "}
          {pad("stage", 8)} {pad("pane", 9)} {pad("review", reviewCol)}{" "}
          {pad("age", 5)}
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text dimColor>{divider}</Text>
      </Box>
      {hiddenAbove > 0 ? <HiddenMarker count={hiddenAbove} direction="above" /> : null}
      {tasks.map((t) => {
        const group = groupForTask(t);
        const showGroup = group.key !== currentGroup;
        currentGroup = group.key;
        const sel = t.slug === selectedSlug;
        const icon = STATE_ICON[t.state];
        const color = STATE_COLOR[t.state];
        const stateLabel = formatStateLabel(t);
        const lifecycle = lifecycleForTask(t);
        const lifecycleLabel = LIFECYCLE_LABEL[lifecycle];
        const lifecycleColor = LIFECYCLE_COLOR[lifecycle];
        return (
          <React.Fragment key={t.slug}>
            {showGroup ? <GroupHeader group={group} /> : null}
            <Box paddingX={1}>
              <Text>
                <Text color={sel ? UI.accent : UI.subtle}>
                  {sel ? "▌" : " "}
                </Text>
                <Text> </Text>
                <Text bold={sel} color={color}>
                  {icon}
                </Text>
                <Text> </Text>
                <Text bold={sel}>
                  {pad(t.slug, slugCol)}{" "}
                </Text>
                <Text bold={sel} dimColor={!sel}>
                  {pad(t.error ?? t.subject, subjectCol)}
                </Text>
                <Text> </Text>
                <Text bold={sel} color={lifecycleColor}>
                  {pad(lifecycleLabel, 8)}
                </Text>
                <Text> </Text>
                <Text bold={sel} color={color}>
                  {pad(stateLabel, 9)}
                </Text>
                <Text> </Text>
                <Text bold={sel}>
                  <ReviewBadges task={t} maxWidth={reviewCol} />
                  {pad("", Math.max(0, reviewCol - reviewSummary(t).length))}
                </Text>
                <Text> </Text>
                <Text bold={sel} dimColor={!sel}>
                  {pad(formatAge(t.ageSeconds), 5)}
                </Text>
              </Text>
            </Box>
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

function CompactTaskList({
  tasks,
  selectedSlug,
  totalTasks,
  filterQuery,
  matchedTaskCount,
  hiddenAbove,
  hiddenBelow,
  width,
}: Omit<Props, "density" | "height" | "tasks"> & {
  tasks: Task[];
  matchedTaskCount: number;
  hiddenAbove: number;
  hiddenBelow: number;
}) {
  let currentGroup: string | null = null;
  const subjectWidth = Math.max(8, width - 28);
  return (
    <Box flexDirection="column">
      {hiddenAbove > 0 ? <HiddenMarker count={hiddenAbove} direction="above" /> : null}
      {tasks.map((t) => {
        const group = groupForTask(t);
        const showGroup = group.key !== currentGroup;
        currentGroup = group.key;
        const sel = t.slug === selectedSlug;
        const color = STATE_COLOR[t.state];
        const lifecycle = lifecycleForTask(t);
        const meta = `${LIFECYCLE_LABEL[lifecycle]} · ${formatStateLabel(t)} · ${formatAge(t.ageSeconds)}`;
        return (
          <React.Fragment key={t.slug}>
            {showGroup ? <GroupHeader group={group} /> : null}
            <Box paddingX={1}>
              <Text>
                <Text color={sel ? UI.accent : UI.subtle}>{sel ? "▌" : " "}</Text>
                <Text> </Text>
                <Text bold={sel} color={color}>
                  {STATE_ICON[t.state]}
                </Text>
                <Text> </Text>
                <Text bold={sel}>{truncate(t.slug, 18)}</Text>
                <Text dimColor={!sel}> {truncate(t.error ?? t.subject, subjectWidth)}</Text>
              </Text>
            </Box>
            <Box paddingX={1}>
              <Text>
                <Text color={sel ? UI.accent : UI.subtle}> </Text>
                <Text dimColor>   {truncate(meta, 28)} · </Text>
                <ReviewBadges task={t} maxWidth={Math.max(12, width - 38)} />
              </Text>
            </Box>
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
        Agents run in zellij panes; quitting this board leaves them running.
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
      return { key: "permission", label: "Permission", color: UI.danger };
    case "waiting":
      return { key: "waiting", label: "Waiting", color: UI.warning };
    case "running":
      return { key: "running", label: "Running", color: UI.accent };
    case "idle":
      return { key: "idle", label: "Idle", color: UI.info };
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
