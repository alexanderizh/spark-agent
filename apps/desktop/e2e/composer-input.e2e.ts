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

async function dismissOptionalCapabilityPrompt(page: Page): Promise<void> {
  const modal = page.locator('.optional-capability-modal')
  const later = modal.locator('.ant-modal-footer button').first()

  try {
    await later.waitFor({ state: 'visible', timeout: 1_000 })
    await later.click()
    await expect(modal).toBeHidden()
  } catch {
    // The prompt is optional and may be disabled by persisted app state.
  }
}

test.describe('Composer Lexical input', () => {
  let electronApp: ElectronApplication
  let page: Page
  let userDataPath: string

  test.beforeEach(async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'spark-composer-e2e-'))
    electronApp = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${userDataPath}`, '--disable-gpu'],
      cwd: DESKTOP_ROOT,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        NODE_ENV: 'production',
        SPARK_ALLOW_MULTIPLE_INSTANCES: '1',
        SPARK_SKIP_PROTOCOL_REGISTRATION: '1',
        SPARK_AUTH_KEYTAR_SERVICE: `SparkAgent.ComposerE2E.${process.pid}.${Date.now()}`,
        SPARK_DISABLE_DEVTOOLS: '1',
      },
      timeout: 20_000,
    })
    page = await electronApp.firstWindow({ timeout: 20_000 })
    await page.waitForLoadState('domcontentloaded')
  })

  test.afterEach(async () => {
    await electronApp?.close().catch(() => {})
    await rm(userDataPath, { recursive: true, force: true })
  })

  test('renders an inserted slash command as an atomic token in one contenteditable', async () => {
    await dismissOnboarding(page)
    await page.getByRole('button', { name: '新建任务', exact: true }).click()

    await dismissOptionalCapabilityPrompt(page)

    const editor = page.locator('.composer-v2 .composer-input[contenteditable="true"]')
    await expect(editor).toBeVisible()
    await expect(page.locator('.composer-v2 textarea')).toHaveCount(0)

    await dismissOptionalCapabilityPrompt(page)
    await page.getByTitle('添加文件、图片或技能').click()
    await dismissOptionalCapabilityPrompt(page)
    await page.getByRole('button', { name: '命令', exact: true }).click()
    const commandItem = page.locator('.slash-cmd-item').first()
    await expect(commandItem).toBeVisible()
    await commandItem.click()

    await expect(editor.locator('.composer-input-token.is-command')).toHaveCount(1)
    await expect(editor).toContainText(/^\/[^\s]+\s$/)
    await expect(page.locator('.composer-input-highlights')).toHaveCount(0)
  })
})
