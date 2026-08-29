import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasProjectRepository, CanvasSnapshotRepository, SparkDatabase } from '@spark/storage'
import type { PersistedPromptLibraryItem } from '../CanvasPromptLibraryPersistence.js'
import { readAllPromptLibraryItems } from './prompt-library-source.js'

function promptAsset(id: string, text: string, updatedAt: string) {
  return {
    id,
    title: id,
    contentText: text,
    createdAt: updatedAt,
    updatedAt,
    metadata: { kind: 'prompt_library', attributes: { promptCategory: '项目' } },
  }
}

function globalItem(id: string, text = id): PersistedPromptLibraryItem {
  return {
    id,
    title: id,
    text,
    category: '全局',
    tags: [],
    coverUrl: null,
    coverMimeType: null,
    usageCount: 0,
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
  }
}

describe('readAllPromptLibraryItems', () => {
  let db: SparkDatabase
  let testDir: string
  let projects: CanvasProjectRepository
  let snapshots: CanvasSnapshotRepository

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-prompt-library-source-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(resolve(process.cwd(), '../../packages/storage/migrations'))
    projects = new CanvasProjectRepository(db)
    snapshots = new CanvasSnapshotRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('combines global and every project prompt including soft-deleted projects', async () => {
    const projectOneRoot = join(testDir, 'project-one')
    mkdirSync(join(projectOneRoot, 'snapshots'), { recursive: true })
    projects.upsert({ id: 'project-1', title: '项目一', rootPath: projectOneRoot })
    snapshots.save(
      'project-1',
      0,
      JSON.stringify({
        assets: [promptAsset('file-prompt', 'SQLite 旧正文', '2026-08-28T00:00:00.000Z')],
      }),
    )
    writeFileSync(
      join(projectOneRoot, 'snapshots', 'latest.json'),
      JSON.stringify({
        assets: [
          promptAsset('file-prompt', '目录最新正文', '2026-08-30T00:00:00.000Z'),
          promptAsset('shadowed', '项目中的重复条目', '2026-08-30T00:00:00.000Z'),
          promptAsset('legacy-shadowed', '旧 ID 重复条目', '2026-08-30T00:00:00.000Z'),
        ],
      }),
      'utf8',
    )

    projects.upsert({ id: 'project-2', title: '项目二' })
    snapshots.save(
      'project-2',
      0,
      JSON.stringify({
        assets: [promptAsset('sqlite-prompt', 'SQLite 正文', '2026-08-30T00:00:00.000Z')],
      }),
    )

    projects.upsert({ id: 'project-deleted', title: '已删除项目', status: 'deleted' })
    snapshots.save(
      'project-deleted',
      0,
      JSON.stringify({
        assets: [promptAsset('deleted-prompt', '已删除项目提示词', '2026-08-30T00:00:00.000Z')],
      }),
    )

    const items = await readAllPromptLibraryItems(db, [
      globalItem('global-1'),
      globalItem('legacy:project-1:shadowed', '全局条目优先'),
      globalItem('legacy:legacy-shadowed', '旧版全局条目优先'),
    ])

    expect(items.map((item) => item.id).sort()).toEqual(
      [
        'global-1',
        'legacy:legacy-shadowed',
        'legacy:project-1:file-prompt',
        'legacy:project-1:shadowed',
        'legacy:project-2:sqlite-prompt',
        'legacy:project-deleted:deleted-prompt',
      ].sort(),
    )
    expect(items.find((item) => item.id === 'legacy:project-1:file-prompt')?.text).toBe(
      '目录最新正文',
    )
    expect(items.find((item) => item.id === 'legacy:project-deleted:deleted-prompt')?.text).toBe(
      '已删除项目提示词',
    )
  })
})
