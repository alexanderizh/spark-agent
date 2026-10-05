/**
 * Word 预览（docx-preview 渲染链）行距校正。
 *
 * 缺陷根因：renderer-word 底层的 docx-preview 把 w:spacing@w:line（lineRule="auto"，
 * 即 Word 的「多倍行距」）直接映射为 CSS `line-height: <line/240>`——这是「乘以字号」。
 * 而 Word 的多倍行距乘的是字体的自然行高（含字体内部行距，PingFang SC 约 1.4 倍字号、
 * 宋体系约 1.3~1.4），因此中文 Word 文档在预览面板里行距/段间距整体比 Word 偏紧约
 * 25%~30%，排版观感明显不对。
 *
 * 修复方式：渲染完成后在 viewer 的 Shadow DOM 内做一次幂等改写——
 *  1. 段落内联样式 `line-height: 1.15` → `calc(1.15 * var(--docx-lh-natural, 1))`；
 *  2. 生成样式表中段落规则（`.docx p` 等）的数值 line-height 同样改写；
 *  3. 默认样式 `.docx p { min-height: 1em }` → calc 形式，让空段落（无 <br>、无内容）
 *     的高度跟随自然行高，与 Word 空行一致；
 * 并把实测的「字体自然行高 / 字号」比值写到 `.docx-fit-viewer` 的
 * `--docx-lh-natural` 自定义属性上，后续仅需更新这一个变量即可整体生效。
 *
 * 安全边界：
 *  - 只改写段落规则；`.docx-tab-stop`（制表符前导线）、`.docx rt`（注音）等默认
 *    样式里的 line-height: 1 不动，viewer 自身 chrome 样式也不含数值 line-height；
 *  - exact/atLeast 行距是绝对值（pt），Word 语义一致，不改写；
 *  - 改写均为幂等形式（calc(… * var(…)) 不再匹配纯数字模式），MutationObserver
 *    跟随渐进渲染重复触发时不会二次放大；样式表按「文本恒等」跳过已处理内容，
 *    文本被追加新数值规则时仍会被改写；
 *  - 自然行高比值按文档根（section.docx）缓存：换文件后 section 重建会自动重测，
 *    不会沿用上一篇文档的字体度量；
 *  - 测量不可用（如面板隐藏时高度为 0、jsdom 测试环境）时不设置变量，calc 回退
 *    `* 1`，等价于原始渲染，不会更差；失败后按秒级退避重试（探针追加会触发
 *    观察器，无退避会在测量持续失败时形成 rAF 自旋），面板可见后自动补测。
 */

const LINE_HEIGHT_VAR = '--docx-lh-natural'
/** 内联样式里使用带空格的引用形式，可读性更好 */
const LINE_HEIGHT_VAR_REF = 'var(--docx-lh-natural, 1)'
/** 样式表文本里使用紧凑形式，减少对大样式表（数百 KB）的体积放大 */
const LINE_HEIGHT_VAR_REF_COMPACT = 'var(--docx-lh-natural,1)'

const NUMERIC_LINE_HEIGHT = /^\d+(?:\.\d+)?$/
/** 比值的合理范围：正常字体自然行高在 1.05~3 倍字号之间，超出视为测量异常 */
const NATURAL_RATIO_MIN = 1.05
const NATURAL_RATIO_MAX = 3
/** 探针文本需同时覆盖拉丁与 CJK 字形，让字体回退链里实际参与渲染的度量都被计入 */
const NATURAL_PROBE_TEXT = 'Ag前端1g永'

const OBSERVER_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['style'],
}

/** 测量失败后的重试退避窗口（毫秒）：探针追加会触发观察器，无退避会在测量持续
 * 失败（面板隐藏、字体度量异常）时形成 pass → 探针 → pass 的 rAF 自旋 */
const MEASURE_RETRY_MS = 1000

interface MeasureState {
  /** 最近一次成功测量对应的文档根（section.docx）；换文件后 section 重建，据此识别重测 */
  section?: Element
  ratio?: number
  /** 最近一次测量失败的时间戳；窗口内跳过探测 */
  failedAt?: number
}

const measureStates = new WeakMap<HTMLElement, MeasureState>()
/** 已处理过的样式表文本；write-once 样式表恒等跳过，文本被追加时重新改写 */
const processedSheetText = new WeakMap<HTMLStyleElement, string>()

/**
 * 判断样式表规则选择器是否指向段落元素。
 * `.docx p` / `.docx p.docx_1` / `p.docx_x` 命中；`.docx-tab-stop`、`.docx rt` 不命中。
 */
