export const initialState = {
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
    taskOverlaps: new Map(),
    pendingAgentKind: null,
    aiFollowUps: [],
    aiFollowUpSelectedIndex: 0,
};
export function lifecycleForState(state) {
    switch (state) {
        case "running":
        case "waiting":
        case "permission":
        case "idle":
            return "active";
        case "ready":
            return "ready";
        case "merging":
            return "applying";
        case "merged":
            return "done";
        case "failed":
            return "failed";
    }
}
export function lifecycleForTask(task) {
    return task.lifecycle ?? lifecycleForState(task.state);
}
//# sourceMappingURL=model.js.map