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
  join(DESKTOP_ROOT, 'src/renderer/assets/spark-logo.png'),
  join(DESKTOP_ROOT, 'src/renderer/assets/builtin-avatars/agent-default.png'),
  join(DESKTOP_ROOT, 'src/renderer/assets/builtin-avatars/animal-kitten-artist.png'),
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
    const baseTask = (input: Record<string, unknown>) => ({
      projectId,
      boardId,
      userId: 0,
      progress: 0,
      inputNodeIds: [],
      inputAssetIds: [],
      outputNodeIds: [],
      outputAssetIds: [],
      modelParams: {},
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
        taskId: 'visual-task-running',
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
        taskId: 'visual-task-failed',
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
        taskId: 'visual-task-pending',
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
    snapshot.tasks.push(
      baseTask({
        id: 'visual-task-running',
        operation: 'text_to_image',
        operationNodeId: 'visual-operation-running',
        status: 'running',
        progress: 48,
      }),
      baseTask({
        id: 'visual-task-failed',
        operation: 'image_to_video',
        operationNodeId: 'visual-operation-failed',
        status: 'failed',
        progress: 68,
        errorMsg: '生成中断，请检查模型参数后重试',
      }),
      baseTask({
        id: 'visual-task-pending',
        operation: 'text_to_video',
        operationNodeId: 'visual-operation-pending',
        status: 'pending',
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

  test('shows Codex Runtime diagnostics and safely restarts only idle runtimes', async ({
    browserName: _browserName,
  }, testInfo) => {
    test.setTimeout(60_000)
    await dismissOnboarding(page)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '完整性', exact: true }).click()

    const card = page.locator('.codex-runtime-diagnostics')
    await expect(card.getByRole('heading', { name: 'Codex Runtime 诊断' })).toBeVisible()
    await expect(
      card.getByText('尚无活跃 Runtime；首次 Codex 会话执行后会显示诊断。'),
    ).toBeVisible()
    const refreshButton = card.locator('.codex-runtime-actions button').first()
    await expect(refreshButton).not.toHaveClass(/ant-btn-loading/)

    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('codex-runtime:diagnostics')
      ipcMain.handle('codex-runtime:diagnostics', () => ({
        ok: true,
        data: {
          enabled: true,
          source: 'default',
          diagnostics: {
            disposed: false,
            activeRuntimeCount: 1,
            leasedRuntimeCount: 0,
            processCount: 1,
            totalRssBytes: 64 * 1024 * 1024,
            totalHandleCount: 24,
            counters: {
              acquireCount: 6,
              coldStartCount: 1,
              warmHitCount: 5,
              warmHitRate: 5 / 6,
              fingerprintRotationCount: 0,
              crashReplacementCount: 0,
              invalidationCount: 0,
              startFailureCount: 0,
              ttlEvictionCount: 0,
              lruEvictionCount: 0,
              manualRestartCount: 0,
              threadLoadedCount: 5,
              threadResumeCount: 0,
              threadStartCount: 1,
              threadResumeFallbackCount: 0,
            },
            latency: {
              coldAcquire: { count: 1, p50Ms: 210, p95Ms: 210, maxMs: 210 },
              warmAcquire: { count: 5, p50Ms: 2, p95Ms: 4, maxMs: 4 },
              coldTurnStart: { count: 1, p50Ms: 180, p95Ms: 180, maxMs: 180 },
              warmTurnStart: { count: 5, p50Ms: 22, p95Ms: 40, maxMs: 40 },
            },
            runtimes: [
              {
                leaseId: 'a1b2c3d4e5f6',
                state: 'idle',
                lastUsedAt: '2026-08-21T12:00:00.000Z',
                resourceCount: 1,
                pid: 1234,
                rssBytes: 64 * 1024 * 1024,
                handleCount: 24,
                loadedThreadCount: 1,
              },
            ],
          },
        },
      }))
      ipcMain.removeHandler('codex-runtime:restart-idle')
      ipcMain.handle('codex-runtime:restart-idle', () => ({
        ok: true,
        data: {
          enabled: true,
          result: {
            restartedLeaseIds: ['a1b2c3d4e5f6'],
            busyLeaseIds: ['running-runtime'],
          },
        },
      }))
    })

    await refreshButton.click()
    await expect(card.getByText('83%', { exact: true })).toBeVisible()
    await expect(card.getByText('Runtime a1b2c3d4e5f6', { exact: true })).toBeVisible()
    await expect(card.getByText('40ms', { exact: true }).first()).toBeVisible()

    await page.setViewportSize({ width: 820, height: 760 })
    await expect
      .poll(() =>
        card
          .locator('.codex-runtime-summary-grid')
          .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
      )
      .toBe(2)

    await card.getByRole('button', { name: '重启空闲 Runtime', exact: true }).click()
    await expect(card.getByText('已重启 1 个空闲 Runtime，跳过 1 个运行中任务')).toBeVisible()
    await card.screenshot({ path: testInfo.outputPath('codex-runtime-diagnostics.png') })
    expect(pageErrors).toEqual([])
  })

  test('opens the infinite-canvas workflow library', async ({
    browserName: _browserName,
  }, testInfo) => {
    await dismissOnboarding(page)
    await page.getByRole('tab', { name: '画布', exact: true }).click()
    await expect(page.getByRole('heading', { name: '无限画布', exact: true })).toBeVisible()

    await page.getByRole('button', { name: '画布工作流', exact: true }).click()
    await expect(page.getByRole('region', { name: '画布工作流' })).toBeVisible()
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
    test.setTimeout(60_000)
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
    const rightPanelRail = page.getByRole('toolbar', { name: '右侧面板控制' })
    const settleRightPanelRail = () =>
      rightPanelRail.evaluate(async (element) => {
        await Promise.all(
          element
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => undefined)),
        )
      })
    await expect(rightPanelRail).toBeVisible()
    await expect(rightPanelRail.getByRole('button')).toHaveCount(2)
    await expect(rightPanelRail.getByRole('button', { name: '收起画布助手' })).toBeVisible()
    await expect(rightPanelRail.getByRole('button', { name: '展开工作面板' })).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('canvas-right-panel-rail-assistant-only.png'),
      fullPage: true,
    })
    await rightPanelRail.screenshot({
      path: testInfo.outputPath('canvas-right-panel-rail-assistant-control.png'),
    })

    await rightPanelRail.getByRole('button', { name: '展开工作面板' }).click()
    await expect(rightPanelRail.getByRole('button', { name: '收起工作面板' })).toBeVisible()
    await expect(rightPanelRail.getByRole('button', { name: '展开画布助手' })).toBeVisible()
    await expect(page.locator('.canvas-agent-side-panel:not(.is-collapsed)')).toHaveCount(0)
    await settleRightPanelRail()
    await page.screenshot({
      path: testInfo.outputPath('canvas-right-panel-rail-workspace-only.png'),
      fullPage: true,
    })
    await rightPanelRail.screenshot({
      path: testInfo.outputPath('canvas-right-panel-rail-workspace-control.png'),
    })

    await rightPanelRail.getByRole('button', { name: '收起工作面板' }).click()
    await expect(rightPanelRail.getByRole('button', { name: '展开工作面板' })).toBeVisible()
    await settleRightPanelRail()
    await page.screenshot({
      path: testInfo.outputPath('canvas-right-panel-rail-both-closed.png'),
      fullPage: true,
    })
    await rightPanelRail.screenshot({
      path: testInfo.outputPath('canvas-right-panel-rail-closed-control.png'),
    })
    await rightPanelRail.getByRole('button', { name: '展开画布助手' }).click()
    await expect(rightPanelRail.getByRole('button', { name: '收起画布助手' })).toBeVisible()
    await expect(page.locator('.canvas-side-panel')).toHaveCount(0)
    await settleRightPanelRail()

    await page.getByRole('button', { name: /打开节点预设中心/ }).click()
    const presetDialog = page.locator('.canvas-operation-preset-dialog')
    const presetContent = page.locator('.ant-modal-container', {
      has: page.locator('.canvas-operation-preset-modal-shell'),
    })
    await expect(presetDialog).toBeVisible()
    const presetInnerGutter = await presetContent.evaluate((content, shellSelector) => {
      const shell = content.querySelector<HTMLElement>(shellSelector)
      if (shell == null) throw new Error('Preset modal shell is missing')
      const contentRect = content.getBoundingClientRect()
      const shellRect = shell.getBoundingClientRect()
      return {
        top: Math.abs(shellRect.top - contentRect.top),
        right: Math.abs(contentRect.right - shellRect.right),
        bottom: Math.abs(contentRect.bottom - shellRect.bottom),
        left: Math.abs(shellRect.left - contentRect.left),
      }
    }, '.canvas-operation-preset-modal-shell')
    expect(Math.max(...Object.values(presetInnerGutter))).toBeLessThanOrEqual(1)
    await presetContent.screenshot({
      path: testInfo.outputPath('canvas-preset-center-full-bleed.png'),
    })
    await presetDialog.getByRole('button', { name: '关闭画布默认设置' }).click()
    await expect(presetDialog).not.toBeVisible()

    const zoomControls = page.locator('.canvas-controls')
    const zoomControlButtons = zoomControls.locator('.canvas-controls-button')
    await expect(zoomControls).toBeVisible()
    await expect(zoomControlButtons).toHaveCount(5)
    const zoomControlPalette = await zoomControls.evaluate((controls) => {
      const firstButton = controls.querySelector<HTMLElement>('.canvas-controls-button')
      if (firstButton == null) throw new Error('Canvas zoom control button is missing')
      const groupStyle = getComputedStyle(controls)
      const buttonStyle = getComputedStyle(firstButton)
      return {
        groupBackground: groupStyle.backgroundColor,
        buttonBackground: buttonStyle.backgroundColor,
        buttonColor: buttonStyle.color,
      }
    })
    expect(zoomControlPalette.groupBackground).not.toBe('rgba(0, 0, 0, 0)')
    expect(zoomControlPalette.buttonBackground).toBe('rgba(0, 0, 0, 0)')
    expect(zoomControlPalette.buttonColor).not.toBe('rgb(255, 255, 255)')
    await zoomControls.screenshot({
      path: testInfo.outputPath('canvas-zoom-controls-flat-dark.png'),
    })

    await zoomControls.getByRole('button', { name: '锁定画布元素' }).click()
    const lockedCanvasControl = zoomControls.getByRole('button', { name: '解锁画布元素' })
    await expect(lockedCanvasControl).toHaveAttribute('aria-pressed', 'true')
    await zoomControls.screenshot({
      path: testInfo.outputPath('canvas-zoom-controls-locked-state.png'),
    })
    await lockedCanvasControl.click()
    await expect(zoomControls.getByRole('button', { name: '锁定画布元素' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

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
    await page.locator('[data-canvas-node-id="visual-operation-pending"]').dblclick()
    const promptComposer = page.locator('.canvas-node-floating-panel .canvas-prompt-composer')
    await expect(promptComposer).toBeVisible()
    const promptInsertButton = promptComposer.getByRole('button', {
      name: '添加参数、图片、视频或资源',
    })
    await expect(promptInsertButton).toBeVisible()
    await promptInsertButton.click()
    const promptInsertMenu = page.locator('.canvas-prompt-insert-menu')
    await expect(promptInsertMenu).toBeVisible()
    await expect(promptInsertMenu).toContainText('镜头时长')
    await page.keyboard.press('Escape')
    await expect(promptInsertMenu).not.toBeVisible()
    const floatingPanel = page.locator('.canvas-node-floating-panel')
    if (await floatingPanel.isVisible().catch(() => false)) {
      await page.locator('.canvas-node-bottom-editor-toolbar button').last().click()
    }
    await expect(floatingPanel).not.toBeVisible()
    await page.getByRole('button', { name: '适配全部节点', exact: true }).click()
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

    await workflowDrawer.getByRole('button', { name: '关闭画布工作流' }).click()
    await expect(workflowDrawer).not.toBeVisible()
    await rightPanelRail.getByRole('button', { name: '展开画布助手' }).click()
    await expect(rightPanelRail.getByRole('button', { name: '收起画布助手' })).toBeVisible()

    const permissionPicker = page.locator(
      '.canvas-agent-modal .composer-permission-picker .composer-select-trigger',
    )
    await expect(permissionPicker).toBeVisible()
    await permissionPicker.click()
    await expect(page.locator('.canvas-agent-permission-menu')).toBeVisible()
    await expect(page.locator('.canvas-agent-permission-menu')).toContainText('运行权限')
    const alternatePermission = page.locator('.canvas-agent-permission-option:not(.active)').first()
    const alternatePermissionLabel = await alternatePermission.locator('strong').innerText()
    await alternatePermission.click()
    await expect(page.locator('.canvas-agent-permission-menu')).not.toBeVisible()
    await expect(permissionPicker).toContainText(alternatePermissionLabel)
    await expect(rightPanelRail.getByRole('button', { name: '收起画布助手' })).toBeVisible()

    const canvasAgentChat = page.locator('.canvas-agent-modal .chat-panel')
    await canvasAgentChat.evaluate((element) => {
      const dataTransfer = new DataTransfer()
      dataTransfer.setData(
        'application/x-spark-canvas-agent-artifact+json',
        JSON.stringify({
          version: 1,
          kind: 'canvas-artifact',
          id: 'e2e-artifact',
          title: 'E2E 产物',
          artifactType: 'file',
          filePath: '/tmp/canvas-agent-e2e.txt',
        }),
      )
      element.dispatchEvent(
        new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }),
      )
    })
    await expect(page.locator('.chat-panel-drop-overlay')).toBeVisible()
    await expect(page.locator('.chat-panel-drop-overlay')).toContainText('放开以加入会话')
    await canvasAgentChat.evaluate((element) => {
      const dataTransfer = new DataTransfer()
      dataTransfer.setData(
        'application/x-spark-canvas-agent-artifact+json',
        JSON.stringify({
          version: 1,
          kind: 'canvas-artifact',
          id: 'e2e-artifact',
          title: 'E2E 产物',
          artifactType: 'file',
          filePath: '/tmp/canvas-agent-e2e.txt',
        }),
      )
      element.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
      )
    })
    const removeDroppedArtifact = page.getByRole('button', {
      name: '移除 canvas-agent-e2e.txt',
    })
    await expect(removeDroppedArtifact).toBeVisible()
    await removeDroppedArtifact.click()
    await expect(removeDroppedArtifact).not.toBeVisible()

    await page.evaluate(() => {
      const sparkWindow = window as Window & {
        spark: { invoke: (...args: unknown[]) => unknown }
      }
      const originalInvoke = sparkWindow.spark.invoke.bind(sparkWindow.spark)
      sparkWindow.spark.invoke = (...args: unknown[]) => {
        if (args[0] === 'workspace:open') return new Promise(() => undefined)
        return originalInvoke(...args)
      }
    })
    const canvasAgentComposer = page.getByPlaceholder('输入消息，让 agent 操作画布...')
    await canvasAgentComposer.fill('验证用户消息不再显示指针图标头像')
    await canvasAgentComposer.press('Enter')
    const canvasUserMessage = page.locator('.canvas-agent-modal .chat-panel-message-user')
    await expect(canvasUserMessage).toBeVisible()
    await expect(canvasUserMessage.locator('.chat-panel-message-avatar')).toHaveCount(0)
    await page.locator('.canvas-agent-side-panel').screenshot({
      path: testInfo.outputPath('canvas-agent-user-message-without-fake-avatar.png'),
    })
    expect(pageErrors).toEqual([])
  })
})
