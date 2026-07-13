/**
 * @module keystore
 *
 * Spark Agent 凭证存储模块 — 唯一合法的 keytar 调用入口。
 * 敏感凭据集中存入一个 OS Keychain vault，避免 macOS 按 Provider 条目重复授权。
 */

import keytar from 'keytar'

const SERVICE_PREFIX = 'spark-agent'
const VAULT_ACCOUNT = 'credential-vault-v1'
const VAULT_VERSION = 1
const USE_CONSOLIDATED_VAULT = process.platform === 'darwin'
const directSecretCache = new Map<string, string | null>()
const directPendingReads = new Map<string, Promise<string | null>>()

interface CredentialVault {
  version: typeof VAULT_VERSION
  secrets: Record<string, string>
  /** 已尝试从旧版独立 Keychain 条目迁移的 ref，避免每次启动重复读取不存在的条目。 */
  legacyChecked: string[]
}

let vaultCache: CredentialVault | null = null
let vaultLoad: Promise<CredentialVault> | null = null
let mutationQueue: Promise<void> = Promise.resolve()

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

async function loadVault(): Promise<CredentialVault> {
  if (vaultCache) return vaultCache
  if (vaultLoad) return vaultLoad
  vaultLoad = keytar.getPassword(SERVICE_PREFIX, VAULT_ACCOUNT).then(parseVault)
  try {
    vaultCache = await vaultLoad
    return vaultCache
  } finally {
    vaultLoad = null
  }
}

async function persistVault(vault: CredentialVault): Promise<void> {
  await keytar.setPassword(SERVICE_PREFIX, VAULT_ACCOUNT, JSON.stringify(vault))
  vaultCache = vault
}

function mutateVault(operation: (vault: CredentialVault) => Promise<void>): Promise<void> {
  // 始终在副本上修改。只有 persistVault 成功后才会替换 vaultCache，
  // 避免 Keychain 写入失败时内存暴露未提交的凭据或意外丢失旧值。
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

/** 启动时预读指定凭据，并触发旧版独立条目到集中 vault 的迁移。 */
export async function preloadSecrets(refs: readonly KeystoreRef[]): Promise<void> {
  await Promise.all(refs.map(ref => getSecret(ref)))
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
