import type {
  PlatformModelPlan,
  PlatformModelPurchaseLink,
  PlatformModelRedeemResponse,
  PlatformModelStatus,
  PlatformModelSubscription,
} from '@spark/protocol'
import { ProviderService, setManagedCredentialRecoveryHandler } from '@spark/agent-runtime'
import { ProviderProfileRepository } from '@spark/storage'
import { Notification, shell } from 'electron'
import { getDatabase } from '../../db.js'
import { sendToMainWindow } from '../../windows/index.js'
import { getAuthService } from '../Auth/AuthService.js'
import {
  NewApiAuthenticationError,
  NewApiClient,
  NewApiSessionConflictError,
} from './NewApiClient.js'
import { PlatformCredentialStore } from './PlatformCredentialStore.js'
import { openExternalPostForm } from './ExternalPostForm.js'

type BootstrapCredentials = {
  bound: true
  newapiUserId: number
  newapiUsername: string
  password: string
  baseUrl: string
}

export class PlatformModelService {
  private status: PlatformModelStatus = emptyStatus()
  private readonly bootstrapInflight = new Map<string, Promise<PlatformModelStatus>>()
  private readonly credentialRecoveryInflight = new Map<string, Promise<string | null>>()
  private readonly lastValidatedApiKeys = new Map<string, { value: string; expiresAt: number }>()
  private lastConflictNotificationAt = 0

  constructor() {
    getAuthService().addLogoutHook(async (userId) => this.logout(userId))
    getAuthService().addLoginHook(async () => { await this.bootstrap(false) })
    setManagedCredentialRecoveryHandler(request => this.recoverManagedCredential(request))
  }

  getStatus(): PlatformModelStatus {
    return { ...this.status, models: [...this.status.models] }
  }

  bootstrap(forceTakeover = false): Promise<PlatformModelStatus> {
    const ownerUserId = getAuthService().getCurrentUserId() ?? '__anonymous__'
    const existing = this.bootstrapInflight.get(ownerUserId)
    if (existing) return existing
    const operation = this.bootstrapInternal(forceTakeover).finally(() => {
      if (this.bootstrapInflight.get(ownerUserId) === operation) {
        this.bootstrapInflight.delete(ownerUserId)
      }
    })
    this.bootstrapInflight.set(ownerUserId, operation)
    return operation
  }

  async getPlans(): Promise<PlatformModelPlan[]> {
    return (await this.readyClient()).getPlans()
  }

  async getSubscription(): Promise<PlatformModelSubscription | null> {
    const subscription = await (await this.readyClient()).getSubscription()
    const sparkUserId = getAuthService().getCurrentUserId()
    if (sparkUserId) {
      const store = new PlatformCredentialStore(sparkUserId)
      const pending = await store.getPendingPayment()
      const paymentConfirmed = pending && subscription?.planId === pending.planId
        && subscription.status.toLowerCase() === 'active'
        && (pending.baselineSubscriptionId == null
          || subscription.id !== pending.baselineSubscriptionId
          || Number(subscription.expiresAt ?? 0) > Number(pending.baselineExpiresAt ?? 0))
      if (paymentConfirmed) {
        await store.clearPendingPayment()
        delete this.status.pendingPayment
      }
    }
    return subscription
  }

  async getUsage() {
    return (await this.readyClient()).getUsage()
  }

  async getPurchaseLinks(): Promise<PlatformModelPurchaseLink[]> {
    const links = await getAuthService().platformGet<Array<{
      id?: unknown
      name?: unknown
      url?: unknown
      description?: unknown
      sortOrder?: unknown
    }>>('/wallet/purchase-links')
    return Array.isArray(links)
      ? links
        .filter((link): link is typeof link & { name: string; url: string } => (
          Number.isInteger(Number(link.id))
          && Number(link.id) > 0
          && typeof link.name === 'string'
          && typeof link.url === 'string'
        ))
        .map(link => ({
          id: Number(link.id),
          name: link.name,
          url: link.url,
          ...(typeof link.description === 'string' ? { description: link.description } : {}),
          sortOrder: Number.isFinite(Number(link.sortOrder)) ? Number(link.sortOrder) : 0,
        }))
        .sort((left, right) => left.sortOrder - right.sortOrder)
      : []
  }

