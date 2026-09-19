import type { FetchLike } from '../llm/http/client.js'
import type { RuntimeLogger } from '../observability/logger.js'

import { EduServerClient } from './edu-server-client.js'
import {
  NewApiClient,
  NewApiAuthenticationError,
  NewApiSessionConflictError,
} from './new-api-client.js'
import { PlatformModelStore } from './model-store.js'

/**
 * Platform-model bootstrap: turns an authenticated Spark account into a
 * working model route.
 *
 * Flow (mirrors the desktop's PlatformModelService so one account behaves
 * identically in both surfaces):
 *   1. `POST /platform-model/bootstrap` returns the new-api gateway the
 *      account is bound to, plus dashboard credentials.
 *   2. An existing dashboard session is validated instead of re-logging-in;
 *      a conflict means the account moved to another device and is reported
 *      instead of silently taking the session over.
 *   3. Otherwise the client logs in and exchanges the session for a dashboard
 *      access token; a rejected login triggers one `/platform-model/rebuild`
 *      attempt (the server rotates the dashboard credentials) before failing.
 *   4. `ensureApiKey` finds or creates the CLI's gateway token, and the model
 *      catalog is stored so model selection works without any network call.
 */

/** The platform gateway speaks Anthropic-protocol models with 1M windows. */
export const PLATFORM_CONTEXT_WINDOW_TOKENS = 1_000_000
/** Matches the desktop's managed-provider output ceiling for platform models. */
export const PLATFORM_MAX_OUTPUT_TOKENS = 128_000

export interface PlatformModelsBootstrapOptions {
  readonly sparkHome: string
  /** Authenticated Spark account session (from `~/.spark/credentials.json`). */
  readonly serverUrl: string
  readonly session: {
    readonly token: string
    readonly refreshToken: string
    readonly userId: string
  }
  readonly fetch?: FetchLike
  /** Re-login even when a stored dashboard session exists (device takeover). */
  readonly forceTakeover?: boolean
  readonly logger?: RuntimeLogger
}

export type PlatformModelsStatus =
  | {
      readonly bound: true
      readonly providerReady: true
      readonly baseUrl: string
      readonly apiKey: string
      readonly models: readonly string[]
    }
  | {
      readonly bound: true
      readonly providerReady: false
      readonly sessionConflict: true
      readonly message: string
    }

export interface PlatformModelSnapshot {
  readonly baseUrl: string
  readonly apiKey: string
  readonly models: readonly string[]
}

export class PlatformModelsError extends Error {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'PlatformModelsError'
  }
}

interface BootstrapCredentials {
  readonly baseUrl: unknown
  readonly newapiUserId: unknown
  readonly newapiUsername: unknown
  readonly password: unknown
}

export async function bootstrapPlatformModels(
  options: PlatformModelsBootstrapOptions,
): Promise<PlatformModelsStatus> {
  const logger = options.logger
  const store = new PlatformModelStore({
    sparkHome: options.sparkHome,
    ...(logger ? { logger } : {}),
  })
  const edu = new EduServerClient({
    baseUrl: options.serverUrl,
    session: options.session,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(logger ? { logger } : {}),
  })

  const credentials = await edu.postPlatform<BootstrapCredentials>('/platform-model/bootstrap')
  const baseUrl = requireString(credentials.baseUrl, 'bootstrap 未返回平台网关地址')
  const newApiUserId = requirePositiveNumber(
    credentials.newapiUserId,
    'bootstrap 未返回平台用户 id',
  )
  const newapiUsername = requireString(credentials.newapiUsername, 'bootstrap 未返回平台账户名')
  const password = requireString(credentials.password, 'bootstrap 未返回平台账户凭据')
  await store.save({ baseUrl, newApiUserId })

  const previousToken = (await store.load())?.accessToken ?? null
  const client = new NewApiClient(baseUrl, newApiUserId, options.fetch ?? fetch, previousToken)

  if (previousToken !== null && options.forceTakeover !== true) {
    try {
      await client.validateSession()
    } catch (error) {
      if (error instanceof NewApiSessionConflictError) {
        return {
          bound: true,
          providerReady: false,
          sessionConflict: true,
          message:
            '平台账户已在其他设备使用；CLI 未接管会话。如需在本机继续，运行 `spark models --takeover`。',
        }
      }
      throw new PlatformModelsError(`平台模型会话校验失败: ${String(error)}`, { cause: error })
    }
  } else {
    let token: string
    try {
      token = await client.loginAndGenerateAccessToken(newapiUsername, password)
    } catch (error) {
      if (!(error instanceof NewApiAuthenticationError)) {
        throw new PlatformModelsError(`平台模型登录失败: ${String(error)}`, { cause: error })
      }
      logger?.warn('new-api 登录被拒绝；请求平台重建账户凭据后重试')
      const rebuilt = await edu.postPlatform<BootstrapCredentials>('/platform-model/rebuild')
      const rebuiltUsername = requireString(rebuilt.newapiUsername, 'rebuild 未返回平台账户名')
      const rebuiltPassword = requireString(rebuilt.password, 'rebuild 未返回平台账户凭据')
      token = await client.loginAndGenerateAccessToken(rebuiltUsername, rebuiltPassword)
    }
    client.setAccessToken(token)
    await store.save({ baseUrl, newApiUserId, accessToken: token })
  }

  const [catalog, apiKey] = await Promise.all([client.getModelCatalog(), client.ensureApiKey()])
  const models = catalog.map((item) => item.modelId)
  if (models.length === 0) throw new PlatformModelsError('平台账户当前没有可用模型')
  const stored = await store.save({ baseUrl, newApiUserId, apiKey, models })
  logger?.info(
    `platform models bound: gateway=${baseUrl} models=${models.length} apiKey=${apiKey.slice(0, 8)}…`,
  )
  return {
    bound: true,
    providerReady: true,
    baseUrl,
    apiKey,
    models: stored.models,
  }
}

/**
 * Loads the stored platform-model route source for model selection. Returns
 * undefined unless the binding is complete (gateway + key + models), so a
 * half-finished bootstrap never masquerades as a usable provider.
 */
export async function readPlatformModelSnapshot(
  sparkHome: string,
): Promise<PlatformModelSnapshot | undefined> {
  const stored = await new PlatformModelStore({ sparkHome }).load()
  if (!stored?.apiKey || stored.models.length === 0) return undefined
  return { baseUrl: stored.baseUrl, apiKey: stored.apiKey, models: stored.models }
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new PlatformModelsError(message)
  return value
}

function requirePositiveNumber(value: unknown, message: string): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new PlatformModelsError(message)
  return Math.trunc(number)
}
