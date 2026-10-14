#!/usr/bin/env node
/**
 * 深度交互 E2E：真实驱动 UI 完成一次「配置切换闭环」。
 *
 * 流程：进聊天页 → 记录推理强度 chip 值 → 打开推理面板 → 滑块面板出现
 *   → 选中档位（滑块 change）→ 面板关闭 + toast → 回读 chip 值变化
 *   → 同时经桥接 API 校验桌面端 runtime 真实落库。
 */
import automator from 'miniprogram-automator'
import { execSync } from 'node:child_process'

const PASS = []
const FAIL = []
function check(name, cond, detail = '') {
  ;(cond ? PASS : FAIL).push(name)
  console.log(`  ${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function bridgeToken() {
  const db = process.env.HOME + '/Library/Application Support/@spark/desktop-dev/spark.db'
  const raw = execSync(
    `sqlite3 "file:${db}?mode=ro" "SELECT value FROM app_settings WHERE key='store' AND category='mobileBridge';"`,
  ).toString()
  const parsed = JSON.parse(raw)
  return parsed.devices[parsed.devices.length - 1].deviceToken
}

async function bridgeRuntime(sessionId, token) {
  const res = await fetch(`http://127.0.0.1:3721/v1/sessions/${sessionId}/runtime`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()).runtime ?? {}
}

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: 'ws://localhost:9420' })
  const token = bridgeToken()

  const sessionsRes = await fetch('http://127.0.0.1:3721/v1/sessions?limit=5', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!sessionsRes.ok) throw new Error(`会话列表接口异常: HTTP ${sessionsRes.status}`)
  // 用测试专用会话，避免碰用户真实会话配置
  const createRes = await fetch('http://127.0.0.1:3721/v1/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'devtools-深度交互测试' }),
  })
  const { session } = await createRes.json()

  console.log('\n[深度交互] 配置切换闭环')
  await miniProgram.reLaunch(
    `/pages/chat/index?sessionId=${encodeURIComponent(session.id)}&title=${encodeURIComponent('深度交互测试')}`,
  )
  await sleep(3500)
  const page = await miniProgram.currentPage()

  // 找到推理 chip（第 4 个）
  const chips = await page.$$('.config-chip')
  check('chips 就绪', chips.length >= 5, `${chips.length} 个`)
  const before = await (await chips[3].$('.config-chip-value')).text()
  console.log(`     切换前推理 chip 值 = "${before}"`)

  await chips[3].tap()
  await sleep(1200)
  const slider = await page.$('.sheet-slider')
  check('推理面板为滑块模式', slider != null)
  const sliderValueEl = await page.$('.sheet-slider-current')
  const sliderLabel = sliderValueEl != null ? await sliderValueEl.text() : ''
  console.log(`     面板当前档位 = "${sliderLabel}"`)

  // 点滑块轨道不同位置触发 change（automator slider 支持 touch 模拟较复杂，
  // 直接调页面方法:onPanelSliderChange 即真实页面处理链）
  const efforts = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const targetIdx = sliderLabel === 'high' ? 1 : 3
  await page.callMethod('onPanelSliderChange', { detail: { index: targetIdx } })
  await sleep(1500)

  const sheetAfter = await page.$('.sheet')
  check('切换后面板关闭', sheetAfter == null)
  const chipsAfter = await page.$$('.config-chip')
  const after = await (await chipsAfter[3].$('.config-chip-value')).text()
  console.log(`     切换后推理 chip 值 = "${after}"`)
  check('chip 值已更新', after !== before || after === efforts[targetIdx])

  const runtime = await bridgeRuntime(session.id, token)
  check(
    '桌面端 runtime 真实落库',
    runtime.reasoningEffort === efforts[targetIdx],
    `runtime.reasoningEffort=${runtime.reasoningEffort}`,
  )

  // 收尾：还原 + 删测试会话
  await fetch(`http://127.0.0.1:3721/v1/sessions/${session.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  await miniProgram.disconnect()
  console.log(`\n═══ 结果: ${PASS.length} 通过 / ${FAIL.length} 失败 ═══`)
  if (FAIL.length > 0) {
    console.log('失败项:', FAIL)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('深度 E2E 失败:', err?.message ?? err)
  process.exit(1)
})
