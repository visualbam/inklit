import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { UI } from "./theme.js";
import { truncate } from "./text.js";
import { decomposeGoal } from "../ai.js";
import { listRepoFiles } from "../wt.js";

type Step = "input" | "loading" | "review";

interface Props {
  onSpawnAll: (subtasks: string[]) => void;
  onCancel: () => void;
  width: number;
}

/** Multi-step goal decomposition prompt: input → loading → editable review. */
export function GoalDecomposePrompt({ onSpawnAll, onCancel, width }: Props) {
  const [step, setStep] = useState<Step>("input");
  const [goal, setGoal] = useState("");
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleGoalSubmit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    setStep("loading");
    try {
      const files = await listRepoFiles();
      const tasks = await decomposeGoal(trimmed, files);
      if (tasks.length === 0) throw new Error("Claude returned no subtasks");
      setSubtasks(tasks);
      setSelectedIdx(0);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("input");
    }
  };

  useInput(
    (input, key) => {
      if (step === "input") {
        if (key.escape) onCancel();
        return;
      }
      if (step === "loading") return;

      // Review step
      if (editingIdx !== null) {
        if (key.escape) {
          setEditingIdx(null);
          setEditValue("");
        }
        // TextInput handles enter/change; we handle escape here
        return;
      }

      if (key.escape) {
        onCancel();
        return;
      }
      if (input === "j" || key.downArrow) {
        setSelectedIdx((i) => Math.min(subtasks.length - 1, i + 1));
        return;
      }
      if (input === "k" || key.upArrow) {
        setSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (input === "d") {
        const next = subtasks.filter((_, i) => i !== selectedIdx);
        setSubtasks(next);
        setSelectedIdx((i) => Math.min(next.length - 1, i));
        return;
      }
      if (input === "e") {
        setEditValue(subtasks[selectedIdx] ?? "");
        setEditingIdx(selectedIdx);
        return;
      }
      if (input === "y" || key.return) {
        if (subtasks.length > 0) onSpawnAll(subtasks);
        else onCancel();
        return;
      }
    },
    { isActive: step !== "input" }
  );

  if (step === "loading") {
    return (
      <Box borderStyle="round" borderColor={UI.accent} paddingX={1} flexDirection="column">
        <Text bold color={UI.accent}>Decomposing goal with Claude…</Text>
        <Text dimColor>Asking Claude to break your goal into parallel subtasks.</Text>
      </Box>
    );
  }

  if (step === "review") {
    return (
      <Box borderStyle="round" borderColor={UI.accent} paddingX={1} flexDirection="column">
        <Text bold color={UI.accent}>
          Review subtasks ({subtasks.length})
        </Text>
        <Text dimColor>
          j/k select · e edit · d delete · y/enter spawn all · esc cancel
        </Text>
        <Box marginTop={1} flexDirection="column">
          {subtasks.map((task, i) => {
            const isSelected = i === selectedIdx;
            const isEditing = editingIdx === i;
            return (
              <Box key={i}>
                <Text color={isSelected ? UI.accent : undefined} bold={isSelected}>
                  {isSelected ? "▸ " : "  "}
                </Text>
                <Text dimColor>{i + 1}. </Text>
                {isEditing ? (
                  <TextInput
                    value={editValue}
                    onChange={setEditValue}
                    onSubmit={(v) => {
                      const trimmed = v.trim();
                      if (trimmed) {
                        const next = [...subtasks];
                        next[i] = trimmed;
                        setSubtasks(next);
                      }
                      setEditingIdx(null);
                      setEditValue("");
                    }}
                  />
                ) : (
                  <Text color={isSelected ? "white" : undefined}>
                    {truncate(task, width - 10)}
                  </Text>
                )}
              </Box>
            );
          })}
        </Box>
      </Box>
    );
  }

  // Input step
  return (
    <Box borderStyle="round" borderColor={UI.accent} paddingX={1} flexDirection="column">
      <Text bold color={UI.accent}>Decompose goal into parallel tasks</Text>
      <Text dimColor>
        Enter a high-level goal. Claude will break it into 3-5 subtasks.
      </Text>
      {error ? <Text color={UI.danger}>{error}</Text> : null}
      <Box marginTop={1}>
        <Text color={UI.accent}>{">  "}</Text>
        <TextInput value={goal} onChange={setGoal} onSubmit={handleGoalSubmit} />
      </Box>
      <Text dimColor>enter continue · esc cancel</Text>
    </Box>
  );
}
