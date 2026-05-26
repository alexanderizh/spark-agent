/**
 * @module keystore
 *
 * Spark Agent 凭证存储模块 — 唯一合法的 keytar 调用入口
 *
 * 架构约束（ADR-001）：
 *   - 本模块是整个项目中唯一可以 import keytar 的模块
 *   - 其他所有模块必须通过本接口访问 API Key，不得绕过
 *   - API Key 永远不写入 SQLite，SQLite 只存 keystoreRef（引用 ID）
 *   - 日志中必须对 Key 做掩码处理（maskSecret）
 *
 * 运行环境：仅 Electron 主进程（Main Process）
 *   - 禁止在 renderer 进程中直接 import 本模块
 *   - renderer 通过 IPC channel "keystore.*" 间接访问
 */

// NOTE: keytar 是 N-API 原生模块，仅在 Electron 主进程可用
// 在单元测试环境中需要 mock（vi.mock('@spark/shared/keystore')）
import keytar from 'keytar'

/** Keychain 服务名前缀，所有 Spark Agent 凭证使用统一前缀 */
const SERVICE_PREFIX = 'spark-agent'

/**
 * Keychain 引用 ID 的类型别名
 * 格式："{provider}-{profileId}"，例如 "anthropic-default"、"openai-gpt4-work"
 * 存储在 SQLite 的 provider_profiles.keychain_ref 字段
 */
export type KeystoreRef = string & { readonly __brand: 'KeystoreRef' }

/**
 * 创建 KeystoreRef
 * @param provider - Provider 标识，如 "anthropic"、"openai"
 * @param profileId - Profile 唯一 ID（UUID）
 */
export function makeKeystoreRef(provider: string, profileId: string): KeystoreRef {
  return `${provider}-${profileId}` as KeystoreRef
}

/**
 * 存储 API Key 到系统 Keychain
 * @param ref - Keychain 引用 ID（存入 SQLite）
 * @param secret - API Key 明文（仅在本次调用中存在于内存）
 * @returns void
 */
export async function setSecret(ref: KeystoreRef, secret: string): Promise<void> {
  await keytar.setPassword(SERVICE_PREFIX, ref, secret)
}

/**
 * 从系统 Keychain 读取 API Key
 * @param ref - Keychain 引用 ID（来自 SQLite）
 * @returns API Key 明文，若不存在返回 null
 */
export async function getSecret(ref: KeystoreRef): Promise<string | null> {
  return keytar.getPassword(SERVICE_PREFIX, ref)
}

/**
 * 删除 Keychain 中的 API Key
 * @param ref - Keychain 引用 ID
 * @returns 是否成功删除
 */
export async function deleteSecret(ref: KeystoreRef): Promise<boolean> {
  return keytar.deletePassword(SERVICE_PREFIX, ref)
}

/**
 * 检查 Keychain 中是否存在指定引用的 Key
 * @param ref - Keychain 引用 ID
 */
export async function hasSecret(ref: KeystoreRef): Promise<boolean> {
  const val = await keytar.getPassword(SERVICE_PREFIX, ref)
  return val !== null
}

/**
 * 对 API Key 进行掩码处理，用于日志输出
 * 显示前 4 位，其余用 * 替代
 * @example maskSecret("sk-ant-abc123def456") → "sk-a**************"
 */
export function maskSecret(secret: string): string {
  if (secret.length <= 4) return '****'
  return secret.slice(0, 4) + '*'.repeat(Math.min(secret.length - 4, 12))
}
