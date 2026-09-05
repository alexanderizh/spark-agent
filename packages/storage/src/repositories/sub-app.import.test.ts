import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SparkDatabase } from '../database.js'
import {
  SubAppDataValidationError,
  SubAppRepository,
  SubAppStateError,
} from './sub-app.repository.js'

function createTestDb(testDir: string): SparkDatabase {
  const db = new SparkDatabase(join(testDir, 'test.db'))
  db.runMigrations(join(process.cwd(), 'migrations'))
  return db
}

/** 建一个已发布两版的本地应用，作为覆盖导入的被替换方。 */
function seedPublishedApp(repository: SubAppRepository): string {
  const created = repository.create({ name: '本机应用', source: '<main>local-v0</main>' })
  const updated = repository.updateDraft(created.id, 1, { source: '<main>local-v1</main>' })
  if (updated == null) throw new Error('seed update failed')
  repository.publish(created.id, 2)
  // publish 不改变 draft_revision，仍是 2。
  const updated2 = repository.updateDraft(created.id, 2, { source: '<main>local-v2</main>' })
  if (updated2 == null) throw new Error('seed update failed')
  repository.publish(created.id, 3)
  repository.upsertData(created.id, 'app', 'bookmark', { page: 1 })
  return created.id
}

describe('SubAppRepository.importApp', () => {
  let db: SparkDatabase
  let repository: SubAppRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-test-sub-app-import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    repository = new SubAppRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('imports a published package preserving version numbers and publish pointer', () => {
    const imported = repository.importApp({
      id: '01900000-0000-7000-8000-000000000001',
      manifest: {
        name: '记账工具',
        description: '分享来的',
        icon: null,
        entry: 'index.html',
        surface: 'content',
        permissions: ['data'],
      },
      draft: { source: '<main>v3</main>', config: {} },
      releases: [
        {
          version: 1,
          source: '<main>v1</main>',
          config: {},
          manifest: {
            name: '记账工具',
            description: '',
            icon: null,
            entry: 'index.html',
            surface: 'content',
            permissions: ['data'],
          },
          publishedAt: '2026-09-01T00:00:00.000Z',
        },
        {
          version: 3,
          source: '<main>v3</main>',
          config: {},
          manifest: {
            name: '记账工具',
            description: '',
            icon: null,
            entry: 'index.html',
            surface: 'content',
            permissions: ['data'],
          },
          publishedAt: '2026-09-03T00:00:00.000Z',
        },
      ],
      publishedVersion: 1,
      data: [{ namespace: 'app', key: 'ledger', value: { count: 3 } }],
    })

    // 导入即启用；指针指向包内 publishedVersion=1（而非最高版本 3）。
    expect(imported.publicationStatus).toBe('published')
    expect(imported.enabled).toBe(true)
    expect(imported.publishedVersion).toBe(1)
    expect(imported.publishedRelease?.source).toBe('<main>v1</main>')
    expect(imported.draft.source).toBe('<main>v3</main>')
    expect(imported.draft.revision).toBe(1)

    const releases = repository.listAllReleasesFull(imported.id)
    expect(releases.map((release) => release.version)).toEqual([1, 3])

    const data = repository.listAllData(imported.id)
    expect(data.total).toBe(1)
    expect(data.entries[0]?.value).toEqual({ count: 3 })
    expect(data.entries[0]?.revision).toBe(1)
  })

  it('imports a draft-only package as draft without publish pointer', () => {
    const imported = repository.importApp({
      id: '01900000-0000-7000-8000-000000000002',
      manifest: {
        name: '草稿包',
        description: '',
        icon: null,
        entry: 'index.html',
        surface: 'panel',
        permissions: [],
      },
      draft: { source: '<main>draft</main>', config: { a: 1 } },
      releases: [],
      publishedVersion: null,
      data: [],
    })

    expect(imported.publicationStatus).toBe('draft')
    expect(imported.publishedVersion).toBeNull()
    expect(imported.publishedRelease).toBeNull()
    expect(imported.draft.source).toBe('<main>draft</main>')
    // 从未发布的包导入后保持禁用语义之外的可见性不受影响，但 enabled 跟随导入即启用。
    expect(imported.enabled).toBe(true)
  })

  it('falls back to the highest version when publishedVersion misses', () => {
    const imported = repository.importApp({
      id: '01900000-0000-7000-8000-000000000003',
      manifest: {
        name: '指针回退',
        description: '',
        icon: null,
        entry: 'index.html',
        surface: 'content',
        permissions: ['data'],
      },
      draft: { source: '<main>d</main>', config: {} },
      releases: [
        {
          version: 2,
          source: '<main>v2</main>',
          config: {},
          manifest: {
            name: '指针回退',
            description: '',
            icon: null,
            entry: 'index.html',
            surface: 'content',
            permissions: ['data'],
          },
          publishedAt: '2026-09-02T00:00:00.000Z',
        },
      ],
      publishedVersion: 9,
      data: [],
    })
    expect(imported.publishedVersion).toBe(2)
    expect(imported.publishedRelease?.source).toBe('<main>v2</main>')
  })

  it('overwrite replaces draft, releases, data and keeps identity', () => {
    const localId = seedPublishedApp(repository)

    const imported = repository.importApp({
      id: localId,
      manifest: {
        name: '本机应用',
        description: '来自分享包',
        icon: null,
        entry: 'index.html',
        surface: 'content',
        permissions: ['data'],
      },
      draft: { source: '<main>shared-v7</main>', config: {} },
      releases: [
        {
          version: 7,
          source: '<main>shared-v7</main>',
          config: {},
          manifest: {
            name: '本机应用',
            description: '',
            icon: null,
            entry: 'index.html',
            surface: 'content',
            permissions: ['data'],
          },
          publishedAt: '2026-09-04T00:00:00.000Z',
        },
      ],
      publishedVersion: 7,
      data: [{ namespace: 'app', key: 'fresh', value: true }],
    })

    expect(imported.id).toBe(localId)
    expect(imported.publishedVersion).toBe(7)
    // 旧发布版本与数据被整体替换，不残留。
    expect(repository.listAllReleasesFull(localId).map((r) => r.version)).toEqual([7])
    const data = repository.listAllData(localId)
    expect(data.total).toBe(1)
    expect(data.entries[0]?.key).toBe('fresh')
  })

  it('rejects duplicate release versions and keeps the original app intact', () => {
    const localId = seedPublishedApp(repository)

    expect(() =>
      repository.importApp({
        id: localId,
        manifest: {
          name: '坏包',
          description: '',
          icon: null,
          entry: 'index.html',
          surface: 'content',
          permissions: ['data'],
        },
        draft: { source: '<main>x</main>', config: {} },
        releases: [
          {
            version: 1,
            source: '<main>a</main>',
            config: {},
            manifest: {
              name: '坏包',
              description: '',
              icon: null,
              entry: 'index.html',
              surface: 'content',
              permissions: ['data'],
            },
            publishedAt: '2026-09-01T00:00:00.000Z',
          },
          {
            version: 1,
            source: '<main>b</main>',
            config: {},
            manifest: {
              name: '坏包',
              description: '',
              icon: null,
              entry: 'index.html',
              surface: 'content',
              permissions: ['data'],
            },
            publishedAt: '2026-09-01T00:00:00.000Z',
          },
        ],
        publishedVersion: 1,
        data: [],
      }),
    ).toThrow(SubAppStateError)

    // 事务回滚：原应用的版本与数据必须原样保留。
    const original = repository.get(localId)
    expect(original?.publishedVersion).toBe(2)
    expect(repository.listAllReleasesFull(localId)).toHaveLength(2)
    expect(repository.listAllData(localId).total).toBe(1)
  })

  it('rejects oversized data values without leaving partial rows', () => {
    const localId = seedPublishedApp(repository)
    const oversized = 'x'.repeat(513_000)

    expect(() =>
      repository.importApp({
        id: '01900000-0000-7000-8000-000000000009',
        manifest: {
          name: '大数据包',
          description: '',
          icon: null,
          entry: 'index.html',
          surface: 'content',
          permissions: ['data'],
        },
        draft: { source: '<main>d</main>', config: {} },
        releases: [],
        publishedVersion: null,
        data: [
          { namespace: 'app', key: 'ok', value: 1 },
          { namespace: 'app', key: 'huge', value: oversized },
        ],
      }),
    ).toThrow(SubAppDataValidationError)

    // 新应用导入失败不残留半成品；原应用不受影响。
    expect(repository.get('01900000-0000-7000-8000-000000000009')).toBeNull()
    expect(repository.get(localId)?.publishedVersion).toBe(2)
  })
})
