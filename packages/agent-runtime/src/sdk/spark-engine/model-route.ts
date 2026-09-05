import type { ModelProtocol } from '@spark/agent'

import type { SDKExecutorConfig } from '../types.js'

/**
 * Spark 引擎模型路由（渠道配置 → spark-engine registerHttp 参数）。
 *
 * 渠道协议仍是 openai/anthropic 二选一（useSparkExecutor 只是执行器偏好开关），
 * 此处把渠道协议映射为 spark-engine 支持的两种上游 wire 协议：
 * - anthropic 渠道 → anthropic-messages（开箱即用，含 promptCaching）
 * - openai 渠道 + codexApiKind responses（或缺省）→ openai-responses
 * - openai 渠道 + codexApiKind chat/embedding → 不支持（spark-engine 无 chat/completions
 *   适配器；后续按「缺功能在 spark 核心补齐」原则在引擎内新增适配器）
 */

export type SparkUpstreamProtocol = ModelProtocol

export type SparkModelRouteResolution =
  | {
      ok: true
      protocol: SparkUpstreamProtocol
      modelId: string
      apiKey: string
      baseUrl: string | undefined
    }
  | { ok: false; reason: string }

/** 渠道协议 → spark 上游 wire 协议（session.service 组装与表单校验共用）。 */
export function resolveSparkUpstreamProtocol(
  providerType: string | null | undefined,
  codexApiKind: string | null | undefined,
): { ok: true; protocol: SparkUpstreamProtocol } | { ok: false; reason: string } {
  if (providerType === 'anthropic') return { ok: true, protocol: 'anthropic-messages' }
  if (providerType === 'openai' && (codexApiKind == null || codexApiKind === 'responses')) {
    return { ok: true, protocol: 'openai-responses' }
  }
  if (providerType === 'openai' && codexApiKind === 'chat') {
    return {
      ok: false,
      reason:
        '该渠道为 chat/completions 接口（codexApiKind=chat），spark 引擎暂不支持；请在渠道设置中改用 Responses 接口或关闭 Spark 执行器',
    }
  }
  return {
    ok: false,
    reason: `渠道协议 ${String(providerType)} 无法映射为 spark 引擎上游协议（仅支持 anthropic / openai-responses）`,
  }
}

/** executor 侧路由解析：校验并归一 registerHttp 所需参数。 */
export function resolveSparkModelRoute(
  config: Pick<SDKExecutorConfig, 'apiKey' | 'model' | 'apiEndpoint' | 'sparkUpstreamProtocol'>,
): SparkModelRouteResolution {
  if (config.sparkUpstreamProtocol == null) {
    return { ok: false, reason: 'sparkUpstreamProtocol 未配置（session.service 组装缺失）' }
  }
  if (config.model == null || config.model.trim().length === 0) {
    return { ok: false, reason: 'spark 引擎缺少 model 配置' }
  }
  if (config.apiKey == null || config.apiKey.length === 0) {
    return { ok: false, reason: 'spark 引擎缺少渠道 API Key' }
  }
  return {
    ok: true,
    protocol: config.sparkUpstreamProtocol,
    modelId: `spark-${config.sparkUpstreamProtocol}-${config.model}`,
    apiKey: config.apiKey,
    baseUrl: config.apiEndpoint?.trim() ? config.apiEndpoint.trim() : undefined,
  }
}

/** spark-* 权限模式 → spark-engine PermissionMode（非 spark 侧值回落 default）。 */
export function toSparkEnginePermissionMode(
  value: string | null | undefined,
): 'default' | 'acceptEdits' | 'plan' | 'bypass' {
  switch (value) {
    case 'spark-accept-edits':
      return 'acceptEdits'
    case 'spark-plan':
      return 'plan'
    case 'spark-bypass':
      return 'bypass'
    default:
      return 'default'
  }
}
