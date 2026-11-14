#!/usr/bin/env node
/**
 * 模型配置弹层冒烟：模型列表要能滚、底部「推理强度 / 权限」要固定露出来。
 *
 * 断言的核心不变量：列表上限 + 头尾占位 ≤ sheet 上限（82vh），
 * 也就是说底栏永远不会被列表顶出屏幕。
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const require = createRequire(import.meta.url)

const layout = require(join(dist, 'utils', 'config-sheet-layout.js'))

let pass = 0
function check(name, fn) {
  fn()
  pass += 1
  console.log(`✅ ${name}`)
}

/** iPhone 13 尺寸：390×844，底部安全区 34 */
const IPHONE = { windowWidth: 390, windowHeight: 844, safeBottom: 34 }
/** 底栏有两种形态：带权限行（更高）/ 只有推理强度 */
const FOOTER_WITH_PERMISSION = 158
const FOOTER_EFFORT_ONLY = 78

/** 底栏底边是否仍在 sheet 内 = 各项之和不超过 sheet 上限 */
function totalHeight(metrics, bodyMax) {
  const pxPerRpx = metrics.windowWidth / 750
  const chrome = 136 * pxPerRpx + (metrics.safeBottom ?? 0)
  return chrome + (metrics.footerHeight ?? 0) + bodyMax
}

check('列表上限 + 头尾 ≤ sheet 上限（底栏不会被顶出屏幕）', () => {
  for (const footerHeight of [FOOTER_WITH_PERMISSION, FOOTER_EFFORT_ONLY, 0]) {
    const metrics = { ...IPHONE, footerHeight }
    const bodyMax = layout.computeConfigSheetBodyMax(metrics)
    assert.ok(bodyMax > 0, `footer=${footerHeight} 应算出可用高度`)
    assert.ok(
      totalHeight(metrics, bodyMax) <= IPHONE.windowHeight * 0.82 + 1,
      `footer=${footerHeight} 总高超出 82vh：${totalHeight(metrics, bodyMax)}`,
    )
  }
})

check('底栏越高，列表可用高度越小（按实测收缩）', () => {
  const tall = layout.computeConfigSheetBodyMax({ ...IPHONE, footerHeight: FOOTER_WITH_PERMISSION })
  const short = layout.computeConfigSheetBodyMax({ ...IPHONE, footerHeight: FOOTER_EFFORT_ONLY })
  assert.equal(short - tall, FOOTER_WITH_PERMISSION - FOOTER_EFFORT_ONLY)
})

check('长列表按上限封顶（会滚），不是撑到内容高度', () => {
  const bodyMax = layout.computeConfigSheetBodyMax({
    ...IPHONE,
    footerHeight: FOOTER_WITH_PERMISSION,
  })
  // 参考：几十个模型的内容高度远超这个值
  assert.ok(bodyMax < 844 * 0.82, '必须比整张 sheet 小，才能给底栏留位置')
  assert.ok(bodyMax > 200, `可用高度过小：${bodyMax}`)
})

check('底部安全区占掉列表空间', () => {
  const withSafe = layout.computeConfigSheetBodyMax({
    ...IPHONE,
    footerHeight: FOOTER_WITH_PERMISSION,
  })
  const noSafe = layout.computeConfigSheetBodyMax({
    ...IPHONE,
    safeBottom: 0,
    footerHeight: FOOTER_WITH_PERMISSION,
  })
  assert.equal(noSafe - withSafe, IPHONE.safeBottom)
})

check('小屏仍给底栏留位置', () => {
  const small = { windowWidth: 320, windowHeight: 568, safeBottom: 0, footerHeight: 140 }
  const bodyMax = layout.computeConfigSheetBodyMax(small)
  assert.ok(
    totalHeight(small, bodyMax) <= small.windowHeight * 0.82 + 1,
    `小屏总高超出上限：${totalHeight(small, bodyMax)}`,
  )
})

check('横屏等极端尺寸返回 0，交给样式表兜底', () => {
  const landscape = { windowWidth: 844, windowHeight: 390, safeBottom: 21, footerHeight: 330 }
  assert.equal(layout.computeConfigSheetBodyMax(landscape), 0)
})

check('safeArea 换算底部安全区', () => {
  assert.equal(layout.resolveSafeBottom({ windowHeight: 844, safeArea: { bottom: 810 } }), 34)
  assert.equal(layout.resolveSafeBottom({ windowHeight: 844, safeArea: { bottom: 900 } }), 0)
  assert.equal(layout.resolveSafeBottom({ windowHeight: 844 }), 0)
})

// ─── 组件接线：打开时量底栏、算上限、滚到选中项 ─────────────────────────

