import { describe, expect, it } from 'vitest'
import {
  ELEMENT_PICKER_CANCEL_SCRIPT,
  ELEMENT_PICKER_SCRIPT,
  buildElementReference,
  type ElementPickInfo,
} from '../design/components/browser/elementPickerScript'
import {
  formatBrowserReferenceLine,
  describeBrowserElementLabel,
} from '../design/views/chat/composer-browser-references'

function samplePick(overrides: Partial<ElementPickInfo> = {}): ElementPickInfo {
  return {
    tag: 'button',
    id: 'submit',
    name: null,
    role: null,
    ariaLabel: '提交订单',
    inputType: null,
    classes: ['btn', 'primary', 'cta', 'rounded'],
    text: '立即购买',
    href: null,
    selector: '#app main > button#submit',
    rect: { x: 10, y: 20, width: 120, height: 40 },
    pageUrl: 'https://example.com/product',
    ...overrides,
  }
}

describe('buildElementReference', () => {
  it('生成带 id/label 的引用，classes 截断到 3 个', () => {
    const reference = buildElementReference(samplePick())
    expect(reference.id).toMatch(/^browser-ref-/)
    expect(reference.label).toBe('button#submit「立即购买」')
    expect(reference.classes).toEqual(['btn', 'primary', 'cta'])
    expect(reference.selector).toBe('#app main > button#submit')
    expect(reference.pageUrl).toBe('https://example.com/product')
  })

  it('无 id 时 label 用首个 class，无文本时省略引号段', () => {
    const reference = buildElementReference(
      samplePick({ id: null, classes: ['nav'], text: '   ' }),
    )
    expect(reference.label).toBe('header.nav'.replace('header', 'button'))
    expect(reference.text).toBeNull()
  })
})

describe('formatBrowserReferenceLine', () => {
  it('输出元素摘要 + 选择器 + 页面的多行定位文本', () => {
    const text = formatBrowserReferenceLine(buildElementReference(samplePick()))
    const lines = text.split('\n')
    expect(lines[0]).toBe(
      '[浏览器元素引用] <button id="submit" class="btn primary cta">立即购买</button>',
    )
    expect(lines[1]).toBe('选择器: #app main > button#submit')
    expect(lines[2]).toBe('页面: https://example.com/product')
  })

  it('链接元素附 href 行', () => {
    const reference = buildElementReference(
      samplePick({ tag: 'a', href: 'https://example.com/next', text: '下一页' }),
    )
    expect(formatBrowserReferenceLine(reference)).toContain('链接: https://example.com/next')
  })
})

describe('describeBrowserElementLabel', () => {
  it('超长文本截断到 16 字符', () => {
    const label = describeBrowserElementLabel({
      tag: 'p',
      id: null,
      classes: [],
      text: '一二三四五六七八九十一二三四五六七八九十',
    })
    expect(label).toBe('p「一二三四五六七八九十一二三四五六…」')
  })
})

describe('ELEMENT_PICKER_SCRIPT', () => {
  it('返回 pending Promise（IIFE 表达式，非函数声明）', () => {
    expect(ELEMENT_PICKER_SCRIPT.trim().startsWith('(() => {')).toBe(true)
    // 含 __sparkPickerActive 守卫与 __sparkPickerCancel 取消入口
    expect(ELEMENT_PICKER_SCRIPT).toContain('__sparkPickerActive')
    expect(ELEMENT_PICKER_SCRIPT).toContain('__sparkPickerCancel')
    // 点击捕获阶段阻断页面默认行为
    expect(ELEMENT_PICKER_SCRIPT).toContain('stopImmediatePropagation')
    expect(ELEMENT_PICKER_SCRIPT).toContain("event.key === 'Escape'")
  })

  it('取消脚本安全调用已登记的取消函数', () => {
    expect(ELEMENT_PICKER_CANCEL_SCRIPT).toContain('__sparkPickerCancel')
    // node 测试环境补一个空 window，脚本在无副作用页面上求值应返回 null
    const globalScope = globalThis as { window?: unknown }
    const hadWindow = 'window' in globalScope
    const original = globalScope.window
    globalScope.window = {}
    try {
      expect(eval(ELEMENT_PICKER_CANCEL_SCRIPT)).toBeNull()
    } finally {
      if (hadWindow) globalScope.window = original
      else delete globalScope.window
    }
  })
})
