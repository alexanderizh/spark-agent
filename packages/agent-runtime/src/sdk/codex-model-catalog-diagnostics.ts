/**
 * @module codex-model-catalog-diagnostics
 *
 * 把 native runtime 拒绝 model_catalog_json 的原始错误翻译成用户能读懂、
 * 能自己解决的提示，并在可能时自动停用该目录让下一轮恢复可用。
 *
 * 背景：runtime 的报错是 Rust serde 原文，例如
 *   `failed to parse model_catalog_json path ...: missing field `base_instructions` at line 54 column 5`
 * 用户看到这行完全无法判断是自己的问题、Provider 的问题还是版本问题。
 */

import { createLogger } from '@spark/shared'
import { compareRuntimeVersions } from './codex-runtime.js'
import {
  LEGACY_MODEL_CATALOG_RUNTIME_CEILING,
  markCodexModelCatalogRejected,
} from './codex-model-catalog.js'

const log = createLogger('codex-model-catalog')

export const CODEX_MODEL_CATALOG_ERROR_CODE = 'CODEX_MODEL_CATALOG_INCOMPATIBLE'

export interface CodexModelCatalogDiagnosis {
  code: string
  /** 面向用户的完整提示，可直接作为 agent_error.message 展示。 */
  message: string
  /** 是否已自动停用该 catalog（下一轮起不再注入）。 */
  catalogDisabled: boolean
}

/**
 * 判断一段 runtime 输出是否属于「模型目录被拒绝」。
 * 只在能确定是目录问题时返回 true，避免把普通报错误判并改写。
 */
export function isCodexModelCatalogFailureText(text: string): boolean {
  if (text.length === 0) return false
  if (/failed to parse model_catalog_json/i.test(text)) return true
  if (!/model_catalog_json/i.test(text)) return false
  return /missing field|unknown field|invalid type|invalid value|expected one of|at line \d+ column \d+/i.test(
    text,
  )
}

/**
 * 生成用户可读的失败提示，并尝试写入拒绝标记实现自愈。
 * 返回 null 表示这不是模型目录问题，调用方应保持原有报错。
 */
export async function diagnoseCodexModelCatalogFailure(params: {
  rawMessage: string
  catalogPath?: string | null | undefined
  runtimeVersion?: string | null | undefined
}): Promise<CodexModelCatalogDiagnosis | null> {
  if (!isCodexModelCatalogFailureText(params.rawMessage)) return null

  let catalogDisabled = false
  const catalogPath = params.catalogPath?.trim()
  if (catalogPath != null && catalogPath.length > 0) {
    catalogDisabled = await markCodexModelCatalogRejected(catalogPath, params.runtimeVersion)
  }

  const version = params.runtimeVersion?.trim() ?? ''
  const versionHint =
    version.length > 0 && compareRuntimeVersions(version, LEGACY_MODEL_CATALOG_RUNTIME_CEILING) < 0
      ? `本机 Codex 运行时（${version}）与应用生成的模型目录结构不兼容。`
      : version.length > 0
        ? `本机 Codex 运行时（${version}）无法解析应用生成的模型目录。`
        : '本机 Codex 运行时无法解析应用生成的模型目录。'
  const action = catalogDisabled
    ? '已自动停用该模型目录（对话仍然可用，仅本次上下文窗口按运行时默认值），请直接重试本轮。'
    : '请重试本轮；若仍失败，请在「设置 → 完整性」中重新安装 Codex 运行时。'
  const upgradeHint = '若反复出现，请在「设置 → 完整性」中更新 Codex 运行时到最新版本。'

  const message = [
    'Codex 运行时拒绝了 Spark 生成的模型目录（model_catalog_json），本轮对话已中断。',
    '',
    `· 原因：${versionHint}`,
    `· 处理：${action}`,
    ...(catalogDisabled ? [] : [`· 补充：${upgradeHint}`]),
    `· 原始错误：${summarizeRawError(params.rawMessage)}`,
  ].join('\n')

  log.warn(
    `catalog 被运行时拒绝：catalogPath=${catalogPath ?? '<none>'} ` +
      `runtime=${version || '<unknown>'} disabled=${catalogDisabled} raw=${summarizeRawError(params.rawMessage)}`,
  )

  return { code: CODEX_MODEL_CATALOG_ERROR_CODE, message, catalogDisabled }
}

function summarizeRawError(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 300) return normalized
  return `${normalized.slice(0, 300)}…`
}
