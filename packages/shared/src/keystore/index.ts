/**
 * @module keystore
 *
 * Spark Agent 凭证存储模块 — 唯一合法的 keytar 调用入口。
 * macOS 敏感凭据集中存入一个 vault，并可由桌面端注入加密应用存储，
 * 避免按 Provider 条目或每次启动重复请求 Keychain 授权。
 */

import keytar from 'keytar'
import { createLogger } from '../logger/index.js'

const SERVICE_PREFIX = 'spark-agent'
const VAULT_ACCOUNT = 'credential-vault-v1'
const VAULT_VERSION = 1
const USE_CONSOLIDATED_VAULT = process.platform === 'darwin'
const directSecretCache = new Map<string, string | null>()
const directPendingReads = new Map<string, Promise<string | null>>()
const log = createLogger('keystore')

interface CredentialVault {
  version: typeof VAULT_VERSION
  secrets: Record<string, string>
  /** 已尝试从旧版独立 Keychain 条目迁移的 ref，避免每次启动重复读取不存在的条目。 */
  legacyChecked: string[]
}

/**
 * macOS 桌面端可注入的加密应用存储。
 *
 * 具体加密实现由 Electron 主进程提供，shared 包只处理已经序列化的 vault，
 * 从而避免在通用运行时中直接依赖 Electron。
 */
export interface CredentialVaultPersistence {
  load(): Promise<string | null>
  save(value: string): Promise<void>
}

let vaultCache: CredentialVault | null = null
let vaultLoad: Promise<CredentialVault> | null = null
let mutationQueue: Promise<void> = Promise.resolve()
let vaultPersistence: CredentialVaultPersistence | null = null

export type KeystoreRef = string & { readonly __brand: 'KeystoreRef' }

export function makeKeystoreRef(provider: string, profileId: string): KeystoreRef {
  return `${provider}-${profileId}` as KeystoreRef
}

function emptyVault(): CredentialVault {
  return { version: VAULT_VERSION, secrets: {}, legacyChecked: [] }
}

function cloneVault(vault: CredentialVault): CredentialVault {
  return {
    version: VAULT_VERSION,
    secrets: { ...vault.secrets },
    legacyChecked: [...vault.legacyChecked],
  }
}

function parseVault(raw: string | null): CredentialVault {
  if (!raw) return emptyVault()
  const parsed = JSON.parse(raw) as Partial<CredentialVault>
  if (parsed.version !== VAULT_VERSION || !parsed.secrets || typeof parsed.secrets !== 'object') {
    throw new Error('Unsupported or invalid Spark Agent credential vault')
  }
  return {
    version: VAULT_VERSION,
    secrets: Object.fromEntries(
      Object.entries(parsed.secrets).filter((entry): entry is [string, string] =>
        typeof entry[1] === 'string'),
    ),
    legacyChecked: Array.isArray(parsed.legacyChecked)
      ? parsed.legacyChecked.filter((value): value is string => typeof value === 'string')
      : [],
  }
}

function serializeVault(vault: CredentialVault): string {
  return JSON.stringify(vault)
}

async function readVaultFromPersistenceOrKeychain(): Promise<CredentialVault> {
  if (vaultPersistence) {
    const persisted = await vaultPersistence.load()
    if (persisted != null) return parseVault(persisted)
  }

  const vault = parseVault(await keytar.getPassword(SERVICE_PREFIX, VAULT_ACCOUNT))
  // Keychain 只作为加密应用存储尚未建立时的一次性导入源。导入完成后，
  // 后续启动直接读取应用存储，避免开发包/签名变化反复触发 macOS 授权。
  if (vaultPersistence) {
    try {
      await vaultPersistence.save(serializeVault(vault))
    } catch (error) {
      // 加密应用文件写入失败不能让本次已成功读取的 vault 失效，否则同一进程
      // 后续每次取密钥都会重新访问 Keychain 并再次触发系统授权。
      log.warn(`failed to cache credential vault in app storage: ${String(error)}`)
    }
  }
  return vault
}

async function loadVault(): Promise<CredentialVault> {
  if (vaultCache) return vaultCache
  if (vaultLoad) return vaultLoad
  vaultLoad = readVaultFromPersistenceOrKeychain()
  try {
    vaultCache = await vaultLoad
    return vaultCache
  } finally {
    vaultLoad = null
  }
}

async function persistVault(vault: CredentialVault): Promise<void> {
  if (vaultPersistence) {
    await vaultPersistence.save(serializeVault(vault))
  } else {
    await keytar.setPassword(SERVICE_PREFIX, VAULT_ACCOUNT, serializeVault(vault))
  }
  vaultCache = vault
}

