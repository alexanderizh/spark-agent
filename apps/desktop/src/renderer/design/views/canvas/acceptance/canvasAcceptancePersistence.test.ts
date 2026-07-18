import { describe, expect, it, vi } from 'vitest'
import {
  buildCanvasAcceptanceEvidencePath,
  persistCanvasAcceptanceEvidence,
} from './canvasAcceptancePersistence'
import type { CanvasAcceptancePlan } from './canvasAcceptanceTypes'

describe('canvas acceptance persistence', () => {
  it('builds a safe evidence path inside the guaranteed project tasks directory', () => {
    expect(buildCanvasAcceptanceEvidencePath('/tmp/project/', 'run:1/test')).toBe(
      '/tmp/project/tasks/run_1_test.canvas-acceptance.json',
    )
    expect(buildCanvasAcceptanceEvidencePath('C:\\work\\project\\', 'run-1')).toBe(
      'C:\\work\\project\\tasks\\run-1.canvas-acceptance.json',
    )
  })

  it('writes a versioned evidence snapshot through the existing desktop bridge', async () => {
    const originalWindow = globalThis.window
    const invoke = vi.fn(async () => ({ success: true }))
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { spark: { invoke } },
    })
    try {
      const result = await persistCanvasAcceptanceEvidence({
        project: { id: 'project-1', title: '验收', rootPath: '/tmp/project' },
        plan: { runId: 'run-1', cases: [] } as unknown as CanvasAcceptancePlan,
        evidence: { runId: 'run-1', updatedAt: '', events: [] },
        now: () => new Date('2026-07-19T00:00:00.000Z'),
      })
      expect(result).toEqual({
        persisted: true,
        path: '/tmp/project/tasks/run-1.canvas-acceptance.json',
      })
      expect(invoke).toHaveBeenCalledWith(
        'file:write-text',
        expect.objectContaining({
          path: '/tmp/project/tasks/run-1.canvas-acceptance.json',
          content: expect.stringContaining('spark.canvas.acceptance-evidence'),
        }),
      )
    } finally {
      if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
    }
  })
})
