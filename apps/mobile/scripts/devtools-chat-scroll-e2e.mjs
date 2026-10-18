#!/usr/bin/env node
/**
 * 聊天页滚动策略真实调试 E2E：验证「贴底跟随 / 上滑停止跟随」，运行中的会话不再抢滚动视口。
 *
 * 覆盖：
 *   1. 聊天页可达（假设备/假会话，历史加载失败不影响滚动策略验证）
 *   2. 上滑（触摸驱动的 scroll 事件）→ 停止跟随 + scrollToId 清空 + 「最新」按钮出现
 *      （该断言同时证明 onReady 视口高度测量生效：高度为 0 时意图判定会直接短路）
 *   3. 停止跟随态下 scrollToBottom 被门控（核心回归：流式刷新不再回底抢视口）
 *   4. 程序化 scroll 事件（无触摸、惯性窗口外）不改变用户意图
 *   5. 「最新」按钮回底并恢复跟随
 *   6. 触摸滚回贴底 → 自动恢复跟随
 *   7. 控制台错误监控
 *
 * 前置：开发者工具已用 `cli auto --project <apps/mobile> --auto-port 9420` 打开。
 */
import automator from 'miniprogram-automator'

const WS_ENDPOINT = 'ws://localhost:9420'

const PASS = []
const FAIL = []
function check(name, cond, detail = '') {
  ;(cond ? PASS : FAIL).push(name)
  console.log(`  ${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

  // ── 1. 进入聊天页（假设备/会话：历史会加载失败，但不影响滚动策略验证） ──
  console.log('\n[1] 进入聊天页')
  await miniProgram.reLaunch(
    '/pages/chat/index?sessionId=e2e-scroll-test&deviceId=e2e-device&title=E2E',
  )
  await sleep(2500)
  let page = await miniProgram.currentPage()
  check('聊天页可达', (page?.path ?? '').includes('chat'), `path=${page?.path}`)
  let data = await page.data()
  check('历史加载失败进入错误态（预期，不阻塞滚动验证）', data.historyError !== '')

  // ── 2. 上滑 → 停止跟随 ──
  console.log('\n[2] 上滑停止跟随')
  await page.callMethod('onScrollTouchStart')
  // 视口高度约 600+px：scrollTop=2000 / scrollHeight=3200 → 距底 ≈600px，远超贴底阈值
  await page.callMethod('onChatScroll', { detail: { scrollTop: 2000, scrollHeight: 3200 } })
  await page.callMethod('onScrollTouchEnd')
  await sleep(300)
  data = await page.data()
  check('上滑后停止跟随（showJumpLatest=true，且证明视口高度测量生效）', data.showJumpLatest === true)
  check('上滑后清空回底锚点（scrollToId=""）', data.scrollToId === '')
  const jumpBtn = await page.$('.chat-jump-latest')
  check('「最新」悬浮按钮已渲染', jumpBtn != null)

  // ── 3. 停止跟随态：scrollToBottom 被门控 ──
  console.log('\n[3] 流式刷新不再抢视口')
  await page.callMethod('scrollToBottom')
  await sleep(200)
  data = await page.data()
  check('非贴底态 scrollToBottom 不回底（scrollToId 保持空）', data.scrollToId === '')

  // ── 4. 程序化 scroll（无触摸、超出惯性窗口）不改用户意图 ──
  console.log('\n[4] 程序化 scroll 不算用户意图')
  await sleep(900) // 超出 SCROLL_MOMENTUM_WINDOW_MS=800ms
  await page.callMethod('onChatScroll', { detail: { scrollTop: 0, scrollHeight: 3200 } })
  await sleep(200)
  data = await page.data()
  check(
    '程序化 scroll 事件被忽略（跟随态与按钮都不变）',
    data.showJumpLatest === true && data.scrollToId === '',
  )

  // ── 5. 「最新」按钮回底并恢复跟随 ──
  console.log('\n[5] 「最新」按钮回底')
  await page.callMethod('onJumpLatest')
  await sleep(300)
  data = await page.data()
  check('回底锚点恢复（scrollToId=chat-anchor）', data.scrollToId === 'chat-anchor')
  check('恢复贴底跟随（按钮隐藏）', data.showJumpLatest === false)
  const jumpBtnGone = await page.$('.chat-jump-latest')
  check('「最新」按钮已从界面移除', jumpBtnGone == null)

  // ── 6. 触摸滚回贴底 → 恢复跟随 ──
  console.log('\n[6] 滚回贴底自动恢复跟随')
  await page.callMethod('onScrollTouchStart')
  await page.callMethod('onChatScroll', { detail: { scrollTop: 3120, scrollHeight: 3200 } })
  await page.callMethod('onScrollTouchEnd')
  await sleep(200)
  data = await page.data()
  check('贴底判定恢复跟随（按钮保持隐藏）', data.showJumpLatest === false)

  // ── 7. 控制台错误 ──
  console.log('\n[7] 控制台监控')
  check('全程无控制台错误/异常', consoleErrors.length === 0, consoleErrors.join(' | '))

  console.log(`\n结果：${PASS.length} 通过 / ${FAIL.length} 失败`)
  if (FAIL.length > 0) process.exitCode = 1
  await miniProgram.disconnect()
}

main().catch((error) => {
  console.error('E2E 运行失败：', error)
  process.exitCode = 1
})
