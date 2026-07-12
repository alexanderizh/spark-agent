import * as keystore from '@spark/shared/keystore'
import { SettingsRepository } from '@spark/storage'
import { getDatabase } from '../../db.js'

export interface PendingPlatformPayment {
  planId: number
  createdAt: number
  baselineSubscriptionId?: number
  baselineExpiresAt?: number
}

export class PlatformCredentialStore {
  private readonly settings: SettingsRepository

  constructor(
    private readonly sparkUserId: string,
    settings?: SettingsRepository,
  ) {
    this.settings = settings ?? new SettingsRepository(getDatabase())
  }

  async getAccessToken(): Promise<string | null> {
    return keystore.getSecret(this.ref('access-token'))
  }

  async setAccessToken(value: string): Promise<void> {
    await keystore.setSecret(this.ref('access-token'), value)
  }

  async getApiKey(): Promise<string | null> {
    return keystore.getSecret(this.ref('api-key'))
  }

  async setApiKey(value: string): Promise<void> {
    await keystore.setSecret(this.ref('api-key'), value)
  }

  async getNewApiUserId(): Promise<number | null> {
    const parsed = Number(this.settings.get(this.category(), 'user-id'))
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }

  async setNewApiUserId(value: number): Promise<void> {
    this.settings.set(this.category(), 'user-id', value)
  }

  async getBaseUrl(): Promise<string | null> {
    const value = this.settings.get(this.category(), 'base-url')
    return typeof value === 'string' ? value : null
  }

  async setBaseUrl(value: string): Promise<void> {
    this.settings.set(this.category(), 'base-url', value)
  }

  async getPendingPayment(): Promise<PendingPlatformPayment | null> {
    let value = this.settings.get(this.category(), 'pending-payment')
    if (!value) {
      const legacy = await keystore.getSecret(this.ref('pending-payment'))
      if (legacy) {
        try {
          value = JSON.parse(legacy) as unknown
          this.settings.set(this.category(), 'pending-payment', value)
          await keystore.deleteSecret(this.ref('pending-payment'))
        } catch {
          return null
        }
      }
    }
    if (!value || typeof value !== 'object') return null
    try {
      const parsed = value as Record<string, unknown>
      const planId = Number(parsed.planId)
      const createdAt = Number(parsed.createdAt)
      if (!Number.isInteger(planId) || planId <= 0 || !Number.isFinite(createdAt)) return null
      const baselineSubscriptionId = Number(parsed.baselineSubscriptionId)
      const baselineExpiresAt = Number(parsed.baselineExpiresAt)
      return {
        planId,
        createdAt,
        ...(Number.isInteger(baselineSubscriptionId) && baselineSubscriptionId > 0
          ? { baselineSubscriptionId }
          : {}),
        ...(Number.isFinite(baselineExpiresAt) && baselineExpiresAt > 0
          ? { baselineExpiresAt }
          : {}),
      }
    } catch {
      return null
    }
  }

  async setPendingPayment(value: PendingPlatformPayment): Promise<void> {
    this.settings.set(this.category(), 'pending-payment', value)
  }

  async clearPendingPayment(): Promise<void> {
    this.settings.delete(this.category(), 'pending-payment')
  }

  async clearSession(): Promise<void> {
    await keystore.deleteSecret(this.ref('access-token'))
  }

  async clearAll(): Promise<void> {
    await Promise.all([
      keystore.deleteSecret(this.ref('access-token')),
      keystore.deleteSecret(this.ref('api-key')),
    ])
    this.settings.deleteByCategory(this.category())
  }

  apiKeyRef(): keystore.KeystoreRef {
    return this.ref('api-key')
  }

  private ref(kind: string): keystore.KeystoreRef {
    return keystore.makeKeystoreRef('newapi', `spark-user-${this.sparkUserId}-${kind}`)
  }

  private category(): string {
    return `platform-model:${this.sparkUserId}`
  }
}
