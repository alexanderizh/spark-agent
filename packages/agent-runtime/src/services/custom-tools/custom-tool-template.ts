/**
 * 模板渲染（安全核心，方案 §3.2）
 *
 * - URL 模板：占位符值逐段 encodeURIComponent，杜绝路径穿越/查询注入
 * - 请求头：拒绝 CR/LF（防头注入），敏感头只能走 secretRef（协议层已强制）
 * - JSON body：协议层 renderJsonBodyTemplate（上下文感知扫描 + parse-based 回填），
 *   结构性注入在解析层死亡；此处只做错误码映射
 */

import {
  extractTemplatePlaceholders,
  renderJsonBodyTemplate as protocolRenderJsonBodyTemplate,
  CustomToolTemplateError,
} from '@spark/protocol'
import { CustomToolError } from './custom-tool-errors.js'

const PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

function requiredValue(input: Record<string, unknown>, name: string): unknown {
  const value = input[name]
  if (value == null) {
    throw new CustomToolError('INVALID_INPUT', `模板引用了参数 ${name}，但调用输入未提供`)
  }
  return value
}

export function toDisplayString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** URL 模板渲染：每个占位符值整体 encodeURIComponent */
export function renderUrlTemplate(template: string, input: Record<string, unknown>): string {
  const rendered = template.replace(PLACEHOLDER_REGEX, (_match, name: string) =>
    encodeURIComponent(toDisplayString(requiredValue(input, name))),
  )
  let parsed: URL
  try {
    parsed = new URL(rendered)
  } catch {
    throw new CustomToolError('INVALID_TEMPLATE', 'URL 模板替换后不是合法 URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CustomToolError('INVALID_TEMPLATE', 'URL 仅支持 http/https 协议')
  }
  return rendered
}

/** 请求头值渲染：禁止 CR/LF/NUL（头注入防线） */
export function renderHeaderTemplate(template: string, input: Record<string, unknown>): string {
  const rendered = template.replace(PLACEHOLDER_REGEX, (_match, name: string) =>
    toDisplayString(requiredValue(input, name)),
  )
  if (/[\r\n\0]/.test(rendered)) {
    throw new CustomToolError('INVALID_INPUT', '请求头值包含非法换行字符')
  }
  return rendered
}

/** JSON body 模板渲染：委托协议层扫描器，映射模板错误为执行错误码 */
export function renderJsonBodyTemplate(template: string, input: Record<string, unknown>): string {
  try {
    return protocolRenderJsonBodyTemplate(template, input)
  } catch (error) {
    if (error instanceof CustomToolTemplateError) {
      if (error.kind === 'MISSING_PARAM') {
        throw new CustomToolError('INVALID_INPUT', error.message)
      }
      throw new CustomToolError('INVALID_TEMPLATE', error.message)
    }
    throw error
  }
}

/** 模板中出现的占位符名集合（供执行器预检参数完整性） */
export function collectPlaceholderNames(templates: string[]): Set<string> {
  const names = new Set<string>()
  for (const template of templates) {
    for (const name of extractTemplatePlaceholders(template)) names.add(name)
  }
  return names
}
