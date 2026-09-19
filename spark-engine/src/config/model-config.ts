import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { z } from 'zod'

import {
  asRecord,
  deepMergeLayers,
  errorMessage,
  readTomlLayer,
  writeTomlLayerAtomic,
} from './config-file.js'
import { ModelConfigSchema, type ModelConfig } from './root-schema.js'

import type { LlmService } from '../seams.js'
import type { FetchLike } from '../llm/http/client.js'
import { ModelRegistry, type ModelProtocol } from '../llm/registry.js'
import type { ModelCapabilities, ReasoningEffort } from '../llm/types.js'
import type { PermissionMode } from '../permission/types.js'
import {
  discoverSparkWorkHost,
  resolveSparkWorkRoute,
  sparkWorkProxyBaseUrl,
  type SparkWorkHostCatalog,
  type SparkWorkHostRoute,
} from './sparkwork-host.js'
import {
  PLATFORM_CONTEXT_WINDOW_TOKENS,
  PLATFORM_MAX_OUTPUT_TOKENS,
  readPlatformModelSnapshot,
  type PlatformModelSnapshot,
} from '../platform/models.js'

export interface LoadModelConfigOptions {
  readonly cwd: string
  readonly globalConfigPath?: string
  readonly projectConfigPath?: string
  readonly env?: NodeJS.ProcessEnv
  readonly model?: string
  readonly sparkWorkBridgePath?: string
  readonly fetch?: FetchLike
}

export interface ConfiguredModelRuntime {
  readonly service: LlmService
  readonly modelId: string
  readonly route: readonly string[]
  readonly configSnapshot: Readonly<Record<string, unknown>>
  /**
   * Capabilities of the primary route, used by the CLI to warn about
   * undeclared inputs (e.g. images) without blocking the turn.
   */
  readonly capabilities?: ModelCapabilities
}

export interface CliPreferences {
  readonly permissionMode: PermissionMode
  readonly reasoningEffort: ReasoningEffort
}

export interface PersistCliPreferencesInput extends CliPreferences {
  readonly sparkHome: string
}

export interface ConfiguredModelCatalogEntry {
  readonly id: string
  readonly source: 'local' | 'sparkwork' | 'platform'
  readonly providerId: string
  readonly providerName: string
  readonly protocol: ModelProtocol
  readonly model: string
  readonly selected: boolean
  /** Configured context window; absent when the source reports none. */
  readonly contextWindowTokens?: number
  /** Configured output ceiling; absent when the source reports none. */
  readonly maxOutputTokens?: number
}

export interface ConfiguredModelCatalog {
  readonly entries: readonly ConfiguredModelCatalogEntry[]
  readonly selectedModel?: string
  /** A complete platform-model binding (gateway + key + models) exists. */
  readonly platformConnected: boolean
  readonly sparkWorkConnected: boolean
  readonly sparkWorkDiagnostic?: string
  readonly sparkWorkStaleBridgeDescriptors: number
}

export class ModelConfigError extends Error {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ModelConfigError'
  }
}

export async function loadConfiguredModel(
  options: LoadModelConfigOptions,
): Promise<ConfiguredModelRuntime> {
  const {
    config,
    environment,
    host,
    platform,
    projectLayer,
    globalPath,
    projectPath,
    globalExists,
    projectExists,
  } = await loadModelContext(options)
  const localSelected = options.model ?? environment.SPARK_MODEL ?? selectedModel(projectLayer)
  // A persisted CLI selection ([agent].model, written by the TUI picker) is an
  // explicit choice and stays sticky above the platform and SparkWork default
  // routes; those defaults only apply while the CLI has picked nothing itself.
  const modelId =
    localSelected ??
    config.agent.model ??
    (platform?.models[0] !== undefined ? `platform:${platform.models[0]}` : undefined) ??
    host.catalog?.defaultRoute
  if (!modelId) {
    throw noModelSelectedError({ host, globalPath, projectPath, globalExists, projectExists })
  }
  const failover = parseFailover(environment.SPARK_FAILOVER_MODELS) ?? config.agent.failover
  return buildConfiguredRuntime(
    {
      config,
      environment,
      host,
      platform,
      projectLayer,
      globalPath,
      projectPath,
      globalExists,
      projectExists,
    },
    modelId,
    failover,
    options.fetch,
  )
}

