/**
 * @module wiki-repo-enrich.test
 *
 * 导读编排服务的假模型测试（方案B §7 / §11）—— 真临时 git 仓库 + 真 SQLite，
 * 仅模型调用与渠道解析走注入假件，全程零真实 HTTP。
 *
 * 覆盖不变量：
 *   - 总闸 repo/enrich/enabled=false：扫描后自动增强不跑（零调用零落库）；
 *   - 自动增强 + 同 rev 缓存（C3）：同 rev 二次扫描模型调用计数不增；
 *   - failed 行可重试：手动重跑后转 ready；
 *   - maxPages 截断：droppedByLimit 如实回报；
 *   - 空间级互斥：run 进行中再触发返回 busy；
 *   - 所有权双重过滤（C5）：manual 页生成侧不入差集、展示侧 getSection 返回 null。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'os'
import { SparkDatabase } from '@spark/storage'
import { createWikiServiceStack, type WikiServiceStack } from './wiki-service-stack.js'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  }).trim()
}

/** 能通过 validateEnrichSection 的合法导读段（三小节齐全、无 [[、≤1500 字符） */
const VALID_SECTION = [
  '## 模块职责',
  '- 演示模块，承载示例代码。',
  '## 关键入口',
  '- `index.ts`',
  '## 依赖关系',
  '- 依据材料未发现外部依赖。',
].join('\n')

/** 综述页变体的合法段（项目定位 / 架构组成 / 阅读指引） */
const VALID_OVERVIEW_SECTION = [
  '## 项目定位',
  '- 演示仓库，承载示例代码。',
  '## 架构组成',
  '- `src/` 与 `lib/` 两个顶层目录。',
  '## 阅读指引',
  '- 先读 `src/`（含入口 `index.ts`）。',
].join('\n')

