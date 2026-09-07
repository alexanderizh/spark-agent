import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SparkDatabase } from './database.js'
import {
  SubAppPackageService,
  assertPackagePath,
  digestFiles,
  validatePackageFiles,
} from './sub-app-package.service.js'
import { SubAppPlatformRepository } from './repositories/sub-app-platform.repository.js'
import { SubAppRepository } from './repositories/sub-app.repository.js'

describe('SubAppPackageService', () => {
  let root = ''
  let db: SparkDatabase | undefined
  let service: SubAppPackageService

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spark-sub-app-v2-'))
    db = new SparkDatabase(join(root, 'test.db'))
    db.runMigrations(fileURLToPath(new URL('../migrations', import.meta.url)))
    service = new SubAppPackageService(db, { rootDir: join(root, 'platform') })
  })

  afterEach(() => {
    db?.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('scaffolds, updates and atomically publishes a fullstack package', async () => {
    const created = await service.scaffold({ name: '同步工具', template: 'fullstack' })
    expect(created.project.validation.readyToPublish).toBe(true)
    expect(created.project.files.map((item) => item.path)).toContain('service/main.mjs')

    const updated = await service.writeFile({
      appId: created.appId,
      expectedDraftRevision: created.draftRevision,
      filePath: 'frontend/app.js',
      content: 'document.body.dataset.ready = "1"',
    })
    expect(updated.revision).toBe(created.draftRevision + 1)

    const published = await service.publish(created.appId, updated.revision)
    expect(published.version).toBe(1)
    expect(published.details?.publishedRelease?.format).toBe('v2')
    expect(published.details?.enabled).toBe(false)
    const stored = new SubAppPlatformRepository(db!).getPublishedPackage(created.appId)
    expect(stored?.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(
      readFileSync(join(root, 'platform', stored!.relativePath, 'frontend/app.js'), 'utf8'),
    ).toContain('dataset.ready')
  })

  it('keeps V1 applications compatible', () => {
    const apps = new SubAppRepository(db!)
    const created = apps.create({ name: 'Legacy', source: '<main>ok</main>' })
    const published = apps.publish(created.id, created.draftRevision)
    expect(published?.draft.format).toBe('v1')
    expect(published?.publishedRelease?.format).toBe('v1')
  })

  it('restores an immutable V2 release into a new draft revision', async () => {
    const created = await service.scaffold({ name: 'Rollback' })
    const first = await service.publish(created.appId, created.draftRevision)
    const changed = await service.writeFile({
      appId: created.appId,
      expectedDraftRevision: created.draftRevision,
      filePath: 'frontend/index.html',
      content: '<main>changed</main>',
    })
    const rolled = await service.rollback(created.appId, first.version, changed.revision)
    expect(rolled.revision).toBe(changed.revision + 1)
    expect(await service.readFile(created.appId, 'frontend/index.html')).not.toMatchObject({
      content: '<main>changed</main>',
    })
  })

  it('rejects traversal, missing entries and legacy raw IPC', () => {
    expect(() => assertPackagePath('../x')).toThrow()
    const files = new Map<string, Buffer>([
      [
        'spark-app.json',
        Buffer.from(
          JSON.stringify({
            schemaVersion: 2,
            name: 'unsafe',
            surface: 'content',
            frontend: { entry: 'frontend/missing.html' },
            permissions: { sparkCapabilities: ['ipc'], osEffects: [], connections: [] },
          }),
        ),
      ],
    ])
    const validation = validatePackageFiles(files)
    expect(validation.readyToPublish).toBe(false)
    expect(validation.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['PACKAGE_ENTRY_MISSING', 'RAW_IPC_FORBIDDEN']),
    )
  })

  it('rejects origin-root resource paths that cannot stay inside the package token', () => {
    const files = new Map<string, Buffer>([
      [
        'spark-app.json',
        Buffer.from(
          JSON.stringify({
            schemaVersion: 2,
            name: 'root resource',
            surface: 'content',
            frontend: { entry: 'frontend/index.html' },
            permissions: { sparkCapabilities: [], osEffects: [], connections: [] },
          }),
        ),
      ],
      ['frontend/index.html', Buffer.from('<script src="/app.js"></script>')],
    ])
    expect(validatePackageFiles(files).diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PACKAGE_ROOT_RESOURCE' })]),
    )
  })

  it('computes deterministic digests independent of insertion order', () => {
    const a = new Map([
      ['b', Buffer.from('2')],
      ['a', Buffer.from('1')],
    ])
    const b = new Map([
      ['a', Buffer.from('1')],
      ['b', Buffer.from('2')],
    ])
    expect(digestFiles(a)).toBe(digestFiles(b))
  })

  it('migrates a V1 draft in place while preserving legacy releases', async () => {
    const apps = new SubAppRepository(db!)
    const legacy = apps.create({ name: 'Legacy migrate', source: '<main>legacy</main>' })
    apps.publish(legacy.id, legacy.draftRevision)
    const migrated = await service.migrateV1(legacy.id, legacy.draftRevision)
    expect(migrated.manifest?.schemaVersion).toBe(2)
    expect(migrated.files.map((item) => item.path)).toEqual([
      'frontend/index.html',
      'spark-app.json',
    ])
    expect(apps.listAllReleasesFull(legacy.id)[0]?.format).toBe('v1')
  })

  it('refuses to run a published artifact after integrity changes', async () => {
    const created = await service.scaffold({ name: 'Integrity' })
    const published = await service.publish(created.appId, created.draftRevision)
    const stored = new SubAppPlatformRepository(db!).getPublishedPackage(created.appId)
    writeFileSync(join(root, 'platform', stored!.relativePath, 'frontend/index.html'), 'tampered')
    await expect(
      service.resolveRuntime({
        appId: created.appId,
        releaseId: published.releaseId,
        mode: 'published',
      }),
    ).rejects.toThrow('完整性校验失败')
  })
})
