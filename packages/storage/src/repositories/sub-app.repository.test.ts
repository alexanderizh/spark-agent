import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SparkDatabase } from '../database.js'
import {
  SubAppConflictError,
  SubAppDataConflictError,
  SubAppNotFoundError,
  SubAppRepository,
} from './sub-app.repository.js'

function createTestDb(testDir: string): SparkDatabase {
  const db = new SparkDatabase(join(testDir, 'test.db'))
  db.runMigrations(join(process.cwd(), 'migrations'))
  return db
}

describe('SubAppRepository', () => {
  let db: SparkDatabase
  let repository: SubAppRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-test-sub-app-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    repository = new SubAppRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('keeps draft edits separate from immutable published releases', () => {
    const created = repository.create({
      name: '记账工具',
      source: '<main>v1</main>',
      config: { currency: 'CNY' },
    })
    expect(created.publicationStatus).toBe('draft')
    expect(created.draft.revision).toBe(1)

    const updated = repository.updateDraft(created.id, 1, {
      source: '<main>v2</main>',
      config: { currency: 'USD' },
    })
    expect(updated).not.toBeNull()
    if (updated == null) throw new Error('draft update did not return the app')
    expect(updated.draft.revision).toBe(2)

    const published = repository.publish(created.id, 2)
    expect(published).not.toBeNull()
    if (published == null) throw new Error('publish did not return the app')
    expect(published.publicationStatus).toBe('published')
    expect(published.publishedRelease?.version).toBe(1)
    expect(published.publishedRelease?.source).toBe('<main>v2</main>')

    const nextDraft = repository.updateDraft(created.id, 2, { source: '<main>v3</main>' })
    expect(nextDraft).not.toBeNull()
    if (nextDraft == null) throw new Error('second draft update did not return the app')
    expect(nextDraft.draft.revision).toBe(3)
    expect(repository.get(created.id, 1)?.publishedRelease?.source).toBe('<main>v2</main>')
    expect(() => repository.publish(created.id, 2)).toThrow(SubAppConflictError)
  })

  it('only exposes published and enabled apps in the menu view', () => {
    const app = repository.create({ name: '菜单应用' })
    expect(repository.list({ menuOnly: true }).items).toHaveLength(0)

    // 发布即启用：菜单立即可见，无需再手动开启用开关
    repository.publish(app.id, 1)
    expect(repository.list({ menuOnly: true }).items.map((item) => item.id)).toEqual([app.id])

    // 禁用后从菜单隐藏，重新启用恢复
    repository.setEnabled(app.id, false)
    expect(repository.list({ menuOnly: true }).items).toHaveLength(0)
    repository.setEnabled(app.id, true)
    expect(repository.list({ menuOnly: true }).items.map((item) => item.id)).toEqual([app.id])

    repository.archive(app.id)
    expect(repository.list({ menuOnly: true }).items).toHaveLength(0)
    expect(repository.list().items).toHaveLength(0)
    expect(repository.list({ includeArchived: true }).items).toHaveLength(1)
  })

  it('isolates app data and requires revision matching for existing records', () => {
    const first = repository.create({ name: '第一个应用' })
    const second = repository.create({ name: '第二个应用' })

    const created = repository.upsertData(first.id, 'settings', 'theme', { mode: 'dark' })
    expect(created.revision).toBe(1)
    expect(repository.getData(second.id, 'settings', 'theme')).toBeNull()

    const updated = repository.upsertData(first.id, 'settings', 'theme', { mode: 'light' }, 1)
    expect(updated.revision).toBe(2)
    expect(() =>
      repository.upsertData(first.id, 'settings', 'theme', { mode: 'system' }, 1),
    ).toThrow(SubAppDataConflictError)

    expect(repository.listData(first.id, 'settings').items).toEqual([updated])
  })

  it('lists release history newest first and marks the published release', () => {
    const app = repository.create({ name: '版本应用', source: 'v1' })
    // publish 不递增草稿 revision：v1 发布后草稿 revision 仍是 1
    repository.publish(app.id, 1)
    repository.updateDraft(app.id, 1, { source: 'v2' })
    repository.publish(app.id, 2)
    repository.updateDraft(app.id, 2, { source: 'v3' })

    const page = repository.listReleases(app.id)
    expect(page).not.toBeNull()
    if (page == null) throw new Error('listReleases did not return a page')
    expect(page.total).toBe(2)
    expect(page.items.map((item) => item.version)).toEqual([2, 1])
    const [latest, previous] = page.items
    if (latest == null || previous == null) throw new Error('release page missing items')
    expect(latest.isPublished).toBe(true)
    expect(previous.isPublished).toBe(false)
    expect(repository.listReleases('nonexistent-app')).toBeNull()
  })

  it('deletes an app with its releases and data, and reports not-found afterwards', () => {
    const app = repository.create({ name: '待删除应用', source: 'v1' })
    repository.publish(app.id, 1)
    repository.upsertData(app.id, 'settings', 'theme', { mode: 'dark' })

    expect(repository.delete(app.id)).toBe(true)
    expect(repository.get(app.id)).toBeNull()
    expect(repository.listReleases(app.id)).toBeNull()
    // 数据访问要求应用存在：删除后为 NOT_FOUND 语义
    expect(() => repository.getData(app.id, 'settings', 'theme')).toThrow(SubAppNotFoundError)
    // 幂等失败：重复删除返回 false 而不是报错
    expect(repository.delete(app.id)).toBe(false)
  })

  it('deleteData distinguishes revision conflicts from missing records', () => {
    const app = repository.create({ name: '数据删除应用' })
    repository.upsertData(app.id, 'notes', 'todo-1', { text: 'hello' })

    expect(() => repository.deleteData(app.id, 'notes', 'todo-1', 5)).toThrow(
      SubAppDataConflictError,
    )
    expect(repository.deleteData(app.id, 'notes', 'todo-1', 1)).toBe(true)
    expect(repository.getData(app.id, 'notes', 'todo-1')).toBeNull()
    // 记录已不存在：NOT_FOUND 语义（SubAppNotFoundError），不是冲突
    expect(() => repository.deleteData(app.id, 'notes', 'todo-1', 1)).toThrow(SubAppNotFoundError)
  })
})
