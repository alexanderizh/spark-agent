import { z } from 'zod'
import type {
  ConnectorAccount,
  ConnectorAuthMethod,
  ConnectorCapabilityKind,
  ConnectorRuntimeDescriptor,
  RuntimeConnectRequest,
  RuntimeEffect,
  RuntimeHealth,
  RuntimeIdempotency,
  RuntimeRisk,
  RuntimeToolDefinition,
} from '@spark/protocol'

export type JsonSchema = Record<string, unknown>
export type InputSchema<T> = z.ZodType<T> | JsonSchema

export interface PluginSdkHttpRequest {
  path: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  query?: Record<string, string | number | boolean | undefined>
  json?: unknown
  headers?: Record<string, string>
}

export interface PluginSdkHttpClient {
  request<T = unknown>(request: PluginSdkHttpRequest): Promise<T>
  get<T = unknown>(path: string, query?: PluginSdkHttpRequest['query']): Promise<T>
}

export interface PluginSdkPolicy {
  requireCapability(capability: string): void
  requireResource(resourceType: string, resourceId: string): void
  requireConfirmation(): void
}

export interface PluginSdkCredentials {
  withAccessToken<T>(callback: (token: string) => Promise<T>): Promise<T>
}

export interface PluginSdkRuntimeContext {
  account: ConnectorAccount
  http: PluginSdkHttpClient
  policy: PluginSdkPolicy
  credentials: PluginSdkCredentials
}

export interface PluginSdkConnectContext {
  request: RuntimeConnectRequest
  http: PluginSdkHttpClient
  getSecret(name: string): string | null
}

export interface PluginSdkToolDefinition<TInput> {
  runtime: RuntimeToolDefinition
  parse(input: unknown): TInput
  handler(ctx: PluginSdkRuntimeContext, input: TInput): Promise<unknown>
}

export interface DefineToolOptions<TInput> {
  name: string
  title: string
  description: string
  input: InputSchema<TInput>
  requiredCapabilities?: ConnectorCapabilityKind[]
  risk: RuntimeRisk
  effect: RuntimeEffect
  idempotency: RuntimeIdempotency
  preview?: (input: TInput) => Record<string, unknown>
  handler(ctx: PluginSdkRuntimeContext, input: TInput): Promise<unknown>
}

export interface PluginSdkRuntimeDescriptor extends Omit<ConnectorRuntimeDescriptor, 'execution'> {
  execution: ConnectorRuntimeDescriptor['execution']
}

export interface DefineConnectorRuntimeOptions {
  descriptor: PluginSdkRuntimeDescriptor
  tools: Array<PluginSdkToolDefinition<unknown>>
  connect?: (
    ctx: PluginSdkConnectContext,
    request: RuntimeConnectRequest,
  ) => Promise<{
    externalAccountId: string
    displayName: string
    avatarUrl?: string
    grantedScopes?: string[]
    config?: Record<string, unknown>
    resourceScope?: Record<string, unknown>
    enabledCapabilities?: string[]
    credential?: {
      accessToken: string
      refreshToken?: string
      expiresAt?: string
      scopes?: string[]
    }
  }>
  healthCheck?: (ctx: PluginSdkRuntimeContext) => Promise<RuntimeHealth>
}

export interface PluginSdkRuntimeDefinition {
  descriptor: ConnectorRuntimeDescriptor
  tools: Array<PluginSdkToolDefinition<unknown>>
  connect?: DefineConnectorRuntimeOptions['connect']
  healthCheck: (ctx: PluginSdkRuntimeContext) => Promise<RuntimeHealth>
  listTools(): RuntimeToolDefinition[]
  invokeTool(ctx: PluginSdkRuntimeContext, toolName: string, input: unknown): Promise<unknown>
}

