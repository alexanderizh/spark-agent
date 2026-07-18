import type { CanvasProject } from '../canvas.types'
import type { CanvasAcceptanceEvidenceEvent } from './canvasAcceptanceEvidence'
import type { CanvasAcceptancePlan } from './canvasAcceptanceTypes'

export type CanvasAcceptancePersistenceResult = {
  persisted: boolean
  path?: string
  error?: string
}

type EvidenceSnapshot = {
  runId: string
  updatedAt: string
  events: CanvasAcceptanceEvidenceEvent[]
}

const writeQueues = new Map<string, Promise<CanvasAcceptancePersistenceResult>>()

export function buildCanvasAcceptanceEvidencePath(rootPath: string, runId: string): string {
  const separator = rootPath.includes('\\') && !rootPath.includes('/') ? '\\' : '/'
  const normalizedRoot = rootPath.replace(/[\\/]+$/, '')
  const safeRunId = runId.replace(/[^a-zA-Z0-9._-]+/g, '_')
  return `${normalizedRoot}${separator}tasks${separator}${safeRunId}.canvas-acceptance.json`
}

export function persistCanvasAcceptanceEvidence(input: {
  project: Pick<CanvasProject, 'id' | 'title' | 'rootPath'>
  plan: CanvasAcceptancePlan
  evidence: EvidenceSnapshot
  now?: () => Date
}): Promise<CanvasAcceptancePersistenceResult> {
  const rootPath = input.project.rootPath?.trim()
  if (!rootPath) {
    return Promise.resolve({ persisted: false, error: 'project_root_path_missing' })
  }
  if (typeof window === 'undefined' || !('spark' in window)) {
    return Promise.resolve({ persisted: false, error: 'desktop_file_bridge_unavailable' })
  }
  const path = buildCanvasAcceptanceEvidencePath(rootPath, input.plan.runId)
  const previous = writeQueues.get(path) ?? Promise.resolve({ persisted: true })
  const queued = previous
    .catch(() => ({ persisted: false }))
    .then(async (): Promise<CanvasAcceptancePersistenceResult> => {
      try {
        const payload = {
          kind: 'spark.canvas.acceptance-evidence',
          version: 2,
          persistedAt: (input.now ?? (() => new Date()))().toISOString(),
          project: {
            id: input.project.id,
            title: input.project.title,
            rootPath,
          },
          plan: input.plan,
          evidence: input.evidence,
        }
        await window.spark.invoke('file:write-text', {
          path,
          content: JSON.stringify(payload, null, 2),
        })
        return { persisted: true, path }
      } catch (error) {
        return {
          persisted: false,
          path,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })
  writeQueues.set(path, queued)
  void queued.finally(() => {
    if (writeQueues.get(path) === queued) writeQueues.delete(path)
  })
  return queued
}
