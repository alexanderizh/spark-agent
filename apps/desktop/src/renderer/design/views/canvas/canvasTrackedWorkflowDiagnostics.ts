export type CanvasTrackedWorkflowDiagnostics = {
  modelOutputText?: string | null
  rawResponse?: unknown
  agentId?: string | null
  providerProfileId?: string | null
  provider?: string | null
  modelId?: string | null
}

export type CaptureCanvasTrackedWorkflowDiagnostics = (
  diagnostics: CanvasTrackedWorkflowDiagnostics,
) => void

/** Keep the latest field values while a multi-step workflow progresses. */
export function mergeCanvasTrackedWorkflowDiagnostics(
  current: CanvasTrackedWorkflowDiagnostics,
  next: CanvasTrackedWorkflowDiagnostics,
): CanvasTrackedWorkflowDiagnostics {
  return { ...current, ...next }
}
