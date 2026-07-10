import { isOperationNode } from './canvas.capabilities'
import type { CanvasShotDirectorDraft } from './CanvasShotDirectorPanel'
import type { CanvasNode, CanvasOperationType, CanvasTask } from './canvas.types'

export function findLatestCreatedOperationNode(
  nodes: CanvasNode[],
  operation: CanvasOperationType,
  existingNodeIds: Set<string>,
): CanvasNode | null {
  const candidates = nodes.filter(
    (item) =>
      !existingNodeIds.has(item.id) && item.data?.operation === operation && isOperationNode(item),
  )
  if (candidates.length === 0) return null
  return (
    [...candidates].sort((left, right) => {
      const timeDelta = Date.parse(right.createdAt) - Date.parse(left.createdAt)
      if (timeDelta !== 0) return timeDelta
      return right.zIndex - left.zIndex
    })[0] ?? null
  )
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readShotDirectorDraft(
  metadata: Record<string, unknown> | undefined,
  boardId: string,
): Partial<CanvasShotDirectorDraft> | null {
  const shotDirector = metadata?.shotDirector
  if (!isRecord(shotDirector)) return null
  const boards = shotDirector.boards
  if (!isRecord(boards)) return null
  const draft = boards[boardId]
  return isRecord(draft) ? (draft as Partial<CanvasShotDirectorDraft>) : null
}

export function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/["\\]/g, '\\$&')
}

export function canvasTaskFailureMessage(task: CanvasTask): string {
  const detail = (task.errorDetail ?? task.errorMsg ?? '').trim()
  return detail ? `任务失败：${detail}` : '任务失败，请检查任务详情后重试'
}

// html2canvas 1.4.1 只认 hsl/hsla/rgb/rgba 颜色函数，遇到 color()/oklch()/oklab()/color-mix()
// 等现代颜色函数会抛 "Attempting to parse an unsupported color function"。这里在截图前把目标
// 子树里所有用到这些函数的颜色相关样式，改写成浏览器规范化后的 rgb()/rgba() 等价值。
const HTML2CANVAS_UNSUPPORTED_COLOR = /(color-mix|color|oklch|oklab|hwb|lab|lch)\s*\(/i
const HTML2CANVAS_COLOR_PROPS = [
  'color',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'textDecorationColor',
  'fill',
  'stroke',
  'caretColor',
  'columnRuleColor',
  'boxShadow',
  'background',
  'backgroundImage',
  'border',
  'outline',
  'textDecoration',
  'textShadow',
  'filter',
]

let html2canvasColorNormalizersCanvas: HTMLCanvasElement | null = null
let html2canvasColorNormalizerElement: HTMLElement | null = null

function clampColorChannel(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}

function parseCssColorNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed || trimmed.toLowerCase() === 'none') return undefined
  const number = Number.parseFloat(trimmed)
  if (!Number.isFinite(number)) return undefined
  return trimmed.endsWith('%') ? number / 100 : number
}

function parseCssAlpha(value: string | undefined): number {
  if (!value) return 1
  const parsed = parseCssColorNumber(value)
  if (parsed === undefined) return 1
  return Math.max(0, Math.min(1, parsed))
}

function formatCssRgbColor(channels: number[], alpha: number): string {
  const [red, green, blue] = channels.map((channel) => clampColorChannel(channel * 255))
  if (alpha >= 1) return `rgb(${red}, ${green}, ${blue})`
  return `rgba(${red}, ${green}, ${blue}, ${Number(alpha.toFixed(3))})`
}

