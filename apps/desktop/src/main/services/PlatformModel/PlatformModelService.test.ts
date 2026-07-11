import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  currentUserId: 'spark-user-1' as string | null,
  secrets: new Map<string, string>(),
  recoveryHandler: null as null | ((request: {
    ownerUserId: string
    currentSecret: string | null
  }) => Promise<string | null>),
  addLoginHook: vi.fn(),
  addLogoutHook: vi.fn(),
  platformPost: vi.fn(),
  validateSession: vi.fn(),
  getModels: vi.fn(),
  ensureApiKey: vi.fn(),
  recoverApiKey: vi.fn(),
  getSubscription: vi.fn(),
  ensureManagedProvider: vi.fn(),
  disableManagedProvider: vi.fn(),
  setManagedCredentialState: vi.fn(),
  openExternal: vi.fn(),
  showNotification: vi.fn(),
}))

vi.mock('@spark/shared/keystore', () => ({
  makeKeystoreRef: (_provider: string, id: string) => `newapi:${id}`,
  getSecret: vi.fn(async (ref: string) => mocks.secrets.get(ref) ?? null),
  setSecret: vi.fn(async (ref: string, value: string) => {
    mocks.secrets.set(ref, value)
  }),
  deleteSecret: vi.fn(async (ref: string) => mocks.secrets.delete(ref)),
}))

vi.mock('@spark/agent-runtime', () => ({
  ProviderService: class {
    ensureManagedNewApiProvider = mocks.ensureManagedProvider
    disableManagedNewApiProvider = mocks.disableManagedProvider
    setManagedNewApiCredentialState = mocks.setManagedCredentialState
  },
  setManagedCredentialRecoveryHandler: vi.fn((handler) => {
    mocks.recoveryHandler = handler
  }),
}))

vi.mock('@spark/storage', () => ({
  ProviderProfileRepository: class {},
}))

vi.mock('electron', () => ({
  shell: { openExternal: mocks.openExternal },
  Notification: class {
    static isSupported = () => true
    show = mocks.showNotification
  },
}))

vi.mock('../../db.js', () => ({ getDatabase: vi.fn(() => ({})) }))
vi.mock('../../windows/index.js', () => ({ sendToMainWindow: vi.fn() }))

vi.mock('../Auth/AuthService.js', () => ({
  getAuthService: () => ({
    addLoginHook: mocks.addLoginHook,
    addLogoutHook: mocks.addLogoutHook,
    getCurrentUserId: () => mocks.currentUserId,
    platformPost: mocks.platformPost,
  }),
}))

vi.mock('./NewApiClient.js', () => {
  class NewApiSessionConflictError extends Error {}
  return {
    NewApiSessionConflictError,
    NewApiClient: class {
      validateSession = mocks.validateSession
      getModels = mocks.getModels
      ensureApiKey = mocks.ensureApiKey
      recoverApiKey = mocks.recoverApiKey
      getSubscription = mocks.getSubscription
    },
  }
})

import { PlatformModelService } from './PlatformModelService.js'

const ref = (kind: string, userId = 'spark-user-1') =>
  `newapi:spark-user-${userId}-${kind}`

function seedReadyCredentials(overrides: Partial<Record<'base-url' | 'user-id' | 'access-token' | 'api-key', string>> = {}) {
  const values = {
    'base-url': 'https://newapi.example',
    'user-id': '42',
    'access-token': 'management-token',
    'api-key': 'sk-current',
    ...overrides,
  }
  for (const [kind, value] of Object.entries(values)) mocks.secrets.set(ref(kind), value)
}

