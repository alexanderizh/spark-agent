import * as keystore from '@spark/shared/keystore'

export interface PendingPlatformPayment {
  planId: number
  createdAt: number
  baselineSubscriptionId?: number
  baselineExpiresAt?: number
}

export class PlatformCredentialStore {
  constructor(private readonly sparkUserId: string) {}

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
    const value = await keystore.getSecret(this.ref('user-id'))
    const parsed = value ? Number(value) : NaN
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }

  async setNewApiUserId(value: number): Promise<void> {
    await keystore.setSecret(this.ref('user-id'), String(value))
  }

  async getBaseUrl(): Promise<string | null> {
    return keystore.getSecret(this.ref('base-url'))
  }

  async setBaseUrl(value: string): Promise<void> {
    await keystore.setSecret(this.ref('base-url'), value)
  }

  async getPendingPayment(): Promise<PendingPlatformPayment | null> {
    const value = await keystore.getSecret(this.ref('pending-payment'))
    if (!value) return null
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>
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
    await keystore.setSecret(this.ref('pending-payment'), JSON.stringify(value))
  }

  async clearPendingPayment(): Promise<void> {
    await keystore.deleteSecret(this.ref('pending-payment'))
  }

  async clearSession(): Promise<void> {
    await keystore.deleteSecret(this.ref('access-token'))
  }

  async clearAll(): Promise<void> {
    await Promise.all([
      keystore.deleteSecret(this.ref('access-token')),
      keystore.deleteSecret(this.ref('api-key')),
      keystore.deleteSecret(this.ref('user-id')),
      keystore.deleteSecret(this.ref('base-url')),
      keystore.deleteSecret(this.ref('pending-payment')),
    ])
  }

  apiKeyRef(): keystore.KeystoreRef {
    return this.ref('api-key')
  }

  private ref(kind: string): keystore.KeystoreRef {
    return keystore.makeKeystoreRef('newapi', `spark-user-${this.sparkUserId}-${kind}`)
  }
}