  async openPurchaseLink(id: number): Promise<{ ok: true }> {
    const link = (await this.getPurchaseLinks()).find(item => Number(item.id) === id)
    if (!link) throw new Error('购买渠道不存在或已停用')
    const target = new URL(link.url)
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      throw new Error('购买地址协议不安全')
    }
    await shell.openExternal(target.toString())
    return { ok: true }
  }

  async updateModelPreferences(params: {
    modelIds: string[]
    defaultModel: string
  }): Promise<{ modelIds: string[]; defaultModel: string }> {
    const profile = await this.providerService().updateManagedNewApiModelPreferences(params)
    this.status = { ...this.status, models: [...profile.modelIds] }
    this.emitProviderChanged('update')
    return { modelIds: profile.modelIds, defaultModel: profile.defaultModel }
  }

  async redeem(code: string): Promise<PlatformModelRedeemResponse> {
    const normalized = code.trim()
    if (!normalized) throw new Error('请输入兑换码')
    try {
      const result = await getAuthService().platformPost<{
        benefitType: 'subscription'
        planId: number
        alreadyRedeemed?: boolean
      }>('/platform-model/redeem-subscription', { code: normalized })
      return {
        benefitType: 'subscription',
        planId: result.planId,
        message: result.alreadyRedeemed ? '该订阅权益已兑换' : '订阅权益已开通',
      }
    } catch (error) {
      const message = (error as Error).message
      if (!message.includes('兑换码无效') && !message.includes('兑换码格式不正确')) throw error
    }

    const quotaAdded = await (await this.readyClient()).redeemQuota(normalized)
    return { benefitType: 'quota', quotaAdded, message: '通用额度已到账' }
  }

  async pay(planId: number, paymentMethod: 'alipay' | 'wxpay') {
    const client = await this.readyClient()
    const baseline = await client.getSubscription()
    const result = await client.createPayment(planId, paymentMethod)
    if (result.url) {
      const target = new URL(result.url)
      if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('支付地址协议不安全')
      await shell.openExternal(target.toString())
    } else if ('postForm' in result && result.postForm) {
      await openExternalPostForm(result.postForm.action, result.postForm.fields)
    }
    const sparkUserId = getAuthService().getCurrentUserId()
    if (sparkUserId) {
      const store = new PlatformCredentialStore(sparkUserId)
      if (result.paid) {
        await store.clearPendingPayment()
        delete this.status.pendingPayment
      } else {
        const pendingPayment = {
          planId,
          createdAt: Date.now(),
          ...(baseline ? { baselineSubscriptionId: baseline.id } : {}),
          ...(baseline?.expiresAt ? { baselineExpiresAt: baseline.expiresAt } : {}),
        }
        await store.setPendingPayment(pendingPayment)
        this.status = { ...this.status, pendingPayment }
      }
    }
    return { mode: result.mode, paid: result.paid }
  }

  async logout(userId: string | null): Promise<void> {
    if (!userId) return
    await new PlatformCredentialStore(userId).clearAll()
    await this.providerService().disableManagedNewApiProvider(userId)
    this.emitProviderChanged('update')
    const currentUserId = getAuthService().getCurrentUserId()
    if (!currentUserId || currentUserId === userId) {
      this.lastValidatedApiKeys.delete(userId)
      this.status = emptyStatus()
    }
  }

  private async bootstrapInternal(forceTakeover: boolean): Promise<PlatformModelStatus> {
    const auth = getAuthService()
    const sparkUserId = auth.getCurrentUserId()
    if (!sparkUserId) throw new Error('请先登录 Spark 账号')

    let credentials = await auth.platformPost<BootstrapCredentials>('/platform-model/bootstrap')
    const store = new PlatformCredentialStore(sparkUserId)
    await Promise.all([
      store.setBaseUrl(credentials.baseUrl),
      store.setNewApiUserId(credentials.newapiUserId),
    ])

    const previousToken = await store.getAccessToken()
    const client = new NewApiClient(credentials.baseUrl, credentials.newapiUserId, previousToken)
    if (previousToken && !forceTakeover) {
      try {
        await client.validateSession()
      } catch (error) {
        if (error instanceof NewApiSessionConflictError) {
          this.notifySessionConflict()
          this.providerService().setManagedNewApiCredentialState(sparkUserId, 'session_conflict')
          this.emitProviderChanged('update')
          this.status = {
            bound: true,
            providerReady: Boolean(await store.getApiKey()),
            sessionConflict: true,
            credentialState: 'session_conflict',
            models: this.status.models,
            message: '平台账户已在其他设备使用；模型对话仍可继续，需要管理套餐时可选择“在本机继续”',
          }
          return this.getStatus()
        }
        throw error
      }
    } else {
      let token: string
      try {
        token = await client.loginAndGenerateAccessToken(
          credentials.newapiUsername,
          credentials.password,
        )
      } catch (error) {
        if (!(error instanceof NewApiAuthenticationError)) throw error
        credentials = await auth.platformPost<BootstrapCredentials>('/platform-model/rebuild')
        token = await client.loginAndGenerateAccessToken(
          credentials.newapiUsername,
          credentials.password,
        )
      }
      await store.setAccessToken(token)
    }

    const [models, apiKey] = await Promise.all([
      client.getModels(),
      client.ensureApiKey(),
    ])
    await store.setApiKey(apiKey)
    this.lastValidatedApiKeys.set(sparkUserId, { value: apiKey, expiresAt: Date.now() + 60_000 })
    const profile = await this.providerService().ensureManagedNewApiProvider({
      ownerUserId: sparkUserId,
      baseUrl: credentials.baseUrl,
      modelIds: models,
      apiKey,
      credentialState: 'ready',
    })
    this.emitProviderChanged('update')
    const pendingPayment = await store.getPendingPayment()
    this.status = {
      bound: true,
      providerReady: true,
      sessionConflict: false,
      credentialState: 'ready',
      models: profile.modelIds,
      ...(pendingPayment ? { pendingPayment } : {}),
    }
    return this.getStatus()
  }

  private async readyClient(): Promise<NewApiClient> {
    const sparkUserId = getAuthService().getCurrentUserId()
    if (!sparkUserId) throw new Error('请先登录 Spark 账号')
    const store = new PlatformCredentialStore(sparkUserId)
    const [baseUrl, userId, accessToken] = await Promise.all([
      store.getBaseUrl(),
      store.getNewApiUserId(),
      store.getAccessToken(),
    ])
    if (!baseUrl || !userId || !accessToken) {
      const status = await this.bootstrap(false)
      if (status.sessionConflict) throw new NewApiSessionConflictError()
      return this.readyClient()
    }
    const client = new NewApiClient(baseUrl, userId, accessToken)
    try {
      await client.validateSession()
      return client
    } catch (error) {
      if (error instanceof NewApiSessionConflictError) {
        this.notifySessionConflict()
        this.providerService().setManagedNewApiCredentialState(sparkUserId, 'session_conflict')
        this.emitProviderChanged('update')
        this.status = {
          ...this.status,
          bound: true,
          sessionConflict: true,
          credentialState: 'session_conflict',
          message: '平台账户已在其他设备使用',
        }
      }
      throw error
    }
  }

  private recoverManagedCredential(request: {
    ownerUserId: string
    currentSecret: string | null
  }): Promise<string | null> {
    const existing = this.credentialRecoveryInflight.get(request.ownerUserId)
    if (existing) return existing
    const operation = this.recoverManagedCredentialInternal(request).finally(() => {
      if (this.credentialRecoveryInflight.get(request.ownerUserId) === operation) {
        this.credentialRecoveryInflight.delete(request.ownerUserId)
      }
    })
    this.credentialRecoveryInflight.set(request.ownerUserId, operation)
    return operation
  }

  private async recoverManagedCredentialInternal(request: {
    ownerUserId: string
    currentSecret: string | null
  }): Promise<string | null> {
    const currentUserId = getAuthService().getCurrentUserId()
    if (!currentUserId || currentUserId !== request.ownerUserId) {
      throw new Error('平台官方模型属于其他登录账号，请重新登录')
    }

    const now = Date.now()
    const cachedKey = this.lastValidatedApiKeys.get(request.ownerUserId)
    if (request.currentSecret && cachedKey?.value === request.currentSecret
        && cachedKey.expiresAt > now) {
      return request.currentSecret
    }

    const store = new PlatformCredentialStore(currentUserId)
    const [baseUrl, newapiUserId, accessToken] = await Promise.all([
      store.getBaseUrl(),
      store.getNewApiUserId(),
      store.getAccessToken(),
    ])
    if (!baseUrl || !newapiUserId || !accessToken) {
      const status = await this.bootstrap(false)
      if (status.sessionConflict) throw new NewApiSessionConflictError()
      return store.getApiKey()
    }

    const client = new NewApiClient(baseUrl, newapiUserId, accessToken)
    const apiKey = await client.recoverApiKey(request.currentSecret)
    await store.setApiKey(apiKey)
    this.lastValidatedApiKeys.set(currentUserId, { value: apiKey, expiresAt: now + 60_000 })
    return apiKey
  }

  private providerService(): ProviderService {
    return new ProviderService(new ProviderProfileRepository(getDatabase()))
  }

  private notifySessionConflict(): void {
    const now = Date.now()
    if (now - this.lastConflictNotificationAt < 5 * 60 * 1000) return
    this.lastConflictNotificationAt = now
    if (!Notification.isSupported()) return
    new Notification({
      title: '平台模型账户已在其他设备登录',
      body: '套餐管理一次只能在一台设备使用；已有模型对话仍可继续。',
    }).show()
  }

  private emitProviderChanged(action: 'create' | 'update'): void {
    try {
      sendToMainWindow('stream:config:changed', {
        scope: 'provider',
        action,
        id: 'spark-platform-newapi',
      })
    } catch {
      // 登录可能发生在主窗口创建前；发送瞬间失败不影响 Provider 持久化。
    }
  }
}

let singleton: PlatformModelService | null = null

export function getPlatformModelService(): PlatformModelService {
  singleton ??= new PlatformModelService()
  return singleton
}

function emptyStatus(): PlatformModelStatus {
  return {
    bound: false,
    providerReady: false,
    sessionConflict: false,
    credentialState: 'unbound',
    models: [],
  }
}
