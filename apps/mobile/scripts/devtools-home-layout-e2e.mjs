#!/usr/bin/env node
/**
 * 首页项目列表改版验证（对齐 Cursor Inbox 参考图）：
 *   ① 2×2 状态卡为竖排结构（stat-card-icon 上 / stat-card-foot 下），共 4 张
 *   ② 项目分组含「新建项目」行 + 单行项目条目（home-row-title），不再渲染 countLabel
 *   ③ 首页截图存档供视觉核对
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

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: 'ws://localhost:9420' })

  await miniProgram.reLaunch('/pages/home/index')
  await sleep(3500)
  const page = await miniProgram.currentPage()
  check('首页可达', (page?.path ?? '').includes('home'), `path=${page?.path}`)

  // ① 竖排状态卡：4 张 + 每张含 foot 行
  const cards = await page.$$('.stat-card')
  check('状态卡 2×2 渲染', cards.length === 4, `count=${cards.length}`)
  let footOk = cards.length > 0
  for (const card of cards) {
    const foot = await card.$('.stat-card-foot')
    const icon = await card.$('.stat-card-icon')
    if (foot == null || icon == null) footOk = false
  }
  check('状态卡为竖排结构（图标上/标签计数下）', footOk)

  // ② 项目分组：新建项目行 + 单行项目条目
  const newProjRow = await page.$('.home-row-title--action')
  check('「新建项目」行渲染', newProjRow != null)
  if (newProjRow != null) {
    const text = await newProjRow.text()
    check('新建项目行文案', text.trim() === '新建项目', text.trim())
  }
  const projRows = await page.$$('.home-row')
  const projRowWxmls = await Promise.all(projRows.map((r) => r.wxml()))
  const projCount = projRowWxmls.filter((w) => !w.includes('home-row-title--action')).length
  console.log(`  [i] 项目条目数: ${projCount}`)
  check(
    '项目条目为单行式（无 countLabel 副行）',
    projRowWxmls.every((w) => !w.includes('t-caption')),
  )

  const rootEl = await page.$('.home-page')
  const pageWxml = await rootEl.wxml()
  check('countLabel 已从渲染层移除', !pageWxml.includes('countLabel'))

  // ③ 截图存档
  try {
    execSync(`mkdir -p /tmp/mobile-e2e && node -e "1"`, { stdio: 'ignore' })
  } catch {
    // 建目录失败不阻断验证，截图失败时由 automator 自行报错
  }
  await miniProgram.screenshot({ path: '/tmp/mobile-e2e/home-cursor-layout.png' })
  console.log('  [i] 截图: /tmp/mobile-e2e/home-cursor-layout.png')

  console.log(`\n结果: ${PASS.length} 通过 / ${FAIL.length} 失败`)
  if (FAIL.length > 0) {
    console.log('失败项:', FAIL.join(' | '))
    process.exitCode = 1
  }
  await miniProgram.disconnect()
}

main().catch((err) => {
  console.error('E2E 异常:', err.message)
  process.exit(1)
})
