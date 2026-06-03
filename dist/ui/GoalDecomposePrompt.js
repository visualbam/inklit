import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { UI } from "./theme.js";
import { truncate } from "./text.js";
import { decomposeGoal } from "../ai.js";
import { listRepoFiles } from "../wt.js";
/** Multi-step goal decomposition prompt: input → loading → editable review. */
export function GoalDecomposePrompt({ onSpawnAll, onCancel, width }) {
    const [step, setStep] = useState("input");
    const [goal, setGoal] = useState("");
    const [subtasks, setSubtasks] = useState([]);
    const [selectedIdx, setSelectedIdx] = useState(0);
    const [editingIdx, setEditingIdx] = useState(null);
    const [editValue, setEditValue] = useState("");
    const [error, setError] = useState(null);
    const handleGoalSubmit = async (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
            onCancel();
            return;
        }
        setStep("loading");
        try {
            const files = await listRepoFiles();
            const tasks = await decomposeGoal(trimmed, files, process.cwd());
            if (tasks.length === 0)
                throw new Error("Claude returned no subtasks");
            setSubtasks(tasks);
            setSelectedIdx(0);
            setStep("review");
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setStep("input");
        }
    };
    useInput((input, key) => {
        if (step === "input") {
            if (key.escape)
                onCancel();
            return;
        }
        if (step === "loading")
            return;
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
            if (subtasks.length > 0)
                onSpawnAll(subtasks);
            else
                onCancel();
            return;
        }
    }, { isActive: step !== "input" });
    if (step === "loading") {
        return (React.createElement(Box, { borderStyle: "round", borderColor: UI.accent, paddingX: 1, flexDirection: "column" },
            React.createElement(Text, { bold: true, color: UI.accent }, "Decomposing goal with Claude\u2026"),
            React.createElement(Text, { dimColor: true }, "Asking Claude to break your goal into parallel subtasks.")));
    }
    if (step === "review") {
        return (React.createElement(Box, { borderStyle: "round", borderColor: UI.accent, paddingX: 1, flexDirection: "column" },
            React.createElement(Text, { bold: true, color: UI.accent },
                "Review subtasks (",
                subtasks.length,
                ")"),
            React.createElement(Text, { dimColor: true }, "j/k select \u00B7 e edit \u00B7 d delete \u00B7 y/enter spawn all \u00B7 esc cancel"),
            React.createElement(Box, { marginTop: 1, flexDirection: "column" }, subtasks.map((task, i) => {
                const isSelected = i === selectedIdx;
                const isEditing = editingIdx === i;
                return (React.createElement(Box, { key: i },
                    React.createElement(Text, { color: isSelected ? UI.accent : undefined, bold: isSelected }, isSelected ? "▸ " : "  "),
                    React.createElement(Text, { dimColor: true },
                        i + 1,
                        ". "),
                    isEditing ? (React.createElement(TextInput, { value: editValue, onChange: setEditValue, onSubmit: (v) => {
                            const trimmed = v.trim();
                            if (trimmed) {
                                const next = [...subtasks];
                                next[i] = trimmed;
                                setSubtasks(next);
                            }
                            setEditingIdx(null);
                            setEditValue("");
                        } })) : (React.createElement(Text, { color: isSelected ? "white" : undefined }, truncate(task, width - 10)))));
            }))));
    }
    // Input step
    return (React.createElement(Box, { borderStyle: "round", borderColor: UI.accent, paddingX: 1, flexDirection: "column" },
        React.createElement(Text, { bold: true, color: UI.accent }, "Decompose goal into parallel tasks"),
        React.createElement(Text, { dimColor: true }, "Enter a high-level goal. Claude will break it into 3-5 subtasks."),
        error ? React.createElement(Text, { color: UI.danger }, error) : null,
        React.createElement(Box, { marginTop: 1 },
            React.createElement(Text, { color: UI.accent }, ">  "),
            React.createElement(TextInput, { value: goal, onChange: setGoal, onSubmit: handleGoalSubmit })),
        React.createElement(Text, { dimColor: true }, "enter continue \u00B7 esc cancel")));
}
//# sourceMappingURL=GoalDecomposePrompt.js.map