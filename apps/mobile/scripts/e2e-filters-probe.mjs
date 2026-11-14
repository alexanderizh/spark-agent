#!/usr/bin/env node
/**
 * 筛选 / 切换电脑 / 备注名入口的真机模拟器布局探针（需先 build 且开发者工具已开 9420 端口）。
 *
 * 只验证「页面结构与布局 + 交互链路」，不依赖真实中继数据：
 * 列表数据用 setData 注入夹具（真实数据路径由 smoke-filters 的纯函数覆盖）。
 */

import automator from 'miniprogram-automator'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** 截图落到仓库根的 output/ 下，避免污染 apps/mobile 工作树 */
const shotsDir = join(root, '..', '..', 'output', 'mobile-probe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []

function check(name, passed, detail = '') {
  console.log(`  ${passed ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!passed) failures.push(name)
}

async function rect(el) {
  const [offset, size] = await Promise.all([el.offset(), el.size()])
  return { left: +offset.left, top: +offset.top, width: +size.width, height: +size.height }
}

async function text(el) {
  return (await el.text()).trim()
}

/** 夹具：跨项目会话行 */
function sessionRows() {
  const now = Date.now()
  const iso = (h) => new Date(now - h * 3600_000).toISOString()
  const row = (id, title, projectName, extra = {}) => ({
    id,
    title,
    status: 'idle',
    updatedAt: iso(2),
    preview: '',
    projectKey: projectName === '未归属项目' ? 'default' : 'p1',
    projectName,
    statusLabel: '空闲',
    dotClass: 'dot-neutral',
    timeLabel: '2 小时前',
    labelText: '',
    labelClass: '',
    ...extra,
  })
  return [
    row('s1', '重构远程视图的筛选菜单', 'Spark-Agent', {
      status: 'running',
      statusLabel: '进行中',
      dotClass: 'dot-info',
      labelText: '待推进',
      labelClass: 'label-pending-advance',
    }),
    row('s2', '小程序设备备注名', 'Spark-Agent', { pinnedAt: iso(1) }),
    row('s3', '临时排查一下中继断连', '未归属项目'),
  ]
}

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: 'ws://localhost:9420' })
  await mkdir(shotsDir, { recursive: true })

  // ─── 1. 全部会话页 ────────────────────────────────────────────────────────
  await miniProgram.reLaunch('/pages/all-sessions/index?deviceId=probe-device&deviceName=测试机')
  await sleep(1800)
  const page = await miniProgram.currentPage()

  check('全部会话页标题', (await page.$('.as-subtitle')) != null)
  const contextName = await page.$('.as-context-name')
  check(
    '电脑上下文显示传入设备名',
    contextName != null && (await text(contextName)) === '测试机',
    contextName ? await text(contextName) : '缺失',
  )

  // 注入「加载完成且在线」的视图状态（真实数据路径由 smoke-filters 覆盖）
  await page.setData({
    loading: false,
    errorText: '',
    deviceOffline: false,
    deviceUnavailable: false,
    total: 3,
    visibleCount: 3,
    renderedCount: 3,
    hasMore: false,
  })
  await sleep(300)

  const filterChip = await page.$('.as-filter-chip')
  check('筛选入口存在', filterChip != null)
  if (filterChip) {
    await filterChip.tap()
    await sleep(500)
    const sheet = await page.$('.fs-sheet')
    check('筛选面板弹出', sheet != null)
    const body = await page.$('.fs-body')
    if (body) {
      const size = await rect(body)
      check(
        '筛选面板滚动区有确定高度（scroll-view 真机收缩陷阱）',
        size.height > 100 && size.height <= 800,
        `${size.height}px`,
      )
    }
    const cardTitles = await page.$$('.fs-card-title')
    check('五个筛选维度都在', cardTitles.length === 5, `${cardTitles.length} 个`)
    await miniProgram.screenshot({ path: join(shotsDir, 'all-sessions-filter.png') })

    // 点「近 3 天」→ 面板保持打开、chip 选中
    const chips = await page.$$('.fs-chip')
    let target = null
    for (const chip of chips) {
      if ((await text(chip)).includes('近 3 天')) {
        target = chip
        break
      }
    }
    check('时间维度有「近 3 天」选项', target != null)
    if (target) {
      await target.tap()
      await sleep(400)
      check('点选项后面板不关闭（多选可连点）', (await page.$('.fs-sheet')) != null)
      const onChips = await page.$$('.fs-chip--on')
      check('选中态回显', onChips.length >= 1, `${onChips.length} 个选中`)
      const reset = await page.$('.fs-reset')
      check('激活后出现「清除」', reset != null)
      if (reset) {
        await reset.tap()
        await sleep(400)
        const afterReset = await page.$$('.fs-chip--on')
        // 单选维度「不限」是默认勾选
        check('清除后只剩默认项', afterReset.length <= 1, `${afterReset.length} 个选中`)
      }
    }
    const done = await page.$('.fs-done')
    if (done) {
      await done.tap()
      await sleep(400)
      check('「完成」关闭面板', (await page.$('.fs-sheet')) == null)
    }
  }

  // 列表渲染（注入夹具）
  await page.setData({
    groups: [
      {
        key: 'pinned',
        label: '置顶',
        rows: [sessionRows()[1]],
      },
      {
        key: 'running',
        label: '进行中',
        rows: [sessionRows()[0]],
      },
      {
        key: 'today',
        label: '今天',
        rows: [sessionRows()[2]],
      },
    ],
    visibleCount: 3,
    renderedCount: 3,
    hasMore: false,
  })
  await sleep(400)
  const rows = await page.$$('.as-row')
  check('会话行渲染', rows.length === 3, `${rows.length} 行`)
  const projectChips = await page.$$('.as-project-chip')
  check('行内项目名 chip', projectChips.length === 3, `${projectChips.length} 个`)
  if (projectChips.length > 0) {
    const chipRect = await rect(projectChips[0])
    check(
      '项目 chip 不撑破行宽',
      chipRect.width > 0 && chipRect.width <= 110,
      `${chipRect.width.toFixed(0)}px`,
    )
  }
  const labelTags = await page.$$('.as-label-tag')
  check('标记标签渲染', labelTags.length === 1, `${labelTags.length} 个`)
  await miniProgram.screenshot({ path: join(shotsDir, 'all-sessions-list.png') })

  // ─── 2. 项目页：切换电脑 + 筛选 + 全部会话入口 ─────────────────────────────
  await miniProgram.reLaunch('/pages/projects/index?deviceId=probe-device&deviceName=测试机')
  await sleep(1800)
  const projectPage = await miniProgram.currentPage()

  const deviceContext = await projectPage.$('.projects-device-context')
  check('项目页当前电脑行存在', deviceContext != null)
  const caret = await projectPage.$('.projects-context-caret')
  check('电脑行有可切换提示（下拉箭头）', caret != null)

  await projectPage.setData({
    loading: false,
    errorText: '',
    deviceOffline: false,
    deviceUnavailable: false,
    deviceOptions: [
      { id: 'probe-device', label: '测试机 · 在线', checked: true },
      { id: 'probe-device-2', label: '另一台 · 离线', sub: 'Windows 工作站' },
    ],
    visibleCount: 2,
    pinnedView: [],
    normalView: [
      {
        id: 'p1',
        name: 'Spark-Agent',
        rootPath: '/tmp/p1',
        projectKind: 'normal',
        pinnedAt: null,
        updatedAt: new Date().toISOString(),
        sessionCount: 12,
        runningSessionCount: 1,
        isVirtual: false,
        updatedLabel: '2 小时前',
      },
      {
        id: 'default',
        name: '未归属项目',
        rootPath: '',
        projectKind: 'virtual',
        pinnedAt: null,
        updatedAt: '',
        sessionCount: 3,
        runningSessionCount: 0,
        isVirtual: true,
        updatedLabel: '',
      },
    ],
  })
  await sleep(400)

  const projectRows = await projectPage.$$('.projects-row')
  check('项目行渲染', projectRows.length === 2, `${projectRows.length} 行`)
  const toolbars = await projectPage.$$('.projects-toolbar')
  check('筛选 + 全部会话工具行存在', toolbars.length === 1)
  const allLink = await projectPage.$('.projects-all-link')
  check('全部会话入口存在', allLink != null)

  const pFilterChip = await projectPage.$('.projects-filter-chip')
  if (pFilterChip) {
    await pFilterChip.tap()
    await sleep(500)
    const sheet = await projectPage.$('.fs-sheet')
    check('项目筛选面板弹出', sheet != null)
    const titles = await projectPage.$$('.fs-card-title')
    check('项目筛选两个维度（时间/状态）', titles.length === 2, `${titles.length} 个`)
    await miniProgram.screenshot({ path: join(shotsDir, 'projects-filter.png') })
    const done = await projectPage.$('.fs-done')
    if (done) await done.tap()
    await sleep(300)
  }

  // 点当前电脑行 → 切换电脑弹层
  if (deviceContext) {
    await deviceContext.tap()
    await sleep(700)
    const sheetTitle = await projectPage.$('.sheet-title')
    check(
      '切换电脑弹层弹出',
      sheetTitle != null && (await text(sheetTitle)) === '切换电脑',
      sheetTitle ? await text(sheetTitle) : '缺失',
    )
    const options = await projectPage.$$('.sheet-option')
    check('弹层列出设备', options.length === 2, `${options.length} 项`)
    await miniProgram.screenshot({ path: join(shotsDir, 'projects-switch-device.png') })
    const done = await projectPage.$('.sheet-done')
    if (done) await done.tap()
    await sleep(300)
  }

  // ─── 3. 设备管理页：备注名入口 ────────────────────────────────────────────
  await miniProgram.reLaunch('/pages/bridge-devices/index')
  await sleep(1500)
  const bdPage = await miniProgram.currentPage()
  const bdCards = await bdPage.$$('.bd-card')
  if (bdCards.length > 0) {
    const aliasButtons = await bdPage.$$('.bd-btn-alias')
    check(
      '每台设备都有「备注名」入口',
      aliasButtons.length === bdCards.length,
      `${aliasButtons.length}/${bdCards.length}`,
    )
    await miniProgram.screenshot({ path: join(shotsDir, 'bridge-devices-alias.png') })
  } else {
    console.log('  ⏭  设备管理页无设备（未登录/未接入），跳过备注名入口断言')
  }

  await writeFile(
    join(shotsDir, 'result.json'),
    JSON.stringify({ failures, at: new Date().toISOString() }, null, 2),
  )

  console.log(
    failures.length === 0
      ? '\n🎉 探针全部通过'
      : `\n❌ 失败 ${failures.length} 项：${failures.join(' / ')}`,
  )
  process.exitCode = failures.length === 0 ? 0 : 1
}

main().catch((error) => {
  console.error('探针执行失败：', error)
  process.exitCode = 1
})
