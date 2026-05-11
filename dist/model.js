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
        case "merged":
            return "done";
        case "failed":
            return "cancelled";
    }
}
export function lifecycleForTask(task) {
    return task.lifecycle ?? lifecycleForState(task.state);
}
//# sourceMappingURL=model.js.map