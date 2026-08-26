import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { parse } from 'smol-toml'
import { z } from 'zod'

import type { LlmService } from '../seams.js'
import type { FetchLike } from '../llm/http/client.js'
import { ModelRegistry, type ModelProtocol } from '../llm/registry.js'
import {
  discoverSparkWorkHost,
  resolveSparkWorkRoute,
  sparkWorkProxyBaseUrl,
  type SparkWorkHostCatalog,
  type SparkWorkHostRoute,
} from './sparkwork-host.js'

const ProtocolSchema = z.enum(['anthropic-messages', 'openai-responses'])
const CapabilitiesSchema = z
  .object({
    tools: z.boolean().optional(),
    parallel_tool_calls: z.boolean().optional(),
    thinking: z.boolean().optional(),
    prompt_caching: z.boolean().optional(),
    assistant_prefill: z.boolean().optional(),
    images: z.boolean().optional(),
  })
  .strict()
const ProviderSchema = z
  .object({
    protocol: ProtocolSchema,
    base_url: z.url().optional(),
    api_key_env: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/u)
      .optional(),
  })
  .strict()
const ModelSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    capabilities: CapabilitiesSchema.optional(),
  })
  .strict()
const AgentSchema = z
  .object({
    model: z.string().min(1).optional(),
    failover: z.array(z.string().min(1)).default([]),
    max_retries: z.number().int().min(0).max(10).default(2),
  })
  .strict()
  .default({ failover: [], max_retries: 2 })
const ModelConfigSchema = z
  .object({
    agent: AgentSchema,
    providers: z.record(z.string(), ProviderSchema).default({}),
    models: z.record(z.string(), ModelSchema).default({}),
  })
  .strict()

type ModelConfig = z.output<typeof ModelConfigSchema>

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
}

export interface ConfiguredModelCatalogEntry {
  readonly id: string
  readonly source: 'local' | 'sparkwork'
  readonly providerId: string
  readonly providerName: string
  readonly protocol: ModelProtocol
  readonly model: string
  readonly selected: boolean
}

export interface ConfiguredModelCatalog {
  readonly entries: readonly ConfiguredModelCatalogEntry[]
  readonly selectedModel?: string
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
  const { config, environment, host, projectLayer, globalPath, projectPath, globalExists, projectExists } =
    await loadModelContext(options)
  const localSelected = options.model ?? environment.SPARK_MODEL ?? selectedModel(projectLayer)
  const modelId = localSelected ?? host.catalog?.defaultRoute ?? config.agent.model
  if (!modelId) {
    throw noModelSelectedError({ host, globalPath, projectPath, globalExists, projectExists })
  }
  const failover = parseFailover(environment.SPARK_FAILOVER_MODELS) ?? config.agent.failover
  const route = [...new Set([modelId, ...failover])]
  const registry = new ModelRegistry()
  for (const id of route) {
    if (!config.models[id] && !host.catalog && host.diagnostic) {
      throw new ModelConfigError(`Model ${id} is unavailable. ${host.diagnostic}`)
    }
    registerModelRoute(registry, id, config, environment, host.catalog, options.fetch)
  }
  return {
    service: registry.createRoute(route, { retry: { maxRetries: config.agent.max_retries } }),
    modelId,
    route,
    configSnapshot: {
      ...structuredClone(config),
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
  const { config, environment, host, projectLayer } = await loadModelContext(options)
  const selected =
    options.model ??
    environment.SPARK_MODEL ??
    selectedModel(projectLayer) ??
    host.catalog?.defaultRoute ??
    config.agent.model
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
    })) ?? []
  return Object.freeze({
    entries: Object.freeze([...hostEntries, ...localEntries]),
    ...(selected ? { selectedModel: selected } : {}),
    sparkWorkConnected: host.catalog !== undefined,
    sparkWorkStaleBridgeDescriptors: host.staleBridgeDescriptors,
    ...(host.diagnostic ? { sparkWorkDiagnostic: host.diagnostic } : {}),
  })
}

interface LoadedModelContext {
  readonly config: ModelConfig
  readonly environment: NodeJS.ProcessEnv
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
  const project = projectPath === globalPath ? { layer: {}, exists: false } : await readLayer(projectPath)
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
  return {
    config,
    environment,
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
  const hostDiagnostic = state.host.diagnostic ? ` SparkWork discovery: ${state.host.diagnostic}` : ''
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
  let source: string
  try {
    source = await readFile(path, 'utf8')
  } catch (error) {
    if (isMissing(error)) return { layer: {}, exists: false }
    throw new ModelConfigError(`Unable to read Spark config ${path}`, { cause: error })
  }
  try {
    const value: unknown = parse(source)
    return { layer: asRecord(value) ?? {}, exists: true }
  } catch (error) {
    throw new ModelConfigError(`Invalid TOML in ${path}: ${message(error)}`, { cause: error })
  }
}

function mergeConfigLayers(
  globalLayer: Record<string, unknown>,
  projectLayer: Record<string, unknown>,
  environment: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const merged = deepMerge(globalLayer, projectLayer)
  const agent = asRecord(merged.agent) ?? {}
  if (environment.SPARK_MODEL) agent.model = environment.SPARK_MODEL
  const failover = parseFailover(environment.SPARK_FAILOVER_MODELS)
  if (failover) agent.failover = failover
  merged.agent = agent
  return merged
}

function deepMerge(
  lower: Readonly<Record<string, unknown>>,
  upper: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = structuredClone(lower)
  for (const [key, value] of Object.entries(upper)) {
    const previous = asRecord(result[key])
    const next = asRecord(value)
    result[key] = previous && next ? deepMerge(previous, next) : structuredClone(value)
  }
  return result
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
  const apiKey = environment[apiKeyEnv]
  if (!apiKey) {
    throw new ModelConfigError(
      `Provider ${model.provider} requires credential environment variable ${apiKeyEnv}`,
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
  })
}

function registerModelRoute(
  registry: ModelRegistry,
  id: string,
  config: ModelConfig,
  environment: NodeJS.ProcessEnv,
  host: SparkWorkHostCatalog | undefined,
  fetcher: FetchLike | undefined,
): void {
  if (config.models[id]) {
    registerConfiguredModel(registry, id, config, environment)
    return
  }
  const hostRoute = host ? resolveSparkWorkRoute(host, id) : undefined
  if (!host || !hostRoute) {
    throw new ModelConfigError(`Model ${id} is not defined locally or available from SparkWork`)
  }
  registerSparkWorkModel(registry, id, host, hostRoute, fetcher)
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
    ...(fetcher ? { fetch: fetcher } : {}),
  })
}

function defaultKeyEnvironment(protocol: ModelProtocol): string {
  return protocol === 'anthropic-messages' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'
}

function parseFailover(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function isMissing(error: unknown): boolean {
  return asRecord(error)?.code === 'ENOENT'
}

function formatZodError(error: unknown): string {
  if (!(error instanceof z.ZodError)) return message(error)
  return error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ')
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
