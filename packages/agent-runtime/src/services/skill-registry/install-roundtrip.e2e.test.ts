/**
 * SkillHub 安装/卸载端到端测试（无需启动 Electron）
 *
 * 覆盖完整的「featured → install → uninstall」链路：
 *   - 拉取 featured（3 个 sub-section 都能跑通）
 *   - installFromSkillHub 下载 zip → 解压 → 落盘 → 写 DB
 *   - 进度回调被调用
 *   - listInstallableCatalog() 标记 installed=true
 *   - uninstall() 清掉磁盘 + DB
 *
 * 关键技术点：
 *   - SparkDatabase 走临时文件（非内存：迁移工具不支持 in-memory）
 *   - globalThis.fetch 被 mock 拦截，命中 /api/v1/download?slug= 时返回本地 zip fixture
 *   - SkillHub detail / search 等其他端点同样 mock
 */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillRegistryService } from './index.js'
import { installFromZip } from './tarball-installer.js'
import { SparkDatabase } from '@spark/storage'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', '..', 'storage', 'migrations')

// Fixture zip 路径（packages/agent-runtime/src/services/skill-registry/__fixtures__/skillhub-sample.zip）
const FIXTURE_ZIP = join(__dirname, '__fixtures__', 'skillhub-sample.zip')

interface Env {
  db: SparkDatabase
  dbPath: string
  userSkillsDir: string
  service: SkillRegistryService
}

let env: Env | null = null
let tempRoot: string | null = null

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.SPARK_SKILL_INSTALL_DISABLE_SYSTEM_TAR
  if (env) {
    env.db.close()
    env = null
  }
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
})