describe('WikiRepoEnrichService（假模型 / 假渠道注入）', () => {
  let db: SparkDatabase
  let root: string
  let repo: string
  let stack: WikiServiceStack
  let settings: Map<string, unknown>
  let modelCalls: number
  /** 可切换的假模型行为（默认返回合法段） */
  let modelBehavior: () => Promise<string | null>

  beforeEach(() => {
    root = join(tmpdir(), `spark-wiki-enrich-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    repo = join(root, 'demo-repo')
    // 两个模块目录：maxPages 截断与所有权过滤都需要「多于一个目标页」
    mkdirSync(join(repo, 'src'), { recursive: true })
    mkdirSync(join(repo, 'lib'), { recursive: true })
    writeFileSync(join(repo, 'README.md'), '# demo\n')
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }))
    writeFileSync(join(repo, 'src', 'index.ts'), 'export const a = 1\n')
    writeFileSync(join(repo, 'lib', 'helper.ts'), 'export const helper = 1\n')
    git(repo, ['init', '-q'])
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', 'init'])

    const dbDir = join(root, 'db')
    mkdirSync(dbDir, { recursive: true })
    db = new SparkDatabase(join(dbDir, 'test.db'))
    db.runMigrations(join(process.cwd(), '../storage/migrations'))

    settings = new Map<string, unknown>()
    modelCalls = 0
    modelBehavior = async () => VALID_SECTION
    stack = createWikiServiceStack({
      db,
      appHomeDir: join(root, 'home'),
      settingsGet: (_category, key) => settings.get(key),
      repoEnrichCallModel: async (params) => {
        modelCalls += 1
        expect(params.system.length).toBeGreaterThan(0)
        // 变体分派：综述材料 → 综述段；模块材料 → 模块段（行为开关只控制 null/非 null）
        const raw = await modelBehavior()
        if (raw == null) return null
        return params.prompt.includes('# 仓库总览材料') ? VALID_OVERVIEW_SECTION : VALID_SECTION
      },
      repoEnrichResolveTarget: async () => ({
        ok: true,
        target: { providerType: 'openai-compatible', apiKey: 'test-key', model: 'test-model' },
      }),
    })
  })

  afterEach(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  /** 扫描并等自动增强空闲，返回空间 id。 */
  async function scanAndWait(): Promise<string> {
    const result = await stack.repoScanService.scan({ repoPath: repo })
    expect(result.ok).toBe(true)
    const spaceId = result.spaceId!
    expect(await stack.repoEnrichService.waitForIdle(spaceId)).toBe(true)
    return spaceId
  }

  function currentRev(spaceId: string): string {
    return stack.spaceRepo.getById(spaceId)?.repo_rev ?? ''
  }

  it('总闸关闭：扫描后自动增强零调用、零落库（默认行为不变）', async () => {
    settings.delete('repo/enrich/enabled') // 未设置 = 默认 false
    const spaceId = await scanAndWait()
    expect(modelCalls).toBe(0)
    expect(stack.repoEnrichRepo.getBySpace(spaceId, currentRev(spaceId))).toHaveLength(0)
    expect(stack.repoEnrichService.progress(spaceId)).toMatchObject({
      running: false,
      ready: 0,
      failed: 0,
    })
  })

  it('自动增强落库 + 同 rev 二次扫描零新增调用（C3 缓存语义）', async () => {
    settings.set('repo/enrich/enabled', true)
    const spaceId = await scanAndWait()
    expect(modelCalls).toBe(3) // 综述 + src + lib 各一次

    const rev = currentRev(spaceId)
    const rows = stack.repoEnrichRepo.getBySpace(spaceId, rev)
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.status === 'ready')).toBe(true)

    const srcPage = stack.pageRepo.getBySlug(spaceId, 'repo-module-src')!
    const section = stack.repoEnrichService.getSection(srcPage.id)
    expect(section?.section).toBe(VALID_SECTION)
    expect(section?.repoRev).toBe(rev)
    // 综述页同 rev 命中独立段（S3）
    const overviewPage = stack.pageRepo.getBySlug(spaceId, 'repo-overview')!
    expect(stack.repoEnrichService.getSection(overviewPage.id)?.section).toBe(
      VALID_OVERVIEW_SECTION,
    )
    expect(stack.repoEnrichService.progress(spaceId)).toMatchObject({
      running: false,
      ready: 3,
      failed: 0,
      pending: 0,
    })

    // 同 rev 再扫描：ready 缓存全部命中，模型不再被调用
    await scanAndWait()
    expect(modelCalls).toBe(3)
  })

  it('failed 行可重试：手动重跑后转 ready（点击即成本授权，不受总闸限制）', async () => {
    settings.set('repo/enrich/enabled', true)
    modelBehavior = async () => null // 第一轮全部失败（模型无输出）
    const spaceId = await scanAndWait()
    expect(modelCalls).toBe(3)
    let rows = stack.repoEnrichRepo.getBySpace(spaceId, currentRev(spaceId))
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.status === 'failed' && row.error === 'model_failed')).toBe(true)
    // 失败页 = 无 AI 块（静默回落骨架）
    const srcPage = stack.pageRepo.getBySlug(spaceId, 'repo-module-src')!
    expect(stack.repoEnrichService.getSection(srcPage.id)).toBeNull()

    modelBehavior = async () => VALID_SECTION
    settings.set('repo/enrich/enabled', false) // 总闸关着也照跑：手动 = 显式授权
    const receipt = await stack.repoEnrichService.runManually({ spaceId })
    expect(receipt).toMatchObject({ ok: true, ready: 3, failed: 0 })
    rows = stack.repoEnrichRepo.getBySpace(spaceId, currentRev(spaceId))
    expect(rows.every((row) => row.status === 'ready')).toBe(true)
    expect(stack.repoEnrichService.getSection(srcPage.id)?.section).toBe(VALID_SECTION)
  })

  it('maxPages 截断：droppedByLimit 如实回报，只处理截断后目标（综述不占配额）', async () => {
    settings.set('repo/enrich/enabled', false) // 用手动路径拿结构化回执
    settings.set('repo/enrich/maxPages', 1)
    const spaceId = await scanAndWait()
    const receipt = await stack.repoEnrichService.runManually({ spaceId })
    // 综述 + 截断后的 1 个模块页；droppedByLimit 只计模块目标
    expect(receipt).toMatchObject({ ok: true, target: 2, droppedByLimit: 1, ready: 2 })
    const rows = stack.repoEnrichRepo.getBySpace(spaceId, currentRev(spaceId))
    expect(rows).toHaveLength(2)
    const slugs = rows.map((row) => row.slug).sort()
    expect(slugs).toEqual(['repo-module-lib', 'repo-overview'])
  })

  it('空间级互斥：run 进行中再触发返回 busy，不并发跑', async () => {
    settings.set('repo/enrich/enabled', false)
    const spaceId = await scanAndWait()
    // 把假模型挂到手动闸上，让第一个 run 停在飞行中
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const originalBehavior = modelBehavior
    modelBehavior = async () => {
      await gate
      return originalBehavior()
    }

    const first = stack.repoEnrichService.runManually({ spaceId })
    const second = await stack.repoEnrichService.runManually({ spaceId })
    expect(second).toMatchObject({ ok: false, reason: 'busy' })

    release()
    const firstReceipt = await first
    expect(firstReceipt).toMatchObject({ ok: true, ready: 3 })
  })

  it('rev 前进：rebuild 后全量重生成并回收旧 rev 缓存（漂移自愈链路）', async () => {
    settings.set('repo/enrich/enabled', true)
    const spaceId = await scanAndWait()
    const rev1 = currentRev(spaceId)
    expect(modelCalls).toBe(3)

    writeFileSync(join(repo, 'src', 'extra.ts'), 'export const c = 3\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', 'advance rev'])

    // rebuild 委托 scan → 同一 hook 链路自然触发再增强
    const rebuilt = await stack.repoScanService.rebuild(spaceId)
    expect(rebuilt.ok).toBe(true)
    expect(await stack.repoEnrichService.waitForIdle(spaceId)).toBe(true)
    const rev2 = currentRev(spaceId)
    expect(rev2).not.toBe(rev1)
    expect(modelCalls).toBe(6) // 新 rev 键空间为空 → 全量重生成

    const rows = stack.repoEnrichRepo.getBySpace(spaceId, rev2)
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.status === 'ready')).toBe(true)
    // 旧 rev 行已被 GC（缓存体积上限 = 单空间单 rev 页面数）
    expect(stack.repoEnrichRepo.getBySpace(spaceId, rev1)).toHaveLength(0)
    // 展示侧基准换到新 rev（模块页与综述页同 rev 语义）
    const srcPage = stack.pageRepo.getBySlug(spaceId, 'repo-module-src')!
    expect(stack.repoEnrichService.getSection(srcPage.id)?.repoRev).toBe(rev2)
    const overviewPage = stack.pageRepo.getBySlug(spaceId, 'repo-overview')!
    expect(stack.repoEnrichService.getSection(overviewPage.id)?.repoRev).toBe(rev2)
  })

  it('所有权双重过滤（C5）：manual 页生成侧不入差集、展示侧 getSection 为 null', async () => {
    settings.set('repo/enrich/enabled', false)
    const spaceId = await scanAndWait()
    const srcPage = stack.pageRepo.getBySlug(spaceId, 'repo-module-src')!
    const libPage = stack.pageRepo.getBySlug(spaceId, 'repo-module-lib')!
    expect(stack.repoScanService.setOwnership(srcPage.id, 'manual').ok).toBe(true)

    settings.set('repo/enrich/enabled', true)
    const receipt = await stack.repoEnrichService.runManually({ spaceId })
    expect(receipt).toMatchObject({ ok: true, target: 2, ready: 2 })
    const rows = stack.repoEnrichRepo.getBySpace(spaceId, currentRev(spaceId))
    expect(rows.map((row) => row.slug).sort()).toEqual(['repo-module-lib', 'repo-overview'])
    expect(stack.repoEnrichService.getSection(srcPage.id)).toBeNull()

    // 展示侧竞态兜底：ready 行已存在，页面转 manual 后 AI 块立即消失
    expect(stack.repoScanService.setOwnership(libPage.id, 'manual').ok).toBe(true)
    expect(stack.repoEnrichService.getSection(libPage.id)).toBeNull()
  })

  it('综述页所有权过滤：overview 转 manual 后不再入计划（S3）', async () => {
    settings.set('repo/enrich/enabled', false)
    const spaceId = await scanAndWait()
    const overviewPage = stack.pageRepo.getBySlug(spaceId, 'repo-overview')!
    expect(stack.repoScanService.setOwnership(overviewPage.id, 'manual').ok).toBe(true)

    const receipt = await stack.repoEnrichService.runManually({ spaceId })
    expect(receipt).toMatchObject({ ok: true, target: 2, ready: 2 })
    const slugs = stack.repoEnrichRepo
      .getBySpace(spaceId, currentRev(spaceId))
      .map((row) => row.slug)
      .sort()
    expect(slugs).toEqual(['repo-module-lib', 'repo-module-src'])
    expect(stack.repoEnrichService.getSection(overviewPage.id)).toBeNull()
    // eligible 计数同步排除综述（进度口径与计划一致）
    expect(stack.repoEnrichService.progress(spaceId)).toMatchObject({
      ready: 2,
      failed: 0,
      pending: 0,
    })
  })

  it('综述页单页强制重跑：slug=repo-overview 只重跑综述，跳过 ready 缓存差集（S3）', async () => {
    settings.set('repo/enrich/enabled', true)
    const spaceId = await scanAndWait()
    expect(modelCalls).toBe(3)

    const before = modelCalls
    const receipt = await stack.repoEnrichService.runManually({ spaceId, slug: 'repo-overview' })
    expect(receipt).toMatchObject({ ok: true, target: 1, cached: 0, ready: 1 })
    expect(modelCalls).toBe(before + 1) // 只重跑综述一页

    const rows = stack.repoEnrichRepo.getBySpace(spaceId, currentRev(spaceId))
    expect(rows).toHaveLength(3) // 模块页缓存未被动
    const overviewRow = rows.find((row) => row.slug === 'repo-overview')
    expect(overviewRow?.status).toBe('ready')
    expect(overviewRow?.section).toBe(VALID_OVERVIEW_SECTION)
  })
})
