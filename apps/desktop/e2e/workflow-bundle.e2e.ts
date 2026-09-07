import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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

type SparkWindow = Window & { spark: { invoke: (channel: string, payload?: unknown) => unknown } }

async function dismissOnboarding(page: Page): Promise<void> {
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
}

async function openWorkflowsView(page: Page): Promise<void> {
  // 侧边栏导航按钮的可访问名含 Beta 徽标,用前缀正则匹配并限定在侧边栏内
  await page
    .locator('.floating-sidebar')
    .getByRole('button', { name: /^工作流/ })
    .click()
  // 「导出全部」按钮可见 = WorkflowView 列表区完成挂载
  await expect(page.getByRole('button', { name: '导出全部', exact: true })).toBeVisible()
}

async function listWorkflowCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const spark = (window as unknown as SparkWindow).spark
    const result = (await spark.invoke('workflow:list', {})) as {
      workflows: { id: string; name: string }[]
    }
    return result.workflows.length
  })
}

test.describe.serial('Workflow bundle (.sparkflow) import/export', () => {
  let electronApp: ElectronApplication
  let page: Page
  let userDataPath: string
  let pageErrors: Error[]

  test.beforeEach(async () => {
    // 钩子与测试共享超时预算,必须在钩子开头就放宽(全局默认 30s 不够引导页收尾)
    test.setTimeout(180_000)
    userDataPath = await mkdtemp(join(tmpdir(), 'spark-workflow-bundle-e2e-'))
    pageErrors = []
    electronApp = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${userDataPath}`, '--disable-gpu'],
      cwd: DESKTOP_ROOT,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        NODE_ENV: 'production',
        SPARK_ALLOW_MULTIPLE_INSTANCES: '1',
        SPARK_SKIP_PROTOCOL_REGISTRATION: '1',
        SPARK_AUTH_KEYTAR_SERVICE: `SparkAgent.CloudAuth.E2E.Bundle.${process.pid}.${Date.now()}`,
        SPARK_DISABLE_DEVTOOLS: '1',
      },
      timeout: 20_000,
    })
    page = await electronApp.firstWindow({ timeout: 20_000 })
    page.on('pageerror', (error) => pageErrors.push(error))
    await page.waitForLoadState('domcontentloaded')
    await dismissOnboarding(page)
    await openWorkflowsView(page)
  })

  test.afterEach(async () => {
    await electronApp?.close().catch(() => {})
    await rm(userDataPath, { recursive: true, force: true })
  })

  test('导出 → 导入预览 → 隔离导入 → 面板验证 → 卸载零残留 全流程', async () => {
    test.setTimeout(180_000)

    // 0) 预置两个自建工作流(经真实 IPC 落库)
    await page.evaluate(async () => {
      const spark = (window as unknown as SparkWindow).spark
      for (const name of ['包内工作流甲', '包内工作流乙']) {
        await spark.invoke('workflow:create', {
          name,
          description: 'e2e 工作流包闭环验证',
          status: 'active',
          tags: ['e2e'],
          enabled: true,
          graph: { nodes: [], edges: [] },
        })
      }
    })
    // 工具栏「刷新」重新拉取列表(创建经 IPC 落库,视图状态需显式刷新),并等卡片出现避免导出竞态
    await page.getByRole('button', { name: /刷\s*新/ }).click()
    await expect(page.getByText('包内工作流甲')).toBeVisible()
    await expect(page.getByText('包内工作流乙')).toBeVisible()
    // 新库含内置种子工作流(028 迁移「全栈开发标准流程」),基线动态获取,后续断言全部用相对值
    const baseline = await listWorkflowCount(page)
    expect(baseline).toBeGreaterThanOrEqual(2)

    // 1) 替换文件对话框:保存与打开都指向同一包文件
    //    注意:dialog 通道经 typedIpcHandle 注册,renderer 侧会解 {ok,data} 信封,stub 必须返回同形信封
    const bundlePath = join(userDataPath, 'e2e-export.sparkflow')
    await electronApp.evaluate(({ ipcMain }, filePath) => {
      ipcMain.removeHandler('dialog:save-file')
      ipcMain.handle('dialog:save-file', () => ({ ok: true, data: { canceled: false, filePath } }))
      ipcMain.removeHandler('dialog:open-file')
      ipcMain.handle('dialog:open-file', () => ({
        ok: true,
        data: { canceled: false, filePaths: [filePath] },
      }))
    }, bundlePath)

    // 2) 导出全部 → 完整工作流包
    await page.getByRole('button', { name: '导出全部', exact: true }).click()
    const exportModal = page.getByRole('dialog', { name: '导出工作流' })
    await expect(exportModal).toBeVisible()
    await expect(exportModal.getByText('完整工作流包(.sparkflow)')).toBeVisible()
    // antd 会给纯文本两字按钮插空格(「导 出」),用正则容错
    await exportModal.getByRole('button', { name: /导\s*出/ }).click()
    await expect(page.locator('.spark-toast-success').first()).toBeVisible({ timeout: 15_000 })

    const bundleStat = await stat(bundlePath)
    expect(bundleStat.size).toBeGreaterThan(0)
    const magic = await readFile(bundlePath).then((buf) => buf.subarray(0, 2).toString('latin1'))
    expect(magic).toBe('PK') // zip 容器

    // 直接解包读 manifest,核对导出的工作流清单(与导入预览互为印证)
    const { unzipSync } = createRequire(
      join(DESKTOP_ROOT, '../packages/agent-runtime/package.json'),
    )('fflate')
    const zipped = unzipSync(await readFile(bundlePath))
    const exportedManifest = JSON.parse(new TextDecoder().decode(zipped['manifest.json'])) as {
      workflows: { name: string }[]
    }
    expect(exportedManifest.workflows.map((w) => w.name)).toEqual(
      expect.arrayContaining(['包内工作流甲', '包内工作流乙']),
    )

    // 3) 导入 → 依赖预览 → 确认导入
    await page.getByRole('button', { name: '导入', exact: true }).click()
    await page.getByRole('menuitem', { name: /工作流包\(\.sparkflow/ }).click()
    const previewModal = page.getByRole('dialog', { name: '导入工作流包 — 依赖预览' })
    await expect(previewModal).toBeVisible()
    await expect(previewModal.getByText('包内工作流甲')).toBeVisible()
    await expect(previewModal.getByText('包内工作流乙')).toBeVisible()
    await previewModal.getByRole('button', { name: '确认导入' }).click()
    await expect(page.locator('.spark-toast-success').first()).toBeVisible({ timeout: 15_000 })

    // 「导出全部」导出 baseline 个,导入落副本后总数翻倍
    expect(await listWorkflowCount(page)).toBe(baseline * 2)

    // 4) 工作流包面板:卡片出现并验证
    await page.getByRole('button', { name: '工作流包', exact: true }).click()
    const drawer = page.locator('.ant-drawer', { hasText: '隔离空间' })
    await expect(drawer.locator('.wf-bundle-card')).toHaveCount(1)
    await expect(drawer.locator('.wf-bundle-card-meta')).toContainText(`${baseline} 个工作流`)
    await expect(drawer.getByText('未验证', { exact: true })).toBeVisible()

    await drawer.getByRole('button', { name: '验证此包' }).click()
    await expect(drawer.locator('.wf-bundle-card-check').first()).toBeVisible({ timeout: 30_000 })
    await expect(drawer.getByText('已验证', { exact: true })).toBeVisible()

    // 5) 卸载整包(Popconfirm 二次确认;antd 两字纯文本按钮会插空格,用正则)
    await drawer
      .locator('.wf-bundle-card')
      .getByRole('button', { name: /卸\s*载/ })
      .click()
    const popover = page.locator('.ant-popover:visible')
    await popover.getByRole('button', { name: /卸\s*载/ }).click()
    // Empty 组件的 description 是整句长文案,用子串匹配
    await expect(drawer.getByText('还没有导入工作流包')).toBeVisible({ timeout: 15_000 })

    // 6) 卸载后零残留:工作流列表回到基线
    expect(await listWorkflowCount(page)).toBe(baseline)

    expect(pageErrors).toEqual([])
  })
})