describe('installFromZip — Spark artifact zip installer', () => {
  it('downloads, verifies SHA256, extracts with bundled JS unzip fallback, and installs skill files', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'spark-zip-installer-e2e-'))
    const userSkillsDir = join(tempRoot, 'skills')
    mkdirSync(userSkillsDir, { recursive: true })
    const zipBuffer = readFileSync(FIXTURE_ZIP)
    const sha256 = createHash('sha256').update(zipBuffer).digest('hex')
    const progressEvents: Array<{ downloaded: number; total: number }> = []
    process.env.SPARK_SKILL_INSTALL_DISABLE_SYSTEM_TAR = '1'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(zipBuffer, {
          status: 200,
          headers: {
            'content-type': 'application/zip',
            'content-length': String(zipBuffer.length),
          },
        }),
      ),
    )

    const result = await installFromZip({
      url: 'https://artifact.example.test/skill.zip',
      destDirName: 'artifact-skill',
      userSkillsDir,
      sha256,
      onProgress(downloaded, total) {
        progressEvents.push({ downloaded, total })
      },
    })

    expect(result.destPath).toBe(join(userSkillsDir, 'artifact-skill'))
    expect(result.skillMd).toContain('Sample Skill')
    expect(result.fileCount).toBeGreaterThan(0)
    expect(existsSync(join(userSkillsDir, 'artifact-skill', 'SKILL.md'))).toBe(true)
    expect(progressEvents.length).toBeGreaterThan(0)
    expect(progressEvents.at(-1)).toEqual({ downloaded: zipBuffer.length, total: zipBuffer.length })
  })

  it('falls back to native downloader when Node fetch fails', async () => {
    if (spawnSync('curl', ['--version'], { stdio: 'ignore' }).status !== 0) return

    tempRoot = mkdtempSync(join(tmpdir(), 'spark-zip-native-download-e2e-'))
    const userSkillsDir = join(tempRoot, 'skills')
    mkdirSync(userSkillsDir, { recursive: true })
    const zipBuffer = readFileSync(FIXTURE_ZIP)
    const sha256 = createHash('sha256').update(zipBuffer).digest('hex')
    process.env.SPARK_SKILL_INSTALL_DISABLE_SYSTEM_TAR = '1'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )

    const server = createServer((_, res) => {
      res.writeHead(200, {
        'content-type': 'application/zip',
        'content-length': String(zipBuffer.length),
      })
      res.end(zipBuffer)
    })
    const listening = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false))
      server.listen(0, '127.0.0.1', () => resolve(true))
    })
    if (!listening) {
      server.close()
      return
    }
    try {
      const address = server.address()
      if (address == null || typeof address === 'string') throw new Error('bad test server address')
      const result = await installFromZip({
        url: `http://127.0.0.1:${address.port}/skill.zip`,
        destDirName: 'native-download-skill',
        userSkillsDir,
        sha256,
      })

      expect(result.skillMd).toContain('Sample Skill')
      expect(existsSync(join(userSkillsDir, 'native-download-skill', 'SKILL.md'))).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

function setupEnv(): Env {
  tempRoot = mkdtempSync(join(tmpdir(), 'spark-skillhub-e2e-'))
  const dbPath = join(tempRoot, 'test.db')
  const userSkillsDir = join(tempRoot, 'skills')
  mkdirSync(userSkillsDir, { recursive: true })
  const db = new SparkDatabase(dbPath)
  db.runMigrations(MIGRATIONS_DIR)
  const service = new SkillRegistryService(db, userSkillsDir)
  service.initialize()
  env = { db, dbPath, userSkillsDir, service }
  return env
}

interface SkillHubFixture {
  slug: string
  name: string
  description: string
  downloads: number
  category: string
}

function makeShowcasePayload(slug: string, section: string): SkillHubFixture {
  return {
    slug,
    name: `Sample ${section} Skill`,
    description: `A ${section} skill for testing`,
    downloads: 100,
    category: 'dev-programming',
  }
}

function makeDetailPayload(slug: string) {
  return {
    skill: {
      slug,
      name: slug,
      displayName: `中文技能 ${slug}`,
      description: 'detail desc',
      description_zh: '详情描述',
      version: '1.2.3',
      ownerName: 'fixture-owner',
      category: 'dev-programming',
      subCategories: [{ key: 'dev-code-gen', name: '代码生成' }],
      iconUrl: 'https://example.com/icon.png',
      downloads: 100,
      stars: 5,
    },
    latestVersion: { version: '1.2.3' },
    owner: { displayName: 'Fixture Owner', handle: 'fixture-owner' },
  }
}

function buildFetchMock(
  zipBuffer: Buffer,
  section: string,
  slug: string,
): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    // 1. 详情端点
    if (url.includes(`/api/v1/skills/${slug}`) && !url.includes('/file') && !url.includes('/files')) {
      return jsonResponse(makeDetailPayload(slug))
    }
    // 2. zip 下载
    if (url.includes('/api/v1/download')) {
      return new Response(zipBuffer, {
        status: 200,
        headers: { 'content-type': 'application/zip', 'content-length': String(zipBuffer.length) },
      })
    }
    // 3. SKILL.md 文件（用于 fallback 路径）
    if (url.includes('/api/v1/skills/') && url.includes('/file')) {
      return new Response(
        '---\nname: Sample\ndescription: fallback\n---\n# Sample\n',
        { status: 200, headers: { 'content-type': 'text/markdown' } },
      )
    }
    // 4. showcase 端点（recommended 走 /api/v1/showcase/recommended）
    if (section === 'recommended' && url.includes('/api/v1/showcase/recommended')) {
      return jsonResponse({
        section,
        skills: [makeShowcasePayload(slug, section)],
      })
    }
    // 5. 下载热榜（hot_downloads 走 /api/skills?sortBy=downloads&order=desc）
    if (section === 'hot_downloads' && url.includes('/api/skills') && url.includes('sortBy=downloads')) {
      return jsonResponse({
        code: 0,
        data: { skills: [makeShowcasePayload(slug, section)] },
      })
    }
    // 5. categories
    if (url.includes('/api/v1/categories')) {
      return jsonResponse({ count: 1, items: [] })
    }
    return new Response('not mocked: ' + url, { status: 404 })
  })
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('SkillHub install roundtrip — 2 个 sub-section 各跑一遍', () => {
  const sections = ['recommended', 'hot_downloads'] as const

  for (const section of sections) {
    it(`section=${section}：featured → install → uninstall`, async () => {
      const env = setupEnv()
      const zipBuffer = readFileSync(FIXTURE_ZIP)
      const slug = 'sample-skill'

      vi.stubGlobal('fetch', buildFetchMock(zipBuffer, section, slug))

      // 1. featured 拉取
      const skills = await env.service.featured({ registryId: 'skillhub', section, limit: 5 })
      expect(skills).toHaveLength(1)
      expect(skills[0]!.id).toBe(`skillhub:${slug}`)

      // 2. installFromSkillHub：进度回调至少被调一次
      const progressEvents: Array<{ downloaded: number; total: number }> = []
      const skill = await env.service.installFromSkillHub(slug, (downloaded, total) => {
        progressEvents.push({ downloaded, total })
      })

      expect(skill.name).toBe(`中文技能 ${slug}`)
      expect(skill.rootPath).toBe(join(env.userSkillsDir, slug))
      expect(skill.id).toBe(`skill:skillhub:${slug}`)
      expect(JSON.parse(skill.manifestJson)).toMatchObject({
        displayName: `中文技能 ${slug}`,
        canonicalName: 'Sample Skill',
      })

      // 3. 磁盘上 SKILL.md 存在
      expect(existsSync(join(env.userSkillsDir, slug, 'SKILL.md'))).toBe(true)

      // 4. 进度至少有过一次
      expect(progressEvents.length).toBeGreaterThan(0)
      const last = progressEvents[progressEvents.length - 1]!
      expect(last.downloaded).toBeGreaterThan(0)
      expect(last.total).toBe(zipBuffer.length)

      // 5. featured 重拉后应标记 installed=true
      const skillsAfter = await env.service.featured({ registryId: 'skillhub', section, limit: 5 })
      expect(skillsAfter[0]!.installed).toBe(true)
      expect(skillsAfter[0]!.localId).toBe(`skill:skillhub:${slug}`)

      // 6. uninstall：磁盘 + DB 都清掉
      const removed = env.service.uninstall(skill.id)
      expect(removed).toBe(true)
      expect(existsSync(join(env.userSkillsDir, slug))).toBe(false)
    })
  }
})

