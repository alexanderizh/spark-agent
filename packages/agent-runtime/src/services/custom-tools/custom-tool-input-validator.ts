/**
 * 工具调用输入校验：按 inputSchema 校验 LLM/测试面板提供的参数。
 * MCP 路径上 SDK 已按 inputSchema 校验一层，test-run 与桥侧仍须自查
 * （防御深度：schema 子集语义比 SDK 的 JSON Schema 校验更严格）。
 */

import type { CustomToolInputSchema, CustomToolParam } from '@spark/protocol'
import { CustomToolError } from './custom-tool-errors.js'

export function validateToolInput(
  inputSchema: CustomToolInputSchema,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = []

  for (const name of inputSchema.required ?? []) {
    const value = input[name]
    if (value == null || (typeof value === 'string' && value.trim() === '')) {
      errors.push(`缺少必填参数 ${name}`)
    }
  }

  for (const [name, value] of Object.entries(input)) {
    const param = inputSchema.properties[name]
    if (param == null) {
      errors.push(`未知参数 ${name}`)
      continue
    }
    const issue = checkParamValue(param, value)
    if (issue != null) errors.push(`参数 ${name} ${issue}`)
  }

  if (errors.length > 0) {
    throw new CustomToolError('INVALID_INPUT', errors.join('；'))
  }
  return input
}

function checkParamValue(param: CustomToolParam, value: unknown): string | null {
  switch (param.type) {
    case 'string':
      if (typeof value !== 'string') return '必须为字符串'
      return checkEnum(param, value)
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) return '必须为数字'
      return checkEnum(param, value)
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return '必须为整数'
      return checkEnum(param, value)
    case 'boolean':
      if (typeof value !== 'boolean') return '必须为布尔值'
      return null
    case 'array': {
      if (!Array.isArray(value)) return '必须为数组'
      const itemType = param.items?.type ?? 'string'
      for (const [index, item] of value.entries()) {
        const itemIssue = checkPrimitive(itemType, item)
        if (itemIssue != null) return `第 ${index + 1} 个元素${itemIssue}`
      }
      return null
    }
    default:
      return null
  }
}

function checkPrimitive(
  type: 'string' | 'number' | 'integer' | 'boolean',
  value: unknown,
): string | null {
  if (type === 'string' && typeof value !== 'string') return '必须为字符串'
  if (type === 'number' && (typeof value !== 'number' || Number.isNaN(value))) return '必须为数字'
  if (type === 'integer' && (typeof value !== 'number' || !Number.isInteger(value)))
    return '必须为整数'
  if (type === 'boolean' && typeof value !== 'boolean') return '必须为布尔值'
  return null
}

function checkEnum(param: CustomToolParam, value: string | number): string | null {
  if (param.enum == null) return null
  if (!param.enum.includes(value)) {
    return `必须为枚举值之一（${param.enum.join(' / ')}）`
  }
  return null
}