function mutateVault(operation: (vault: CredentialVault) => Promise<void>): Promise<void> {
  // 始终在副本上修改。只有 persistVault 成功后才会替换 vaultCache，
  // 避免持久化失败时内存暴露未提交的凭据或意外丢失旧值。
  const next = mutationQueue.then(async () => operation(cloneVault(await loadVault())))
  mutationQueue = next.catch(() => undefined)
  return next
}

export async function setSecret(ref: KeystoreRef, secret: string): Promise<void> {
  if (!USE_CONSOLIDATED_VAULT) {
    if (directSecretCache.has(ref) && directSecretCache.get(ref) === secret) return
    await keytar.setPassword(SERVICE_PREFIX, ref, secret)
    directSecretCache.set(ref, secret)
    return
  }
  await mutateVault(async vault => {
    if (vault.secrets[ref] === secret && vault.legacyChecked.includes(ref)) return
    vault.secrets[ref] = secret
    if (!vault.legacyChecked.includes(ref)) vault.legacyChecked.push(ref)
    await persistVault(vault)
  })
}

export async function getSecret(ref: KeystoreRef): Promise<string | null> {
  if (!USE_CONSOLIDATED_VAULT) {
    if (directSecretCache.has(ref)) return directSecretCache.get(ref) ?? null
    const pending = directPendingReads.get(ref)
    if (pending) return pending
    const read = keytar.getPassword(SERVICE_PREFIX, ref)
    directPendingReads.set(ref, read)
    try {
      const secret = await read
      directSecretCache.set(ref, secret)
      return secret
    } finally {
      directPendingReads.delete(ref)
    }
  }
  const vault = await loadVault()
  if (Object.hasOwn(vault.secrets, ref)) return vault.secrets[ref] ?? null
  if (vault.legacyChecked.includes(ref)) return null

  // 兼容升级前每个 ref 一个 Keychain 条目的布局。首次读取后写入集中 vault；
  // 旧条目保留但不再访问，避免删除动作再次触发系统授权窗口。
  let migrated: string | null = null
  await mutateVault(async current => {
    if (Object.hasOwn(current.secrets, ref) || current.legacyChecked.includes(ref)) {
      migrated = current.secrets[ref] ?? null
      return
    }
    migrated = await keytar.getPassword(SERVICE_PREFIX, ref)
    if (migrated != null) current.secrets[ref] = migrated
    current.legacyChecked.push(ref)
    await persistVault(current)
  })
  return migrated
}

export async function deleteSecret(ref: KeystoreRef): Promise<boolean> {
  if (!USE_CONSOLIDATED_VAULT) {
    const deleted = await keytar.deletePassword(SERVICE_PREFIX, ref)
    directSecretCache.delete(ref)
    return deleted
  }
  let deleted = false
  await mutateVault(async vault => {
    deleted = Object.hasOwn(vault.secrets, ref)
    delete vault.secrets[ref]
    if (!vault.legacyChecked.includes(ref)) vault.legacyChecked.push(ref)
    await persistVault(vault)
  })
  // 自动迁移阶段保留旧条目以免额外弹窗；用户显式删除/退出时必须真正清理。
  const legacyDeleted = await keytar.deletePassword(SERVICE_PREFIX, ref)
  return deleted || legacyDeleted
}

export async function hasSecret(ref: KeystoreRef): Promise<boolean> {
  return (await getSecret(ref)) !== null
}

/**
 * 启动时预读凭据。
 *
 * macOS 只加载一次集中 vault；绝不在启动阶段逐条探测旧 Keychain 项。
 * 旧条目会在真正使用对应凭据时由 getSecret() 按需迁移。
 */
export async function preloadSecrets(refs: readonly KeystoreRef[]): Promise<void> {
  if (USE_CONSOLIDATED_VAULT) {
    await loadVault()
    return
  }
  await Promise.all(refs.map(ref => getSecret(ref)))
}

/**
 * 注入 macOS 桌面端的加密应用存储。应在第一次凭据访问前调用。
 * 传入 null 可恢复为仅使用系统 Keychain（主要用于测试和非 Electron 运行时）。
 */
export function configureCredentialVaultPersistence(
  persistence: CredentialVaultPersistence | null,
): void {
  vaultPersistence = persistence
  vaultCache = null
  vaultLoad = null
  mutationQueue = Promise.resolve()
}

/** Test/dev helper: clear only the in-process cache, not OS Keychain. */
export function clearSecretCache(): void {
  vaultCache = null
  vaultLoad = null
  mutationQueue = Promise.resolve()
  directSecretCache.clear()
  directPendingReads.clear()
}

export function maskSecret(secret: string): string {
  if (secret.length <= 4) return '****'
  return secret.slice(0, 4) + '*'.repeat(Math.min(secret.length - 4, 12))
}
