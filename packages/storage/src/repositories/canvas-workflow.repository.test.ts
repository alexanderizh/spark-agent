import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SparkDatabase } from '../database.js'
import { CanvasProjectRepository } from './canvas.repository.js'
import { CanvasWorkflowRepository } from './canvas-workflow.repository.js'

const emptyPackage = {
  schemaVersion: 1,
  graph: { nodes: [], edges: [] },
  contract: { inputs: [], outputs: [], exposedParams: [] },
  dependencies: { modelCapabilities: [], canvasNodeKinds: [] },
}

function createTestDb(testDir: string): SparkDatabase {
  const dbPath = join(testDir, 'test.db')
  const migrationsDir = join(process.cwd(), 'migrations')
  const db = new SparkDatabase(dbPath)
  db.runMigrations(migrationsDir)
  return db
}

describe('CanvasWorkflowRepository', () => {
  let db: SparkDatabase
  let repo: CanvasWorkflowRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-test-canvas-workflow-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    const projects = new CanvasProjectRepository(db)
    projects.upsert({ id: 'project-1', title: 'Project 1' })
    projects.upsert({ id: 'project-2', title: 'Project 2' })
    repo = new CanvasWorkflowRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('keeps project workflows scoped to their project', () => {
    repo.create({
      id: 'project-workflow',
      projectId: 'project-1',
      name: '分镜到镜头图',
      scope: 'project',
      tags: ['影视', '图片'],
      packageJson: emptyPackage,
    })
    repo.create({
      id: 'other-project-workflow',
      projectId: 'project-2',
      name: '角色设定',
      scope: 'project',
      packageJson: emptyPackage,
    })

    const rows = repo.list({ scope: 'project', projectId: 'project-1' })

    expect(rows.map((row) => row.id)).toEqual(['project-workflow'])
    expect(repo.toItem(rows[0]!).tags).toEqual(['影视', '图片'])
  })

  it('lists personal workflows independently from project workflows', () => {
    repo.create({
      id: 'library-workflow',
      name: '社媒套图',
      scope: 'library',
      status: 'published',
      packageJson: emptyPackage,
    })
    repo.create({
      id: 'project-workflow',
      projectId: 'project-1',
      name: '项目草稿',
      scope: 'project',
      packageJson: emptyPackage,
    })

    expect(repo.list({ scope: 'library' }).map((row) => row.id)).toEqual(['library-workflow'])
  })

  it('hides archived workflows unless explicitly requested', () => {
    repo.create({
      id: 'archived-workflow',
      name: '旧版本',
      scope: 'library',
      packageJson: emptyPackage,
    })
    repo.update('archived-workflow', { status: 'archived' })

    expect(repo.list({ scope: 'library' })).toEqual([])
    expect(repo.list({ scope: 'library', includeArchived: true })).toHaveLength(1)
  })

  it('duplicates a personal workflow into a project without mutating the source', () => {
    repo.create({
      id: 'source-workflow',
      name: '个人模板',
      scope: 'library',
      status: 'published',
      version: 3,
      packageJson: emptyPackage,
    })

    const copy = repo.duplicate('source-workflow', {
      id: 'project-copy',
      name: '个人模板 - 项目副本',
      scope: 'project',
      projectId: 'project-1',
    })

    expect(copy?.id).toBe('project-copy')
    expect(copy?.project_id).toBe('project-1')
    expect(copy?.version).toBe(1)
    expect(copy?.status).toBe('draft')
    expect(repo.get('source-workflow')?.version).toBe(3)
  })

  it('does not write canvas definitions into the Agent workflows table', () => {
    const before = db.raw.prepare('SELECT COUNT(*) AS count FROM workflows').get() as {
      count: number
    }
    repo.create({
      id: 'canvas-only',
      name: '画布专用',
      scope: 'library',
      packageJson: emptyPackage,
    })

    const agentWorkflowCount = db.raw.prepare('SELECT COUNT(*) AS count FROM workflows').get() as {
      count: number
    }
    expect(agentWorkflowCount.count).toBe(before.count)
  })

  it('hides workflows owned by soft-deleted canvas projects', () => {
    repo.create({
      id: 'deleted-project-workflow',
      projectId: 'project-1',
      name: '已删除项目工作流',
      scope: 'project',
      packageJson: emptyPackage,
    })
    new CanvasProjectRepository(db).softDelete('project-1')

    expect(repo.list({ scope: 'project' })).toEqual([])
    expect(repo.get('deleted-project-workflow')).not.toBeNull()
  })

  it('paginates filtered workflows and reports the filtered total', () => {
    for (let index = 1; index <= 5; index += 1) {
      repo.create({
        id: `library-${index}`,
        name: `社媒工作流 ${index}`,
        scope: 'library',
        packageJson: emptyPackage,
        createdAt: `2026-07-23T00:00:0${index}.000Z`,
        updatedAt: `2026-07-23T00:00:0${index}.000Z`,
      })
    }
    repo.create({
      id: 'project-only',
      projectId: 'project-1',
      name: '项目工作流',
      scope: 'project',
      packageJson: emptyPackage,
    })

    const page = repo.listPage({ scope: 'library', query: '社媒', limit: 2, offset: 2 })

    expect(page.total).toBe(5)
    expect(page.rows.map((item) => item.id)).toEqual(['library-3', 'library-2'])
  })

  it('rolls back definition changes when a version snapshot write fails', () => {
    repo.create({
      id: 'atomic-workflow',
      name: '原始名称',
      scope: 'library',
      packageJson: emptyPackage,
    })

    let transactionBodyEntered = false
    expect(() =>
      repo.withTransaction(() => {
        transactionBodyEntered = true
        repo.update('atomic-workflow', { name: '不应保留' })
        db.raw
          .prepare(
            `INSERT INTO canvas_workflow_versions (
              workflow_id, version, name, package_json, created_at
            ) VALUES (?, ?, ?, ?, ?)`,
          )
          .run('missing-workflow', 1, '失败快照', '{}', '2026-07-23T00:00:00.000Z')
      }),
    ).toThrow(/FOREIGN KEY/)

    expect(transactionBodyEntered).toBe(true)
    expect(repo.get('atomic-workflow')?.name).toBe('原始名称')
  })
})
