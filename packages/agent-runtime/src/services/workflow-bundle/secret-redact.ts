/**
 * MCP 配置密钥脱敏 — 导出时把敏感叶子值替换为 {{secret:<path>}} 占位符
 */

import {
  workflowBundleSecretPlaceholder,
  workflowBundleSecretPathFromPlaceholder,
  type WorkflowBundleSecretSpec,
} from '@spark/protocol'

const SENSITIVE_KEY_PATTERN = /(token|secret|password|apikey|api_key|authorization)/i

export interface RedactResult {
  /** 脱敏后的 config(深拷贝;原对象不动) */
  config: Record<string, unknown>
  secrets: WorkflowBundleSecretSpec[]
}

function joinPath(parent: string | null, key: string): string {
  return parent == null ? key : `${parent}.${key}`
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

function redactValue(
  value: unknown,
  path: string | null,
  key: string,
  secrets: WorkflowBundleSecretSpec[],
  secretPaths: Set<string>,
): unknown {
  if (typeof value === 'string') {
    // 已是占位符(重复导出)则原样保留,避免重复登记
    if (workflowBundleSecretPathFromPlaceholder(value) != null) return value
    const treatSensitive =
      path?.startsWith('headers.') === true ||
      path?.startsWith('env.') === true ||
      isSensitiveKey(key)
    if (treatSensitive && value.trim().length > 0) {
      const secretPath = path ?? key
      if (!secretPaths.has(secretPath)) {
        secretPaths.add(secretPath)
        secrets.push({ path: secretPath, label: secretPath, required: true })
      }
      return workflowBundleSecretPlaceholder(secretPath)
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item, i) =>
      redactValue(item, joinPath(path, String(i)), String(i), secrets, secretPaths),
    )
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactValue(v, joinPath(path, k), k, secrets, secretPaths)
    }
    return out
  }
  return value
}

/**
 * 深度脱敏:MCP config 中 headers.* 与 env.* 下的全部字符串值、以及任意层级
 * 键名命中敏感模式(token/secret/password/apiKey/authorization)的字符串值,
 * 一律替换为占位符并登记 requiredSecrets。安全优先,宁多勿漏。
 */
export function redactMcpConfig(configJson: string): RedactResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(configJson)
  } catch {
    return { config: {}, secrets: [] }
  }
  const secrets: WorkflowBundleSecretSpec[] = []
  const secretPaths = new Set<string>()
  const config = isPlainObject(parsed)
    ? (redactValue(parsed, null, '', secrets, secretPaths) as Record<string, unknown>)
    : {}
  return { config, secrets }
}

/** 收集 config 中仍未补齐(仍是占位符)的 secret 路径。 */
export function collectMissingSecretPaths(configJson: string): string[] {
  const missing: string[] = []
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const p = workflowBundleSecretPathFromPlaceholder(value)
      if (p != null && !missing.includes(p)) missing.push(p)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (isPlainObject(value)) {
      for (const v of Object.values(value)) visit(v)
    }
  }
  try {
    visit(JSON.parse(configJson))
  } catch {
    /* 解析失败交由上层报错 */
  }
  return missing
}
