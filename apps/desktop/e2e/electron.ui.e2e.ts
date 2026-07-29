import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

const DESKTOP_ROOT = resolve(__dirname, '..')
const MAIN_ENTRY = join(DESKTOP_ROOT, 'out/main/index.js')
const CANVAS_VISUAL_ASSETS = [
  join(DESKTOP_ROOT, 'src/renderer/assets/canvas-prompt-examples/style-noir.png'),
  join(
    DESKTOP_ROOT,
    'src/renderer/assets/canvas-prompt-examples/generated/prompt-production-design-tungsten-room.png',
  ),
  join(DESKTOP_ROOT, 'src/renderer/assets/canvas-prompt-examples/generated/prompt-action-turn.png'),
]

async function seedCanvasNodeStateMatrix(page: Page): Promise<void> {
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.canvas-toolbar-savetag')).toContainText('已保存')

  const result = await page.evaluate(async () => {
    const projectId = new URLSearchParams(window.location.search).get('projectId')
    if (!projectId) throw new Error('Canvas project id is missing from window URL')
    const spark = (window as any).spark
    const loaded = await spark.invoke('canvas:snapshot:load', { projectId })
    if (!loaded.snapshotJson) throw new Error('Canvas snapshot is missing')
    const snapshot = JSON.parse(loaded.snapshotJson)
    const now = new Date().toISOString()
    const boardId = snapshot.board.id
    const baseNode = (input: Record<string, unknown>) => ({
      projectId,
      boardId,
      userId: 0,
      rotation: 0,
      zIndex: 20,
      locked: false,
      hidden: false,
      createdAt: now,
      updatedAt: now,
      ...input,
    })

    const group = snapshot.nodes.find((node: any) => node.type === 'group')
    if (group) {
      group.x = 40
      group.y = 40
    }

    snapshot.nodes.push(
      baseNode({
        id: 'visual-empty-image',
        type: 'image',
        title: '角色参考待补充',
        x: 800,
        y: 40,
        width: 460,
        height: 300,
        data: { message: '等待导入角色参考图' },
      }),
      baseNode({
        id: 'visual-empty-video',
        type: 'video',
        title: '镜头素材待补充',
        x: 1280,
        y: 40,
        width: 500,
        height: 300,
        data: { message: '等待导入视频镜头' },
      }),
      baseNode({
        id: 'visual-text-note',
        type: 'text',
        title: '第一幕 · 雨夜追踪',
        x: 800,
        y: 380,
        width: 400,
        height: 320,
        data: {
          format: 'plain',
          origin: 'manual',
          text: '雨夜的旧城区，角色沿着霓虹倒影追踪一张遗失的照片。\n\n镜头从远景缓慢推进，环境声保持克制。',
        },
      }),
      baseNode({
        id: 'visual-operation-running',
        type: 'text_to_image',
        title: '生成关键帧',
        x: 1220,
        y: 380,
        width: 460,
        height: 420,
        data: {
          operation: 'text_to_image',
          status: 'running',
          progress: 48,
          prompt: '电影感雨夜街巷，人物回头看向镜头，钨丝灯与冷色霓虹交错。',
          message: '正在生成关键帧，预计还需 12 秒',
        },
      }),
      baseNode({
        id: 'visual-operation-failed',
        type: 'image_to_video',
        title: '生成动态镜头',
        x: 800,
        y: 740,
        width: 460,
        height: 420,
        data: {
          operation: 'image_to_video',
          status: 'failed',
          progress: 68,
          prompt: '手持镜头跟随人物穿过雨巷，保持身份和服装一致。',
          message: '生成中断，请检查模型参数后重试',
        },
      }),
      baseNode({
        id: 'visual-operation-pending',
        type: 'text_to_video',
        title: '下一镜头',
        x: 1280,
        y: 840,
        width: 460,
        height: 420,
        data: {
          operation: 'text_to_video',
          status: 'pending',
          prompt: '人物停在电话亭前，镜头切到照片特写。',
          message: '连接参考节点后即可开始任务',
        },
      }),
    )
    snapshot.project.nodeCount = snapshot.nodes.length
    snapshot.project.updatedAt = now
    await spark.invoke('canvas:snapshot:save', {
      projectId,
      snapshotJson: JSON.stringify(snapshot),
      meta: {
        title: snapshot.project.title,
        nodeCount: snapshot.nodes.length,
        assetCount: snapshot.assets.length,
        taskCount: snapshot.tasks.length,
        rootPath: snapshot.project.rootPath ?? null,
      },
    })
    return { nodeCount: snapshot.nodes.length }
  })

  expect(result.nodeCount).toBeGreaterThanOrEqual(10)
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('[data-canvas-node-id="visual-empty-image"]')).toBeVisible()
  await expect(page.locator('[data-canvas-node-id="visual-empty-video"]')).toBeVisible()
  await expect(page.locator('[data-canvas-node-id="visual-operation-running"]')).toHaveClass(
    /canvas-node-task-running/,
  )
}

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
}