/** Loads durable CLI defaults without requiring a model to be configured. */
export async function loadCliPreferences(options: LoadModelConfigOptions): Promise<CliPreferences> {
  const { config } = await loadModelContext(options)
  return {
    permissionMode: config.agent.permission_mode ?? 'manual',
    reasoningEffort: config.agent.reasoning_effort ?? 'high',
  }
}

/**
 * Builds a runtime for one explicitly chosen model id (a local model entry or a
 * SparkWork route id). The interactive host uses this after the user picks a
 * model on the picker, so every selection re-reads the effective config and
 * the live SparkWork catalog instead of trusting startup state.
 */
export async function createConfiguredRuntime(
  options: LoadModelConfigOptions & { readonly model: string },
): Promise<ConfiguredModelRuntime> {
  const context = await loadModelContext(options)
  const failover =
    parseFailover(context.environment.SPARK_FAILOVER_MODELS) ?? context.config.agent.failover
  return buildConfiguredRuntime(context, options.model, failover, options.fetch)
}

function buildConfiguredRuntime(
  context: LoadedModelContext,
  modelId: string,
  failover: readonly string[],
  fetcher: FetchLike | undefined,
): ConfiguredModelRuntime {
  const { config, environment, host, platform } = context
  const route = [...new Set([modelId, ...failover])]
  const registry = new ModelRegistry()
  for (const id of route) {
    if (
      !config.models[id] &&
      !platform?.models.includes(platformModelId(id)) &&
      !host.catalog &&
      host.diagnostic
    ) {
      throw new ModelConfigError(`Model ${id} is unavailable. ${host.diagnostic}`)
    }
    registerModelRoute(registry, id, config, environment, host.catalog, platform, fetcher)
  }
  const primaryCapabilities = registry.get(modelId)?.capabilities
  return {
    service: registry.createRoute(route, {
      retry: {
        maxRetries: config.agent.max_retries,
        initialDelayMs: config.agent.retry_initial_delay_ms,
        maxDelayMs: config.agent.retry_max_delay_ms,
        jitterRatio: config.agent.retry_jitter_ratio,
      },
    }),
    modelId,
    route,
    ...(primaryCapabilities === undefined ? {} : { capabilities: primaryCapabilities }),
    configSnapshot: {
      ...structuredClone(config),
      ...(platform ? { platform: { gateway: platform.baseUrl, selectedRoute: modelId } } : {}),
      ...(host.catalog
        ? {
            sparkwork: {
              catalogRevision: host.catalog.revision,
              selectedRoute: modelId,
            },
          }
        : {}),
    },
  }
}

export async function inspectConfiguredModels(
  options: LoadModelConfigOptions,
): Promise<ConfiguredModelCatalog> {
  const { config, environment, host, platform, projectLayer } = await loadModelContext(options)
  const selected =
    options.model ??
    environment.SPARK_MODEL ??
    selectedModel(projectLayer) ??
    config.agent.model ??
    (platform?.models[0] !== undefined ? `platform:${platform.models[0]}` : undefined) ??
    host.catalog?.defaultRoute
  const selectedHostRoute =
    selected && host.catalog && !config.models[selected]
      ? resolveSparkWorkRoute(host.catalog, selected)
      : undefined
  const localEntries: ConfiguredModelCatalogEntry[] = Object.entries(config.models).flatMap(
    ([id, model]) => {
      const provider = config.providers[model.provider]
      if (!provider) {
        throw new ModelConfigError(
          `Model ${id} references unknown provider ${model.provider}; define [providers.${model.provider}]`,
        )
      }
      return [
        {
          id,
          source: 'local',
          providerId: model.provider,
          providerName: model.provider,
          protocol: provider.protocol,
          model: model.model,
          selected: selected === id,
          ...(model.context_window === undefined
            ? {}
            : { contextWindowTokens: model.context_window }),
          ...(model.max_tokens === undefined ? {} : { maxOutputTokens: model.max_tokens }),
        },
      ]
    },
  )
  const hostEntries: ConfiguredModelCatalogEntry[] =
    host.catalog?.routes.map((route) => ({
      id: route.routeId,
      source: 'sparkwork',
      providerId: route.providerId,
      providerName: route.providerName,
      protocol: route.protocol,
      model: route.model,
      selected: selectedHostRoute?.routeId === route.routeId,
      ...(route.contextWindow === undefined ? {} : { contextWindowTokens: route.contextWindow }),
      ...(route.maxOutputTokens === undefined ? {} : { maxOutputTokens: route.maxOutputTokens }),
    })) ?? []
  const platformEntries: ConfiguredModelCatalogEntry[] = (platform?.models ?? []).map(
    (modelId) => ({
      id: `platform:${modelId}`,
      source: 'platform' as const,
      providerId: 'platform',
      providerName: 'Spark 平台模型',
      protocol: 'anthropic-messages' as const,
      model: modelId,
      selected: selected === `platform:${modelId}`,
      contextWindowTokens: PLATFORM_CONTEXT_WINDOW_TOKENS,
      maxOutputTokens: PLATFORM_MAX_OUTPUT_TOKENS,
    }),
  )
  return Object.freeze({
    entries: Object.freeze([...hostEntries, ...localEntries, ...platformEntries]),
    ...(selected ? { selectedModel: selected } : {}),
    platformConnected: platform !== undefined,
    sparkWorkConnected: host.catalog !== undefined,
    sparkWorkStaleBridgeDescriptors: host.staleBridgeDescriptors,
    ...(host.diagnostic ? { sparkWorkDiagnostic: host.diagnostic } : {}),
  })
}

