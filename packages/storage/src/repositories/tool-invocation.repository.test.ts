import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SparkDatabase } from '../database.js'
import { ToolInvocationRepository } from './tool-invocation.repository.js'

describe('ToolInvocationRepository', () => {
  let root: string
  let db: SparkDatabase
  let repository: ToolInvocationRepository

  beforeEach(() => {
    root = join(tmpdir(), `spark-tool-invocations-${Date.now()}-${Math.random()}`)
    mkdirSync(root, { recursive: true })
    db = new SparkDatabase(join(root, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    repository = new ToolInvocationRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('records privacy-preserving lifecycle data and supports filtered pagination', () => {
    repository.start({
      id: 'invocation-1',
      correlationId: 'correlation-1',
      sourceKind: 'tool-package',
      sourceId: 'acme.tools',
      packageId: 'acme.tools',
      toolName: 'search',
      version: '1.0.0',
      adapter: 'process',
      sessionId: 'session-1',
      invocationSource: 'model',
      inputSha256: 'a'.repeat(64),
      startedAt: '2026-09-05T00:00:00.000Z',
    })
    const finished = repository.finish('invocation-1', {
      status: 'ok',
      outputBytes: 128,
      finishedAt: '2026-09-05T00:00:00.025Z',
    })
    expect(finished).toMatchObject({
      status: 'ok',
      duration_ms: 25,
      output_bytes: 128,
      input_sha256: 'a'.repeat(64),
    })
    expect(repository.list({ sessionId: 'session-1', limit: 20 })).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ correlation_id: 'correlation-1' })],
    })
    expect(repository.list({ status: 'error' }).total).toBe(0)
  })

  it('backfills legacy Custom Tool history idempotently', () => {
    const timestamp = '2026-09-04T23:59:00.000Z'
    db.raw
      .prepare(
        `INSERT INTO custom_tools(
          id, title, description, type, input_schema_json, spec_json, risk, effect,
          idempotency, timeout_ms, enabled, origin, published_version, draft_version,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'http', '{}', '{}', 'read', 'read', 'safe', 30000, 1, 'local', 1, 1, ?, ?)`,
      )
      .run('legacy-search', 'Legacy search', 'Legacy history fixture', timestamp, timestamp)
    db.raw
      .prepare(
        `INSERT INTO custom_tool_invocations(
          tool_id, session_id, turn_id, input_sha256, status, duration_ms,
          output_bytes, created_at, tool_version, source
        ) VALUES (?, ?, ?, ?, 'ok', 25, 64, ?, 1, 'model')`,
      )
      .run('legacy-search', 'session-legacy', 'turn-legacy', 'b'.repeat(64), timestamp)
    db.raw.prepare('DELETE FROM schema_migrations WHERE version = 95').run()

    db.runMigrations(join(process.cwd(), 'migrations'))
    db.raw.prepare('DELETE FROM schema_migrations WHERE version = 95').run()
    db.runMigrations(join(process.cwd(), 'migrations'))

    expect(repository.list({ sourceKind: 'custom-tool', sourceId: 'legacy-search' })).toMatchObject(
      {
        total: 1,
        items: [
          expect.objectContaining({
            id: 'legacy-custom-tool-1',
            session_id: 'session-legacy',
            invocation_source: 'model',
            status: 'ok',
          }),
        ],
      },
    )
  })
})