function normalizeCssColorFunctionToken(rawValue: string): string | undefined {
  const match = rawValue.match(/^color\(\s*([a-z0-9-]+)\s+(.+)\)$/i)
  if (!match) return undefined
  const colorSpace = match[1]?.toLowerCase()
  const supportedColorSpaces = ['srgb', 'srgb-linear', 'display-p3', 'a98-rgb', 'prophoto-rgb']
  if (!colorSpace || !supportedColorSpaces.includes(colorSpace)) {
    return undefined
  }
  const [channelText = '', alphaText] = (match[2] ?? '').split(/\s*\/\s*/, 2)
  const channels = channelText.trim().split(/\s+/).slice(0, 3).map(parseCssColorNumber)

  if (channels.length < 3 || channels.some((channel) => channel === undefined)) return undefined
  return formatCssRgbColor(channels as number[], parseCssAlpha(alphaText))
}

function normalizeCssColorWithBrowser(rawValue: string): string | undefined {
  if (typeof document === 'undefined') return undefined
  if (!html2canvasColorNormalizerElement) {
    html2canvasColorNormalizerElement = document.createElement('span')
    html2canvasColorNormalizerElement.style.cssText =
      'position:absolute;left:-99999px;top:-99999px;visibility:hidden;pointer-events:none;'
    document.documentElement.appendChild(html2canvasColorNormalizerElement)
  }
  const element = html2canvasColorNormalizerElement
  element.style.color = ''
  element.style.color = rawValue
  if (!element.style.color) return undefined

  const normalized = window.getComputedStyle(element).color
  const parsed = normalizeCssColorFunctionToken(normalized)
  return parsed ?? normalized
}

function normalizeCssColorWithBrowserForHtml2Canvas(rawValue: string): string | undefined {
  const normalized = normalizeCssColorWithBrowser(rawValue)
  if (!normalized || HTML2CANVAS_UNSUPPORTED_COLOR.test(normalized)) return undefined
  return normalized
}