const isParagraphRuleSelector = (selector: string): boolean =>
  selector
    .split(',')
    .some((part) => /(^|\s)p($|\s|[.[:])/.test(part.trim()))

/**
 * 用探针元素实测「自然行高 / 字号」比值：与文档段落同字体栈、line-height:normal。
 * 返回 null 表示测量不可用（高度为 0 或超出合理范围），调用方应保持回退行为。
 */
const measureNaturalLineHeightRatio = (mount: HTMLElement, fontFamily: string): number | null => {
  const doc = mount.ownerDocument
  if (!doc) return null
  const probe = doc.createElement('div')
  probe.textContent = NATURAL_PROBE_TEXT
  probe.setAttribute(
    'style',
    'position:absolute;visibility:hidden;white-space:nowrap;' +
      'font-size:100px;line-height:normal;margin:0;padding:0;border:0;',
  )
  if (fontFamily) probe.style.fontFamily = fontFamily
  mount.appendChild(probe)
  const height = probe.getBoundingClientRect().height
  probe.remove()
  if (!(height > 0)) return null
  const ratio = height / 100
  if (ratio < NATURAL_RATIO_MIN || ratio > NATURAL_RATIO_MAX) return null
  return Math.round(ratio * 1000) / 1000
}

/**
 * 把实测比值写到 viewer 根节点。
 * 返回「当前文档是否已有可用比值」：同一文档测过且未变化时直接命中缓存；
 * 换文件后 section 重建会重测（新文档字体度量可能不同），不沿用旧比值。
 * `force` 用于字体加载完成后强制重测（内嵌字体到位会改变度量）。
 * 测量失败时保留已有比值（回退 `* 1` 或沿用近似值），并记录失败时间做秒级退避。
 */
const applyNaturalRatioVar = (
  root: ShadowRoot | HTMLElement,
  viewerRoot: HTMLElement,
  force = false,
): boolean => {
  const section = root.querySelector<HTMLElement>('section.docx')
  if (!section) return false
  const state = measureStates.get(viewerRoot)
  if (!force && state?.ratio != null && state.section === section) return true
  if (
    !force &&
    state?.failedAt != null &&
    Date.now() - state.failedAt < MEASURE_RETRY_MS
  ) {
    return false
  }
  const ratio = measureNaturalLineHeightRatio(viewerRoot, getComputedStyle(section).fontFamily)
  if (ratio == null) {
    measureStates.set(viewerRoot, { ...state, failedAt: Date.now() })
    return false
  }
  measureStates.set(viewerRoot, { section, ratio })
  viewerRoot.style.setProperty(LINE_HEIGHT_VAR, ratio.toFixed(3))
  return true
}

/** 段落内联样式：`line-height: 1.15` → `calc(1.15 * var(--docx-lh-natural, 1))` */
const rewriteInlineParagraphLineHeights = (viewerRoot: HTMLElement): void => {
  for (const paragraph of viewerRoot.querySelectorAll<HTMLElement>('p[style]')) {
    const value = paragraph.style.lineHeight
    if (!NUMERIC_LINE_HEIGHT.test(value)) continue
    paragraph.style.lineHeight = `calc(${value} * ${LINE_HEIGHT_VAR_REF})`
  }
}

/**
 * 生成样式表：只改写段落规则里的数值 line-height 与默认空段落 min-height:1em，
 * 其余声明（pt 值、max()、tab-stop 等）原样保留。calc 形式天然幂等。
 */
const rewriteDocumentCssText = (cssText: string): string =>
  cssText.replace(/([^{}]+)\{([^{}]*)\}/g, (rule, selector: string, body: string) => {
    if (!isParagraphRuleSelector(selector)) return rule
    const nextBody = body
      .replace(
        /(line-height:)\s*(\d+(?:\.\d+)?)(?=\s*[;}])/g,
        (_match, property: string, value: string) =>
          `${property}calc(${value} * ${LINE_HEIGHT_VAR_REF_COMPACT})`,
      )
      .replace(
        /(min-height:)\s*1em(?=\s*[;}])/g,
        (_match, property: string) => `${property}calc(1em * ${LINE_HEIGHT_VAR_REF_COMPACT})`,
      )
    return nextBody === body ? rule : `${selector}{${nextBody}}`
  })

