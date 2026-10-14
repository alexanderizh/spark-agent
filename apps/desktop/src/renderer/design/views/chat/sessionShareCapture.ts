import { resolveShareCaptureScale } from './sessionShareModel'

export interface SessionShareImage {
  blob: Blob
  width: number
  height: number
  scale: number
}

const PAINT_PROPS = [
  'color',
  'background-color',
  'background-image',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
  'box-shadow',
  'text-shadow',
  'fill',
  'stroke',
]

/** 等字体、图片和异步高亮都停下来，再量高度、再截图。 */
export async function waitForShareSheet(root: HTMLElement): Promise<void> {
  await Promise.race([
    document.fonts?.ready ?? Promise.resolve(),
    delay(1500),
  ])
  await waitForImages(root)
  await waitForQuietDom(root, 180, 2200)
  await nextFrame()
}

export async function captureSessionShareSheet(sheet: HTMLElement): Promise<SessionShareImage> {
  const cssWidth = Math.max(1, sheet.scrollWidth)
  const cssHeight = Math.max(1, sheet.scrollHeight)
  const scale = resolveShareCaptureScale(cssWidth, cssHeight)
  const backgroundColor = readSheetBackground(sheet)
  const canvas = await renderSheet(sheet, cssWidth, cssHeight, scale, backgroundColor)
  const blob = await canvasToPngBlob(canvas)
  return { blob, width: canvas.width, height: canvas.height, scale }
}

/**
 * 用浏览器自己的排版画进 SVG foreignObject。
 * html2canvas 不认识网格和 color-mix，会把消息区画坏，只在这条路失败时兜底。
 */
async function renderSheet(
  sheet: HTMLElement,
  cssWidth: number,
  cssHeight: number,
  scale: number,
  backgroundColor: string | null,
): Promise<HTMLCanvasElement> {
  try {
    const canvas = await renderSheetWithBrowser(sheet, cssWidth, cssHeight, scale, backgroundColor)
    if (!canvasLooksBlank(canvas)) return canvas
  } catch {
    // 浏览器绘制失败时退回 html2canvas，并先把计算后的颜色写进行内样式。
  }
  return renderSheetWithHtml2Canvas(sheet, scale, backgroundColor)
}

