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

type SparkInvoke = (channel: string, payload?: unknown) => Promise<unknown>

function sparkOf(page: Page): SparkInvoke {
  return (channel, payload) =>
    page.evaluate(
      ({ channel, payload }) =>
        (
          window as unknown as { spark: { invoke: (c: string, p?: unknown) => Promise<unknown> } }
        ).spark.invoke(channel, payload),
      { channel, payload },
    ) as Promise<unknown>
}

/**
 * 子应用源码模板：
 *   - 上报 runtime.getInfo() 的 mode/surface（验证宿主注入的运行身份）
 *   - 有 data 权限时：upsert('e2e','boot') 并把 revision 写回 DOM
 *   - data-expect-deny：调用 data.get 应被权限拒绝，错误码回显到 DOM
 *   - 有 data 权限时：主题监听把收到的 theme 写入 data('e2e','theme')
 */
function makeAppSource(marker: string, expectDeny = false, useToast = false): string {
  return `<!doctype html>
<html>
<body data-marker="${marker}" data-expect-deny="${expectDeny ? '1' : '0'}" data-use-toast="${useToast ? '1' : '0'}">
<div id="root" data-state="boot">booting</div>
<script>
(function () {
  var root = document.getElementById('root')
  var marker = document.body.getAttribute('data-marker')
  function set(text, state) {
    root.textContent = text
    root.dataset.state = state
  }
  // upsert 对已存在记录要求 expectedRevision（CAS 防丢失更新）——
  // 正确模式是先 get 再带 revision 写。
  function put(namespace, key, value) {
    return window.sparkApp.data.get(namespace, key).then(function (rec) {
      return window.sparkApp.data.upsert(
        namespace,
        key,
        value,
        rec == null ? undefined : rec.revision,
      )
    })
  }
  window.sparkApp.runtime.getInfo().then(function (info) {
    root.dataset.mode = info.mode
    root.dataset.surface = info.surface
    if (document.body.getAttribute('data-expect-deny') === '1') return info
    return put('e2e', 'boot', { marker: marker, mode: info.mode }).then(function (rec) {
      root.dataset.revision = String(rec.revision)
      set('READY marker=' + marker + ' mode=' + info.mode, 'ready')
      if (document.body.getAttribute('data-use-toast') === '1') {
        window.sparkApp.ui.toast('E2E-TOAST-OK', 'success').catch(function () {})
      }
      return info
    })
  }).catch(function (err) {
    set('ERR ' + (err.code || 'UNKNOWN') + ': ' + err.message, 'error')
    return
  })
  if (document.body.getAttribute('data-expect-deny') === '1') {
    window.sparkApp.data.get('e2e', 'boot').then(function () {
      set('UNEXPECTED-PERMIT', 'permit')
    }).catch(function (err) {
      set('DENIED ' + (err.code || 'UNKNOWN'), 'denied')
    })
  }
  window.sparkApp.theme.onChange(function (theme) {
    root.dataset.themeSeen = theme.theme
    if (document.body.getAttribute('data-expect-deny') === '1') return
    put('e2e', 'theme', { theme: theme.theme, primary: theme.primaryColor }).catch(function () {})
  })
})()
</script>
</body>
</html>`
}