export function defineTool<TInput>(
  options: DefineToolOptions<TInput>,
): PluginSdkToolDefinition<TInput> {
  const inputSchema = toJsonSchema(options.input)
  const preview = options.preview
  const runtime: RuntimeToolDefinition = {
    name: options.name,
    title: options.title,
    description: options.description,
    inputSchema,
    requiredCapabilities: options.requiredCapabilities ?? [],
    risk: options.risk,
    effect: options.effect,
    idempotency: options.idempotency,
    ...(preview !== undefined ? { preview: (input: unknown) => preview(input as TInput) } : {}),
  }
  validateTool(runtime)
  return {
    runtime,
    parse: (input) => parseInput(options.input, input),
    handler: options.handler,
  }
}

export function defineConnectorRuntime(
  options: DefineConnectorRuntimeOptions,
): PluginSdkRuntimeDefinition {
  const names = new Set<string>()
  for (const tool of options.tools) {
    if (names.has(tool.runtime.name))
      throw new Error(`Duplicate runtime tool: ${tool.runtime.name}`)
    names.add(tool.runtime.name)
  }
  const descriptor = validateDescriptor(options.descriptor)
  const healthCheck =
    options.healthCheck ??
    (async () => ({ status: 'healthy' as const, checkedAt: new Date().toISOString() }))
  return {
    descriptor,
    tools: options.tools,
    ...(options.connect !== undefined ? { connect: options.connect } : {}),
    healthCheck,
    listTools: () => options.tools.map((tool) => tool.runtime),
    invokeTool: async (ctx, toolName, input) => {
      const tool = options.tools.find((item) => item.runtime.name === toolName)
      if (tool == null) throw new Error(`Runtime tool not found: ${toolName}`)
      return tool.handler(ctx, tool.parse(input))
    },
  }
}

function toJsonSchema<T>(schema: InputSchema<T>): JsonSchema {
  if (isZodSchema(schema)) {
    const result = z.toJSONSchema(schema, {
      target: 'draft-7',
      io: 'input',
      reused: 'inline',
      unrepresentable: 'any',
    }) as JsonSchema
    delete result.$schema
    return result
  }
  return structuredClone(schema)
}

function parseInput<T>(schema: InputSchema<T>, input: unknown): T {
  return isZodSchema(schema) ? schema.parse(input) : (input as T)
}

function isZodSchema<T>(schema: InputSchema<T>): schema is z.ZodType<T> {
  return schema != null && typeof schema === 'object' && 'safeParse' in schema
}

function validateTool(tool: RuntimeToolDefinition): void {
  if (!/^[a-z0-9][a-z0-9_-]{1,95}$/.test(tool.name))
    throw new Error(`Invalid runtime tool name: ${tool.name}`)
  if (tool.description.trim().length === 0) throw new Error(`Tool ${tool.name} needs a description`)
  if (tool.risk === 'read' && tool.effect !== 'read')
    throw new Error(`Read tool ${tool.name} must use read effect`)
  if (tool.risk === 'destructive' && tool.idempotency !== 'unsafe')
    throw new Error(`Destructive tool ${tool.name} must use unsafe idempotency`)
}

function validateDescriptor(descriptor: PluginSdkRuntimeDescriptor): ConnectorRuntimeDescriptor {
  if (!/^[a-z0-9][a-z0-9._-]{1,95}$/.test(descriptor.id))
    throw new Error(`Invalid runtime id: ${descriptor.id}`)
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(descriptor.toolNamespace))
    throw new Error(`Invalid runtime tool namespace: ${descriptor.toolNamespace}`)
  if (descriptor.pluginId.trim().length === 0) throw new Error('Runtime pluginId is required')
  if (descriptor.capabilities.some((capability) => capability.id.trim().length === 0))
    throw new Error('Runtime capability id cannot be empty')
  return {
    ...descriptor,
    authMethods: [...descriptor.authMethods] as ConnectorAuthMethod[],
    capabilities: descriptor.capabilities.map((capability) => ({
      ...capability,
      ...(capability.requiredScopes !== undefined
        ? { requiredScopes: [...capability.requiredScopes] }
        : {}),
    })),
  }
}

export type { ConnectorRuntimeDescriptor, RuntimeToolDefinition }
