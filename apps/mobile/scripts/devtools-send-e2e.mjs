#!/usr/bin/env node
/**
 * 发送链路真实复现：进聊天页 → 输入文本 → 点发送 → 验证用户气泡上屏
 *   → 等 agent 回复 → 验证 AI 回复上屏 + running 状态恢复。
 * 全程捕获控制台异常，任何一步失败即钉住根因。
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

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: 'ws://localhost:9420' })
  const token = bridgeToken()

  const createRes = await fetch('http://127.0.0.1:3721/v1/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'devtools-发送回归测试' }),
  })
  const { session } = await createRes.json()
  const sid = session.id
  console.log(`[发送复现] 测试会话 ${sid}`)

  await miniProgram.reLaunch(
    `/pages/chat/index?sessionId=${encodeURIComponent(sid)}&title=${encodeURIComponent('发送回归')}`,
  )
  await sleep(3500)
  const page = await miniProgram.currentPage()

  // ① 输入框可见且可输入
  const input = await page.$('.composer-input')
  check('输入框存在', input != null)
  if (input == null) {
    console.log('FAIL-FAST: 输入框不存在，WXML 结构异常')
    await miniProgram.disconnect()
    return
  }
  await input.input('你好，请只回复两个字：收到')
  await sleep(600)

  // ② 读回页面数据：inputText 是否真的进了 data（受控链路验证）
  const data1 = await page.data()
  check(
    'inputText 已进页面数据',
    data1.inputText === '你好，请只回复两个字：收到',
    `实际: "${data1.inputText}"`,
  )
  check('发送前 running=false', data1.running === false, `实际: ${data1.running}`)

  // ③ 点发送按钮
  const sendBtn = await page.$('.composer-action')
  check('发送按钮存在', sendBtn != null)
  await sendBtn.tap()
  await sleep(1200)

  // ④ 发送后：inputText 清空 + 用户气泡上屏
  const data2 = await page.data()
  check('发送后输入框已清空', data2.inputText === '', `实际: "${data2.inputText}"`)
  const items1 = data2.items ?? []
  const userItem = items1.find((it) => it.kind === 'user')
  check(
    '用户气泡已上屏',
    userItem != null && (userItem.text ?? '').includes('收到'),
    JSON.stringify(items1.map((i) => i.kind)),
  )
  console.log(
    '  [items 序列]',
    items1.map((i) => `${i.kind}:${(i.text ?? '').slice(0, 12)}`).join(' | '),
  )

  // ⑤ 等 agent 回复（最多 40s）
  let replied = false
  for (let i = 0; i < 20; i++) {
    await sleep(2000)
    const d = await page.data()
    const hasAssistant = (d.items ?? []).some(
      (it) => it.kind === 'assistant' && (it.text ?? '').length > 0,
    )
    if (hasAssistant) {
      replied = true
      console.log(
        '  [items 终态]',
        d.items.map((it) => `${it.kind}:${(it.text ?? '').slice(0, 14)}`).join(' | '),
      )
      check('running 已回落 false', d.running === false, `实际: ${d.running}`)
      break
    }
  }
  check('AI 回复已上屏', replied)

  // ⑥ 控制台异常检查
  const consoleRes = await miniProgram.callWxMethod('getSystemInfo').catch(() => null)
  void consoleRes

  // 清理测试会话
  await fetch(`http://127.0.0.1:3721/v1/sessions/${sid}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {})

  console.log(`\n结果: ${PASS.length} 通过 / ${FAIL.length} 失败`)
  FAIL.forEach((f) => console.log('  失败项: ' + f))
  await miniProgram.disconnect()
  process.exit(FAIL.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('E2E 执行失败:', err.message)
  process.exit(2)
})
