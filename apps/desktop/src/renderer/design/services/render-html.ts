import {
  DEFAULT_HTML_RENDER_HEIGHT,
  MAX_HTML_RENDER_HEIGHT,
  MAX_HTML_RENDER_TITLE_LENGTH,
  MIN_HTML_RENDER_HEIGHT,
  buildSandboxedHtml,
} from '@spark/shared'
import type { UIBlock } from './event-mapper'

export const RENDER_HTML_TOOL_NAME = 'mcp__spark_ui__render_html'

export type HtmlOpenMode = 'inline' | 'side-panel' | 'window' | 'external'

export type RenderHtmlInput = {
  html: string
  title: string
  height: number
}

export type RenderHtmlResult = {
  accepted: boolean
  html?: string
  title?: string
  height?: number
  warnings?: string[]
  reason?: string
}

export function isRenderHtmlTool(toolName: string): boolean {
  return toolName.trim().toLowerCase() === RENDER_HTML_TOOL_NAME
}

export function parseRenderHtmlInput(input: unknown): RenderHtmlInput | null {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  if (typeof record.html !== 'string' || record.html.trim().length === 0) return null
  const title = typeof record.title === 'string' ? record.title.trim() : 'HTML 内容'
  const height = typeof record.height === 'number' ? record.height : DEFAULT_HTML_RENDER_HEIGHT
  return {
    html: record.html,
    title: title.slice(0, MAX_HTML_RENDER_TITLE_LENGTH) || 'HTML 内容',
    height: Number.isInteger(height)
      ? Math.min(MAX_HTML_RENDER_HEIGHT, Math.max(MIN_HTML_RENDER_HEIGHT, height))
      : DEFAULT_HTML_RENDER_HEIGHT,
  }
}

export function parseRenderHtmlResult(output: unknown): RenderHtmlResult | null {
  const candidates: unknown[] = [output]
  for (let index = 0; index < candidates.length && index < 12; index += 1) {
    let candidate = candidates[index]
    if (typeof candidate === 'string') {
      try {
        candidate = JSON.parse(candidate) as unknown
      } catch {
        continue
      }
    }
    if (candidate == null || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const record = candidate as Record<string, unknown>
    if (typeof record.accepted === 'boolean') {
      return {
        accepted: record.accepted,
        ...(typeof record.html === 'string' ? { html: record.html } : {}),
        ...(typeof record.title === 'string' ? { title: record.title } : {}),
        ...(typeof record.height === 'number' ? { height: record.height } : {}),
        ...(Array.isArray(record.warnings)
          ? { warnings: record.warnings.filter((item): item is string => typeof item === 'string') }
          : {}),
        ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
      }
    }
    for (const key of ['structuredContent', 'result', 'data']) {
      if (record[key] != null) candidates.push(record[key])
    }
    if (Array.isArray(record.content)) {
      for (const item of record.content.slice(0, 4)) {
        if (item != null && typeof item === 'object') {
          const text = (item as Record<string, unknown>).text
          if (typeof text === 'string') candidates.push(text)
        }
      }
    }
  }
  return null
}

export function buildRenderHtmlSrcDoc(
  block: Pick<Extract<UIBlock, { kind: 'html_block' }>, 'html'>,
  theme: 'light' | 'dark',
): string {
  return buildSandboxedHtml(block.html, theme)
}

// ─── 沙箱文档登记（capability-asset://html-render/<token>） ────────────────
// srcdoc 文档会继承 renderer CSP（script-src 'self' capability-asset:）导致
// 渲染块内联脚本被拦；合成文档改为登记到主进程再导航加载，机制与子应用
// 一致（见 main/services/RuntimeDocRegistry.ts）。

/** capability-asset://html-render/<token>?v=<n>；version 递增强制 iframe 重新加载。 */
export function htmlRenderDocUrl(token: string, version: number): string {
  return `capability-asset://html-render/${token}?v=${version}`
}

/** FNV-1a 32 位哈希的 base36 表示，用于防 sanitize 后的 token 碰撞。 */
function fnv1aBase36(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/**
 * 从 block 的 toolCallId 派生稳定 token：inline / 侧面板 / 全屏多个展示
 * 入口共用同一 token（put 幂等覆盖），主题切换等重渲染也不换文档身份。
 * 输出需满足主进程 token 约束 ^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$。
 */
export function buildHtmlRenderToken(toolCallId: string): string {
  const sanitized = toolCallId
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 64)
  const token = `hr-${sanitized}-${fnv1aBase36(toolCallId)}`
  return token.length < 8 ? token.padEnd(8, '0') : token.slice(0, 80)
}

export function putHtmlRuntimeDoc(token: string, document: string): Promise<void> {
  return window.spark.invoke('html:put-runtime-doc', { token, document }).then(() => undefined)
}

/** 卸载路径上的释放：fire-and-forget，失败由主进程 TTL 兜底回收。 */
export function releaseHtmlRuntimeDoc(token: string): void {
  void window.spark.invoke('html:release-runtime-doc', { token }).catch(() => undefined)
}
