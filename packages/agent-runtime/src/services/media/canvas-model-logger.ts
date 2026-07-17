/**
 * @module canvas-model-logger
 *
 * 画布模型调用日志（file-friendly 单行版）。
 *
 * 设计目标：让 `设置 → 遥测与日志` 页面能稳定看到「任务 → 模型/参数/响应/报错」。
 *
 * 输出约束（与 logger/index.ts 的前缀过滤兼容）：
 *   - 每条日志一个物理行，带 `[LEVEL] [namespace]` 前缀；
 *   - 无 ANSI 控制符（写到 main.log 不污染查看器）；
 *   - 长文本 / base64 / data: 复用 compactForLog 截断；
 *   - 任务级分隔行走独立 `event=block-start` / `event=block-end`，供查看器渲染分割线；
 *   - 所有调用 try/catch，日志失败绝不抛到业务路径。
 *
 * 与 media-debug-log.ts 的关系：
 *   - media-debug-log.ts 仍负责适配器内彩色控制台日志（开发期肉眼排查）。
 *   - 本模块负责「落到 main.log 后能被画布日志查看器搜到」的结构化记录。
 */

import { createLogger } from '@spark/shared'
import type { Logger } from '@spark/shared'
import { compactForLog } from './media-debug-log.js'

const log: Logger = createLogger('canvas:model')

export interface CanvasModelRequestLog {
  clientTaskId?: string | undefined
  provider: string
  capability: string
  model?: string | undefined
  method: string
  url: string
  body?: unknown
  extra?: Record<string, unknown> | undefined
}

export interface CanvasModelResponseLog {
  clientTaskId?: string | undefined
  provider: string
  capability: string
  model?: string | undefined
  status?: number | undefined
  body?: unknown
  durationMs?: number | undefined
  assetCount?: number | undefined
  requestId?: string | undefined
}

export interface CanvasModelFailureLog {
  clientTaskId?: string | undefined
  provider: string
  capability: string
  model?: string | undefined
  code?: string | undefined
  message: string
  durationMs?: number | undefined
}

/** 任务级分隔块——查看器识别 `event=block-start` / `event=block-end` 渲染为分割线 */
export interface CanvasModelBlockLog {
  clientTaskId?: string | undefined
  label: string
  kind?: 'media' | 'text' | 'generic'
}

export function logCanvasModelRequest(input: CanvasModelRequestLog): void {
  try {
    const parts: string[] = ['event=request']
    parts.push(field('clientTaskId', input.clientTaskId))
    parts.push(field('provider', input.provider))
    parts.push(field('capability', input.capability))
    parts.push(field('model', input.model))
    parts.push(`method=${JSON.stringify(input.method)}`)
    parts.push(`url=${JSON.stringify(input.url)}`)
    if (input.body !== undefined) {
      parts.push(`body=${stringifyBody(input.body)}`)
    }
    if (input.extra) {
      for (const [key, value] of Object.entries(input.extra)) {
        parts.push(`${key}=${formatValue(value)}`)
      }
    }
    log.info(parts.join(' '))
  } catch {
    /* 日志失败不影响业务路径 */
  }
}

export function logCanvasModelResponse(input: CanvasModelResponseLog): void {
  try {
    const parts: string[] = ['event=response']
    parts.push(field('clientTaskId', input.clientTaskId))
    parts.push(field('provider', input.provider))
    parts.push(field('capability', input.capability))
    parts.push(field('model', input.model))
    if (input.status !== undefined) parts.push(`status=${input.status}`)
    if (input.body !== undefined) {
      parts.push(`body=${stringifyBody(input.body)}`)
    }
    if (input.durationMs !== undefined) parts.push(`durationMs=${input.durationMs}`)
    if (input.assetCount !== undefined) parts.push(`assets=${input.assetCount}`)
    if (input.requestId) parts.push(`requestId=${JSON.stringify(input.requestId)}`)
    log.info(parts.join(' '))
  } catch {
    /* ignore */
  }
}

export function logCanvasModelFailure(input: CanvasModelFailureLog): void {
  try {
    const parts: string[] = ['event=failed']
    parts.push(field('clientTaskId', input.clientTaskId))
    parts.push(field('provider', input.provider))
    parts.push(field('capability', input.capability))
    parts.push(field('model', input.model))
    if (input.code) parts.push(`code=${JSON.stringify(input.code)}`)
    parts.push(`message=${JSON.stringify(truncate(input.message, 1000))}`)
    if (input.durationMs !== undefined) parts.push(`durationMs=${input.durationMs}`)
    log.warn(parts.join(' '))
  } catch {
    /* ignore */
  }
}

export function logCanvasBlockStart(input: CanvasModelBlockLog): void {
  try {
    log.info(
      [
        'event=block-start',
        field('clientTaskId', input.clientTaskId),
        field('kind', input.kind),
        `label=${JSON.stringify(input.label)}`,
      ].join(' '),
    )
  } catch {
    /* ignore */
  }
}

export function logCanvasBlockEnd(input: CanvasModelBlockLog): void {
  try {
    log.info(
      [
        'event=block-end',
        field('clientTaskId', input.clientTaskId),
        field('kind', input.kind),
        `label=${JSON.stringify(input.label)}`,
      ].join(' '),
    )
  } catch {
    /* ignore */
  }
}

function stringifyBody(body: unknown): string {
  try {
    return JSON.stringify(compactForLog(body))
  } catch {
    return '"[unserializable body]"'
  }
}

function formatValue(value: unknown): string {
  if (value === undefined) return '"(n/a)"'
  if (typeof value === 'string') return JSON.stringify(truncate(value, 400))
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(compactForLog(value))
  } catch {
    return '"[unserializable value]"'
  }
}

function field(name: string, value: string | null | undefined): string {
  if (value == null) return `${name}=(n/a)`
  const text = String(value).trim()
  if (!text) return `${name}=(n/a)`
  return `${name}=${JSON.stringify(text)}`
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…[truncated chars=${value.length}]`
}