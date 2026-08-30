import { describe, expect, it } from 'vitest'
import type { CanvasSnapshot, CanvasTask } from '../canvas.types'
import {
  appendCanvasAcceptanceRunnerEvidence,
  buildCanvasAcceptanceEvidenceEvent,
  captureCanvasAcceptanceTaskEvidence,
  sanitizeEvidence,
  summarizeCanvasAcceptanceEvidence,
} from './canvasAcceptanceEvidence'
import type { CanvasAcceptanceCasePlan, CanvasAcceptancePlan } from './canvasAcceptanceTypes'

const casePlan: CanvasAcceptanceCasePlan = {
  caseId: 'W1-SCREENPLAY',
  stageId: 'W1_SCREENPLAY',
  nodeRef: 'screenplay',
  title: '🧪 [W1] 小说转分场剧本',
  operation: 'text_rewrite',
  targetKind: 'text',
  dependsOnCaseIds: [],
  target: {
    kind: 'text',
    providerProfileId: 'provider-1',
    providerName: 'Provider',
    modelId: 'model-1',
    displayName: 'Model',
    capabilities: [],
  },
  blockedReasons: [],
  expectedEvidence: ['actual_request', 'model_output'],
}

function task(overrides: Partial<CanvasTask> = {}): CanvasTask {
  return {
    id: 'task-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 0,
    operation: 'text_rewrite',
    status: 'completed',
    progress: 100,
    title: casePlan.title,
    operationNodeId: 'node-1',
    prompt: 'prompt',
    negativePrompt: null,
    inputNodeIds: ['source-1'],
    inputAssetIds: ['asset-source'],
    outputNodeIds: ['output-1'],
    outputAssetIds: ['asset-output'],
    providerProfileId: 'provider-1',
    manifestId: null,
    modelId: 'model-1',
    provider: 'openai-compatible',
    modelParams: {},
    modelOutputText: '完整剧本',
    requestCall: {
      method: 'POST',
      url: 'https://example.test/v1/chat/completions',
      headers: { authorization: 'Bearer secret-value' },
      body: { image: `data:image/png;base64,${'A'.repeat(600)}` },
      response: { status: 200 },
    },
    runtimeEvents: [{ at: '', kind: 'completed', label: '完成' }],
    createdAt: '',
    updatedAt: '',
    completedAt: '',
    ...overrides,
  }
}

function snapshot(nextTask: CanvasTask): CanvasSnapshot {
  return {
    project: {
      id: 'project-1',
      userId: 0,
      title: '验收',
      status: 'active',
      metadata: { projectKind: 'acceptance' },
      nodeCount: 2,
      assetCount: 1,
      taskCount: 1,
      createdAt: '',
      updatedAt: '',
    },
    board: {
      id: 'board-1',
      projectId: 'project-1',
      userId: 0,
      name: 'run',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: '',
      updatedAt: '',
    },
    nodes: [
      {
        id: 'output-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 0,
        type: 'text',
        assetId: 'asset-output',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        zIndex: 1,
        locked: false,
        hidden: false,
        data: {},
        createdAt: '',
        updatedAt: '',
      },
    ],
    edges: [],
    assets: [
      {
        id: 'asset-output',
        projectId: 'project-1',
        userId: 0,
        type: 'text',
        source: 'ai_generated',
        contentText: '完整剧本',
        metadata: {},
        createdAt: '',
        updatedAt: '',
      },
    ],
    tasks: [nextTask],
  }
}