export interface LocalProviderInput {
  readonly sparkHome: string
  readonly alias: string
  readonly protocol: ModelProtocol
  readonly baseUrl?: string
  readonly apiKeyEnv: string
  readonly modelId: string
}

export interface LocalProviderConfigResult {
  readonly configPath: string
  readonly modelEntryId: string
}

const LOCAL_ALIAS = /^[a-z][a-z0-9-]{0,63}$/u
const API_KEY_ENV_NAME = /^[A-Z_][A-Z0-9_]*$/u

/**
 * Terminal-side provider configuration flow (docs 016 §4): merges one local
 * provider + model entry into ~/.spark/config.toml. Credentials are only ever
 * referenced by environment-variable name — this function refuses to persist
 * anything else and never touches project-level config.
 */
export async function configureLocalProvider(
  input: LocalProviderInput,
): Promise<LocalProviderConfigResult> {
  const alias = input.alias.trim()
  const apiKeyEnv = input.apiKeyEnv.trim()
  const modelId = input.modelId.trim()
  const baseUrl = input.baseUrl?.trim() ?? ''
  if (!LOCAL_ALIAS.test(alias)) {
    throw new ModelConfigError(
      `Invalid provider alias "${alias}": use lowercase letters, digits and dashes, starting with a letter`,
    )
  }
  if (!API_KEY_ENV_NAME.test(apiKeyEnv)) {
    throw new ModelConfigError(
      `Invalid credential environment variable "${apiKeyEnv}": use UPPER_SNAKE_CASE (the key itself is never stored)`,
    )
  }
  if (!modelId || modelId.length > 200) {
    throw new ModelConfigError('A non-empty upstream model id (at most 200 chars) is required')
  }
  if (input.protocol !== 'anthropic-messages' && input.protocol !== 'openai-responses') {
    throw new ModelConfigError(`Unsupported protocol: ${String(input.protocol)}`)
  }
  if (baseUrl !== '') {
    try {
      const parsed = new URL(baseUrl)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('scheme')
      }
    } catch {
      throw new ModelConfigError(`Invalid base_url "${baseUrl}": expected an http(s) URL`)
    }
  }

  const configPath = await writeGlobalConfig(input.sparkHome, (layer) => {
    const providers = asRecord(layer.providers) ?? {}
    const models = asRecord(layer.models) ?? {}
    layer.providers = {
      ...providers,
      [alias]: {
        protocol: input.protocol,
        ...(baseUrl === '' ? {} : { base_url: baseUrl }),
        api_key_env: apiKeyEnv,
      },
    }
    layer.models = {
      ...models,
      [alias]: { provider: alias, model: modelId },
    }
  })
  return { configPath, modelEntryId: alias }
}

