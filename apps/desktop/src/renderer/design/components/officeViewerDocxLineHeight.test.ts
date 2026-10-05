// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachDocxLineHeightCorrection,
  correctDocxLineHeights,
} from './officeViewerDocxLineHeight'

/**
 * 构建与真实挂载一致的结构：FileViewer 容器元素自身挂 Shadow DOM（styleIsolation
 * 默认 'auto' 的行为），文档内容都在 shadow root 里。
 * - viewer chrome 样式（font 简写里带 1.45，不应被改写）
 * - docx 默认样式（tab-stop / rt 的 line-height: 1 不应被改写；`.docx p` 的 min-height:1em 应被改写）
 * - 命名样式生成的段落规则（数值 line-height 应被改写）
 * - 段落内联样式（数值 / pt / min-height 混合场景）
 */
const buildShadow = () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = container.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style data-test="viewer-chrome">.file-viewer-web-shell{font:14px/1.45 system-ui,sans-serif;}</style>
    <style data-test="docx-defaults">
.docx .docx-tab-stop { display: inline-block; min-width: 1em; white-space: nowrap; line-height: 1; }
.docx rt { line-height: 1; }
.docx p { margin: 0pt; min-height: 1em; }
    </style>
    <style data-test="docx-styles">
.docx p, .docx p.docx_1 { margin-top: 0pt; margin-bottom: 2pt; line-height: 1.15; }
.docx p.docx_3 { line-height: 1.3; }
    </style>
    <div class="docx-fit-viewer">
      <div class="docx-wrapper">
        <section class="docx">
          <p style="margin-top: 0pt; margin-bottom: 2pt; line-height: 1.15;">第一段</p>
          <p style="line-height: 2.00">第二段</p>
          <p style="line-height: 24pt">固定行距</p>
          <p style="min-height: 18pt">网格段落</p>
        </section>
      </div>
    </div>`
  return { container, root }
}

const styleText = (root: ShadowRoot, testId: string): string =>
  root.querySelector(`style[data-test="${testId}"]`)?.textContent ?? ''

/** 把探针的 getBoundingClientRect 桩为指定高度,用于模拟可测量的真实浏览器环境 */
const stubProbeHeight = (height: number) =>
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        height,
        width: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  )

describe('correctDocxLineHeights', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('rewrites numeric inline paragraph line-heights to the natural-ratio calc form', () => {
    const { root } = buildShadow()
    correctDocxLineHeights(root)
    const paragraphs = [...root.querySelectorAll<HTMLElement>('.docx-wrapper p')]
    expect(paragraphs[0]?.style.lineHeight).toBe('calc(1.15 * var(--docx-lh-natural, 1))')
    // CSSOM 会把 2.00 规范化为 2，改写使用规范化后的数值
    expect(paragraphs[1]?.style.lineHeight).toBe('calc(2 * var(--docx-lh-natural, 1))')
  })

  it('keeps absolute pt line-heights and unrelated inline declarations untouched', () => {
    const { root } = buildShadow()
    correctDocxLineHeights(root)
    const paragraphs = [...root.querySelectorAll<HTMLElement>('.docx-wrapper p')]
    expect(paragraphs[2]?.style.lineHeight).toBe('24pt')
    expect(paragraphs[2]?.getAttribute('style')).toContain('line-height: 24pt')
    expect(paragraphs[3]?.getAttribute('style')).toContain('min-height: 18pt')
    expect(paragraphs[0]?.getAttribute('style')).toContain('margin-bottom: 2pt')
  })

  it('rewrites paragraph rules in generated stylesheets but not tab-stop/rt/viewer chrome', () => {
    const { root } = buildShadow()
    correctDocxLineHeights(root)
    const styles = styleText(root, 'docx-styles')
    expect(styles).toContain('line-height:calc(1.15 * var(--docx-lh-natural,1))')
    expect(styles).toContain('line-height:calc(1.3 * var(--docx-lh-natural,1))')
    expect(styles).not.toContain('line-height: 1.15')

    const defaults = styleText(root, 'docx-defaults')
    expect(defaults).toContain('min-height:calc(1em * var(--docx-lh-natural,1))')
    // 制表符前导线与注音行高必须保持原样
    expect(defaults).toContain('.docx-tab-stop')
    expect((defaults.match(/line-height: 1/g) ?? []).length).toBe(2)

    const chrome = styleText(root, 'viewer-chrome')
    expect(chrome).toBe('.file-viewer-web-shell{font:14px/1.45 system-ui,sans-serif;}')
  })

  it('is idempotent: a second pass does not double-wrap values', () => {
    const { root } = buildShadow()
    correctDocxLineHeights(root)
    const once = styleText(root, 'docx-styles')
    const inlineOnce = root.querySelector<HTMLElement>('.docx-wrapper p')?.getAttribute('style')
    correctDocxLineHeights(root)
    expect(styleText(root, 'docx-styles')).toBe(once)
    expect(root.querySelector<HTMLElement>('.docx-wrapper p')?.getAttribute('style')).toBe(
      inlineOnce,
    )
  })

  it('skips silently when no docx content is mounted', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = container.attachShadow({ mode: 'open' })
    root.innerHTML = '<style>.a{color:red;}</style><div></div>'
    expect(() => correctDocxLineHeights(root)).not.toThrow()
  })

  it('does not set the ratio variable when measurement is unavailable (jsdom zero-height)', () => {
    const { root } = buildShadow()
    correctDocxLineHeights(root)
    const viewerRoot = root.querySelector<HTMLElement>('.docx-fit-viewer')
    // jsdom 的 getBoundingClientRect 高度为 0，测量应返回 null 且不写入变量，
    // calc(...) 回退 * 1，等价于原始渲染。
    expect(viewerRoot?.style.getPropertyValue('--docx-lh-natural')).toBe('')
  })

  it('reports no-docx for non-docx content and unmeasured when the probe cannot measure', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = container.attachShadow({ mode: 'open' })
    // xlsx/pptx 预览：没有 docx 容器,不属于校正职责
    root.innerHTML = '<style>.a{color:red;}</style><div class="sheet-viewer">10</div>'
    expect(correctDocxLineHeights(root)).toBe('no-docx')

    const { root: docxRoot } = buildShadow()
    expect(correctDocxLineHeights(docxRoot)).toBe('unmeasured')
  })

  it('caches the measured ratio per document section and re-measures on file switch', () => {
    const rectSpy = stubProbeHeight(140)
    const { root } = buildShadow()
    const viewerRoot = root.querySelector<HTMLElement>('.docx-fit-viewer')
    expect(correctDocxLineHeights(root)).toBe('measured')
    expect(viewerRoot?.style.getPropertyValue('--docx-lh-natural')).toBe('1.400')

    // 同一文档重复 pass：命中缓存,即使探针度量变化也不改写比值
    rectSpy.mockImplementation(() => ({ height: 120 } as DOMRect))
    expect(correctDocxLineHeights(root)).toBe('measured')
    expect(viewerRoot?.style.getPropertyValue('--docx-lh-natural')).toBe('1.400')

    // 模拟切换文件：section.docx 重建（新文档字体度量不同）,应重测
    root.querySelector('section.docx')?.remove()
    const section = document.createElement('section')
    section.className = 'docx'
    root.querySelector('.docx-wrapper')?.appendChild(section)
    expect(correctDocxLineHeights(root)).toBe('measured')
    expect(viewerRoot?.style.getPropertyValue('--docx-lh-natural')).toBe('1.200')
  })

  it('rewrites paragraph rules appended to an already-processed style element', () => {
    const { root } = buildShadow()
    correctDocxLineHeights(root)
    // 模拟渐进渲染向已处理过的样式表追加新数值规则
    const styleEl = root.querySelector<HTMLStyleElement>('style[data-test="docx-styles"]')
    styleEl!.textContent += '\n.docx p.docx_9 { line-height: 1.5; }'
    correctDocxLineHeights(root)
    const next = styleEl!.textContent ?? ''
    // 新追加的规则被改写
    expect(next).toContain('line-height:calc(1.5 * var(--docx-lh-natural,1))')
    // 已处理内容保持稳定
    expect(next).toContain('line-height:calc(1.15 * var(--docx-lh-natural,1))')
    expect(next).not.toContain('line-height: 1.5')
  })
})

describe('attachDocxLineHeightCorrection', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('processes content that renders after attach and stops after detach', async () => {
    const { container, root } = buildShadow()
    const detach = attachDocxLineHeightCorrection(container)
    // attach 时内容已在,等待 rAF 触发的一轮 pass
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(
      root.querySelector<HTMLElement>('.docx-wrapper p')?.style.lineHeight,
    ).toContain('var(--docx-lh-natural')

    // 渐进渲染:追加新段落,应被下一轮 pass 覆盖
    const late = document.createElement('p')
    late.setAttribute('style', 'line-height: 1.5')
    root.querySelector('.docx-wrapper')?.appendChild(late)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(late.style.lineHeight).toBe('calc(1.5 * var(--docx-lh-natural, 1))')

    detach()

    // 解绑后不再处理新增内容
    const after = document.createElement('p')
    after.setAttribute('style', 'line-height: 1.5')
    root.querySelector('.docx-wrapper')?.appendChild(after)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(after.style.lineHeight).toBe('1.5')
  })

  it('retries measurement after the backoff window once the panel can measure', async () => {
    const { container, root } = buildShadow()
    const detach = attachDocxLineHeightCorrection(container)
    const viewerRoot = root.querySelector<HTMLElement>('.docx-fit-viewer')

    // 首轮 pass:jsdom 探针高度为 0,测量失败,比值不写入
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(viewerRoot?.style.getPropertyValue('--docx-lh-natural')).toBe('')

    // 模拟面板变为可见(探针可测量),退避窗口到点后的重试 pass 自动补测
    stubProbeHeight(140)
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(viewerRoot?.style.getPropertyValue('--docx-lh-natural')).toBe('1.400')

    // 补测成功后不再安排重试:再等一个退避窗口,无新增变化
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(viewerRoot?.style.getPropertyValue('--docx-lh-natural')).toBe('1.400')

    detach()
  }, 6000)
})
