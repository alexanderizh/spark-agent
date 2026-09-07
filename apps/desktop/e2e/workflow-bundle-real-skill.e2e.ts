import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

const DESKTOP_ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = join(DESKTOP_ROOT, 'out/main/index.js')
// 真实技能夹具:仓库内置 spark-web-tool(SKILL.md + manifest.json + references/ 嵌套目录,33 个文件)
const REAL_SKILL_SOURCE = join(DESKTOP_ROOT, 'resources', 'skills', 'spark-web-tool')

type SparkWindow = Window & { spark: { invoke: (channel: string, payload?: unknown) => unknown } }

interface SkillItemLike {
  id: string
  name: string
  manifestJson: string
  rootPath: string
}

// 串行测试间共享:导出产物、技能副本目录、技能原始 manifest(字节级比对基准)
let sharedBundlePath = ''
let sharedSkillCopyDir = ''
let sharedSkillId = ''
let sharedSkillManifest = ''

// 夹具缓存:e2e 实例首启会清空 resources/skills(已知行为),任何应用启动前先把真实技能
// 缓存到 OS 临时目录并把 manifest id 改写为独立第三方 id,与易失的内置资源目录解耦
const FIXTURE_CACHE = join(tmpdir(), 'spark-e2e-fixture-spark-web-tool')

