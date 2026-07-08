/**
 * 内置可安装技能目录（Installable Catalog）端到端测试
 *
 * 覆盖：
 *   - listInstallableCatalog() 返回精选项且 installed=false
 *   - 模拟「通过 catalog 安装后」，listInstallableCatalog() 标 installed=true
 *   - uninstallFromCatalog() 清掉 DB；DB 重新 list 后 installed=false
 *   - 未知 slug 抛错
 *   - 手动写入的同名不同 root_path 技能不会被误判为「目录已安装」
 *
 * 故意只测「catalog surface」（list / 状态查询 / uninstall），不测实际的 GitHub
 * tarball 下载——后者需要构造合法 .tar.gz + 走 GitHub API，复杂度超出本次改造范围，
 * 由 install-roundtrip.e2e.test.ts 覆盖 SkillHub zip 安装路径。
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SkillRegistryService } from './index.js'
import { tarballSourceFingerprint } from './tarball-installer.js'
import { SparkDatabase } from '@spark/storage'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', '..', 'storage', 'migrations')

let tempRoot: string | null = null
let db: SparkDatabase | null = null
let userSkillsDir: string | null = null
let service: SkillRegistryService | null = null

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'spark-catalog-e2e-'))
  userSkillsDir = join(tempRoot, 'skills')
  mkdirSync(userSkillsDir, { recursive: true })
  const dbPath = join(tempRoot, 'test.db')
  db = new SparkDatabase(dbPath)
  db.runMigrations(MIGRATIONS_DIR)
  service = new SkillRegistryService(db, userSkillsDir)
  service.initialize()
})

afterEach(() => {
  if (db) {
    db.close()
    db = null
  }
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
  userSkillsDir = null
  service = null
})

describe('listInstallableCatalog — 基础', () => {
  it('空 DB 时返回精选项且 installed=false', () => {
    const items = service!.listInstallableCatalog()
    const slugs = items.map((i) => i.slug).sort()
    expect(slugs).toEqual(
      expect.arrayContaining([
        'ai-film-production',
        'gitnexus-impact-analysis',
        'hyperframes',
        'playwright',
        'ppt-master',
        'screenwriting-lab',
        'superpowers-systematic-debugging',
        'superpowers-writing-plans',
      ]),
    )
    items.forEach((i) => expect(i.installed).toBe(false))
    items.forEach((i) => expect(i.localId).toBeUndefined())
  })

  it('catalog 项声明可安装来源，ppt-master 优先走 Spark artifact 源', () => {
    const items = service!.listInstallableCatalog()
    items.forEach((i) => {
      if (i.source.type === 'tarball') {
        expect(i.source.repo).toMatch(/^[\w.-]+\/[\w.-]+$/)
        expect(['main', 'master']).toContain(i.source.ref ?? 'main')
      } else if (i.source.type === 'artifact') {
        expect(i.source.artifactId).toBeTruthy()
        expect(i.source.manifestUrl).toContain('minio.yiqibyte.com')
      }
    })
    const ppt = items.find((i) => i.slug === 'ppt-master')!
    expect(ppt.source.type).toBe('artifact')
  })
})

describe('listInstallableCatalog — 状态查询', () => {
  it('直接往 DB 插入一行（模拟 catalog 安装完成），list 应标 installed=true', () => {
    // 模拟「installFromCatalog('ppt-master') 成功」后的 DB 状态：
    //   root_path = <userSkillsDir>/ppt-master
    //   id 形如 skill:catalog:<fingerprint>
    const skillDir = join(userSkillsDir!, 'ppt-master')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: PPT Master\n---\n# PPT\n')

    db!.raw
      .prepare(
        `INSERT INTO skills (id, scope, name, version, root_path, manifest_json, enabled)
         VALUES (?, 'user', 'PPT Master', '1.0.0', ?, '{}', 1)`,
      )
      .run('skill:catalog:ppt-master', skillDir)

    const items = service!.listInstallableCatalog()
    const ppt = items.find((i) => i.slug === 'ppt-master')!
    expect(ppt.installed).toBe(true)
    expect(ppt.localId).toBe('skill:catalog:ppt-master')

    const pw = items.find((i) => i.slug === 'playwright')!
    expect(pw.installed).toBe(false)
  })

  it('手动导入的同名不同 root_path 不被误判为 catalog 已安装', () => {
    // 用户手动 import 了名为 "PPT Master" 但路径不一样的 skill → 不能被算作 catalog 已装
    const userImportedDir = join(tempRoot!, 'user-imports', 'ppt-master')
    mkdirSync(userImportedDir, { recursive: true })
    writeFileSync(join(userImportedDir, 'SKILL.md'), '---\nname: PPT Master\n---\n# User version\n')

    db!.raw
      .prepare(
        `INSERT INTO skills (id, scope, name, version, root_path, manifest_json, enabled)
         VALUES (?, 'user', 'PPT Master', '1.0.0', ?, '{}', 1)`,
      )
      .run('user:imported-ppt', userImportedDir)

    const items = service!.listInstallableCatalog()
    const ppt = items.find((i) => i.slug === 'ppt-master')!
    expect(ppt.installed).toBe(false)
  })
})

describe('uninstallFromCatalog', () => {
  it('未安装时返回 false', () => {
    expect(service!.uninstallFromCatalog('ppt-master')).toBe(false)
  })

  it('已安装时返回 true 并清掉 DB 行', () => {
    const skillDir = join(userSkillsDir!, 'ppt-master')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '# x')
    const catalogId = `skill:catalog:${tarballSourceFingerprint('hugohe3/ppt-master', 'skills/ppt-master')}`
    db!.raw
      .prepare(
        `INSERT INTO skills (id, scope, name, version, root_path, manifest_json, enabled)
         VALUES (?, 'user', 'PPT Master', '1.0.0', ?, '{}', 1)`,
      )
      .run(catalogId, skillDir)

    expect(service!.uninstallFromCatalog('ppt-master')).toBe(true)

    const items = service!.listInstallableCatalog()
    const ppt = items.find((i) => i.slug === 'ppt-master')!
    expect(ppt.installed).toBe(false)
  })

  it('未知 slug 返回 false 而不抛', () => {
    expect(service!.uninstallFromCatalog('not-a-real-skill')).toBe(false)
  })

  it('磁盘目录不存在时只清 DB，不抛', () => {
    // 模拟孤儿 DB 行：id 命中 catalog 指纹，root_path 指向不存在的目录
    const catalogId = `skill:catalog:${tarballSourceFingerprint('hugohe3/ppt-master', 'skills/ppt-master')}`
    db!.raw
      .prepare(
        `INSERT INTO skills (id, scope, name, version, root_path, manifest_json, enabled)
         VALUES (?, 'user', 'PPT Master', '1.0.0', '/nonexistent/path/ppt-master', '{}', 1)`,
      )
      .run(catalogId)

    expect(service!.uninstallFromCatalog('ppt-master')).toBe(true)
    const items = service!.listInstallableCatalog()
    const ppt = items.find((i) => i.slug === 'ppt-master')!
    expect(ppt.installed).toBe(false)
  })
})

describe('installFromCatalog — 入参校验', () => {
  it('未知 slug 抛错', async () => {
    await expect(service!.installFromCatalog('not-a-real-skill')).rejects.toThrow(
      /Unknown installable skill slug/,
    )
  })

  it('userSkillsDir 未配置时抛错', async () => {
    const noDirService = new SkillRegistryService(db!, /* userSkillsDir */ undefined)
    noDirService.initialize()
    await expect(noDirService.installFromCatalog('ppt-master')).rejects.toThrow(
      /User skills directory not configured/,
    )
  })
})
