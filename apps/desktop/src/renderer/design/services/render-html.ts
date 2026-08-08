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
