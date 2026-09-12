import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkDatabase } from './database.js'
import { SessionRepository } from './repositories/session.repository.js'
import { WorkflowRepository } from './repositories/workflow.repository.js'

const migrationsDir = join(process.cwd(), 'migrations')

describe('session workflow binding migration', () => {
  let db: SparkDatabase | undefined
  let dir: string | undefined

  afterEach(() => {
    db?.close()
    if (dir != null) rmSync(dir, { recursive: true, force: true })
  })

  it('upgrades a version 97 database without changing existing workflow runs', () => {
    dir = join(tmpdir(), `spark-session-binding-migration-${Date.now()}-${Math.random()}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    applyMigrationsThrough(db, 97)

    new SessionRepository(db).create({
      id: 'session-a',
      kind: 'chat',
      title: 'A',
      status: 'idle',
      projectId: 'project-a',
    })
    new WorkflowRepository(db).create({
      id: 'workflow-a',
      name: 'A',
      version: '1.0.0',
      status: 'active',
      graph: { nodes: [], edges: [] },
    })
    db.raw
      .prepare(
        `INSERT INTO workflow_runs
         (id, session_id, turn_id, workflow_id, status, objective, graph_json,
          state_json, executions_json, atomic_executions_json, completed_node_ids_json,
          skipped_node_ids_json, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'run-a',
        'session-a',
        'turn-a',
        'workflow-a',
        'failed',
        'resume me',
        '{"nodes":[],"edges":[]}',
        '{}',
        '[]',
        '[]',
        '[]',
        '[]',
        'before-upgrade',
        'before-upgrade',
      )

    db.runMigrations(migrationsDir)

    expect(db.raw.prepare('SELECT * FROM workflow_runs WHERE id = ?').get('run-a')).toMatchObject({
      id: 'run-a',
      status: 'failed',
      workflow_binding_instance_id: null,
      workflow_graph_digest: null,
      workflow_name_snapshot: null,
      workflow_version_snapshot: null,
      binding_source: null,
    })
    expect(
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get('session_workflow_bindings'),
    ).toEqual({ name: 'session_workflow_bindings' })
  })

  it('does not reapply migration 98 on repeated startup', () => {
    dir = join(tmpdir(), `spark-session-binding-restart-${Date.now()}-${Math.random()}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))

    db.runMigrations(migrationsDir)
    db.runMigrations(migrationsDir)

    expect(
      db.raw.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 98').get(),
    ).toEqual({ count: 1 })
    const auditColumns = db.raw
      .prepare('PRAGMA table_info(workflow_runs)')
      .all()
      .map((row) => (row as { name: string }).name)
      .filter((name) => name.startsWith('workflow_') || name === 'binding_source')
    expect(auditColumns).toEqual(
      expect.arrayContaining([
        'workflow_binding_instance_id',
        'workflow_graph_digest',
        'workflow_name_snapshot',
        'workflow_version_snapshot',
        'binding_source',
      ]),
    )
  })
})

function applyMigrationsThrough(db: SparkDatabase, targetVersion: number): void {
  db.raw.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  for (const name of readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    const version = Number.parseInt(name, 10)
    if (version > targetVersion) break
    db.raw.exec(readFileSync(join(migrationsDir, name), 'utf8'))
    db.raw.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(version, name)
  }
}