test.describe.serial('SparkWork Electron release acceptance', () => {
  let electronApp: ElectronApplication
  let page: Page
  let userDataPath: string
  let pageErrors: Error[]

  test.beforeEach(async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'spark-electron-e2e-'))
    const isolatedAuthService = `SparkAgent.CloudAuth.E2E.${process.pid}.${Date.now()}`
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
        SPARK_AUTH_KEYTAR_SERVICE: isolatedAuthService,
        SPARK_DISABLE_DEVTOOLS: '1',
      },
      timeout: 20_000,
    })
    page = await electronApp.firstWindow({ timeout: 20_000 })
    page.on('pageerror', (error) => pageErrors.push(error))
    await page.waitForLoadState('domcontentloaded')
  })

  test.afterEach(async () => {
    await electronApp?.close().catch(() => {})
    await rm(userDataPath, { recursive: true, force: true })
  })

  test('launches the production shell with the primary sidebar', async () => {
    await expect(page).toHaveTitle('SparkWork')
    await expect(
      page.getByRole('heading', { name: '欢迎使用 SparkWork', exact: true }),
    ).toBeVisible()
    await dismissOnboarding(page)
    await expect(page.getByText('新建任务', { exact: true })).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('opens the infinite-canvas workflow library', async ({
    browserName: _browserName,
  }, testInfo) => {
    await dismissOnboarding(page)
    await page.getByRole('tab', { name: '画布', exact: true }).click()
    await expect(page.getByRole('heading', { name: '无限画布', exact: true })).toBeVisible()

    await page.getByRole('button', { name: '画布工作流库', exact: true }).click()
    await expect(page.getByRole('region', { name: '画布工作流库' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '工作流范围' })).toBeVisible()
    await expect(page.getByRole('button', { name: '新建画布工作流', exact: true })).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('canvas-workflow-library.png'),
      fullPage: true,
    })
    expect(pageErrors).toEqual([])
  })

  test('creates a canvas project and opens its workflow drawer', async ({
    browserName: _browserName,
  }, testInfo) => {
    await dismissOnboarding(page)
    await page.getByRole('tab', { name: '画布', exact: true }).click()
    await expect(page.getByRole('heading', { name: '无限画布', exact: true })).toBeVisible()
    await page.getByRole('main').getByRole('button', { name: '新建项目', exact: true }).click()

    const createDialog = page.getByRole('dialog', { name: '新建 Canvas 项目' })
    await expect(createDialog).toBeVisible()
    await createDialog.getByPlaceholder('例如：618 商品主图').fill('工作流 E2E 项目')
    await createDialog
      .getByPlaceholder('这个项目要生成什么、有哪些素材和风格约束')
      .fill('验证项目内画布工作流入口与抽屉。')
    const canvasWindowPromise = electronApp.waitForEvent('window')
    await createDialog.getByRole('button', { name: '创建并进入画布' }).click()
    page = await canvasWindowPromise
    page.on('pageerror', (error) => pageErrors.push(error))
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('.canvas-workspace.canvas-cinematic')).toBeVisible()
    const canvasBackButton = page.getByRole('button', { name: '项目', exact: true })
    const backButtonBox = await canvasBackButton.boundingBox()
    if (backButtonBox == null) throw new Error('Canvas back button has no visible bounding box')
    if (process.platform === 'darwin') {
      expect(backButtonBox.x).toBeGreaterThanOrEqual(92)
    }
    const viewport = page.viewportSize()
    await page.screenshot({
      path: testInfo.outputPath('canvas-macos-titlebar-safe-area.png'),
      clip: {
        x: 0,
        y: 0,
        width: Math.min(viewport?.width ?? 900, 900),
        height: 90,
      },
    })
    await expect(page.getByRole('region', { name: '空画布创作引导' })).toBeVisible()
    await expect(page.locator('.canvas-agent-side-panel:not(.is-collapsed)')).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('canvas-cinematic-empty.png'),
      fullPage: true,
    })

    await page.locator('input[type="file"]:not([accept])').setInputFiles(CANVAS_VISUAL_ASSETS)
    await expect(page.locator('.canvas-stage .canvas-node.canvas-node-image')).toHaveCount(3)
    await page.getByRole('button', { name: '适配全部节点', exact: true }).click()
    await page.screenshot({
      path: testInfo.outputPath('canvas-cinematic-media-nodes.png'),
      fullPage: true,
    })

    await seedCanvasNodeStateMatrix(page)
    await page.getByRole('button', { name: '适配全部节点', exact: true }).click()
    await expect
      .poll(async () =>
        Number.parseInt(
          (await page.locator('.canvas-controls-zoom-label').textContent()) ?? '100',
          10,
        ),
      )
      .toBeLessThan(80)
    await expect
      .poll(() =>
        page
          .locator('[data-canvas-node-id="visual-operation-running"]')
          .evaluate((node) => getComputedStyle(node, '::before').animationName),
      )
      .toContain('canvas-cinema-running-border')
    await page.screenshot({
      path: testInfo.outputPath('canvas-cinematic-node-state-matrix.png'),
      fullPage: true,
    })
    await page.getByRole('button', { name: '选择', exact: true }).click()
    await page.locator('[data-canvas-node-id="visual-empty-image"]').click()
    await page.getByRole('button', { name: '回到选中节点中心', exact: true }).click()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const zoom = Number.parseInt(
        (await page.locator('.canvas-controls-zoom-label').textContent()) ?? '100',
        10,
      )
      if (zoom >= 95) break
      await page.getByRole('button', { name: '放大', exact: true }).click()
    }
    await expect
      .poll(async () =>
        Number.parseInt(
          (await page.locator('.canvas-controls-zoom-label').textContent()) ?? '0',
          10,
        ),
      )
      .toBeGreaterThanOrEqual(90)
    await page.screenshot({
      path: testInfo.outputPath('canvas-cinematic-flat-media-detail-100.png'),
      fullPage: true,
    })
    await page.getByRole('button', { name: '适配视图', exact: true }).click()
    await expect
      .poll(async () =>
        Number.parseInt(
          (await page.locator('.canvas-controls-zoom-label').textContent()) ?? '100',
          10,
        ),
      )
      .toBeLessThan(80)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const zoom = Number.parseInt(
        (await page.locator('.canvas-controls-zoom-label').textContent()) ?? '100',
        10,
      )
      if (zoom >= 95) break
      await page.getByRole('button', { name: '放大', exact: true }).click()
    }
    await expect
      .poll(async () =>
        Number.parseInt(
          (await page.locator('.canvas-controls-zoom-label').textContent()) ?? '0',
          10,
        ),
      )
      .toBeGreaterThanOrEqual(95)
    await page.screenshot({
      path: testInfo.outputPath('canvas-cinematic-node-detail-100.png'),
      fullPage: true,
    })
    await page.getByRole('button', { name: '适配视图', exact: true }).click()
    await expect
      .poll(async () =>
        Number.parseInt(
          (await page.locator('.canvas-controls-zoom-label').textContent()) ?? '100',
          10,
        ),
      )
      .toBeLessThan(80)

    const workflowButton = page.getByRole('button', { name: '画布工作流', exact: true })
    await expect(workflowButton).toBeVisible({ timeout: 15_000 })
    await workflowButton.click()

    const workflowDrawer = page.getByRole('dialog', { name: '画布工作流' })
    await expect(workflowDrawer).toBeVisible()
    await expect(workflowDrawer.getByRole('tab', { name: '查看当前项目工作流' })).toBeVisible()
    await expect(workflowDrawer.getByRole('tab', { name: '查看个人工作流' })).toBeVisible()
    await expect(workflowDrawer.getByRole('tab', { name: '查看内置模板' })).toBeVisible()
    await expect(
      workflowDrawer.getByRole('button', { name: '从当前选区提取工作流' }),
    ).toBeDisabled()
    await expect(workflowDrawer.locator('.canvas-workflow-drawer-list')).toHaveAttribute(
      'data-load-state',
      'ready',
    )
    await expect(workflowDrawer.getByText('这里还没有可用工作流', { exact: true })).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('canvas-workflow-drawer.png'),
      fullPage: true,
    })
    expect(pageErrors).toEqual([])
  })
})
