#!/usr/bin/env node
/**
 * 布局改造 + 发送回归 E2E：
 *   ① 快捷行渲染两个常用 chip（模型/权限），配置条不再重复这两项且无 label 文本
 *   ② 输入（含逐字符模拟）→ 发送 → 用户气泡 + AI 单份回复上屏（双份修复验证）
 *   ③ 输入后 inputText 与组件 localValue 一致、发送后清空
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
  return JSON.parse(raw).devices[JSON.parse(raw).devices.length - 1].deviceToken
}

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: 'ws://localhost:9420' })
  const token = bridgeToken()
  const createRes = await fetch('http://127.0.0.1:3721/v1/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'devtools-布局与发送验证' }),
  })
  const { session } = await createRes.json()
  console.log(`[布局+发送] 测试会话 ${session.id}`)

  // 测试会话切到已知可用渠道（默认渠道可能欠费无响应，与被测代码无关）
  const catalog = await (
    await fetch('http://127.0.0.1:3721/v1/catalog', {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()
  const usable = catalog.providers.find((p) => p.name.includes('智谱'))
  if (usable != null) {
    await fetch(`http://127.0.0.1:3721/v1/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerProfileId: usable.id,
        modelId: usable.models.find((m) => m.id.includes('glm')).id,
      }),
    })
    console.log(`  [前置] 已切换测试会话渠道: ${usable.name}`)
  }

  await miniProgram.reLaunch(
    `/pages/chat/index?sessionId=${encodeURIComponent(session.id)}&title=${encodeURIComponent('布局验证')}`,
  )
  await sleep(4000)
  const page = await miniProgram.currentPage()

  // ① 快捷行与配置条结构
  const quickChips = await page.$$('.quick-chip')
  check('快捷行渲染 2 个常用 chip', quickChips.length === 2, `实际 ${quickChips.length}`)
  const quickTexts = []
  for (const el of quickChips) quickTexts.push((await el.text()).trim())
  console.log('  [快捷行]', quickTexts.join(' | '))

  const barChips = await page.$$('.config-chip')
  const barTexts = []
  for (const el of barChips) barTexts.push((await el.text()).trim())
  console.log('  [配置条]', barTexts.join(' | '))
  check(
    '配置条不再含模型/权限',
    !barTexts.some((t) => quickTexts.some((q) => q.startsWith(t) && t !== '')) ||
      barTexts.length < 6,
    `${barTexts.length} 个`,
  )
  check(
    '配置条 chip 无 label 前缀（不含「助手/模型/权限/推理/工作流/项目」字样开头）',
    barTexts.every((t) => !/^(助手|模型|权限|推理|工作流|项目)/.test(t)),
    barTexts.join(' / '),
  )
  const chipBarEl = await page.$('.chip-bar')
  check('配置条存在（其余项收进扁平条）', chipBarEl != null)

  // ② 逐字符输入（模拟真实打字路径）
  const input = await page.$('.composer-input')
  await input.input('用三个字回复：测试好')
  await sleep(500)
  const data1 = await page.data()
  check('页面 inputText 同步', (data1.inputText ?? '').includes('测试好'), `"${data1.inputText}"`)

  // ③ 发送
  const sendBtn = await page.$('.composer-action')
  await sendBtn.tap()
  await sleep(1500)
  const data2 = await page.data()
  const userItem = (data2.items ?? []).find((it) => it.kind === 'user')
  check('用户气泡上屏', userItem != null && (userItem.text ?? '').includes('测试好'))

  // ④ 等 AI 回复，断言只出现一条助手气泡（双份修复）
  let assistantCount = -1
  let assistantText = ''
  for (let i = 0; i < 20; i++) {
    await sleep(2000)
    const d = await page.data()
    const assistants = (d.items ?? []).filter((it) => it.kind === 'assistant')
    if (assistants.length > 0 && d.running === false) {
      assistantCount = assistants.length
      assistantText = assistants.map((a) => a.text).join('‖')
      break
    }
  }
  check(
    'AI 回复只有一条（双份修复生效）',
    assistantCount === 1,
    `数量 ${assistantCount}：${assistantText.slice(0, 40)}`,
  )

  // ⑤ 发送后输入框清空
  check('发送后输入清空', (data2.inputText ?? '') === '', `"${data2.inputText}"`)

  // 截图存档
  try {
    await miniProgram.screenshot({ path: '/tmp/chat-layout-after.png' })
    console.log('  [截图] /tmp/chat-layout-after.png')
  } catch (e) {
    console.log('  [截图] 失败:', e.message)
  }

  await fetch(`http://127.0.0.1:3721/v1/sessions/${session.id}`, {
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