describe('PlatformModelService delivery boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.currentUserId = 'spark-user-1'
    mocks.secrets.clear()
    mocks.recoveryHandler = null
    mocks.platformPost.mockResolvedValue({
      bound: true,
      newapiUserId: 42,
      newapiUsername: 'sp_42',
      password: 'derived-password',
      baseUrl: 'https://newapi.example',
    })
    mocks.validateSession.mockResolvedValue(undefined)
    mocks.getModels.mockResolvedValue(['gpt-5.4-mini'])
    mocks.ensureApiKey.mockResolvedValue('sk-current')
    mocks.recoverApiKey.mockImplementation(async (current: string | null) => current ?? 'sk-recovered')
    mocks.getSubscription.mockResolvedValue(null)
  })

  it('singleflights concurrent inference-key recovery requests', async () => {
    seedReadyCredentials()
    let finishRecovery!: (value: string) => void
    const recovery = new Promise<string>(resolve => { finishRecovery = resolve })
    mocks.recoverApiKey.mockReturnValue(recovery)
    new PlatformModelService()

    const request = { ownerUserId: 'spark-user-1', currentSecret: 'sk-expired' }
    const first = mocks.recoveryHandler!(request)
    const second = mocks.recoveryHandler!(request)

    expect(second).toBe(first)
    await vi.waitFor(() => expect(mocks.recoverApiKey).toHaveBeenCalledTimes(1))
    finishRecovery('sk-recovered')
    await expect(Promise.all([first, second])).resolves.toEqual(['sk-recovered', 'sk-recovered'])
    expect(mocks.secrets.get(ref('api-key'))).toBe('sk-recovered')
  })

  it('rejects recovery when the managed provider owner differs from the active Spark user', async () => {
    seedReadyCredentials()
    new PlatformModelService()

    await expect(mocks.recoveryHandler!({
      ownerUserId: 'spark-user-2',
      currentSecret: 'sk-other-user',
    })).rejects.toThrow('属于其他登录账号')
    expect(mocks.recoverApiKey).not.toHaveBeenCalled()
  })

  it('never shares an in-flight credential promise across different owners', async () => {
    seedReadyCredentials()
    let finishRecovery!: (value: string) => void
    mocks.recoverApiKey.mockReturnValue(new Promise<string>(resolve => { finishRecovery = resolve }))
    new PlatformModelService()

    const activeOwnerRecovery = mocks.recoveryHandler!({
      ownerUserId: 'spark-user-1',
      currentSecret: 'sk-expired',
    })
    await vi.waitFor(() => expect(mocks.recoverApiKey).toHaveBeenCalledTimes(1))

    await expect(mocks.recoveryHandler!({
      ownerUserId: 'spark-user-2',
      currentSecret: 'sk-other-user',
    })).rejects.toThrow('属于其他登录账号')

    finishRecovery('sk-user-1-recovered')
    await expect(activeOwnerRecovery).resolves.toBe('sk-user-1-recovered')
  })

  it('continues inference with a valid API key even when the dashboard token is stale', async () => {
    seedReadyCredentials({ 'access-token': 'stale-management-token' })
    mocks.recoverApiKey.mockImplementation(async current => current)
    new PlatformModelService()

    await expect(mocks.recoveryHandler!({
      ownerUserId: 'spark-user-1',
      currentSecret: 'sk-still-valid',
    })).resolves.toBe('sk-still-valid')

    expect(mocks.recoverApiKey).toHaveBeenCalledWith('sk-still-valid')
    expect(mocks.validateSession).not.toHaveBeenCalled()
  })

  it('restores a pending browser payment after restart and clears it only after activation', async () => {
    seedReadyCredentials()
    const pending = { planId: 8, createdAt: 12345 }
    mocks.secrets.set(ref('pending-payment'), JSON.stringify(pending))
    mocks.getSubscription.mockResolvedValue({
      id: 9,
      planId: 8,
      planTitle: '专业版',
      status: 'active',
      startsAt: 100,
      expiresAt: 200,
      amountTotal: 1_000,
      amountUsed: 0,
      nextResetTime: 150,
    })
    const service = new PlatformModelService()

    await expect(service.bootstrap()).resolves.toMatchObject({ pendingPayment: pending })
    await expect(service.getSubscription()).resolves.toMatchObject({ planId: 8, status: 'active' })

    expect(mocks.secrets.has(ref('pending-payment'))).toBe(false)
    expect(service.getStatus().pendingPayment).toBeUndefined()
  })

  it('does not confirm a same-plan renewal until the subscription id or expiry changes', async () => {
    seedReadyCredentials()
    const pending = {
      planId: 8,
      createdAt: 12345,
      baselineSubscriptionId: 9,
      baselineExpiresAt: 200,
    }
    mocks.secrets.set(ref('pending-payment'), JSON.stringify(pending))
    const unchanged = {
      id: 9,
      planId: 8,
      status: 'active',
      expiresAt: 200,
      amountTotal: 1_000,
      amountUsed: 0,
    }
    mocks.getSubscription.mockResolvedValue(unchanged)
    const service = new PlatformModelService()

    await service.bootstrap()
    await service.getSubscription()
    expect(service.getStatus().pendingPayment).toEqual(pending)

    mocks.getSubscription.mockResolvedValue({ ...unchanged, id: 10, expiresAt: 300 })
    await service.getSubscription()
    expect(service.getStatus().pendingPayment).toBeUndefined()
  })

  it('throttles native notifications for a management-token device conflict', () => {
    const service = new PlatformModelService()
    ;(service as any).notifySessionConflict()
    ;(service as any).notifySessionConflict()
    expect(mocks.showNotification).toHaveBeenCalledTimes(1)
  })
})
