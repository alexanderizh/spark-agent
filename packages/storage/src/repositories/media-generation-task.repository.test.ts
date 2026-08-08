import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { SparkDatabase } from '../database.js'
import { MediaGenerationTaskRepository } from './media-generation-task.repository.js'

describe('MediaGenerationTaskRepository recovery state machine', () => {
  let db: SparkDatabase | undefined
  let directory: string | undefined

  afterEach(() => {
    db?.close()
    if (directory) rmSync(directory, { recursive: true, force: true })
    db = undefined
    directory = undefined
  })

  it('atomically claims only the matching failed task without existing assets', () => {
    directory = mkdtempSync(join(tmpdir(), 'spark-media-task-'))
    db = new SparkDatabase(join(directory, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    const repo = new MediaGenerationTaskRepository(db)
    const row = repo.create({
      id: 'task-recovery-1',
      providerProfileId: 'provider-1',
      providerTaskId: 'provider-task-1',
      projectId: 'project-1',
      clientTaskId: 'canvas-task-1',
      operation: 'text_to_video',
      status: 'failed',
      outputDir: '/tmp/media',
      assetsJson: '[]',
    })

    const first = repo.beginRecovery(row.id, 'provider-task-1')
    const second = repo.beginRecovery(row.id, 'provider-task-1')

    expect(first.started).toBe(true)
    expect(second.started).toBe(false)
    expect(second.row?.status).toBe('running')
    expect(repo.getByProviderTaskId('provider-1', 'provider-task-1')?.project_id).toBe('project-1')
  })

  it('cannot write a late success after cancellation', () => {
    directory = mkdtempSync(join(tmpdir(), 'spark-media-task-'))
    db = new SparkDatabase(join(directory, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    const repo = new MediaGenerationTaskRepository(db)
    const row = repo.create({
      id: 'task-recovery-2',
      providerProfileId: 'provider-1',
      providerTaskId: 'provider-task-2',
      operation: 'text_to_video',
      status: 'failed',
      outputDir: '/tmp/media',
      assetsJson: '[]',
    })
    expect(repo.beginRecovery(row.id, 'provider-task-2').started).toBe(true)
    expect(repo.cancel(row.id)?.status).toBe('cancelled')

    const late = repo.completeRecovery(row.id, 'provider-task-2', {
      providerKind: 'volcengine-ark',
      modelId: 'seedance',
      assetsJson: JSON.stringify([{ type: 'video', filePath: '/tmp/late.mp4' }]),
      rawResponseJson: '{}',
    })

    expect(late.completed).toBe(false)
    expect(late.row?.status).toBe('cancelled')
    expect(late.row?.assets_json).toBe('[]')
  })
})