async function renderSheetWithBrowser(
  sheet: HTMLElement,
  cssWidth: number,
  cssHeight: number,
  scale: number,
  backgroundColor: string | null,
): Promise<HTMLCanvasElement> {
  const bitmapWidth = Math.max(1, Math.round(cssWidth * scale))
  const bitmapHeight = Math.max(1, Math.round(cssHeight * scale))
  const clone = sheet.cloneNode(true) as HTMLElement
  pinFixedElements(sheet, clone)
  stripInvalidXmlChars(clone)
  await inlineCloneImages(sheet, clone)
  const xhtml = serializeCaptureDocument(clone, sheet, cssWidth, backgroundColor)
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${bitmapWidth}" height="${bitmapHeight}" viewBox="0 0 ${cssWidth} ${cssHeight}">
  <foreignObject x="0" y="0" width="${cssWidth}" height="${cssHeight}">${xhtml}</foreignObject>
</svg>`
  return drawSvg(svg, bitmapWidth, bitmapHeight)
}

function serializeCaptureDocument(
  clone: HTMLElement,
  sheet: HTMLElement,
  cssWidth: number,
  backgroundColor: string | null,
): string {
  const html = document.createElement('html')
  html.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  const sourceHtml = document.documentElement
  for (const name of ['lang', 'class', 'data-theme', 'data-backdrop-blur', 'data-density']) {
    const value = sourceHtml.getAttribute(name)
    if (value) html.setAttribute(name, value)
  }
  copyCustomProperties(sheet, html)
  html.style.margin = '0'
  html.style.background = backgroundColor ?? 'transparent'

  const style = document.createElement('style')
  style.textContent = collectCaptureCss()

  const app = document.querySelector<HTMLElement>('.app')
  const frame = document.createElement('div')
  frame.className = app?.className || themeClassName(sourceHtml)
  frame.style.setProperty('width', `${cssWidth}px`, 'important')
  frame.style.setProperty('height', 'auto', 'important')
  frame.style.setProperty('min-height', '0', 'important')
  frame.style.setProperty('max-height', 'none', 'important')
  frame.style.setProperty('overflow', 'visible', 'important')
  frame.style.setProperty('display', 'block', 'important')
  frame.style.setProperty('position', 'static', 'important')
  frame.append(clone)

  const body = document.createElement('body')
  body.setAttribute(
    'style',
    `margin:0;padding:0;width:${cssWidth}px;background:${backgroundColor ?? 'transparent'};`,
  )
  body.append(style, frame)
  html.append(document.createElement('head'), body)
  return new XMLSerializer().serializeToString(html)
}

function themeClassName(source: HTMLElement): string {
  const theme = source.getAttribute('data-theme')
  return theme ? `app theme-${theme}` : 'app'
}

function collectCaptureCss(): string {
  const chunks: string[] = []
  const seen = new Set<CSSStyleSheet>()
  const visit = (sheet: CSSStyleSheet | null) => {
    if (sheet == null || seen.has(sheet)) return
    seen.add(sheet)
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      return
    }
    const base = sheet.href ?? document.baseURI
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSImportRule) {
        visit(rule.styleSheet)
        continue
      }
      if (rule instanceof CSSFontFaceRule && hasExternalFontUrl(rule.cssText)) continue
      chunks.push(neutralizeExternalUrls(rewriteCssUrls(rule.cssText, base)))
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet instanceof CSSStyleSheet) visit(sheet)
  }
  return chunks.join('\n')
}

function hasExternalFontUrl(css: string): boolean {
  return /url\(/i.test(css) && !/url\(\s*(['"])?data:/i.test(css)
}

export function rewriteCssUrls(css: string, base: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, quote: string, raw: string) => {
    const value = raw.trim()
    if (!value || value.startsWith('data:') || value.startsWith('blob:') || value.startsWith('#')) {
      return full
    }
    try {
      return `url(${quote}${new URL(value, base).href}${quote})`
    } catch {
      return full
    }
  })
}

/** SVG 画进 canvas 时，外部 url() 会污染画布，换成透明像素。 */
export function neutralizeExternalUrls(css: string): string {
  const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, quote: string, raw: string) => {
    const value = raw.trim()
    if (value.startsWith('data:') || value.startsWith('#')) return full
    return `url(${quote}${pixel}${quote})`
  })
}

function copyCustomProperties(from: HTMLElement, to: HTMLElement): void {
  const computed = getComputedStyle(from)
  for (let index = 0; index < computed.length; index += 1) {
    const prop = computed.item(index)
    if (!prop.startsWith('--')) continue
    to.style.setProperty(prop, computed.getPropertyValue(prop))
  }
}

function pinFixedElements(live: HTMLElement, clone: HTMLElement): void {
  const liveNodes = [live, ...live.querySelectorAll<HTMLElement>('*')]
  const cloneNodes = [clone, ...clone.querySelectorAll<HTMLElement>('*')]
  liveNodes.forEach((node, index) => {
    const cloned = cloneNodes[index]
    if (cloned == null) return
    if (getComputedStyle(node).position === 'fixed') cloned.style.position = 'absolute'
  })
}

function stripInvalidXmlChars(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    current.textContent = stripXmlIncompatible(current.textContent ?? '')
    current = walker.nextNode()
  }
}

function stripXmlIncompatible(value: string): string {
  let output = ''
  for (const char of value) {
    const code = char.charCodeAt(0)
    const forbidden = code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)
    if (!forbidden) output += char
  }
  return output
}

async function inlineCloneImages(live: HTMLElement, clone: HTMLElement): Promise<void> {
  const liveImages = [...live.querySelectorAll('img')]
  const clonedImages = [...clone.querySelectorAll('img')]
  await Promise.all(
    clonedImages.map(async (image, index) => {
      image.removeAttribute('srcset')
      const source = liveImages[index]
      const dataUrl = source ? await rasterizeImage(source) : null
      if (dataUrl) image.setAttribute('src', dataUrl)
      else image.removeAttribute('src')
    }),
  )
}

async function rasterizeImage(image: HTMLImageElement): Promise<string | null> {
  if (image.currentSrc.startsWith('data:') || image.src.startsWith('data:')) {
    return image.currentSrc || image.src
  }
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (width > 0 && height > 0) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (context) {
        context.drawImage(image, 0, 0, width, height)
        return canvas.toDataURL('image/png')
      }
    } catch {
      // 跨域图片画不进 canvas，下面再试 fetch。
    }
  }
  try {
    const response = await fetch(image.currentSrc || image.src)
    if (!response.ok) return null
    const blob = await response.blob()
    return await blobToDataUrl(blob)
  } catch {
    return null
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function drawSvg(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  return loadImage(url)
    .then((image) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (context == null) throw new Error('无法导出 PNG')
      context.drawImage(image, 0, 0, width, height)
      if (!canvasIsReadable(context)) throw new Error('长图画布被外部资源污染')
      return canvas
    })
    .finally(() => URL.revokeObjectURL(url))
}

function canvasLooksBlank(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('2d')
  if (context == null || canvas.width < 1 || canvas.height < 1) return true
  const points = [
    [0, 0],
    [canvas.width - 1, 0],
    [0, canvas.height - 1],
    [Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)],
  ]
  return points.every(([x, y]) => context.getImageData(x ?? 0, y ?? 0, 1, 1).data[3] === 0)
}

function canvasIsReadable(context: CanvasRenderingContext2D): boolean {
  try {
    context.getImageData(0, 0, 1, 1)
    return true
  } catch {
    return false
  }
}

async function renderSheetWithHtml2Canvas(
  sheet: HTMLElement,
  scale: number,
  backgroundColor: string | null,
): Promise<HTMLCanvasElement> {
  const { normalizeColorsForHtml2Canvas } = await import('../canvas/canvasWorkspaceSnapshot')
  const restorePaint = inlineResolvedPaint(sheet)
  const restoreColors = normalizeColorsForHtml2Canvas(sheet)
  try {
    const { default: html2canvas } = await import('html2canvas')
    return await html2canvas(sheet, {
      backgroundColor,
      scale,
      useCORS: true,
      allowTaint: false,
      logging: false,
      imageTimeout: 8000,
      removeContainer: true,
      width: sheet.scrollWidth,
      height: sheet.scrollHeight,
      windowWidth: sheet.scrollWidth,
      windowHeight: Math.max(sheet.scrollHeight, window.innerHeight),
      scrollX: 0,
      scrollY: 0,
      onclone: (clonedDocument: Document) => {
        const cloned = clonedDocument.querySelector<HTMLElement>('.session-share-sheet')
        const view = clonedDocument.defaultView
        if (cloned && view) normalizeColorsForHtml2Canvas(cloned, view)
      },
    })
  } finally {
    restoreColors?.()
    restorePaint()
  }
}

function inlineResolvedPaint(root: HTMLElement): () => void {
  const restores: Array<() => void> = []
  const elements = [root, ...root.querySelectorAll<HTMLElement>('*')]
  for (const element of elements) {
    const computed = getComputedStyle(element)
    for (const prop of PAINT_PROPS) {
      const value = computed.getPropertyValue(prop)
      if (!value || value === 'none') continue
      const previous = element.style.getPropertyValue(prop)
      const priority = element.style.getPropertyPriority(prop)
      restores.push(() => {
        if (previous || priority) element.style.setProperty(prop, previous, priority)
        else element.style.removeProperty(prop)
      })
      element.style.setProperty(prop, value, 'important')
    }
  }
  return () => {
    while (restores.length > 0) restores.pop()?.()
  }
}

function readSheetBackground(sheet: HTMLElement): string | null {
  const background = window.getComputedStyle(sheet).backgroundColor
  if (!background || background === 'transparent' || background === 'rgba(0, 0, 0, 0)') return null
  return background
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('无法导出 PNG'))
      }, 'image/png')
    } catch (error) {
      reject(error instanceof Error ? error : new Error('无法导出 PNG'))
    }
  })
}

function waitForImages(root: HTMLElement): Promise<void> {
  const pending = [...root.querySelectorAll('img')].filter((image) => !image.complete)
  if (pending.length === 0) return Promise.resolve()
  return Promise.all(
    pending.map(
      (image) =>
        new Promise<void>((resolve) => {
          const done = () => resolve()
          image.addEventListener('load', done, { once: true })
          image.addEventListener('error', done, { once: true })
        }),
    ),
  ).then(() => undefined)
}

function waitForQuietDom(root: HTMLElement, quietMs: number, maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    let timer = window.setTimeout(finish, quietMs)
    const started = Date.now()
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer)
      if (Date.now() - started >= maxMs) {
        finish()
        return
      }
      timer = window.setTimeout(finish, quietMs)
    })
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })

    function finish() {
      observer.disconnect()
      window.clearTimeout(timer)
      resolve()
    }
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('无法绘制会话长图'))
    image.src = url
  })
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
