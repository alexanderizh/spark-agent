import type { CodexNativeThreadBinding, SDKExecutorConfig } from '../../sdk/types.js'

const CODEX_APP_SERVER_METADATA_KEY = 'codexAppServer'
const MAX_NATIVE_THREAD_BINDINGS = 12
const SHA256_HEX = /^[a-f0-9]{64}$/

type StoredCodexNativeThreadBinding = CodexNativeThreadBinding & {
  updatedAt: string
}

export interface PersistentCodexAppServerEligibility {
  enabled: boolean
  adapterKind: 'claude-sdk' | 'codex'
  useLocalConfig: boolean
  codexApiKind?: 'chat' | 'responses' | 'embedding' | undefined
  hasImageAttachments: boolean
}

export type PersistentCodexAppServerConfig = Pick<
  SDKExecutorConfig,
  | 'resumeFallbackSystemPrompt'
  | 'codexRuntimeLeaseKey'
  | 'codexNativeThreadBindingKey'
  | 'codexNativeThreadBindings'
  | 'codexNativeThreadBindingObserver'
>

export interface BuildPersistentCodexAppServerConfigInput {
  runtimeLeaseKey: string
  bindingKey: string
  metadataJson: string | null | undefined
  resumeFallbackSystemPrompt?: string | undefined
  onBinding: (binding: CodexNativeThreadBinding) => void | Promise<void>
}

export function buildCodexNativeThreadIdentityScope(input: {
  agentId: string
  isMentionTurn: boolean
}): string {
  const agentId = input.agentId.trim()
  if (agentId.length === 0) throw new Error('codex native thread identity requires an agent id')
  return `native:${input.isMentionTurn ? 'mention' : 'host'}:${agentId}`
}

/** 仅 responses 文本 turn 使用持久 App Server；其余载具必须保留原历史装配语义。 */
export function shouldUsePersistentCodexAppServer(
  input: PersistentCodexAppServerEligibility,
): boolean {
  return (
    input.enabled &&
    input.adapterKind === 'codex' &&
    !input.useLocalConfig &&
    input.codexApiKind !== 'chat' &&
    !input.hasImageAttachments
  )
}

/**
 * 统一 Host / Team member 的持久 App Server 配置，避免两条 SessionService 分支
 * 在 lease 隔离、候选读取或 binding key 校验上发生漂移。
 */
export function buildPersistentCodexAppServerConfig(
  input: BuildPersistentCodexAppServerConfigInput,
): PersistentCodexAppServerConfig {
  const runtimeLeaseKey = input.runtimeLeaseKey.trim()
  const bindingKey = input.bindingKey.trim()
  if (runtimeLeaseKey.length === 0 || bindingKey.length === 0) {
    throw new Error('persistent codex app-server config requires non-empty lease and binding keys')
  }
  const bindings = readCodexNativeThreadBindings(input.metadataJson, bindingKey)
  return {
    ...(input.resumeFallbackSystemPrompt != null
      ? { resumeFallbackSystemPrompt: input.resumeFallbackSystemPrompt }
      : {}),
    codexRuntimeLeaseKey: runtimeLeaseKey,
    codexNativeThreadBindingKey: bindingKey,
    ...(bindings.length > 0 ? { codexNativeThreadBindings: bindings } : {}),
    codexNativeThreadBindingObserver: (binding) => {
      if (binding.bindingKey !== bindingKey) {
        throw new Error('codex native thread binding key changed during turn')
      }
      return input.onBinding(binding)
    },
  }
}

export function readCodexNativeThreadBinding(
  metadataJson: string | null | undefined,
  bindingKey: string,
): CodexNativeThreadBinding | null {
  return readCodexNativeThreadBindings(metadataJson, bindingKey)[0] ?? null
}

