import type { ConnectorAccount } from '@spark/protocol'
import type {
  PluginSdkCredentials,
  PluginSdkHttpClient,
  PluginSdkPolicy,
  PluginSdkRuntimeContext,
  PluginSdkRuntimeDefinition,
} from './index.js'

export function createMockAccount(overrides: Partial<ConnectorAccount> = {}): ConnectorAccount {
  const now = new Date().toISOString()
  return {
    id: 'test-account',
    pluginId: 'com.example.test',
    runtimeId: 'test-runtime',
    provider: 'test',
    externalAccountId: 'external-test-account',
    displayName: 'Test account',
    authMethod: 'none',
    status: 'connected',
    enabled: true,
    grantedScopes: [],
    enabledCapabilities: [],
    resourceScope: {},
    config: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createMockRuntimeContext(
  overrides: Partial<PluginSdkRuntimeContext> = {},
): PluginSdkRuntimeContext {
  const http: PluginSdkHttpClient = {
    async request() {
      return {} as never
    },
    async get() {
      return {} as never
    },
  }
  const policy: PluginSdkPolicy = {
    requireCapability() {},
    requireResource() {},
    requireConfirmation() {},
  }
  const credentials: PluginSdkCredentials = {
    async withAccessToken(callback) {
      return callback('mock-access-token')
    },
  }
  return {
    account: createMockAccount(),
    http,
    policy,
    credentials,
    ...overrides,
  }
}

export async function runRuntimeContract(runtime: PluginSdkRuntimeDefinition): Promise<void> {
  const tools = runtime.listTools()
  if (tools.length === 0) throw new Error('Runtime must expose at least one tool')
  const names = new Set<string>()
  for (const tool of tools) {
    if (names.has(tool.name)) throw new Error(`Duplicate runtime tool: ${tool.name}`)
    names.add(tool.name)
    if (!tool.inputSchema || typeof tool.inputSchema !== 'object')
      throw new Error(`Tool ${tool.name} has no JSON input schema`)
    if (tool.description.includes('access-token') || tool.description.includes('refresh-token'))
      throw new Error(`Tool ${tool.name} leaks credential terminology`)
  }
  await runtime.healthCheck(createMockRuntimeContext())
}
