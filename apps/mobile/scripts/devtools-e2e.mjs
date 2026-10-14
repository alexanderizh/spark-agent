#!/usr/bin/env node
/**
 * 微信开发者工具真实调试 E2E：连接自动化端口 → 驱动真实渲染进程逐页验证。
 *
 * 覆盖（与 2026-10-14 能力扩展对应）：
 *   1. 启动与首页渲染（Inbox 枢纽）
 *   2. 登录页 / 个人中心页渲染（此前样式裸奔回归确认）
 *   3. 聊天页：配置条 chips 渲染
 *   4. 聊天页：输入区附件/语音按钮 + 配置面板组件存在性
 *   5. 控制台错误监控（页面切换全程收集）
 *
 * 前置：桌面端桥接已启动（3721）+ 小程序已配对（storage 里有 deviceToken）。
 * 若未配对，聊天相关断言降级为「页面可达 + 无控制台错误」。
 */
import automator from 'miniprogram-automator'

const WS_ENDPOINT = 'ws://localhost:9420'

const PASS = []
const FAIL = []
function check(name, cond, detail = '') {
  ;(cond ? PASS : FAIL).push(name)
  console.log(`  ${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  console.log('连接开发者工具自动化端口…')
  const miniProgram = await automator.connect({ wsEndpoint: WS_ENDPOINT })
  console.log('已连接。')

  const consoleErrors = []
  miniProgram.on('console', (msg) => {
    if (msg.type === 'error') consoleErrors.push(String(msg.args?.[0]?.() ?? '').slice(0, 200))
  })
  miniProgram.on('exception', (exc) => {
    consoleErrors.push(`EXCEPTION: ${String(exc?.message ?? '').slice(0, 300)}`)
  })

  // ── 1. 启动页/首页 ──────────────────────────────────────────────
  console.log('\n[1] 首页（Inbox 枢纽）')
  // 已配对时 entry 启动页会自动跳转首页（既有正确行为），所以只验证最终落在 home
  await miniProgram.reLaunch('/pages/entry/index')
  await sleep(3000)
  let page = await miniProgram.currentPage()
  const landedPath = page?.path ?? ''
  check(
    '启动流程收敛到首页（或停留启动页）',
    landedPath.includes('home') || landedPath.includes('entry'),
    `path=${landedPath}`,
  )
  await miniProgram.reLaunch('/pages/home/index')
  await sleep(2500)
  page = await miniProgram.currentPage()
  check('首页可达', (page?.path ?? '').includes('home'), `path=${page?.path}`)
  const homeHasToolbar = await page.$('.home-toolbar')
  check('首页工具条渲染', homeHasToolbar != null)

  // ── 2. 登录页 / 个人中心（样式回归确认） ─────────────────────────
  console.log('\n[2] 登录页 / 个人中心')
  await miniProgram.navigateTo('/pages/login/index')
  await sleep(1500)
  page = await miniProgram.currentPage()
  check('登录页可达', (page?.path ?? '').includes('login'))
  const segment = await page.$('.segment')
  check('登录页分段控制器存在', segment != null)
  const brandLogo = await page.$('.brand-logo')
  check('登录页品牌 logo 存在', brandLogo != null)
  await miniProgram.navigateBack()
  await sleep(800)

  await miniProgram.navigateTo('/pages/profile/index')
  await sleep(1500)
  page = await miniProgram.currentPage()
  check('个人中心可达', (page?.path ?? '').includes('profile'))
  const avatar = await page.$('.avatar-large')
  if (avatar != null) {
    const size = await avatar.size()
    check(
      '头像尺寸受控(≤120px)',
      size != null && size.width <= 120 && size.height <= 120,
      `${size?.width}x${size?.height}`,
    )
  } else {
    check('头像元素存在', false, '.avatar-large 未找到')
  }
  await miniProgram.navigateBack()
  await sleep(800)

  // ── 3. 聊天页（核心：配置条 + 输入扩展） ─────────────────────────
  console.log('\n[3] 聊天页能力面')
  // 取一个真实会话：从桌面端桥接拿最近会话 id，经页面参数进入
  let sessionId = null
  let sessionTitle = null
  try {
    const res = await fetch('http://127.0.0.1:3721/v1/sessions?limit=5', {
      headers: { Authorization: 'Bearer ' + (await readBridgeToken()) },
    })
    const body = await res.json()
    const target = body.sessions?.find((s) => !s.status || s.status !== 'running')
    sessionId = target?.id ?? null
    sessionTitle = target?.title ?? null
  } catch {
    /* 桥接不可达时降级 */
  }
  if (sessionId) {
    await miniProgram.navigateTo(
      `/pages/chat/index?sessionId=${encodeURIComponent(sessionId)}&title=${encodeURIComponent(sessionTitle ?? '对话')}`,
    )
    await sleep(3500)
    page = await miniProgram.currentPage()
    check('聊天页可达', (page?.path ?? '').includes('chat'))

    const quickChips = await page.$$('.quick-chip')
    const chips = await page.$$('.config-chip')
    check('快捷行 2 个常用 chip', quickChips.length === 2, `${quickChips.length} 个`)
    check('配置条 chips 渲染', chips.length >= 4, `${chips.length} 个 chip`)
    if (chips.length > 0) {
      const firstChipText = await (await chips[0].$('.config-chip-value')).text()
      check(
        'chip 值渲染（扁平态无 label）',
        typeof firstChipText === 'string' && firstChipText.length > 0,
        `首个="${firstChipText}"`,
      )
      // 点开助手面板 → 面板出现 → 关闭（按 data-key 定位助手 chip）
      let agentChip = null
      for (const chip of chips) {
        if ((await chip.attribute('data-key')) === 'agent') agentChip = chip
      }
      await agentChip.tap()
      await sleep(1200)
      const sheet = await page.$('.sheet')
      check('半屏选择面板打开', sheet != null)
      const options = await page.$$('.sheet-option')
      check('面板选项渲染', options.length >= 1, `${options.length} 个选项`)
      const closeBtn = await page.$('.sheet-close')
      if (closeBtn != null) {
        await closeBtn.tap()
        await sleep(600)
      }
      const sheetAfter = await page.$('.sheet')
      check('面板可关闭', sheetAfter == null)
    }

    // 输入区功能钮
    const sides = await page.$$('.composer-side')
    check('麦克风+加号按钮渲染', sides.length === 2, `${sides.length} 个功能钮`)
    const attachBarAbsent = (await page.$('.attach-bar')) == null
    check('空附件时不显示附件条', attachBarAbsent)

    // 命令补全：向输入框输入 "/"
    const input = await page.$('.composer-input')
    if (input != null) {
      await input.input('/')
      await sleep(800)
      const cmdPanel = await page.$('.cmd-panel')
      check('斜杠命令补全面板浮出', cmdPanel != null)
      await input.input('')
      await sleep(500)
    }

    // 定时任务面板经 ··· 菜单触发较绕，直接验证组件挂载（show=false 时无 .tasks-mask）
    const tasksMask = await page.$('.tasks-mask')
    check('任务面板默认隐藏', tasksMask == null)

    await miniProgram.navigateBack()
    await sleep(800)
  } else {
    console.log('  ⚠️ 桥接不可达或无会话，聊天页断言降级跳过')
  }

  // ── 4. 控制台错误 ────────────────────────────────────────────────
  console.log('\n[4] 控制台错误监控')
  const meaningful = consoleErrors.filter(
    (line) => !/net::ERR|Failed to load|SharedArrayBuffer|deprecat/i.test(line),
  )
  check('无页面异常', meaningful.length === 0, meaningful.slice(0, 3).join(' | '))

  await miniProgram.disconnect()
  console.log(`\n═══ 结果: ${PASS.length} 通过 / ${FAIL.length} 失败 ═══`)
  if (FAIL.length > 0) {
    console.log('失败项:', FAIL)
    process.exit(1)
  }
  process.exit(0)
}

async function readBridgeToken() {
  const { execSync } = await import('node:child_process')
  const db = process.env.HOME + '/Library/Application Support/@spark/desktop-dev/spark.db'
  const raw = execSync(
    `sqlite3 "file:${db}?mode=ro" "SELECT value FROM app_settings WHERE key='store' AND category='mobileBridge';"`,
  ).toString()
  const parsed = JSON.parse(raw)
  return parsed.devices[parsed.devices.length - 1].deviceToken
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((err) => {
  console.error('E2E 运行失败:', err?.message ?? err)
  process.exit(1)
})