export interface PersistSelectedModelInput {
  readonly sparkHome: string
  readonly model: string
}

/**
 * Remembers the interactive model selection as [agent].model in the global
 * layer (~/.spark/config.toml) so the next launch reuses it instead of
 * reopening the picker (docs 016 §4). Only the model id is persisted —
 * credentials stay in environment variables — and the merge is validated
 * against the config schema before an atomic rename, so a hand-edited config
 * is never silently corrupted.
 */
export async function persistSelectedModel(input: PersistSelectedModelInput): Promise<string> {
  const model = input.model.trim()
  if (!model || model.length > 2_000) {
    throw new ModelConfigError('A non-empty model id (at most 2000 chars) is required')
  }
  return writeGlobalConfig(input.sparkHome, (layer) => {
    const agent = asRecord(layer.agent) ?? {}
    layer.agent = { ...agent, model }
  })
}

/** Persists the user's TUI choices as global CLI defaults. */
export async function persistCliPreferences(input: PersistCliPreferencesInput): Promise<string> {
  return writeGlobalConfig(input.sparkHome, (layer) => {
    const agent = asRecord(layer.agent) ?? {}
    layer.agent = {
      ...agent,
      permission_mode: input.permissionMode,
      reasoning_effort: input.reasoningEffort,
    }
  })
}

/**
 * Read-merge-validate-atomically-write helper shared by every global config
 * mutation: the temp file lives in the same directory as the target so the
 * rename never crosses filesystems, and the merged result must still satisfy
 * the config schema or nothing is written.
 */
async function writeGlobalConfig(
  sparkHome: string,
  mutate: (layer: Record<string, unknown>) => void,
): Promise<string> {
  const configPath = resolve(sparkHome, 'config.toml')
  const existing = await readLayer(configPath)
  const mutated: Record<string, unknown> = structuredClone(existing.layer)
  mutate(mutated)
  try {
    ModelConfigSchema.parse(mutated)
  } catch (error) {
    throw new ModelConfigError(
      `Updating ${configPath} would produce an invalid config: ${formatZodError(error)}`,
      { cause: error },
    )
  }

  await writeTomlLayerAtomic(configPath, mutated)
  return configPath
}

interface LoadedModelContext {
  readonly config: ModelConfig
  readonly environment: NodeJS.ProcessEnv
  readonly platform: PlatformModelSnapshot | undefined
  readonly host: Awaited<ReturnType<typeof discoverSparkWorkHost>>
  readonly projectLayer: Record<string, unknown>
  readonly globalPath: string
  readonly projectPath: string
  readonly globalExists: boolean
  readonly projectExists: boolean
}