async function launchApp(): Promise<{
  electronApp: ElectronApplication
  page: Page
  userDataPath: string
  authService: string
}> {
  const userDataPath = await mkdtemp(join(tmpdir(), 'spark-subapp-e2e-'))
  const authService = `SparkAgent.CloudAuth.SubAppE2E.${process.pid}.${Date.now()}`
  const electronApp = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataPath}`, '--disable-gpu'],
    cwd: DESKTOP_ROOT,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      NODE_ENV: 'production',
      SPARK_ALLOW_MULTIPLE_INSTANCES: '1',
      SPARK_SKIP_PROTOCOL_REGISTRATION: '1',
      SPARK_AUTH_KEYTAR_SERVICE: authService,
      SPARK_DISABLE_DEVTOOLS: '1',
    },
    timeout: 20_000,
  })
  const page = await electronApp.firstWindow({ timeout: 20_000 })
  await page.waitForLoadState('domcontentloaded')
  return { electronApp, page, userDataPath, authService }
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
  // 首启还可能弹出「可选功能资源」下载引导（稍后 / 前往完整性 / 后台安装），
  // 出现时机不定（0-8s），会以遮罩挡住侧栏交互。轮询点「稍后」直到连续
  // 1.5s 无新弹窗为止。注意按钮文案是「稍 后」（带空格）。
  const later = page.getByRole('button', { name: /^稍\s*后$/ })
  let quietRounds = 0
  for (let attempt = 0; attempt < 30 && quietRounds < 3; attempt += 1) {
    await page.waitForTimeout(500)
    if (await later.isVisible().catch(() => false)) {
      await later.click()
      quietRounds = 0
    } else {
      quietRounds += 1
    }
  }
  try {
    await expect(page.locator('.ant-modal-wrap:visible')).toHaveCount(0, { timeout: 5000 })
  } catch {
    const info = await page
      .locator('.ant-modal-wrap:visible')
      .allInnerTexts()
      .catch(() => [])
    throw new Error(`首启弹窗未关闭: ${JSON.stringify(info).slice(0, 300)}`)
  }
}

async function openSubAppsView(page: Page, expectEmpty = true): Promise<void> {
  await dismissOnboarding(page)
  // L2 工具导航 VISIBLE_COUNT=3，「我的应用」排第 4，默认折叠在「更多」hover 菜单里。
  // navItem 按钮内含置顶 pin（带 aria-label），完整可访问名是「我的应用 置顶」——
  // 必须用子串/正则匹配，不能用 exact。
  const direct = page.getByRole('button', { name: /我的应用/ })
  if (!(await direct.isVisible().catch(() => false))) {
    const more = page.locator('.nav-more-trigger')
    await expect(more).toBeVisible()
    const inMenu = page.locator('.nav-more-menu').getByRole('button', { name: /我的应用/ })
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await more.hover()
      if (await inMenu.isVisible().catch(() => false)) break
      await page.waitForTimeout(400)
    }
    await expect(inMenu).toBeVisible()
    await inMenu.click()
  } else {
    await direct.click()
  }
  if (expectEmpty) {
    await expect(page.getByTestId('sub-app-card')).toHaveCount(0)
    await expect(page.getByText('还没有子应用', { exact: false })).toBeVisible()
  }
}

async function createApp(
  page: Page,
  input: { name: string; source: string; permissions?: string[] },
): Promise<{ id: string }> {
  const created = (await sparkOf(page)('sub-app:create', {
    name: input.name,
    description: `E2E ${input.name}`,
    surface: 'content',
    permissions: input.permissions ?? ['data'],
    source: input.source,
  })) as { id: string }
  expect(created.id).toBeTruthy()
  return created
}

test.describe.serial('SparkWork sub-app acceptance', () => {
  test('sub-app 运行、bridge 读写与重启持久化', async ({ browserName: _browserName }, testInfo) => {
    test.setTimeout(180_000)
    const { electronApp, page, userDataPath, authService } = await launchApp()
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    try {
      await openSubAppsView(page)
      const app = await createApp(page, { name: 'E2E 记账工具', source: makeAppSource('v1') })
      await page.locator('.sa-header').getByRole('button', { name: '刷新', exact: true }).click()
      await expect(page.getByTestId('sub-app-card')).toHaveCount(1)
      await expect(page.locator('.sa-card-name', { hasText: 'E2E 记账工具' })).toBeVisible()

      // 打开 → iframe 沙箱运行 → 应用经 bridge 写数据落库
      await page
        .getByTestId('sub-app-card')
        .getByRole('button', { name: /打\s*开/ })
        .click()
      const frame = page.frameLocator('iframe[title="E2E 记账工具"]')
      await expect(frame.locator('#root')).toHaveText(/READY marker=v1 mode=draft/, {
        timeout: 15_000,
      })
      const boot = (await sparkOf(page)('sub-app:data:get', {
        appId: app.id,
        namespace: 'e2e',
        key: 'boot',
      })) as { value: { marker: string; mode: string }; revision: number } | null
      expect(boot?.value.marker).toBe('v1')
      expect(boot?.value.mode).toBe('draft')
      await page.screenshot({ path: testInfo.outputPath('subapp-run-draft.png'), fullPage: true })

      // 重启（同一 userData）：应用与数据都在，bridge 仍工作
      await electronApp.close()
      const relaunched = await electron.launch({
        args: [MAIN_ENTRY, `--user-data-dir=${userDataPath}`, '--disable-gpu'],
        cwd: DESKTOP_ROOT,
        env: {
          ...process.env,
          ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
          NODE_ENV: 'production',
          SPARK_ALLOW_MULTIPLE_INSTANCES: '1',
          SPARK_SKIP_PROTOCOL_REGISTRATION: '1',
          SPARK_AUTH_KEYTAR_SERVICE: authService,
          SPARK_DISABLE_DEVTOOLS: '1',
        },
        timeout: 20_000,
      })
      const page2 = await relaunched.firstWindow({ timeout: 20_000 })
      await page2.waitForLoadState('domcontentloaded')
      await openSubAppsView(page2, false)
      await expect(page2.locator('.sa-card-name', { hasText: 'E2E 记账工具' })).toBeVisible()
      const persisted = (await sparkOf(page2)('sub-app:data:get', {
        appId: app.id,
        namespace: 'e2e',
        key: 'boot',
      })) as { value: { marker: string }; revision: number } | null
      expect(persisted?.value.marker).toBe('v1')
      await page2
        .getByTestId('sub-app-card')
        .getByRole('button', { name: /打\s*开/ })
        .click()
      const frame2 = page2.frameLocator('iframe[title="E2E 记账工具"]')
      await expect(frame2.locator('#root')).toHaveText(/READY marker=v1 mode=draft/, {
        timeout: 15_000,
      })
      await relaunched.close()
    } finally {
      await electronApp.close().catch(() => {})
      await rm(userDataPath, { recursive: true, force: true })
    }
    expect(errors).toEqual([])
  })

  test('草稿 → 发布 → 修改 → 双版本 → 回滚', async ({ browserName: _browserName }, testInfo) => {
    test.setTimeout(180_000)
    const { electronApp, page, userDataPath } = await launchApp()
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    try {
      await openSubAppsView(page)
      const app = await createApp(page, { name: 'E2E 版本工具', source: makeAppSource('v1') })
      await page.locator('.sa-header').getByRole('button', { name: '刷新', exact: true }).click()

      // 发布 v1
      await page
        .getByTestId('sub-app-card')
        .getByRole('button', { name: /发\s*布/ })
        .click()
      await page
        .locator('.ant-popconfirm')
        .getByRole('button', { name: /发\s*布/ })
        .click()
      await expect(page.getByText('已发布 v1', { exact: false })).toBeVisible({ timeout: 10_000 })

      // 打开 → 默认运行发布版（不可变）
      await page
        .getByTestId('sub-app-card')
        .getByRole('button', { name: /打\s*开/ })
        .click()
      const frame = page.frameLocator('iframe[title="E2E 版本工具"]')
      await expect(frame.locator('#root')).toHaveText(/READY marker=v1 mode=published/, {
        timeout: 15_000,
      })

      // Agent 修改草稿（走同一条 update-draft IPC，revision CAS）
      const details = (await sparkOf(page)('sub-app:get', { appId: app.id })) as {
        draftRevision: number
      }
      await sparkOf(page)('sub-app:update-draft', {
        appId: app.id,
        expectedDraftRevision: details.draftRevision,
        patch: { source: makeAppSource('v2') },
      })

      // 重新加载 → 发布版仍是 v1；切草稿预览 → v2
      await page.getByRole('button', { name: '重新加载应用' }).click()
      await expect(frame.locator('#root')).toHaveText(/READY marker=v1 mode=published/)
      await page.locator('.ant-segmented-item', { hasText: '草稿预览' }).click()
      await expect(frame.locator('#root')).toHaveText(/READY marker=v2 mode=draft/, {
        timeout: 15_000,
      })
      await page.screenshot({ path: testInfo.outputPath('subapp-draft-preview-v2.png') })

      // 发布 v2 → 版本历史出现两条 → 回滚草稿到 v1
      await page.getByRole('button', { name: /发\s*布/ }).click()
      await page
        .locator('.ant-popconfirm')
        .getByRole('button', { name: /发\s*布/ })
        .click()
      await expect(page.getByText('已发布 v2', { exact: false })).toBeVisible({ timeout: 10_000 })
      // 发布后视图仍停在草稿预览，切回「发布版」验证 v2 快照生效
      await page.locator('.ant-segmented-item', { hasText: '发布版' }).click()
      await expect(frame.locator('#root')).toHaveText(/READY marker=v2 mode=published/, {
        timeout: 15_000,
      })

      await page.getByRole('button', { name: '返回应用列表' }).click()
      await expect(page.getByTestId('sub-app-card')).toHaveCount(1)
      await page
        .getByTestId('sub-app-card')
        .getByRole('button', { name: /版\s*本/ })
        .click()
      const drawer = page.getByRole('dialog', { name: /版本历史/ })
      await expect(drawer).toBeVisible()
      await expect(drawer.getByText('v1', { exact: true })).toBeVisible()
      await expect(drawer.getByText('v2', { exact: true })).toBeVisible()
      await drawer
        .locator('.sa-release-item', { hasText: 'v1' })
        .getByRole('button', { name: '回滚草稿到此版本' })
        .click()
      await page.keyboard.press('Escape')
      await page
        .getByTestId('sub-app-card')
        .getByRole('button', { name: /打\s*开/ })
        .click()
      await page.locator('.ant-segmented-item', { hasText: '草稿预览' }).click()
      await expect(frame.locator('#root')).toHaveText(/READY marker=v1 mode=draft/, {
        timeout: 15_000,
      })
      await page.screenshot({ path: testInfo.outputPath('subapp-rollback-draft-v1.png') })
    } finally {
      await electronApp.close().catch(() => {})
      await rm(userDataPath, { recursive: true, force: true })
    }
    expect(errors).toEqual([])
  })

  test('主题热切换、权限拒绝、禁用/归档/删除', async ({ browserName: _browserName }, testInfo) => {
    test.setTimeout(180_000)
    const { electronApp, page, userDataPath } = await launchApp()
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    try {
      await openSubAppsView(page)
      const permitted = await createApp(page, {
        name: 'E2E 主题工具',
        source: makeAppSource('theme', false, true),
        permissions: ['data', 'ui'],
      })
      await createApp(page, {
        name: 'E2E 无权限工具',
        source: makeAppSource('deny', true),
        permissions: [],
      })
      await page.locator('.sa-header').getByRole('button', { name: '刷新', exact: true }).click()
      await expect(page.getByTestId('sub-app-card')).toHaveCount(2)

      // 无 data 权限：bridge 拒绝且不落任何数据
      await page
        .locator('.sub-app-card, [data-testid="sub-app-card"]', { hasText: 'E2E 无权限工具' })
        .first()
        .getByRole('button', { name: /打\s*开/ })
        .click()
      const deniedFrame = page.frameLocator('iframe[title="E2E 无权限工具"]')
      await expect(deniedFrame.locator('#root')).toHaveText(/DENIED PERMISSION/, {
        timeout: 15_000,
      })
      const deniedApps = (await sparkOf(page)('sub-app:list', { query: '无权限' })) as {
        items: { id: string }[]
      }
      const deniedId = deniedApps.items[0]?.id
      if (deniedId == null) throw new Error('无权限应用未出现在列表中')
      const deniedList = (await sparkOf(page)('sub-app:data:list', {
        appId: deniedId,
        namespace: 'e2e',
      })) as { total: number }
      expect(deniedList.total).toBe(0)
      await page.getByRole('button', { name: '返回应用列表' }).click()

      // 主题热切换：真实 prefers-color-scheme → tokens 推送 → 应用收到并落库
      await page
        .locator('[data-testid="sub-app-card"]', { hasText: 'E2E 主题工具' })
        .getByRole('button', { name: /打\s*开/ })
        .click()
      const themeFrame = page.frameLocator('iframe[title="E2E 主题工具"]')
      await expect(themeFrame.locator('#root')).toHaveText(/READY marker=theme/, {
        timeout: 15_000,
      })
      // ui 域：应用 toast 在宿主以 antd message 展示（带应用名前缀归因）
      await expect(page.getByText('E2E-TOAST-OK', { exact: false })).toBeVisible({
        timeout: 10_000,
      })
      await page.emulateMedia({ colorScheme: 'dark' })
      await expect(themeFrame.locator('#root')).toHaveAttribute('data-theme-seen', 'dark', {
        timeout: 10_000,
      })
      await expect
        .poll(async () => {
          const rec = (await sparkOf(page)('sub-app:data:get', {
            appId: permitted.id,
            namespace: 'e2e',
            key: 'theme',
          })) as { value: { theme: string } } | null
          return rec?.value.theme
        })
        .toBe('dark')
      await page.emulateMedia({ colorScheme: 'light' })
      await expect(themeFrame.locator('#root')).toHaveAttribute('data-theme-seen', 'light', {
        timeout: 10_000,
      })
      await page.screenshot({ path: testInfo.outputPath('subapp-theme-hot-switch.png') })

      // 禁用 → 归档 → 删除（确认后应用与数据一起消失）
      // Switch 点击与列表刷新存在竞态（badge 已变但 busy/loading 未清），
      // 用「轮询点击直到徽标翻转」保证稳定。
      await page.getByRole('button', { name: '返回应用列表' }).click()
      const themeCard = page.locator('[data-testid="sub-app-card"]', { hasText: 'E2E 主题工具' })
      await expect
        .poll(
          async () => {
            if (
              !(await themeCard
                .getByText('已禁用', { exact: false })
                .isVisible()
                .catch(() => false))
            ) {
              await themeCard
                .getByRole('switch')
                .click({ timeout: 2000 })
                .catch(() => {})
              return 'pending'
            }
            return 'disabled'
          },
          { timeout: 15_000, intervals: [600, 600, 800, 1000] },
        )
        .toBe('disabled')
      await expect
        .poll(
          async () => {
            if (
              !(await themeCard
                .getByText('草稿', { exact: false })
                .first()
                .isVisible()
                .catch(() => false))
            ) {
              await themeCard
                .getByRole('switch')
                .click({ timeout: 2000 })
                .catch(() => {})
              return 'pending'
            }
            return 'draft'
          },
          { timeout: 15_000, intervals: [600, 600, 800, 1000] },
        )
        .toBe('draft')

      await themeCard.getByRole('button', { name: /归\s*档/ }).click()
      await page
        .locator('.ant-popconfirm')
        .getByRole('button', { name: /归\s*档/ })
        .click()
      await expect(page.getByTestId('sub-app-card')).toHaveCount(1, { timeout: 10_000 })
      // 归档筛选开关的可达名来自 label 内文字「归档」（Tooltip 标题不参与命名）
      await page.getByRole('switch', { name: '归档', exact: true }).click()
      await expect(page.getByTestId('sub-app-card')).toHaveCount(2)
      await expect(
        page
          .locator('[data-testid="sub-app-card"]', { hasText: 'E2E 主题工具' })
          .getByText('已归档'),
      ).toBeVisible()

      await page
        .locator('[data-testid="sub-app-card"]', { hasText: 'E2E 主题工具' })
        .getByRole('button', { name: /删\s*除/ })
        .click()
      await page
        .locator('.ant-popconfirm')
        .getByRole('button', { name: /删\s*除/ })
        .click()
      await expect(page.getByTestId('sub-app-card')).toHaveCount(1, { timeout: 10_000 })
      const gone = await sparkOf(page)('sub-app:get', { appId: permitted.id }).then(
        () => 'unexpected-present',
        (err: Error) => err.message,
      )
      // 删除后 get 应以 NOT_FOUND 拒绝（错误消息为中文文案）
      expect(gone).toContain('不存在')
    } finally {
      await electronApp.close().catch(() => {})
      await rm(userDataPath, { recursive: true, force: true })
    }
    expect(errors).toEqual([])
  })
})