export function readCodexNativeThreadBindings(
  metadataJson: string | null | undefined,
  bindingKey: string,
): CodexNativeThreadBinding[] {
  if (metadataJson == null || metadataJson.length === 0 || bindingKey.length === 0) return []
  try {
    const metadata = JSON.parse(metadataJson) as unknown
    const appServer = readRecord(readRecord(metadata)?.[CODEX_APP_SERVER_METADATA_KEY])
    const bindings = Array.isArray(appServer?.nativeThreadBindings)
      ? appServer.nativeThreadBindings
      : []
    return bindings
      .map((candidate) => parseStoredBinding(candidate))
      .filter(
        (binding): binding is StoredCodexNativeThreadBinding => binding?.bindingKey === bindingKey,
      )
      .map((binding) => stripStoredFields(binding))
  } catch {
    // Invalid historical metadata is ignored; a successful fresh thread will repair the binding.
  }
  return []
}

/**
 * 为 SessionRepository.patchMetadata 生成浅合并 patch。
 * 保留 codexAppServer 下未来新增字段，并把绑定限制为最近 12 条，避免 metadata 无界增长。
 */
export function createCodexNativeThreadMetadataPatch(
  currentMetadata: Readonly<Record<string, unknown>>,
  binding: CodexNativeThreadBinding,
  updatedAt = new Date().toISOString(),
): Record<string, unknown> {
  assertBinding(binding)
  const currentAppServer = readRecord(currentMetadata[CODEX_APP_SERVER_METADATA_KEY]) ?? {}
  const currentBindings = Array.isArray(currentAppServer.nativeThreadBindings)
    ? currentAppServer.nativeThreadBindings
        .map((candidate) => parseStoredBinding(candidate))
        .filter((candidate): candidate is StoredCodexNativeThreadBinding => candidate != null)
    : []
  const nextBinding: StoredCodexNativeThreadBinding = { ...binding, updatedAt }
  const nextBindings = [
    nextBinding,
    ...currentBindings.filter(
      (candidate) =>
        candidate.bindingKey !== binding.bindingKey ||
        candidate.runtimeFingerprint !== binding.runtimeFingerprint ||
        candidate.threadFingerprint !== binding.threadFingerprint,
    ),
  ]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_NATIVE_THREAD_BINDINGS)

  return {
    [CODEX_APP_SERVER_METADATA_KEY]: {
      ...currentAppServer,
      version: 1,
      nativeThreadBindings: nextBindings,
    },
  }
}

function parseStoredBinding(value: unknown): StoredCodexNativeThreadBinding | null {
  const record = readRecord(value)
  if (record == null) return null
  const binding = {
    bindingKey: readNonEmptyString(record.bindingKey),
    threadId: readNonEmptyString(record.threadId),
    runtimeFingerprint: readNonEmptyString(record.runtimeFingerprint),
    threadFingerprint: readNonEmptyString(record.threadFingerprint),
    updatedAt: readNonEmptyString(record.updatedAt),
  }
  if (
    binding.bindingKey == null ||
    binding.threadId == null ||
    binding.updatedAt == null ||
    binding.runtimeFingerprint == null ||
    binding.threadFingerprint == null ||
    !SHA256_HEX.test(binding.runtimeFingerprint) ||
    !SHA256_HEX.test(binding.threadFingerprint)
  ) {
    return null
  }
  return binding as StoredCodexNativeThreadBinding
}

function stripStoredFields(binding: StoredCodexNativeThreadBinding): CodexNativeThreadBinding {
  return {
    bindingKey: binding.bindingKey,
    threadId: binding.threadId,
    runtimeFingerprint: binding.runtimeFingerprint,
    threadFingerprint: binding.threadFingerprint,
  }
}

function assertBinding(binding: CodexNativeThreadBinding): void {
  if (binding.bindingKey.length === 0 || binding.threadId.length === 0) {
    throw new Error('codex native thread binding requires non-empty ids')
  }
  if (!SHA256_HEX.test(binding.runtimeFingerprint) || !SHA256_HEX.test(binding.threadFingerprint)) {
    throw new Error('codex native thread binding requires SHA-256 fingerprints')
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