function normalizeSingleCssColorToken(rawValue: string): string {
  const parsedColorFunction = normalizeCssColorFunctionToken(rawValue)
  if (parsedColorFunction) return parsedColorFunction

  // 浏览器 canvas 的 fillStyle 赋值会自动把任何合法颜色值规范化为 rgb()/rgba()/#hex，
  // 是最权威的颜色降级方式（支持 color()/oklch()/color-mix() 等所有现代写法）。
  if (!html2canvasColorNormalizersCanvas) {
    html2canvasColorNormalizersCanvas = document.createElement('canvas')
  }
  const ctx = html2canvasColorNormalizersCanvas.getContext('2d')
  if (!ctx) return normalizeCssColorWithBrowserForHtml2Canvas(rawValue) ?? rawValue
  try {
    const sentinel = '#010203'
    ctx.fillStyle = sentinel
    ctx.fillStyle = rawValue
    const normalized = ctx.fillStyle
    // 若浏览器无法识别该值，fillStyle 会回落为上一个有效值，此时继续尝试 DOM computed style。
    if (normalized.toLowerCase() === sentinel) {
      return normalizeCssColorWithBrowserForHtml2Canvas(rawValue) ?? rawValue
    }
    if (HTML2CANVAS_UNSUPPORTED_COLOR.test(normalized)) {
      return normalizeCssColorWithBrowserForHtml2Canvas(rawValue) ?? rawValue
    }
    if (/^(rgb|rgba|#)/i.test(normalized)) return normalized
  } catch {
    // 继续尝试 DOM computed style 兜底。
  }

  return normalizeCssColorWithBrowserForHtml2Canvas(rawValue) ?? rawValue
}

function findCssFunctionEnd(value: string, openParenIndex: number): number {
  let depth = 0
  for (let index = openParenIndex; index < value.length; index += 1) {
    const char = value[index]
    if (char === '(') depth += 1
    if (char === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function normalizeCssColorForSnapshot(rawValue: string): string {
  if (!rawValue || !HTML2CANVAS_UNSUPPORTED_COLOR.test(rawValue)) return rawValue

  let output = ''
  let cursor = 0
  let changed = false

  while (cursor < rawValue.length) {
    const rest = rawValue.slice(cursor)
    const match = rest.match(HTML2CANVAS_UNSUPPORTED_COLOR)
    if (!match || match.index === undefined) {
      output += rest
      break
    }

    const functionStart = cursor + match.index
    const functionOpen = rawValue.indexOf('(', functionStart)
    if (functionOpen < 0) {
      output += rawValue.slice(cursor)
      break
    }
    const functionEnd = findCssFunctionEnd(rawValue, functionOpen)
    if (functionEnd < 0) {
      output += rawValue.slice(cursor)
      break
    }

    const token = rawValue.slice(functionStart, functionEnd + 1)
    const normalized = normalizeSingleCssColorToken(token)
    output += rawValue.slice(cursor, functionStart) + normalized
    changed = changed || normalized !== token
    cursor = functionEnd + 1
  }

  return changed ? output : rawValue
}

export function normalizeColorsForHtml2Canvas(
  root: HTMLElement,
  targetWindow: Window = window,
): (() => void) | undefined {
  const elements: HTMLElement[] = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
  const restores: Array<() => void> = []

  for (const element of elements) {
    const computed = targetWindow.getComputedStyle(element)
    const inlineStyle = element.style
    const cssProps = new Set(
      HTML2CANVAS_COLOR_PROPS.map((prop) => prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)),
    )
    for (let index = 0; index < computed.length; index += 1) {
      const cssProp = computed.item(index)
      if (!cssProp) continue
      const value = computed.getPropertyValue(cssProp)
      if (HTML2CANVAS_UNSUPPORTED_COLOR.test(value)) cssProps.add(cssProp)
    }

    for (const cssProp of cssProps) {
      const value = computed.getPropertyValue(cssProp)
      if (typeof value !== 'string' || !HTML2CANVAS_UNSUPPORTED_COLOR.test(value)) continue
      const normalized = normalizeCssColorForSnapshot(value)
      if (normalized === value) continue
      const previous = inlineStyle.getPropertyValue(cssProp)
      const previousPriority = inlineStyle.getPropertyPriority(cssProp)
      const hadPrevious = previous !== '' || previousPriority !== ''
      restores.push(() => {
        if (hadPrevious) {
          inlineStyle.setProperty(cssProp, previous, previousPriority)
        } else {
          inlineStyle.removeProperty(cssProp)
        }
      })
      // 用 !important 覆盖计算值，保证 html2canvas 在克隆阶段拿到的是 rgb()/rgba()。
      inlineStyle.setProperty(cssProp, normalized, 'important')
    }
  }

  if (restores.length === 0) return undefined
  return () => {
    while (restores.length > 0) {
      const restore = restores.pop()
      restore?.()
    }
  }
}

export function buildCanvasSnapshotFileName(title: string | undefined): string {
  const safeTitle = (title || 'group')
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${safeTitle || 'group'}-merged-${Date.now()}.png`
}

export function collectGroupDescendantNodes(nodes: CanvasNode[], groupId: string): CanvasNode[] {
  const descendants: CanvasNode[] = []
  const queue = nodes.filter((node) => node.parentNodeId === groupId)

  while (queue.length > 0) {
    const node = queue.shift()
    if (!node) continue
    descendants.push(node)
    if (node.type === 'group') {
      queue.push(...nodes.filter((candidate) => candidate.parentNodeId === node.id))
    }
  }

  return descendants
}

export function findGroupContainingNodes(nodes: CanvasNode[], nodeIds: string[]): CanvasNode | null {
  const expectedIds = new Set(nodeIds)
  if (expectedIds.size === 0) return null
  const groups = nodes.filter((node) => node.type === 'group')
  return (
    groups.find((group) => {
      const childIds = new Set(
        nodes.filter((node) => node.parentNodeId === group.id).map((node) => node.id),
      )
      for (const nodeId of expectedIds) {
        if (!childIds.has(nodeId)) return false
      }
      return true
    }) ?? null
  )
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}
