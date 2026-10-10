type WorkspaceState = {
  generating: boolean;
  restoring: boolean;
  generationError: string | null;
  previewError: string | null;
  hasPreview: boolean;
  previewReady: boolean;
};

export function workspaceStatus(state: WorkspaceState) {
  if (state.generating)
    return {
      tone: "working",
      label: "Working",
      heading: state.hasPreview
        ? "Updating your application"
        : "Bringing your idea to life",
      announcement: "Generating application",
    } as const;
  if (state.restoring)
    return {
      tone: "working",
      label: "Restoring",
      heading: "Saving restored version",
      announcement: "Saving restored version",
    } as const;
  if (state.generationError)
    return {
      tone: "error",
      label: "Error",
      heading: "Generation failed",
      announcement: "Generation failed",
    } as const;
  if (state.previewError)
    return {
      tone: "error",
      label: "Preview error",
      heading: "Preview could not run",
      announcement: "Preview could not run. Open Preview for recovery options.",
    } as const;
  if (state.hasPreview && !state.previewReady)
    return {
      tone: "working",
      label: "Loading",
      heading: "Loading your preview",
      announcement: "Application generated. Loading preview.",
    } as const;
  return {
    tone: "ready",
    label: "Ready",
    heading: state.hasPreview ? "Application ready" : "Ready when you are",
    announcement: state.hasPreview
      ? "Preview running — application ready"
      : "Ready for a description",
  } as const;
}