const rewriteParagraphStylesheetDeclarations = (root: ShadowRoot | HTMLElement): void => {
  for (const style of root.querySelectorAll<HTMLStyleElement>('style')) {
    const text = style.textContent ?? ''
    if (!text || processedSheetText.get(style) === text) continue
    if (!text.includes('line-height') && !text.includes('min-height')) {
      processedSheetText.set(style, text)
      continue
    }
    const next = rewriteDocumentCssText(text)
    if (next !== text) style.textContent = next
    // 记录改写后的文本：write-once 样式表后续 pass 恒等跳过；文本被追加时重新改写
    processedSheetText.set(style, style.textContent ?? '')
  }
}

/**
 * 一轮校正的结局：
 *  - 'no-docx'：当前没有 docx 内容（xlsx/pptx 预览或尚未挂载），无需重试；
 *  - 'measured'：当前文档已测得自然行高比值，进入稳定态；
 *  - 'unmeasured'：有 docx 内容但测量暂不可用（如面板隐藏），值得安排重试。
 */
export type DocxCorrectionStatus = 'no-docx' | 'measured' | 'unmeasured'

/**
 * 对一个已挂载的 viewer 根（ShadowRoot 或降级的普通容器）执行一轮行距校正。
 * 幂等：重复调用不会二次放大，可直接在测试中独立调用。
 */
export const correctDocxLineHeights = (root: ShadowRoot | HTMLElement): DocxCorrectionStatus => {
  const viewerRoot =
    root.querySelector<HTMLElement>('.docx-fit-viewer') ??
    root.querySelector<HTMLElement>('.docx-wrapper')
  if (!viewerRoot) return 'no-docx'
  const measured = applyNaturalRatioVar(root, viewerRoot)
  rewriteInlineParagraphLineHeights(viewerRoot)
  rewriteParagraphStylesheetDeclarations(root)
  return measured ? 'measured' : 'unmeasured'
}

/**
 * 持续跟随 viewer 渲染并对 docx 内容做行距校正。
 * `container` 是 FileViewer 渲染出的容器元素：styleIsolation 为默认 'auto' 时
 * viewer 会在其上挂 Shadow DOM（文档内容都在里面），降级模式下容器本身就是根。
 * viewer 分批渐进渲染、主题切换会整体重建内容，因此用 MutationObserver 跟随；
 * 字体加载完成后（document.fonts.ready）强制重测一次自然行高比。
 * 返回解绑函数。
 */
export const attachDocxLineHeightCorrection = (container: HTMLElement): (() => void) => {
  const view = container.ownerDocument?.defaultView
  if (typeof MutationObserver === 'undefined' || !view) return () => undefined

  let detached = false
  let frame = 0
  let retryTimer: number | undefined
  let observedRoot: ShadowRoot | HTMLElement | null = null
  const observer = new MutationObserver(() => schedulePass())

  // 预先绑定 rAF 与定时器,让上方对 view 的空值守卫对闭包保持类型收窄
  const requestFrame = view.requestAnimationFrame.bind(view)
  const cancelFrame = view.cancelAnimationFrame.bind(view)
  const scheduleRetryTimer = view.setTimeout.bind(view)
  const cancelRetryTimer = view.clearTimeout.bind(view)

  const scheduleMeasureRetry = (): void => {
    if (detached || retryTimer != null) return
    retryTimer = scheduleRetryTimer(() => {
      retryTimer = undefined
      schedulePass()
    }, MEASURE_RETRY_MS)
  }

  const runPass = (): void => {
    frame = 0
    if (detached) return
    const root = container.shadowRoot ?? container
    if (observedRoot !== root) {
      observer.disconnect()
      observer.observe(root, OBSERVER_OPTIONS)
      observedRoot = root
    }
    if (correctDocxLineHeights(root) === 'unmeasured') scheduleMeasureRetry()
  }

  function schedulePass(): void {
    if (detached || frame) return
    frame = requestFrame(() => runPass())
  }

  schedulePass()

  // 字体（含文档内嵌字体）加载完成后度量会变化，强制重测一次比值
  void container.ownerDocument?.fonts?.ready
    .then(() => {
      if (detached) return
      const root = observedRoot
      if (!root) return
      const viewerRoot =
        root.querySelector<HTMLElement>('.docx-fit-viewer') ??
        root.querySelector<HTMLElement>('.docx-wrapper')
      if (!viewerRoot) return
      applyNaturalRatioVar(root, viewerRoot, true)
    })
    .catch(() => undefined)

  return () => {
    detached = true
    if (frame) cancelFrame(frame)
    frame = 0
    if (retryTimer != null) cancelRetryTimer(retryTimer)
    retryTimer = undefined
    observer.disconnect()
  }
}