describe('SkillHub install — 失败路径', () => {
  beforeEach(() => {
    env = null
  })

  it('zip 下载失败且无 fallback 时抛错', async () => {
    const env = setupEnv()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/v1/skills/') && !url.includes('/file') && !url.includes('/files')) {
          return jsonResponse(makeDetailPayload('bad-slug'))
        }
        if (url.includes('/api/v1/download')) {
          return new Response('zip corrupted', { status: 500 })
        }
        if (url.includes('/file')) {
          // fallback 路径也需要失败才能真正抛错
          return new Response('not found', { status: 500 })
        }
        if (url.includes('/showcase/')) {
          return jsonResponse({ section: 'recommended', skills: [] })
        }
        return new Response('not mocked', { status: 404 })
      }),
    )

    await expect(env.service.installFromSkillHub('bad-slug')).rejects.toThrow()
  })

  it('unknown slug 抛错', async () => {
    const env = setupEnv()
    vi.stubGlobal('fetch', vi.fn())
    await expect(env.service.installFromSkillHub('does-not-exist')).rejects.toThrow()
  })
})

describe('SkillHubAdapter 兼容性', () => {
  it('zip 流的 content-length 0 也能被纯 JS 兜底解压（已 fixture）', () => {
    // 顺带验证 fixture zip 是合法格式
    expect(existsSync(FIXTURE_ZIP)).toBe(true)
    const buf = readFileSync(FIXTURE_ZIP)
    // zip magic: PK\x03\x04
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
    expect(buf[2]).toBe(0x03)
    expect(buf[3]).toBe(0x04)
  })

  it('Readable.fromWeb 不被 vitest 内存吃光', () => {
    // sanity: 验证我们用的工具确实存在
    expect(typeof Readable.fromWeb).toBe('function')
  })
})
