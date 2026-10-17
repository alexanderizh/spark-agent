#!/usr/bin/env node
/**
 * E2E（微信开发者工具模拟器，ws://localhost:9420）：
 * 验证首页配置弹层的「权限模式」行，以及项目页快速发起胶囊的
 * 配置 chips / 半屏面板 / float 定位（底部安全区模型与首页一致）。
 *
 * 前置：微信开发者工具打开 apps/mobile/dist 并开启自动化端口 9420；
 * 模拟器内已登录且至少一台授信电脑在线（权限/模型目录依赖真实 catalog）。
 */
import automator from 'miniprogram-automator'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const failures = []

function check(name, passed, detail = '') {
  console.log(`  ${passed ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!passed) failures.push(name)
}

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: 'ws://localhost:9420' })
  const system = await miniProgram.systemInfo()

  // ─── 首页：配置弹层含权限模式 ───────────────────────────────────────────────
  await miniProgram.reLaunch('/pages/home/index')
  await sleep(2600)
  let page = await miniProgram.currentPage()
  const homeData = await page.data()
  const onlineDevice = (homeData.devices ?? []).find((item) => item.online)
  check(
    '首页拿到授信电脑',
    (homeData.devices ?? []).length > 0,
    `${homeData.devices?.length ?? 0} 台`,
  )

  await page.callMethod('onOpenConfig')
  await sleep(2600)
  const configRows = await page.$$('.home-config-row')
  check(
    '配置弹层共 5 行（电脑/项目/模型/权限/推理）',
    configRows.length === 5,
    `${configRows.length} 行`,
  )
  if (configRows[3]) {
    const label = await (await configRows[3].$('.home-config-label')).text()
    check('第 4 行为「权限模式」', label === '权限模式', label)
  }
  const afterConfig = await page.data()
  check(
    '权限选项已按目录加载（默认档 + adapter 档位）',
    (afterConfig.permissionOptions ?? []).length >= 2,
    `${afterConfig.permissionOptions?.length ?? 0} 项`,
  )
  // 选择「每步确认」之外的一个非默认档位，验证 picker 与 patch 数据就位
  const permIdx = (afterConfig.permissionOptions ?? []).findIndex((item) => item.id !== 'default')
  if (permIdx > 0) {
    await page.callMethod('onPermissionChange', { detail: { value: String(permIdx) } })
    await sleep(300)
    const patched = await page.data()
    check(
      '权限选择写入配置摘要',
      (patched.configSummary ?? '').includes(patched.permissionOptions[permIdx].label),
      patched.configSummary,
    )
    await page.callMethod('onPermissionChange', { detail: { value: '0' } })
    await sleep(200)
  }
  await page.callMethod('onCloseConfig')
  await sleep(200)

  // ─── 项目页：快速发起胶囊 ──────────────────────────────────────────────────
  const deviceId = onlineDevice?.deviceId ?? homeData.devices?.[0]?.deviceId ?? ''
  await miniProgram.navigateTo(
    `/pages/project-sessions/index?deviceId=${encodeURIComponent(deviceId)}&deviceName=E2E&projectId=default&projectName=默认`,
  )
  await sleep(2800)
  page = await miniProgram.currentPage()
  check('项目页已打开', page.path.includes('project-sessions'), page.path)

  const composer = await page.$('.composer--float')
  check('悬浮胶囊存在', composer != null)
  if (composer) {
    // 安全区 padding 模型（与首页同款）：根节点贴底，env(safe-area)+24rpx 收在 padding-bottom；
    // 键盘弹起时仅内联覆盖 bottom=键盘高度，padding 安全区保留。量最末内容块 chip-bar 的底距验证。
    const safeInset = system.windowHeight - system.safeArea.bottom
    const chipBar = await page.$('.composer--float .chip-bar')
    check('配置条（推理）存在', chipBar != null)
    if (chipBar) {
      const [offset, size] = await Promise.all([chipBar.offset(), chipBar.size()])
      const gap = system.windowHeight - (offset.top + size.height)
      const expected = safeInset + 12.5 // 24rpx @390pt 宽 ≈ 12.5px
      check(
        '底部保留 安全区+24rpx padding（键盘弹起时同源保留）',
        Math.abs(gap - expected) <= 2,
        `底距 ${gap.toFixed(1)}px / 期望 ${expected.toFixed(1)}px（safeInset=${safeInset}）`,
      )
    }
  }

  const quickChips = await page.$$('.quick-chip')
  check('快捷行两个常用项（模型/权限）', quickChips.length === 2, `${quickChips.length} 个`)
  const reasoningChip = await page.$('.config-chip')
  check('配置条含推理强度', reasoningChip != null)

  // 点权限 chip → sheet-panel 列出权限档位 → 选择一项
  if (quickChips[1]) {
    await quickChips[1].tap()
    await sleep(600)
    const options = await page.$$('.sheet-option')
    const panelData = await page.data()
    check(
      '权限面板列出全部档位',
      options.length === (panelData.panelOptions ?? []).length && options.length >= 2,
      `面板 ${options.length} 项 / data.panelOptions ${panelData.panelOptions?.length ?? 0} 项`,
    )
    if (options.length > 1) {
      await options[1].tap()
      await sleep(500)
      const picked = await page.data()
      check(
        '选择后权限档写入 quickPermissionId',
        picked.quickPermissionId !== 'default',
        picked.quickPermissionId,
      )
      check('面板已关闭', picked.panelShow === false)
    }
  }

  // 推理滑块面板
  if (reasoningChip) {
    await reasoningChip.tap()
    await sleep(600)
    const slider = await page.$('.sheet-slider')
    check('推理面板为滑块模式', slider != null)
    const sliderData = await page.data()
    check(
      '滑块档位含「电脑默认」',
      (sliderData.panelSliderLabels ?? [])[0] === '电脑默认',
      (sliderData.panelSliderLabels ?? []).join(','),
    )
    await page.callMethod('closePanel')
    await sleep(200)
  }

  await miniProgram.disconnect()
  if (failures.length > 0) {
    console.error(`\nE2E 失败 ${failures.length} 项`)
    process.exit(1)
  }
  console.log('\nE2E 全部通过')
}

main().catch((error) => {
  console.error('E2E 运行失败:', error)
  process.exit(1)
})
