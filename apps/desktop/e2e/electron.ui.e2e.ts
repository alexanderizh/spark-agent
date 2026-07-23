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
    await expect(page.locator('.floating-sidebar')).toBeVisible()
    await expect(page.getByText('新建任务', { exact: true })).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('opens the infinite-canvas workflow library', async ({}, testInfo) => {
    await page.locator('.nav-item', { hasText: '无限画布' }).first().click()
    await expect(page.getByRole('heading', { name: '无限画布', exact: true })).toBeVisible()

    await page.getByRole('button', { name: '画布工作流库', exact: true }).click()
    await expect(page.getByRole('region', { name: '画布工作流库' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '工作流范围' })).toBeVisible()
    await expect(page.getByRole('button', { name: '新建工作流' })).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('canvas-workflow-library.png'),
      fullPage: true,
    })
    expect(pageErrors).toEqual([])
  })

  test('creates a canvas project and opens its workflow drawer', async ({}, testInfo) => {
    await page.locator('.nav-item', { hasText: '无限画布' }).first().click()
    await page.getByRole('button', { name: '新建项目', exact: true }).click()

    const createDialog = page.getByRole('dialog', { name: '新建 Canvas 项目' })
    await expect(createDialog).toBeVisible()
    await createDialog.getByPlaceholder('例如：618 商品主图').fill('工作流 E2E 项目')
    await createDialog
      .getByPlaceholder('这个项目要生成什么、有哪些素材和风格约束')
      .fill('验证项目内画布工作流入口与抽屉。')
    await createDialog.getByRole('button', { name: '创建并进入画布' }).click()

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
    await page.screenshot({
      path: testInfo.outputPath('canvas-workflow-drawer.png'),
      fullPage: true,
    })
    expect(pageErrors).toEqual([])
  })
})
