import {
  makeKeystoreRef,
  deleteSecret,
  getSecret,
  setSecret,
  type KeystoreRef,
} from '@spark/shared/keystore'
import { RuntimeError } from './runtime-errors.js'

export interface StoredCredentialBundle {
  accessToken: string
  refreshToken?: string
  tokenType?: string
  expiresAt?: string
  clientId?: string
  scopes?: string[]
}

export interface RuntimeSecretStore {
  get(ref: KeystoreRef): Promise<string | null>
  set(ref: KeystoreRef, value: string): Promise<void>
  delete(ref: KeystoreRef): Promise<boolean>
}

const osSecretStore: RuntimeSecretStore = {
  get: getSecret,
  set: setSecret,
  delete: deleteSecret,
}

export class RuntimeTokenService {
  private readonly refreshes = new Map<string, Promise<StoredCredentialBundle>>()

  constructor(private readonly store: RuntimeSecretStore = osSecretStore) {}

  createRef(pluginId: string, runtimeId: string, externalAccountId: string): KeystoreRef {
    const safeExternalId = Buffer.from(externalAccountId, 'utf8').toString('base64url').slice(0, 80)
    return makeKeystoreRef('plugin-runtime', `${pluginId}-${runtimeId}-${safeExternalId}`)
  }

  async save(ref: string, bundle: StoredCredentialBundle): Promise<void> {
    if (bundle.accessToken.trim().length === 0) {
      throw new RuntimeError('AUTH_REQUIRED', 'Provider access token is empty')
    }
    await this.store.set(ref as KeystoreRef, JSON.stringify(bundle))
  }

  async read(ref: string | null): Promise<StoredCredentialBundle | null> {
    if (ref == null || ref.trim().length === 0) return null
    const raw = await this.store.get(ref as KeystoreRef)
    if (raw == null || raw.trim().length === 0) return null
    try {
      const parsed = JSON.parse(raw) as Partial<StoredCredentialBundle>
      if (typeof parsed.accessToken !== 'string' || parsed.accessToken.trim().length === 0)
        return null
      return {
        accessToken: parsed.accessToken,
        ...(typeof parsed.refreshToken === 'string' ? { refreshToken: parsed.refreshToken } : {}),
        ...(typeof parsed.tokenType === 'string' ? { tokenType: parsed.tokenType } : {}),
        ...(typeof parsed.expiresAt === 'string' ? { expiresAt: parsed.expiresAt } : {}),
        ...(typeof parsed.clientId === 'string' ? { clientId: parsed.clientId } : {}),
        ...(Array.isArray(parsed.scopes)
          ? {
              scopes: parsed.scopes.filter(
                (scope): scope is string => typeof scope === 'string' && scope.length > 0,
              ),
            }
          : {}),
      }
    } catch {
      throw new RuntimeError(
        'AUTH_REQUIRED',
        'Stored provider credential is invalid; reauthorize the account',
      )
    }
  }

  async delete(ref: string | null): Promise<void> {
    if (ref != null && ref.trim().length > 0) await this.store.delete(ref as KeystoreRef)
  }

  async withAccessToken<T>(
    ref: string | null,
    callback: (token: string) => Promise<T>,
    refresh?: (bundle: StoredCredentialBundle) => Promise<StoredCredentialBundle>,
  ): Promise<T> {
    const bundle = await this.read(ref)
    if (bundle == null)
      throw new RuntimeError('AUTH_REQUIRED', 'Provider account requires authorization')
    const current =
      bundle.expiresAt != null && Date.parse(bundle.expiresAt) <= Date.now() + 30_000
        ? await this.refreshIfPossible(ref, bundle, refresh)
        : bundle
    if (current.expiresAt != null && Date.parse(current.expiresAt) <= Date.now() + 30_000)
      throw new RuntimeError(
        'AUTH_EXPIRED',
        'Provider authorization has expired; reconnect the account',
      )
    return callback(current.accessToken)
  }

  private async refreshIfPossible(
    ref: string | null,
    bundle: StoredCredentialBundle,
    refresh: ((bundle: StoredCredentialBundle) => Promise<StoredCredentialBundle>) | undefined,
  ): Promise<StoredCredentialBundle> {
    if (ref == null || refresh == null || bundle.refreshToken == null)
      throw new RuntimeError(
        'AUTH_EXPIRED',
        'Provider authorization has expired; reconnect the account',
      )
    const existing = this.refreshes.get(ref)
    if (existing != null) return existing
    const promise = (async () => {
      const updated = await refresh(bundle)
      if (updated.refreshToken == null && bundle.refreshToken != null)
        updated.refreshToken = bundle.refreshToken
      if (updated.clientId == null && bundle.clientId != null) updated.clientId = bundle.clientId
      if (updated.scopes == null && bundle.scopes != null) updated.scopes = bundle.scopes
      await this.save(ref, updated)
      return updated
    })()
    this.refreshes.set(ref, promise)
    try {
      return await promise
    } finally {
      if (this.refreshes.get(ref) === promise) this.refreshes.delete(ref)
    }
  }
}