async function loadModelContext(options: LoadModelConfigOptions): Promise<LoadedModelContext> {
  const environment = options.env ?? process.env
  const sparkHome = resolve(environment.SPARK_HOME ?? resolve(homedir(), '.spark'))
  const globalPath = resolve(options.globalConfigPath ?? resolve(sparkHome, 'config.toml'))
  const projectPath = resolve(
    options.projectConfigPath ?? resolve(options.cwd, '.spark', 'config.toml'),
  )
  const global = await readLayer(globalPath)
  const project =
    projectPath === globalPath ? { layer: {}, exists: false } : await readLayer(projectPath)
  const merged = mergeConfigLayers(global.layer, project.layer, environment)
  let config: ModelConfig
  try {
    config = ModelConfigSchema.parse(merged)
  } catch (error) {
    throw new ModelConfigError(`Invalid Spark model configuration: ${formatZodError(error)}`, {
      cause: error,
    })
  }
  const host = await discoverSparkWorkHost({
    sparkHome,
    ...(options.sparkWorkBridgePath ? { descriptorPath: options.sparkWorkBridgePath } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })
  // Platform models come from the stored bootstrap binding, never a network
  // call: selection must work offline once `spark login` bootstrapped once.
  const platform = await readPlatformModelSnapshot(sparkHome).catch(() => undefined)
  return {
    config,
    environment,
    platform,
    host,
    projectLayer: project.layer,
    globalPath,
    projectPath,
    globalExists: global.exists,
    projectExists: project.exists,
  }
}

interface NoModelState {
  readonly host: Awaited<ReturnType<typeof discoverSparkWorkHost>>
  readonly globalPath: string
  readonly projectPath: string
  readonly globalExists: boolean
  readonly projectExists: boolean
}

function noModelSelectedError(state: NoModelState): ModelConfigError {
  const hostDiagnostic = state.host.diagnostic
    ? ` SparkWork discovery: ${state.host.diagnostic}`
    : ''
  if (state.host.catalog) {
    const sample = state.host.catalog.routes
      .slice(0, 3)
      .map((route) => route.routeId)
      .join(', ')
    return new ModelConfigError(
      `SparkWork is connected with ${state.host.catalog.routes.length} model(s) but none is marked default. ` +
        `Set a default provider and model in SparkWork, or pass --model <route-id>${sample ? ` (for example: ${sample})` : ''}.` +
        ' Run `spark models` to list every route id.',
    )
  }
  if (!state.globalExists && !state.projectExists) {
    return new ModelConfigError(
      `No model is available. Start SparkWork so its configured models are discovered automatically, ` +
        `or run \`spark init\` to create ${state.globalPath}, or pass --model.${hostDiagnostic}`,
    )
  }
  return new ModelConfigError(
    `No model is selected. Configure a model in SparkWork, set [agent].model in ${state.projectPath} or ${state.globalPath}, or pass --model.${hostDiagnostic}`,
  )
}

function selectedModel(layer: Readonly<Record<string, unknown>>): string | undefined {
  const value = asRecord(layer.agent)?.model
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

interface ConfigLayer {
  readonly layer: Record<string, unknown>
  readonly exists: boolean
}

async function readLayer(path: string): Promise<ConfigLayer> {
  try {
    return await readTomlLayer(path)
  } catch (error) {
    throw new ModelConfigError(errorMessage(error), { cause: error })
  }
}

function mergeConfigLayers(
  globalLayer: Record<string, unknown>,
  projectLayer: Record<string, unknown>,
  environment: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const merged = deepMergeLayers(globalLayer, projectLayer)
  const agent = asRecord(merged.agent) ?? {}
  if (environment.SPARK_MODEL) agent.model = environment.SPARK_MODEL
  const failover = parseFailover(environment.SPARK_FAILOVER_MODELS)
  if (failover) agent.failover = failover
  merged.agent = agent
  return merged
}

function registerConfiguredModel(
  registry: ModelRegistry,
  id: string,
  config: ModelConfig,
  environment: NodeJS.ProcessEnv,
): void {
  const model = config.models[id]
  if (!model) throw new ModelConfigError(`Model ${id} is not defined under [models.${id}]`)
  const provider = config.providers[model.provider]
  if (!provider) {
    throw new ModelConfigError(
      `Model ${id} references unknown provider ${model.provider}; define [providers.${model.provider}]`,
    )
  }
  const apiKeyEnv = provider.api_key_env ?? defaultKeyEnvironment(provider.protocol)
  const keyEnvironmentNames = credentialEnvironmentNames(provider.protocol, apiKeyEnv)
  const apiKey = keyEnvironmentNames
    .map((name) => environment[name])
    .find((value): value is string => typeof value === 'string' && value.length > 0)
  if (apiKey === undefined) {
    throw new ModelConfigError(
      `Provider ${model.provider} requires credential environment variable ${keyEnvironmentNames.join(' or ')}`,
    )
  }
  registry.registerHttp({
    id,
    providerId: model.provider,
    protocol: provider.protocol,
    model: model.model,
    apiKey,
    ...(provider.base_url ? { baseUrl: provider.base_url } : {}),
    ...(model.capabilities
      ? {
          capabilities: {
            ...(model.capabilities.tools === undefined ? {} : { tools: model.capabilities.tools }),
            ...(model.capabilities.parallel_tool_calls === undefined
              ? {}
              : { parallelToolCalls: model.capabilities.parallel_tool_calls }),
            ...(model.capabilities.thinking === undefined
              ? {}
              : { thinking: model.capabilities.thinking }),
            ...(model.capabilities.prompt_caching === undefined
              ? {}
              : { promptCaching: model.capabilities.prompt_caching }),
            ...(model.capabilities.assistant_prefill === undefined
              ? {}
              : { assistantPrefill: model.capabilities.assistant_prefill }),
            ...(model.capabilities.images === undefined
              ? {}
              : { images: model.capabilities.images }),
          },
        }
      : {}),
    ...(model.context_window === undefined ? {} : { contextWindowTokens: model.context_window }),
    ...(model.max_tokens === undefined ? {} : { maxOutputTokens: model.max_tokens }),
  })
}

function registerModelRoute(
  registry: ModelRegistry,
  id: string,
  config: ModelConfig,
  environment: NodeJS.ProcessEnv,
  host: SparkWorkHostCatalog | undefined,
  platform: PlatformModelSnapshot | undefined,
  fetcher: FetchLike | undefined,
): void {
  if (config.models[id]) {
    registerConfiguredModel(registry, id, config, environment)
    return
  }
  if (platform) {
    const platformModel = platformModelId(id)
    if (platform.models.includes(platformModel)) {
      // The platform gateway speaks the Anthropic wire protocol and appends
      // /v1/messages itself, so the bare gateway URL is the correct base.
      registry.registerHttp({
        id,
        providerId: 'platform',
        protocol: 'anthropic-messages',
        model: platformModel,
        baseUrl: platform.baseUrl,
        apiKey: platform.apiKey,
        contextWindowTokens: PLATFORM_CONTEXT_WINDOW_TOKENS,
        maxOutputTokens: PLATFORM_MAX_OUTPUT_TOKENS,
        ...(fetcher ? { fetch: fetcher } : {}),
      })
      return
    }
  }
  const hostRoute = host ? resolveSparkWorkRoute(host, id) : undefined
  if (!host || !hostRoute) {
    throw new ModelConfigError(
      `Model ${id} is not defined locally, available from the platform, or available from SparkWork`,
    )
  }
  registerSparkWorkModel(registry, id, host, hostRoute, fetcher)
}

function platformModelId(id: string): string {
  return id.startsWith('platform:') ? id.slice('platform:'.length) : id
}

function registerSparkWorkModel(
  registry: ModelRegistry,
  id: string,
  host: SparkWorkHostCatalog,
  route: SparkWorkHostRoute,
  fetcher: FetchLike | undefined,
): void {
  registry.registerHttp({
    id,
    providerId: `sparkwork:${route.providerId}`,
    protocol: route.protocol,
    model: route.model,
    baseUrl: sparkWorkProxyBaseUrl(host, route),
    apiKey: host.token,
    ...(route.contextWindow === undefined ? {} : { contextWindowTokens: route.contextWindow }),
    ...(route.maxOutputTokens === undefined ? {} : { maxOutputTokens: route.maxOutputTokens }),
    ...(fetcher ? { fetch: fetcher } : {}),
  })
}

const ANTHROPIC_KEY_ENVIRONMENT = 'ANTHROPIC_API_KEY'
const ANTHROPIC_KEY_ENVIRONMENT_FALLBACK = 'ANTHROPIC_AUTH_TOKEN'

function defaultKeyEnvironment(protocol: ModelProtocol): string {
  return protocol === 'anthropic-messages' ? ANTHROPIC_KEY_ENVIRONMENT : 'OPENAI_API_KEY'
}

/**
 * Anthropic 兼容渠道的凭据变量名没有统一口径：Claude Code 官方文档写
 * `ANTHROPIC_API_KEY`，而多数第三方厂商 / 中转站文档只让导出 `ANTHROPIC_AUTH_TOKEN`。
 * 默认名取不到时回退到另一个名字，避免「用户按厂商文档只设了 AUTH_TOKEN」直接
 * fail closed。显式配置了非默认变量名时不做回退，保持「配什么用什么」的严格语义。
 */
function credentialEnvironmentNames(protocol: ModelProtocol, apiKeyEnv: string): string[] {
  if (protocol !== 'anthropic-messages') return [apiKeyEnv]
  if (apiKeyEnv !== ANTHROPIC_KEY_ENVIRONMENT) return [apiKeyEnv]
  return [ANTHROPIC_KEY_ENVIRONMENT, ANTHROPIC_KEY_ENVIRONMENT_FALLBACK]
}

function parseFailover(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatZodError(error: unknown): string {
  if (!(error instanceof z.ZodError)) return errorMessage(error)
  return error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ')
}