async function ensureFixture(): Promise<string> {
  if (existsSync(join(FIXTURE_CACHE, 'SKILL.md'))) return FIXTURE_CACHE
  expect(existsSync(REAL_SKILL_SOURCE), `真实技能夹具缺失且无缓存: ${REAL_SKILL_SOURCE}`).toBe(true)
  await rm(FIXTURE_CACHE, { recursive: true, force: true })
  await cp(REAL_SKILL_SOURCE, FIXTURE_CACHE, { recursive: true })
  const manifestPath = join(FIXTURE_CACHE, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as { id: string }
  expect(manifest.id.startsWith('builtin:')).toBe(true)
  manifest.id = 'skill:skillhub:spark-web-tool-e2e'
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  return FIXTURE_CACHE
}

async function launchApp(
  userDataPath: string,
): Promise<{ electronApp: ElectronApplication; page: Page }> {
  const electronApp = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataPath}`, '--disable-gpu'],
    cwd: DESKTOP_ROOT,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      NODE_ENV: 'production',
      SPARK_ALLOW_MULTIPLE_INSTANCES: '1',
      SPARK_SKIP_PROTOCOL_REGISTRATION: '1',
      SPARK_AUTH_KEYTAR_SERVICE: `SparkAgent.CloudAuth.E2E.BundleSkill.${process.pid}.${Date.now()}`,
      SPARK_DISABLE_DEVTOOLS: '1',
    },
    timeout: 20_000,
  })
  const page = await electronApp.firstWindow({ timeout: 20_000 })
  await page.waitForLoadState('domcontentloaded')

  // 首启引导收尾(与 workflow-bundle.e2e.ts 同款):轮询等引导页或侧边栏,点掉后等侧边栏挂载
  const skip = page.getByRole('button', { name: '稍后再说', exact: true })
  const sidebar = page.locator('.floating-sidebar')
  await expect
    .poll(async () => {
      if (await skip.isVisible().catch(() => false)) return 'onboarding'
      if (await sidebar.isVisible().catch(() => false)) return 'shell'
      return 'loading'
    })
    .not.toBe('loading')
  if (await skip.isVisible().catch(() => false)) await skip.click()
  await expect(sidebar).toBeVisible()

  const optionalCapabilityLater = page.getByRole('button', { name: /^稍\s*后$/ })
  let quietRounds = 0
  for (let attempt = 0; attempt < 30 && quietRounds < 3; attempt += 1) {
    await page.waitForTimeout(500)
    if (await optionalCapabilityLater.isVisible().catch(() => false)) {
      await optionalCapabilityLater.click()
      quietRounds = 0
    } else {
      quietRounds += 1
    }
  }
  await expect(page.locator('.ant-modal-wrap:visible')).toHaveCount(0, { timeout: 5_000 })
  return { electronApp, page }
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    for (const name of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, name.name)
      if (name.isDirectory()) await walk(abs)
      else out.push(abs)
    }
  }
  await walk(root)
  return out
}

test.describe.serial('真实技能随包验证(spark-web-tool,33 文件)', () => {
  let electronApp: ElectronApplication
  let page: Page
  let userDataPath: string
  let scratchDir: string
  const scratchDirs: string[] = []
  let pageErrors: Error[] = []

  test.beforeAll(async () => {
    // 必须先于任何应用启动:首启清理会删 resources/skills,夹具先落缓存
    sharedSkillCopyDir = await ensureFixture()
  })

  test.beforeEach(async () => {
    test.setTimeout(240_000)
    userDataPath = await mkdtemp(join(tmpdir(), 'spark-bundle-skill-e2e-'))
    scratchDir = await mkdtemp(join(tmpdir(), 'spark-bundle-skill-scratch-'))
    scratchDirs.push(scratchDir)
    pageErrors = []
    const launched = await launchApp(userDataPath)
    electronApp = launched.electronApp
    page = launched.page
    page.on('pageerror', (error) => pageErrors.push(error))
  })

  test.afterEach(async () => {
    await electronApp?.close().catch(() => {})
    await rm(userDataPath, { recursive: true, force: true }).catch(() => {})
  })

  test.afterAll(async () => {
    await Promise.all(
      scratchDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})),
    )
  })

  test('导出方:真实技能经 skill:import-directory 安装后,33 个文件字节级进入 .sparkflow', async () => {
    // 0) 夹具已由 beforeAll 缓存就绪(sharedSkillCopyDir),manifest id 已改写为独立第三方 id
    expect(existsSync(join(sharedSkillCopyDir, 'manifest.json'))).toBe(true)

    // 1) 经真实 IPC 安装本地技能(与 UI「导入技能」同一链路)
    const imported = (await page.evaluate(async (dir) => {
      const spark = (window as unknown as SparkWindow).spark
      const result = (await spark.invoke('skill:import-directory', { directoryPath: dir })) as {
        skills: SkillItemLike[]
      }
      return result.skills[0]
    }, sharedSkillCopyDir)) as SkillItemLike
    expect(imported?.id).toBeTruthy()
    expect(imported.id.startsWith('builtin:')).toBe(false)
    sharedSkillId = imported.id
    sharedSkillManifest = imported.manifestJson
    expect(sharedSkillManifest.length).toBeGreaterThan(2)

    // 2) 建工作流引用该技能(+一个 builtin 技能,验证 builtin 不随包的设计)
    const created = (await page.evaluate(async (skillId) => {
      const spark = (window as unknown as SparkWindow).spark
      return (await spark.invoke('workflow:create', {
        name: '内容生成流水线',
        description: '真实技能随包验证',
        status: 'active',
        tags: ['e2e'],
        enabled: true,
        graph: {
          nodes: [
            {
              id: 'n1',
              kind: 'skill',
              title: '生成内容',
              x: 0,
              y: 0,
              config: { skillIds: [skillId, 'builtin:commit'] },
            },
          ],
          edges: [],
        },
      })) as { workflow?: { id: string }; id?: string }
    }, sharedSkillId)) as { workflow?: { id: string }; id?: string }
    expect(created?.id ?? created?.workflow?.id).toBeTruthy()

    // 3) 导出完整工作流包(空 workflowIds = 全部,与「导出全部」同链路)
    sharedBundlePath = join(scratchDir, 'real-skill.sparkflow')
    const exported = (await page.evaluate(async (outputPath) => {
      const spark = (window as unknown as SparkWindow).spark
      return (await spark.invoke('workflow-bundle:export', {
        workflowIds: [],
        outputPath,
        name: '真实技能包',
      })) as { manifest: { skills: { path: string; originSkillId: string; sha256: string }[] } }
    }, sharedBundlePath)) as {
      manifest: { skills: { path: string; originSkillId: string; sha256: string }[] }
    }

    // 4) manifest:恰好 1 个随包技能,来源即导入的技能;builtin 不入包
    expect(exported.manifest.skills).toHaveLength(1)
    expect(exported.manifest.skills[0]?.originSkillId).toBe(sharedSkillId)
    const skillPrefix = `skills/${exported.manifest.skills[0]!.path.split('/')[1]}/`

    // 5) 测试进程解包(纯 JS,无原生依赖):33 个真实文件 + 随包 manifest,逐文件字节比对
    const { unzipSync } = createRequire(
      join(DESKTOP_ROOT, '../packages/agent-runtime/package.json'),
    )('fflate') as { unzipSync: (data: Buffer) => Record<string, Uint8Array> }
    const zipped = unzipSync(await readFile(sharedBundlePath))
    const realFiles = await walkFiles(sharedSkillCopyDir)
    const packedSkillKeys = Object.keys(zipped).filter((k) => k.startsWith(skillPrefix))
    expect(packedSkillKeys).toHaveLength(realFiles.length + 1) // + .spark-skill-manifest.json

    for (const abs of realFiles) {
      const rel = relative(sharedSkillCopyDir, abs).split('\\').join('/')
      const packed = zipped[`${skillPrefix}${rel}`]
      expect(packed, `包内缺失: ${rel}`).toBeDefined()
      expect(Buffer.from(packed!).equals(await readFile(abs)), `内容不一致: ${rel}`).toBe(true)
    }
    const packedManifest = zipped[`${skillPrefix}.spark-skill-manifest.json`]
    expect(new TextDecoder().decode(packedManifest!)).toBe(sharedSkillManifest)

    // 6) checksums.json:每个技能文件有 sha256 且与重算一致
    const checksums = JSON.parse(new TextDecoder().decode(zipped['checksums.json']!)) as {
      files: Record<string, string>
    }
    for (const key of packedSkillKeys) {
      expect(checksums.files[key], `校验和缺失: ${key}`).toBe(
        createHash('sha256').update(zipped[key]!).digest('hex'),
      )
    }

    // 7) 工作流图随包且引用完整;无该技能的 unresolved 提示(builtin 被跳过不报错)
    const bundledGraph = JSON.parse(new TextDecoder().decode(zipped['workflows/0.json']!)) as {
      name: string
      graph: { nodes: { config: { skillIds: string[] } }[] }
    }
    expect(bundledGraph.name).toBe('内容生成流水线')
    expect(bundledGraph.graph.nodes[0]?.config.skillIds).toEqual([sharedSkillId, 'builtin:commit'])
    const bundledManifest = JSON.parse(new TextDecoder().decode(zipped['manifest.json']!)) as {
      unresolved: { type: string; name: string }[]
    }
    expect(
      bundledManifest.unresolved.filter((u) => u.type === 'skill' && u.name === sharedSkillId),
    ).toHaveLength(0)
  })

  test('导入方(全新环境):技能隔离落位、DB manifest 逐字节保留、引用改写、验证通过', async () => {
    expect(sharedBundlePath, '前置的导出测试未产出包文件').toBeTruthy()

    // 0) 全新环境技能基线:无 bundle: 前缀技能
    const before = (await page.evaluate(async () => {
      const spark = (window as unknown as SparkWindow).spark
      return (await spark.invoke('skill:list', {})) as { skills: SkillItemLike[] }
    })) as { skills: SkillItemLike[] }
    expect(before.skills.filter((s) => s.id.startsWith('bundle:'))).toHaveLength(0)

    // 1) 替换文件对话框 → UI 导入链路(导入 → 工作流包 → 预览 → 确认)
    await electronApp.evaluate(({ ipcMain }, filePath) => {
      ipcMain.removeHandler('dialog:open-file')
      ipcMain.handle('dialog:open-file', () => ({
        ok: true,
        data: { canceled: false, filePaths: [filePath] },
      }))
    }, sharedBundlePath)

    await page
      .locator('.floating-sidebar')
      .getByRole('button', { name: /^工作流/ })
      .click()
    await expect(page.getByRole('button', { name: '导入', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '导入', exact: true }).click()
    await page.getByRole('menuitem', { name: /工作流包\(\.sparkflow/ }).click()
    const previewModal = page.getByRole('dialog', { name: '导入工作流包 — 依赖预览' })
    await expect(previewModal).toBeVisible()
    // 预览里技能名以 kebab 展示(DB name 来自 frontmatter 含空格),断言随包技能计数 + 宽松名称匹配
    await expect(previewModal.getByText(/随包技能\s*1\s*个/)).toBeVisible()
    await expect(previewModal.getByText(/spark[\s-]*web[\s-]*tool/i)).toBeVisible()
    await previewModal.getByRole('button', { name: '确认导入' }).click()
    await expect(page.locator('.spark-toast-success').first()).toBeVisible({ timeout: 15_000 })

    // 2) 技能落库:bundle: 前缀 ID、user scope、manifest 逐字节等于导出方原始值
    const after = (await page.evaluate(async () => {
      const spark = (window as unknown as SparkWindow).spark
      return (await spark.invoke('skill:list', {})) as { skills: SkillItemLike[] }
    })) as { skills: SkillItemLike[] }
    const bundledSkills = after.skills.filter((s) => s.id.startsWith('bundle:'))
    expect(bundledSkills).toHaveLength(1)
    const bundled = bundledSkills[0]
    expect(bundled).toBeDefined()
    if (bundled == null) throw new Error('未找到导入的 bundle 技能')
    // slug 保留 name 原始大小写(name 来自 frontmatter 含空格,空格转 -)
    const slug = bundled.name.replace(/\s+/g, '-')
    expect(bundled.id).toBe(`bundle:${bundled.id.split(':')[1]}:${slug}`)
    expect(bundled.manifestJson).toBe(sharedSkillManifest)

    // 3) 磁盘隔离落位校验:本机 DLP 下 Electron 写入 userData 的文件对测试进程枚举不可见,
    //    改由应用主进程经 net.fetch(file://) 逐文件读回,在测试进程比对 sha256
    const bundledRow = bundled
    const fixtureRelFiles = (await walkFiles(sharedSkillCopyDir)).sort()
    const readback = (await electronApp.evaluate(
      async ({ net }, { rootPath, rels }) => {
        const out: { results: { rel: string; ok: boolean; sha256?: string; err?: string }[] } = {
          results: [],
        }
        for (const rel of rels) {
          const fileUrl =
            'file:///' +
            rootPath.split('\\').join('/').split('?').join('%3F') +
            '/' +
            rel.split('\\').join('/')
          try {
            const resp = await net.fetch(fileUrl)
            if (!resp.ok) {
              out.results.push({ rel, ok: false, err: `HTTP ${resp.status}` })
              continue
            }
            const buf = new Uint8Array(await resp.arrayBuffer())
            const digest = await crypto.subtle.digest('SHA-256', buf)
            const sha256 = Array.from(new Uint8Array(digest))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('')
            out.results.push({ rel, ok: true, sha256 })
          } catch (err) {
            out.results.push({ rel, ok: false, err: String(err) })
          }
        }
        return out
      },
      {
        rootPath: bundledRow.rootPath,
        rels: [
          ...fixtureRelFiles.map((abs) => relative(sharedSkillCopyDir, abs)),
          '.spark-skill-manifest.json',
        ],
      },
    )) as { results: { rel: string; ok: boolean; sha256?: string; err?: string }[] }
    const failed = readback.results.filter((r) => !r.ok)
    console.log(
      `[诊断] 主进程 net.fetch 读回: ${readback.results.filter((r) => r.ok).length}/${readback.results.length} 成功${failed.length ? `,失败样例: ${failed[0]?.rel} ${failed[0]?.err}` : ''}`,
    )
    expect(failed, `主进程读回落盘文件失败: ${JSON.stringify(failed.slice(0, 3))}`).toHaveLength(0)

    // 34 个文件(33 真实 + 随包 manifest)全部读回,sha256 与夹具逐一一致 = 字节级一致
    const expectedHashes = await Promise.all(
      fixtureRelFiles.map(async (abs) => ({
        rel: relative(sharedSkillCopyDir, abs).split('\\').join('/'),
        sha256: createHash('sha256')
          .update(await readFile(abs))
          .digest('hex'),
      })),
    )
    const installedByRel = new Map(readback.results.map((r) => [r.rel, r.sha256]))
    for (const expected of expectedHashes) {
      expect(installedByRel.get(expected.rel), `落盘 sha256 不一致: ${expected.rel}`).toBe(
        expected.sha256,
      )
    }
    expect(
      readback.results.find((r) => r.rel === '.spark-skill-manifest.json')?.sha256,
    ).toBeDefined()
    expect(bundled.rootPath, 'DB root_path 应指向隔离 bundle 目录').toContain('_bundles')
    // 4) 工作流引用改写:随包技能 → bundle: 前缀;builtin 原样保留
    const list = (await page.evaluate(async () => {
      const spark = (window as unknown as SparkWindow).spark
      return (await spark.invoke('workflow:list', {})) as {
        workflows: { id: string; name: string }[]
      }
    })) as { workflows: { id: string; name: string }[] }
    const importedWorkflow = list.workflows.find((w) => w.name === '内容生成流水线')
    expect(importedWorkflow).toBeDefined()
    if (importedWorkflow == null) throw new Error('未找到导入的工作流')
    const got = (await page.evaluate(async (id) => {
      const spark = (window as unknown as SparkWindow).spark
      return (await spark.invoke('workflow:get', { id })) as {
        workflow: { graph: { nodes: { config: { skillIds: string[] } }[] } } | null
      }
    }, importedWorkflow.id)) as {
      workflow: { graph: { nodes: { config: { skillIds: string[] } }[] } } | null
    }
    expect(got.workflow?.graph.nodes[0]?.config.skillIds).toEqual([bundled.id, 'builtin:commit'])

    // 5) 包面板「验证此包」:技能检查真实读取落盘目录,应全部通过
    await page.getByRole('button', { name: '工作流包', exact: true }).click()
    const drawer = page.locator('.ant-drawer', { hasText: '隔离空间' })
    await expect(drawer.locator('.wf-bundle-card')).toHaveCount(1)
    await drawer.getByRole('button', { name: '验证此包' }).click()
    await expect(drawer.locator('.wf-bundle-card-check').first()).toBeVisible({ timeout: 30_000 })
    await expect(drawer.getByText('已验证', { exact: true })).toBeVisible()

    expect(pageErrors).toEqual([])
  })
})