let options = null
globalThis.Component = (value) => {
  options = value
}
globalThis.wx = {
  getWindowInfo: () => ({
    ...IPHONE,
    safeArea: { bottom: IPHONE.windowHeight - IPHONE.safeBottom },
  }),
  nextTick: (fn) => fn(),
}

require(join(dist, 'components', 'config-sheet', 'index.js'))

function makeContext(data) {
  return {
    // 真机上方法挂在实例上，这里照做，别让 measureBody 变成 undefined
    ...options.methods,
    data: { bodyMax: 0, scrollTarget: '', ...data },
    setData(patch) {
      Object.assign(this.data, patch)
    },
    createSelectorQuery() {
      const query = {
        select: () => query,
        boundingClientRect: () => query,
        exec: (callback) => callback([{ height: FOOTER_WITH_PERMISSION }]),
      }
      return query
    },
  }
}

const MODELS = [
  { id: 'a::1', label: 'qwen3:4b' },
  { id: 'a::2', label: 'glm-5.3' },
  { id: 'b::3', label: 'gpt-6.1-sol', checked: true },
]

check('打开时算出列表上限并写进 bodyMax', () => {
  const context = makeContext({
    show: true,
    models: MODELS,
    efforts: [{ id: 'high', label: '高' }],
  })
  options.observers.show.call(context, true)
  assert.equal(
    context.data.bodyMax,
    layout.computeConfigSheetBodyMax({ ...IPHONE, footerHeight: FOOTER_WITH_PERMISSION }),
  )
})

check('打开时滚到当前选中的模型', () => {
  const context = makeContext({ show: true, models: MODELS, efforts: [] })
  options.observers.show.call(context, true)
  assert.equal(context.data.scrollTarget, 'cs-model-2')
})

check('没有选中项时不强制滚动', () => {
  const context = makeContext({
    show: true,
    models: [{ id: 'a::1', label: 'qwen3:4b' }],
    efforts: [],
  })
  options.observers.show.call(context, true)
  assert.equal(context.data.scrollTarget, '')
})

check('关闭状态不测量（省一次 selectorQuery）', () => {
  const context = makeContext({
    show: false,
    models: MODELS,
    efforts: [],
    scrollTarget: 'cs-model-2',
  })
  options.observers.show.call(context, false)
  assert.equal(context.data.bodyMax, 0)
  assert.equal(context.data.scrollTarget, '', '关掉要清掉滚动目标，下次打开才会重新定位')
})

check('底栏没渲染（无推理强度 / 权限）时按 0 计，列表拿到更多空间', () => {
  const context = makeContext({ show: true, models: MODELS, efforts: [] })
  context.createSelectorQuery = () => {
    const query = {
      select: () => query,
      boundingClientRect: () => query,
      exec: (callback) => callback([null]),
    }
    return query
  }
  options.observers.show.call(context, true)
  assert.equal(
    context.data.bodyMax,
    layout.computeConfigSheetBodyMax({ ...IPHONE, footerHeight: 0 }),
  )
})

check('量完之后高度变了会重新量（底栏出现权限行）', () => {
  const context = makeContext({ show: true, models: MODELS, efforts: [] })
  options.observers.show.call(context, true)
  const before = context.data.bodyMax
  context.createSelectorQuery = () => {
    const query = {
      select: () => query,
      boundingClientRect: () => query,
      exec: (callback) => callback([{ height: 200 }]),
    }
    return query
  }
  context.data.permissionLabel = '免确认'
  options.observers['models, efforts, permissionLabel'].call(context)
  assert.ok(context.data.bodyMax < before, '底栏变高后列表上限要变小')
})

check('选中项变了也不重新定位（避免选完列表跳一下）', () => {
  const context = makeContext({ show: true, models: MODELS, efforts: [] })
  options.observers.show.call(context, true)
  const target = context.data.scrollTarget
  context.data.models = MODELS.map((model, index) => ({ ...model, checked: index === 0 }))
  options.observers['models, efforts, permissionLabel'].call(context)
  assert.equal(context.data.scrollTarget, target)
  assert.equal(target, 'cs-model-2')
})

check('WXML 绑定：列表读 bodyMax 与 scrollTarget', () => {
  const { readFileSync } = require('node:fs')
  const wxml = readFileSync(join(root, 'src', 'components', 'config-sheet', 'index.wxml'), 'utf8')
  assert.match(wxml, /scroll-into-view="\{\{scrollTarget\}\}"/)
  assert.match(wxml, /bodyMax > 0 \? 'max-height:' \+ bodyMax \+ 'px'/)
  assert.match(wxml, /id="cs-model-\{\{modelIndex\}\}"/)
})

console.log(`\n${pass}/${pass} 通过`)
