import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SparkDatabase } from '../database.js'
import { CanvasProjectRepository } from './canvas.repository.js'
import { CanvasWorkflowRepository } from './canvas-workflow.repository.js'
import {
  CanvasWorkflowRunRepository,
  CanvasWorkflowVersionRepository,
} from './canvas-workflow-runtime.repository.js'

const workflowPackage = {
  schemaVersion: 1,
  graph: {
    nodes: [
      {
        id: 'generate',
        kind: 'canvas_operation',
        label: '生成',
        position: { x: 0, y: 0 },
        config: { operation: 'text_to_image' },
      },
      {
        id: 'output',
        kind: 'canvas_output',
        label: '输出',
        position: { x: 240, y: 0 },
        config: {},
      },
    ],
    edges: [{ id: 'edge-1', sourceNodeId: 'generate', targetNodeId: 'output' }],
  },
  contract: { inputs: [], outputs: [], exposedParams: [] },
  dependencies: { modelCapabilities: ['text_to_image'], canvasNodeKinds: ['operation'] },
}

function createTestDb(testDir: string): SparkDatabase {
  const db = new SparkDatabase(join(testDir, 'test.db'))
  db.runMigrations(join(process.cwd(), 'migrations'))
  return db
}

describe('canvas workflow runtime repositories', () => {
  let db: SparkDatabase
  let versions: CanvasWorkflowVersionRepository
  let runs: CanvasWorkflowRunRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-test-canvas-workflow-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    new CanvasProjectRepository(db).upsert({ id: 'project-1', title: 'Project 1' })
    new CanvasWorkflowRepository(db).create({
      id: 'workflow-1',
      projectId: 'project-1',
      name: '生成主视觉',
      scope: 'project',
      packageJson: workflowPackage,
    })
    versions = new CanvasWorkflowVersionRepository(db)
    runs = new CanvasWorkflowRunRepository(db)
    versions.create({
      workflowId: 'workflow-1',
      version: 1,
      name: '生成主视觉',
      packageJson: workflowPackage,
      createdAt: '2026-07-23T10:00:00.000Z',
    })
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('stores immutable workflow version snapshots', () => {
    expect(() =>
      versions.create({
        workflowId: 'workflow-1',
        version: 1,
        name: '覆盖历史',
        packageJson: { ...workflowPackage, graph: { nodes: [], edges: [] } },
      }),
    ).toThrow()
    expect(versions.get('workflow-1', 1)?.name).toBe('生成主视觉')
  })

  it('persists canvas runs and steps outside Agent workflow_runs', () => {
    const agentCountBefore = db.raw
      .prepare('SELECT COUNT(*) AS count FROM workflow_runs')
      .get() as { count: number }

    runs.create({
      id: 'run-1',
      workflowId: 'workflow-1',
      workflowVersion: 1,
      projectId: 'project-1',
      inputsJson: { theme: '海边日落' },
      exposedParamsJson: { count: 1 },
      idempotencyKey: 'project-1:workflow-1:request-1',
      createdAt: '2026-07-23T10:00:00.000Z',
    })
    runs.createSteps('run-1', [
      { id: 'step-generate', nodeId: 'generate', stepIndex: 0, dependsOnNodeIds: [] },
      { id: 'step-output', nodeId: 'output', stepIndex: 1, dependsOnNodeIds: ['generate'] },
    ])

    expect(runs.get('run-1')?.status).toBe('queued')
    expect(runs.listSteps('run-1').map((step) => step.status)).toEqual(['ready', 'blocked'])
    const agentCountAfter = db.raw.prepare('SELECT COUNT(*) AS count FROM workflow_runs').get() as {
      count: number
    }
    expect(agentCountAfter.count).toBe(agentCountBefore.count)
  })

  it('returns an existing run for the same idempotency key', () => {
    const first = runs.create({
      id: 'run-1',
      workflowId: 'workflow-1',
      workflowVersion: 1,
      projectId: 'project-1',
      inputsJson: {},
      exposedParamsJson: {},
      idempotencyKey: 'same-request',
    })
    const second = runs.create({
      id: 'run-2',
      workflowId: 'workflow-1',
      workflowVersion: 1,
      projectId: 'project-1',
      inputsJson: {},
      exposedParamsJson: {},
      idempotencyKey: 'same-request',
    })

    expect(second.id).toBe(first.id)
    expect(runs.list({ projectId: 'project-1' })).toHaveLength(1)
  })

  it('reports whether a workflow has immutable run history', () => {
    expect(runs.hasRunsForWorkflow('workflow-1')).toBe(false)
    runs.create({
      id: 'run-history',
      workflowId: 'workflow-1',
      workflowVersion: 1,
      projectId: 'project-1',
      inputsJson: {},
      exposedParamsJson: {},
      idempotencyKey: 'history-request',
    })

    expect(runs.hasRunsForWorkflow('workflow-1')).toBe(true)
  })

  it('hard deletes a project together with its workflow versions and run history', () => {
    runs.create({
      id: 'run-to-delete',
      workflowId: 'workflow-1',
      workflowVersion: 1,
      projectId: 'project-1',
      inputsJson: {},
      exposedParamsJson: {},
      idempotencyKey: 'project-delete-request',
    })
    runs.createSteps('run-to-delete', [
      { id: 'step-to-delete', nodeId: 'generate', stepIndex: 0, dependsOnNodeIds: [] },
    ])

    expect(() => new CanvasProjectRepository(db).hardDelete('project-1')).not.toThrow()

    expect(new CanvasProjectRepository(db).get('project-1')).toBeNull()
    expect(new CanvasWorkflowRepository(db).get('workflow-1')).toBeNull()
    expect(versions.get('workflow-1', 1)).toBeNull()
    expect(runs.get('run-to-delete')).toBeNull()
  })

  it('rolls back a run when step creation fails', () => {
    let transactionBodyEntered = false
    expect(() =>
      runs.withTransaction(() => {
        transactionBodyEntered = true
        runs.create({
          id: 'run-atomic',
          workflowId: 'workflow-1',
          workflowVersion: 1,
          projectId: 'project-1',
          inputsJson: {},
          exposedParamsJson: {},
          idempotencyKey: 'atomic-request',
        })
        runs.createSteps('run-atomic', [
          { id: 'duplicate-step', nodeId: 'first', stepIndex: 0, dependsOnNodeIds: [] },
          { id: 'duplicate-step', nodeId: 'second', stepIndex: 1, dependsOnNodeIds: [] },
        ])
      }),
    ).toThrow(/UNIQUE/)

    expect(transactionBodyEntered).toBe(true)
    expect(runs.get('run-atomic')).toBeNull()
  })

  it('retries only a failed step and preserves completed outputs', () => {
    runs.create({
      id: 'run-1',
      workflowId: 'workflow-1',
      workflowVersion: 1,
      projectId: 'project-1',
      inputsJson: {},
      exposedParamsJson: {},
      idempotencyKey: 'retry-request',
    })
    runs.createSteps('run-1', [
      { id: 'step-generate', nodeId: 'generate', stepIndex: 0, dependsOnNodeIds: [] },
      { id: 'step-output', nodeId: 'output', stepIndex: 1, dependsOnNodeIds: ['generate'] },
    ])
    runs.updateStep('run-1', 'generate', {
      status: 'completed',
      outputJson: { assetId: 'asset-1' },
      finishedAt: '2026-07-23T10:01:00.000Z',
    })
    runs.updateStep('run-1', 'output', {
      status: 'failed',
      errorJson: { code: 'materialize_failed', message: '写入失败' },
      finishedAt: '2026-07-23T10:02:00.000Z',
    })

    const retried = runs.retryFailedStep('run-1', 'output', '2026-07-23T10:03:00.000Z')

    expect(retried?.status).toBe('ready')
    expect(retried?.attempt).toBe(2)
    expect(retried?.error_json).toBeNull()
    expect(runs.getStep('run-1', 'generate')?.output_json).toBe(
      JSON.stringify({ assetId: 'asset-1' }),
    )
  })

  it('cancels only unfinished steps and can resume a failed run', () => {
    runs.create({
      id: 'run-1',
      workflowId: 'workflow-1',
      workflowVersion: 1,
      projectId: 'project-1',
      inputsJson: {},
      exposedParamsJson: {},
      idempotencyKey: 'cancel-request',
    })
    runs.createSteps('run-1', [
      { id: 'step-generate', nodeId: 'generate', stepIndex: 0, dependsOnNodeIds: [] },
      { id: 'step-output', nodeId: 'output', stepIndex: 1, dependsOnNodeIds: ['generate'] },
    ])
    runs.updateStep('run-1', 'generate', { status: 'completed', outputJson: { value: 'ok' } })

    runs.cancel('run-1', '2026-07-23T10:04:00.000Z')
    expect(runs.get('run-1')?.status).toBe('cancelled')
    expect(runs.getStep('run-1', 'generate')?.status).toBe('completed')
    expect(runs.getStep('run-1', 'output')?.status).toBe('cancelled')

    runs.updateRun('run-1', { status: 'failed', errorJson: { code: 'interrupted' } })
    const resumed = runs.resume('run-1', '2026-07-23T10:05:00.000Z')
    expect(resumed?.status).toBe('running')
    expect(runs.getStep('run-1', 'generate')?.status).toBe('completed')
    expect(runs.getStep('run-1', 'output')?.status).toBe('ready')
    expect(runs.getStep('run-1', 'output')?.attempt).toBe(2)
  })

  it('releases satisfied dependencies and reconciles the final run state', () => {
    runs.create({
      id: 'run-1',
      workflowId: 'workflow-1',
      workflowVersion: 1,
      projectId: 'project-1',
      inputsJson: {},
      exposedParamsJson: {},
      idempotencyKey: 'reconcile-request',
    })
    runs.createSteps('run-1', [
      { id: 'step-generate', nodeId: 'generate', stepIndex: 0, dependsOnNodeIds: [] },
      { id: 'step-output', nodeId: 'output', stepIndex: 1, dependsOnNodeIds: ['generate'] },
    ])

    runs.updateStep('run-1', 'generate', { status: 'completed', outputJson: { value: 'ok' } })
    expect(runs.releaseReadySteps('run-1')).toEqual(['output'])
    expect(runs.getStep('run-1', 'output')?.status).toBe('ready')
    expect(runs.reconcileStatus('run-1')?.status).toBe('running')

    runs.updateStep('run-1', 'output', { status: 'completed', outputJson: { assetId: 'a1' } })
    expect(runs.reconcileStatus('run-1')?.status).toBe('completed')
    expect(runs.get('run-1')?.finished_at).not.toBeNull()
  })
})
