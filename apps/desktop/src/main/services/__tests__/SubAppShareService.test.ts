import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { SparkDatabase } from '@spark/storage'
import { SubAppRepository } from '@spark/storage'
import {
  SubAppShareService,
  buildImportChecks,
  computeBodySha256,
  scanCapabilities,
  verifyPackageIntegrity,
} from '../SubAppShareService.js'
import { SubAppFileStore } from '../SubAppFileStore.js'

const MIGRATIONS_DIR = resolve(process.cwd(), '../../packages/storage/migrations')

describe('SubAppShareService', () => {
  let testDir: string
  let db: SparkDatabase
  let repository: SubAppRepository
  let fileStore: SubAppFileStore
  let service: SubAppShareService

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-test-sub-app-share-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(join(testDir, 'files'), { recursive: true })
    mkdirSync(join(testDir, 'backups'), { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(MIGRATIONS_DIR)
    repository = new SubAppRepository(db)
    fileStore = new SubAppFileStore(join(testDir, 'files'))
    service = new SubAppShareService({
      repository,
      fileStore,
      fileStoreRoot: join(testDir, 'files'),
      backupsDir: join(testDir, 'backups'),
      platformVersion: '1.2.3',
    })
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  /** 建一个带两版发布、一条数据、一个文件空间的完整应用。 */
  async function seedFullApp(name = '记账工具'): Promise<string> {
    const created = repository.create({ name, source: '<main>v1</main>', config: { c: 1 } })
    const updated = repository.updateDraft(created.id, 1, { source: '<main>v2</main>' })
    if (updated == null) throw new Error('seed update failed')
    repository.publish(created.id, 2)
    repository.upsertData(created.id, 'app', 'ledger', { total: 42 })
    await fileStore.write(created.id, 'exports/report.md', '# 报告')
    return created.id
  }

  it('round-trips a package: serialize → verify ok, tamper → verify fails', async () => {
    const appId = await seedFullApp()
    const packed = await service.buildPackage(appId)

    expect(packed.counts).toEqual({ releases: 1, dataEntries: 1, files: 1 })
    expect(packed.body.publishedVersion).toBe(1)
    expect(packed.body.manifest.name).toBe('记账工具')

    const parsed = JSON.parse(packed.text) as Parameters<typeof verifyPackageIntegrity>[0]
    const verified = verifyPackageIntegrity(parsed)
    expect(verified.integrityOk).toBe(true)
    expect(verified.body.draft.source).toBe('<main>v2</main>')

    // 篡改包体（哪怕一个字符）必须被拦截。
    const tampered = JSON.parse(packed.text) as Record<string, unknown>
    tampered.draft = { ...(tampered.draft as Record<string, unknown>), source: '<main>evil</main>' }
    expect(verifyPackageIntegrity(tampered as never).integrityOk).toBe(false)
  })

  it('statically scans ipc channels, provider refs and secret hints', () => {
    const report = scanCapabilities(
      [
        {
          label: '草稿',
          source: [
            "await sparkApp.ipc.invoke('sub-app:data:list', {})",
            "sparkApp.ipc.on('stream:session:agent-event', fn)",
            'const pid = providerProfileId',
            "fetch('https://api.example.com', { headers: { apiKey: 'abcdefghijklmnop' } })",
          ].join('\n'),
        },
      ],
      [{ namespace: 'settings', key: 'creds', value: { token: 'sk-abcdefghijklmnop1234' } }],
    )

    expect(report.ipcChannels).toEqual(['stream:session:agent-event', 'sub-app:data:list'])
    expect(report.providerRefs.some((ref) => ref.startsWith('providerProfileId'))).toBe(true)
    expect(report.secretHints).toContainEqual({ scope: 'source', location: '草稿' })
    expect(report.secretHints).toContainEqual({ scope: 'data', location: 'settings/creds' })
  })

  it('builds import checks: unknown channel warns, oversize data blocks', () => {
    const base = {
      formatVersion: 1,
      appId: '01900000-0000-7000-8000-0000000000aa',
      exportedAt: '2026-09-05T00:00:00.000Z',
      platformVersion: '1.0.0',
      manifest: {
        name: '检查',
        description: '',
        icon: null,
        entry: 'index.html',
        surface: 'content' as const,
        permissions: [],
      },
      draft: { source: '<main>d</main>', config: {} },
      releases: [],
      publishedVersion: null,
      data: [],
      files: [],
      capabilities: { ipcChannels: ['totally:unknown-channel'], providerRefs: [], secretHints: [] },
    }

    const checks = buildImportChecks(base, true, '1.2.3')
    expect(checks.find((check) => check.code === 'IPC_CHANNELS')?.level).toBe('warning')

    const oversize = {
      ...base,
      data: [{ namespace: 'app', key: 'huge', value: 'x'.repeat(513_000) }],
    }
    const blocking = buildImportChecks(oversize, true, '1.2.3')
    expect(blocking.find((check) => check.code === 'DATA_LIMIT')?.level).toBe('error')

    const tooManyFiles = {
      ...base,
      files: Array.from({ length: 501 }, (_, index) => ({
        path: `dir-${index % 2}/file-${index}.txt`,
        content: 'ok',
      })),
    }
    const fileBlocking = buildImportChecks(tooManyFiles, true, '1.2.3')
    expect(fileBlocking.find((check) => check.code === 'FILE_LIMIT')?.level).toBe('error')
    expect(fileBlocking.find((check) => check.code === 'FILE_LIMIT')?.detail).toContain(
      '文件数量 501（上限 500）',
    )
  })

  it('rejects export when files exceed the limit across multiple directories', async () => {
    const created = repository.create({ name: '文件上限', source: '<main>app</main>' })
    const appRoot = join(testDir, 'files', created.id)
    mkdirSync(join(appRoot, 'first'), { recursive: true })
    mkdirSync(join(appRoot, 'second'), { recursive: true })
    for (let index = 0; index < 250; index += 1) {
      writeFileSync(join(appRoot, 'first', `file-${index}.txt`), 'a')
    }
    for (let index = 0; index < 251; index += 1) {
      writeFileSync(join(appRoot, 'second', `file-${index}.txt`), 'b')
    }

    await expect(service.buildPackage(created.id)).rejects.toThrow(/超过 500 个文件/)
  })

  it('end-to-end: export → preview → import as new app (files + data + releases)', async () => {
    const sourceId = await seedFullApp()
    const packed = await service.buildPackage(sourceId)

    const pkgPath = join(testDir, 'share.sparkapp')
    writeFileSync(pkgPath, packed.text, 'utf8')

    const preview = await service.previewFromFile(pkgPath, 'share.sparkapp')
    expect(preview.integrityOk).toBe(true)
    expect(preview.conflict.kind).toBe('same-id')

    const applied = await service.applyImport(
      preview.body,
      'new-app',
      computeBodySha256(preview.body),
    )
    expect(applied.appId).not.toBe(sourceId)
    expect(applied.name).toBe('记账工具（导入）') // 撞名自动加后缀
    expect(applied.publicationStatus).toBe('published')
    expect(applied.importedReleases).toBe(1)

    const imported = repository.get(applied.appId)
    expect(imported?.publishedVersion).toBe(1)
    expect(imported?.draft.source).toBe('<main>v2</main>')
    expect(repository.listAllData(applied.appId).total).toBe(1)
    const file = await fileStore.read(applied.appId, 'exports/report.md')
    expect(file.content).toBe('# 报告')
    // 原应用不受影响。
    expect(repository.get(sourceId)?.publishedVersion).toBe(1)
  })

  it('end-to-end: overwrite import replaces the local app and leaves a backup', async () => {
    const sourceId = await seedFullApp()
    const packed = await service.buildPackage(sourceId)
    const preview = await service.previewFromFile(
      (() => {
        const pkgPath = join(testDir, 'overwrite.sparkapp')
        writeFileSync(pkgPath, packed.text, 'utf8')
        return pkgPath
      })(),
    )

    // 本机继续演化，产生与包不同的新状态。
    repository.upsertData(sourceId, 'app', 'local-only', 'will-be-replaced')

    const applied = await service.applyImport(
      preview.body,
      'overwrite',
      computeBodySha256(preview.body),
    )
    expect(applied.appId).toBe(sourceId)
    expect(applied.backupPath != null && statSync(applied.backupPath).isFile()).toBe(true)

    // 备份可再解析（可导入恢复）。
    const backupText = readFileSync(applied.backupPath as string, 'utf8')
    expect(verifyPackageIntegrity(JSON.parse(backupText)).integrityOk).toBe(true)

    // 覆盖后：本地独有数据被替换掉，包内数据在。
    const data = repository.listAllData(sourceId)
    expect(data.entries.map((entry) => entry.key).sort()).toEqual(['ledger'])

    // 文件空间目录没有残留 incoming/old 临时目录。
    const filesRoot = join(testDir, 'files')
    expect(
      readdirSync(filesRoot).filter(
        (name) => name.includes('.incoming-') || name.includes('.old-'),
      ),
    ).toEqual([])
  })

  it('rejects apply when the body sha differs from preview', async () => {
    const sourceId = await seedFullApp()
    const packed = await service.buildPackage(sourceId)
    await expect(service.applyImport(packed.body, 'new-app', 'deadbeef')).rejects.toThrow()
    // 未传 sha 时跳过该校验（内部调用方语义），仍能正常导入。
    await expect(service.applyImport(packed.body, 'new-app')).resolves.toBeTruthy()
  })

  it('blocks invalid file paths before any file changes', async () => {
    const sourceId = await seedFullApp()
    const packed = await service.buildPackage(sourceId)
    const evil = {
      ...packed.body,
      files: [{ path: '../escape.txt', content: 'boom' }],
    }
    // 阻断性检查在前：任何文件写入都不会发生。
    await expect(service.applyImport(evil, 'new-app')).rejects.toThrow()
    const escaped = join(testDir, 'files', 'escape.txt')
    expect(() => statSync(escaped)).toThrow()
  })

  it('describes conflicts: same-id vs same-name', async () => {
    const sourceId = await seedFullApp('重名应用')
    const packed = await service.buildPackage(sourceId)

    // 同名不同 id。
    const other = repository.create({ name: '重名应用', source: '<main>other</main>' })
    const conflictSameName = await service.describeConflict({
      ...packed.body,
      appId: '01900000-0000-7000-8000-0000000000bb',
    })
    expect(conflictSameName.kind).toBe('same-name')
    expect(conflictSameName.appId).toBe(other.id)

    // 同 id。
    const conflictSameId = await service.describeConflict(packed.body)
    expect(conflictSameId.kind).toBe('same-id')
    expect(conflictSameId.appId).toBe(sourceId)
  })

  it('blocks oversized data before any file changes', async () => {
    const sourceId = await seedFullApp()
    const packed = await service.buildPackage(sourceId)
    const evil = {
      ...packed.body,
      appId: '01900000-0000-7000-8000-0000000000cc',
      data: [{ namespace: 'app', key: 'huge', value: 'x'.repeat(513_000) }],
    }
    // 超大 data 在预检阶段被拦（error 级），不发生文件交换也不写库。
    await expect(service.applyImport(evil, 'new-app')).rejects.toThrow()
    expect(() => statSync(join(testDir, 'files', '01900000-0000-7000-8000-0000000000cc'))).toThrow()
  })
})
