/**
 * MCP 配置归一化 & 校验
 *
 * 背景：MCP 配置在历史上被两套字段名写入过——
 *   - UI（McpView.serializeConfig）写 `transport`
 *   - 早期 managed 注册 / 部分 agent 写 `type`
 * 且远程服务器的传输类型有 `http`（Streamable HTTP，当前标准）与 `sse`（旧标准）。
 *
 * 读取端曾经只认 `type === 'sse'`，其余一律降级成 stdio，导致所有 http 远程 MCP
 * 被错当成一个跑 `npx`（无参数）的本地进程，永远连不上、零工具注入。
 *
 * 本模块提供唯一的归一化读取与写入校验，供 buildMcpServersForSDK /
 * McpService / platform-bridge 三条路径统一复用，消除字段分裂。
 */

import type { McpTransportConfig } from './transport/types.js'

/** 归一化后的传输配置，等价于 McpClient 可直接消费的 {@link McpTransportConfig}。 */
export type ResolvedMcpConfig = McpTransportConfig

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (value == null || typeof value !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 把任意历史/新版 MCP 配置对象归一化为可用的传输配置。
 *
 * 规则：
 *  - 传输类型从 `transport` 优先、其次 `type` 读取；两者都缺时按可用字段推断。
 *  - `http` / `sse` 需要 `url`；`stdio` 需要 `command`。
 *  - 自愈：显式 stdio 但缺 command 却带 url → 视为 http（修历史上写反的记录）。
 *  - 无法确定有效传输时返回 null（调用方应跳过，而不是降级成坏的 stdio）。
 */
export function resolveMcpConfig(cfg: Record<string, unknown>): ResolvedMcpConfig | null {
  const explicit = asString(cfg.transport) ?? asString(cfg.type)
  const url = asString(cfg.url)
  const command = asString(cfg.command)

  let kind = explicit
  // 未声明或声明为受支持之外的值 → 按可用字段推断
  if (kind !== 'stdio' && kind !== 'http' && kind !== 'sse') {
    kind = url != null ? 'http' : command != null ? 'stdio' : undefined
  }
  // 自愈：声明 stdio 但没有 command，却给了 url —— 按 http 处理
  if (kind === 'stdio' && command == null && url != null) {
    kind = 'http'
  }

  if (kind === 'http') {
    if (url == null) return null
    const headers = asStringRecord(cfg.headers)
    return { type: 'http', url, ...(headers != null ? { headers } : {}) }
  }

  if (kind === 'sse') {
    if (url == null) return null
    const headers = asStringRecord(cfg.headers)
    return { type: 'sse', url, ...(headers != null ? { headers } : {}) }
  }

  if (kind === 'stdio') {
    if (command == null) return null
    const env = asStringRecord(cfg.env)
    const cwd = asString(cfg.cwd)
    return {
      type: 'stdio',
      command,
      args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
      ...(env != null ? { env } : {}),
      ...(cwd != null ? { cwd } : {}),
    }
  }

  return null
}

/**
 * 写入前校验：返回错误信息（中文），合法返回 null。
 * 用于 create/update 路径，避免把矛盾/残缺配置静默存下再对用户报“成功”。
 */
export function validateMcpConfigJson(configJson: string): string | null {
  let cfg: Record<string, unknown>
  try {
    cfg = JSON.parse(configJson) as Record<string, unknown>
  } catch {
    return 'MCP 配置不是合法 JSON'
  }
  if (cfg == null || typeof cfg !== 'object') return 'MCP 配置必须是对象'

  const explicit = asString(cfg.transport) ?? asString(cfg.type)
  const url = asString(cfg.url)
  const command = asString(cfg.command)

  if (explicit === 'http' || explicit === 'sse') {
    if (url == null) return `${explicit} 传输需要填写 url`
    return validateUrl(url)
  }
  if (explicit === 'stdio') {
    if (command == null) {
      // 允许自愈：带 url 时按 http 处理，不算错误
      if (url != null) return validateUrl(url)
      return 'stdio 传输需要填写 command（启动命令）'
    }
    return null
  }
  // 未声明传输：至少要有 url 或 command 之一
  if (url != null) return validateUrl(url)
  if (command != null) return null
  return '缺少传输配置：请提供 url（http/sse）或 command（stdio）'
}

function validateUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol) && parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      return 'url 协议必须是 http / https / ws / wss'
    }
    return null
  } catch {
    return 'url 格式不正确'
  }
}