describe('canvas acceptance evidence', () => {
  it('captures successful call, model output and canvas materialization assertions', () => {
    const nextTask = task()
    const plan = { cases: [casePlan] } as CanvasAcceptancePlan
    const event = buildCanvasAcceptanceEvidenceEvent({
      snapshot: snapshot(nextTask),
      task: nextTask,
      context: {
        runId: 'run-1',
        boardId: 'board-1',
        plan,
        caseNodeIds: { 'W1-SCREENPLAY': 'node-1' },
        casePlan,
      },
      source: 'text-stream',
      sequence: 1,
      now: () => new Date('2026-07-18T00:00:00.000Z'),
    })
    expect(event.observabilityGap).toBe(false)
    expect(event.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'evidence.actual_call', status: 'passed' }),
        expect.objectContaining({ id: 'text.model_output', status: 'passed' }),
        expect.objectContaining({ id: 'canvas.output_materialized', status: 'passed' }),
      ]),
    )
    expect(JSON.stringify(event.providerCall)).not.toContain('secret-value')
    expect(JSON.stringify(event.providerCall)).toContain('[REDACTED]')
    expect(JSON.stringify(event.providerCall)).toContain('base64 omitted')
  })

  it('reports an observability gap when a failed task has no error or trace', () => {
    const failed = task({
      status: 'failed',
      requestCall: null,
      rawResponse: null,
      runtimeEvents: [],
      errorMsg: null,
      errorDetail: null,
      outputNodeIds: [],
      outputAssetIds: [],
      modelOutputText: null,
    })
    const event = buildCanvasAcceptanceEvidenceEvent({
      snapshot: snapshot(failed),
      task: failed,
      context: {
        runId: 'run-1',
        boardId: 'board-1',
        plan: { cases: [casePlan] } as CanvasAcceptancePlan,
        caseNodeIds: { 'W1-SCREENPLAY': 'node-1' },
        casePlan,
      },
      source: 'text-stream',
      sequence: 1,
    })
    expect(event.observabilityGap).toBe(true)
    expect(event.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'evidence.failure_detail', status: 'failed' }),
        expect.objectContaining({ id: 'evidence.failure_trace', status: 'failed' }),
      ]),
    )
  })

  it('redacts nested credential-shaped fields and large base64 blocks', () => {
    expect(
      sanitizeEvidence({
        nested: { apiKey: 'abc', value: 'A'.repeat(600), completionTokens: 128 },
      }),
    ).toEqual({
      nested: {
        apiKey: '[REDACTED]',
        value: '[base64 omitted chars=600]',
        completionTokens: 128,
      },
    })
  })

  it('redacts signed URL queries, bearer tokens and circular arrays', () => {
    const circular: unknown[] = []
    circular.push(circular)
    expect(
      sanitizeEvidence({
        url: 'https://cdn.example.test/result.mp4?token=secret#fragment',
        error: 'request failed: Bearer top-secret at https://api.example.test/run?api_key=secret',
        circular,
      }),
    ).toEqual({
      url: 'https://cdn.example.test/result.mp4?[REDACTED]',
      error:
        'request failed: Bearer [REDACTED] at https://api.example.test/run?[REDACTED]',
      circular: ['[Circular]'],
    })
  })

  it('summarizes the latest event of each case instead of double counting stream updates', () => {
    const nextTask = task()
    const context = {
      runId: 'run-1',
      boardId: 'board-1',
      plan: { cases: [casePlan] } as CanvasAcceptancePlan,
      caseNodeIds: { 'W1-SCREENPLAY': 'node-1' },
      casePlan,
    }
    const runningTask = task({ status: 'running', outputNodeIds: [], outputAssetIds: [] })
    const running = buildCanvasAcceptanceEvidenceEvent({
      snapshot: snapshot(runningTask),
      task: runningTask,
      context,
      source: 'text-stream',
      sequence: 1,
    })
    const completed = buildCanvasAcceptanceEvidenceEvent({
      snapshot: snapshot(nextTask),
      task: nextTask,
      context,
      source: 'text-stream',
      sequence: 2,
    })
    expect(summarizeCanvasAcceptanceEvidence([running, completed])).toMatchObject({
      totalEvents: 2,
      observedCases: 1,
      passedCases: 1,
      failedCases: 0,
    })
  })

  it('builds queryable preflight failure evidence before a provider call exists', () => {
    const originalWindow = globalThis.window
    const values = new Map<string, string>()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
        },
      },
    })
    try {
      const event = appendCanvasAcceptanceRunnerEvidence({
        runId: 'run-preflight',
        casePlan,
        taskStatus: 'pending',
        stage: 'preflight_blocked',
        preCall: { providerProfileId: 'provider-1' },
        assertions: [
          { id: 'preflight.manifest', status: 'failed', message: 'missing_manifest_id' },
        ],
        now: () => new Date('2026-07-18T00:00:00.000Z'),
      })
      expect(event).toMatchObject({
        stage: 'preflight_blocked',
        taskId: 'preflight:W1-SCREENPLAY',
      })
      expect(values.size).toBe(1)
    } finally {
      if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
    }
  })

  it('keeps evidence sequence monotonic after the retained event window is full', () => {
    const originalWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: { getItem: () => null, setItem: () => undefined } },
    })
    try {
      let lastSequence = 0
      for (let index = 0; index < 602; index += 1) {
        const event = appendCanvasAcceptanceRunnerEvidence({
          runId: 'run-sequence-window',
          casePlan,
          taskStatus: 'pending',
          stage: 'preflight_passed',
          assertions: [],
        })
        lastSequence = event?.sequence ?? 0
      }
      expect(lastSequence).toBe(602)
    } finally {
      if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
    }
  })

  it('resolves evidence context for an older acceptance Run Board', () => {
    const originalWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: { getItem: () => null, setItem: () => undefined } },
    })
    try {
      const nextTask = task()
      const oldSnapshot = snapshot(nextTask)
      oldSnapshot.project.metadata = {
        projectKind: 'acceptance',
        latestAcceptanceRun: {
          runId: 'run-new',
          boardId: 'board-new',
          caseNodeIds: {},
          plan: { cases: [] },
        },
        acceptanceRuns: [
          {
            runId: 'run-old',
            boardId: 'board-1',
            caseNodeIds: { 'W1-SCREENPLAY': 'node-1' },
            plan: { cases: [casePlan] },
          },
        ],
      }
      const event = captureCanvasAcceptanceTaskEvidence({
        snapshot: oldSnapshot,
        taskId: nextTask.id,
        source: 'text-stream',
      })
      expect(event?.runId).toBe('run-old')
    } finally {
      if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
    }
  })
})
