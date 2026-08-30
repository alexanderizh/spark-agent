/**
 * Return local references held by a persisted video workbench draft.
 * The caller is responsible for decoding safe-file URLs and resolving paths.
 */
export function collectCanvasVideoWorkbenchPaths(data: unknown): string[] {
  if (!data || typeof data !== 'object') return []

  const paths: string[] = []
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.length > 0) paths.push(value)
  }
  const workbench = data as { keyframes?: unknown; outputs?: unknown }

  if (Array.isArray(workbench.keyframes)) {
    for (const keyframe of workbench.keyframes) {
      if (!keyframe || typeof keyframe !== 'object') continue
      const item = keyframe as { path?: unknown; previewUrl?: unknown }
      add(item.path)
      add(item.previewUrl)
    }
  }
  if (Array.isArray(workbench.outputs)) {
    for (const output of workbench.outputs) {
      if (!output || typeof output !== 'object') continue
      const item = output as { outputPath?: unknown; outputUrl?: unknown }
      add(item.outputPath)
      add(item.outputUrl)
    }
  }
  return paths
}
