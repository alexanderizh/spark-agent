import { z } from 'zod'
import type { SparkDatabase } from '@spark/storage'
import { AgentRepository, ProviderProfileRepository } from '@spark/storage'
import { fetchJson } from '@spark/shared'
import { resolveProviderApiKey } from '../provider-credential-resolver.js'
import type {
  ToolHostCapabilityContext,
  ToolHostCapabilityDefinition,
} from './tool-host-capability-broker.js'
import { ToolHostCapabilityBroker } from './tool-host-capability-broker.js'

export interface ToolPackageFileUploadInput {
  path: string
  fileName?: string | undefined
  mimeType?: string | undefined
  purpose?: string | undefined
}

export interface ToolPackageFilePresentInput {
  files: Array<{ path: string; title?: string | undefined }>
}

export interface ToolPackageBuiltInCapabilityDeps {
  db: SparkDatabase
  uploadFile?: (
    context: ToolHostCapabilityContext,
    input: ToolPackageFileUploadInput,
  ) => Promise<unknown>
  presentFiles?: (
    context: ToolHostCapabilityContext,
    input: ToolPackageFilePresentInput,
  ) => Promise<unknown>
}

const ProviderSelectionSchema = z.object({
  providerId: z.string().min(1).max(160).optional(),
  model: z.string().min(1).max(300).optional(),
})

const ModelInvokeSchema = ProviderSelectionSchema.extend({
  prompt: z.string().min(1).max(200_000),
  system: z.string().max(100_000).optional(),
  maxTokens: z.number().int().min(1).max(32_768).default(4_096),
  temperature: z.number().min(0).max(2).optional(),
})

const AgentInvokeSchema = z.object({
  agentId: z.string().min(1).max(160),
  prompt: z.string().min(1).max(200_000),
  maxTokens: z.number().int().min(1).max(32_768).default(4_096),
  temperature: z.number().min(0).max(2).optional(),
})

const FileUploadSchema = z.object({
  path: z.string().min(1).max(4_096),
  fileName: z.string().min(1).max(500).optional(),
  mimeType: z.string().min(1).max(200).optional(),
  purpose: z.string().min(1).max(100).optional(),
})

const FilePresentSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(4_096),
        title: z.string().min(1).max(300).optional(),
      }),
    )
    .min(1)
    .max(50),
})

export function registerToolPackageBuiltInCapabilities(
  broker: ToolHostCapabilityBroker,
  deps: ToolPackageBuiltInCapabilityDeps,
): () => void {
  const providers = new ProviderProfileRepository(deps.db)
  const agents = new AgentRepository(deps.db)
  const definitions: ToolHostCapabilityDefinition[] = [
    {
      name: 'models.list',
      invoke: async () => ({ models: listModels(providers) }),
    },
    {
      name: 'models.get',
      invoke: async (_context, input) => {
        const selection = ProviderSelectionSchema.parse(input)
        return publicModelSelection(resolveModelSelection(providers, selection))
      },
    },
    {
      name: 'models.invoke',
      invoke: async (_context, input) => {
        const request = ModelInvokeSchema.parse(input)
        const selection = resolveModelSelection(providers, request)
        const text = await invokeModel(selection.provider, selection.model, request)
        return { ...publicModelSelection(selection), text }
      },
    },
    {
      name: 'agents.list',
      invoke: async () => ({ agents: agents.list().map(publicAgent) }),
    },
    {
      name: 'agents.get',
      invoke: async (_context, input) => {
        const { agentId } = z.object({ agentId: z.string().min(1).max(160) }).parse(input)
        const agent = agents.get(agentId)
        if (agent == null) throw new Error(`Spark Agent not found: ${agentId}`)
        return publicAgent(agent)
      },
    },
    {
      name: 'agents.invoke',
      invoke: async (_context, input) => {
        const request = AgentInvokeSchema.parse(input)
        const agent = agents.get(request.agentId)
        if (agent == null || !agent.enabled) {
          throw new Error(`Spark Agent is unavailable: ${request.agentId}`)
        }
        const selection = resolveModelSelection(providers, {
          ...(agent.providerProfileId != null ? { providerId: agent.providerProfileId } : {}),
          ...(agent.modelId != null ? { model: agent.modelId } : {}),
        })
        const text = await invokeModel(selection.provider, selection.model, {
          prompt: request.prompt,
          ...(agent.prompt ? { system: agent.prompt } : {}),
          maxTokens: request.maxTokens,
          ...(request.temperature != null ? { temperature: request.temperature } : {}),
        })
        return {
          agent: publicAgent(agent),
          executionMode: 'single-turn',
          ...publicModelSelection(selection),
          text,
        }
      },
    },
  ]
  const uploadFile = deps.uploadFile
  if (uploadFile != null) {
    definitions.push({
      name: 'files.upload',
      invoke: async (context, input) => uploadFile(context, FileUploadSchema.parse(input)),
    })
  }
  const presentFiles = deps.presentFiles
  if (presentFiles != null) {
    definitions.push({
      name: 'files.present',
      invoke: async (context, input) => presentFiles(context, FilePresentSchema.parse(input)),
    })
  }
  const unregister = definitions.map((definition) => broker.register(definition))
  return () => {
    for (const dispose of unregister.reverse()) dispose()
  }
}

type ProviderRow = NonNullable<ReturnType<ProviderProfileRepository['get']>>

interface ProviderConfig {
  apiEndpoint?: string
  defaultModel?: string
  modelIds?: string[]
}

function listModels(providers: ProviderProfileRepository) {
  return providers
    .listAll()
    .filter((provider) => provider.enabled === 1)
    .flatMap((provider) => {
      const config = parseProviderConfig(provider)
      const ids = uniqueStrings([
        ...(config.modelIds ?? []),
        ...(config.defaultModel ? [config.defaultModel] : []),
      ])
      return ids.map((model) => ({
        providerId: provider.id,
        providerName: provider.name,
        providerType: provider.provider_type,
        model,
        default: config.defaultModel === model,
      }))
    })
}

function resolveModelSelection(
  providers: ProviderProfileRepository,
  selection: { providerId?: string | undefined; model?: string | undefined },
): { provider: ProviderRow; model: string } {
  const provider =
    (selection.providerId != null ? providers.get(selection.providerId) : providers.getDefault()) ??
    providers.listAll().find((candidate) => candidate.enabled === 1) ??
    null
  if (provider == null || provider.enabled !== 1) {
    throw new Error('No enabled Spark model Provider is available')
  }
  const config = parseProviderConfig(provider)
  const model = selection.model ?? config.defaultModel ?? config.modelIds?.[0]
  if (model == null || model.trim().length === 0) {
    throw new Error(`Spark model is not configured for Provider: ${provider.id}`)
  }
  if (
    config.modelIds != null &&
    config.modelIds.length > 0 &&
    !config.modelIds.includes(model) &&
    config.defaultModel !== model
  ) {
    throw new Error(`Spark model is not registered on Provider ${provider.id}: ${model}`)
  }
  return { provider, model }
}

async function invokeModel(
  provider: ProviderRow,
  model: string,
  request: {
    prompt: string
    system?: string | undefined
    maxTokens: number
    temperature?: number | undefined
  },
): Promise<string> {
  if (provider.provider_type === 'local-cli' || provider.provider_type === 'local-codex-cli') {
    throw new Error(`Provider does not expose an HTTP model endpoint: ${provider.id}`)
  }
  const config = parseProviderConfig(provider)
  const apiKey = await resolveProviderApiKey(provider)
  const anthropic = provider.provider_type === 'anthropic'
  const endpoint = anthropic
    ? anthropicMessagesEndpoint(config.apiEndpoint)
    : openAiChatEndpoint(config.apiEndpoint)
  const response = await fetchJson<{
    content?: Array<{ type?: string; text?: string }>
    choices?: Array<{ message?: { content?: string } }>
  }>(endpoint, {
    method: 'POST',
    headers: anthropic
      ? {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
          'anthropic-version': '2023-06-01',
        }
      : {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
    body: JSON.stringify(
      anthropic
        ? {
            model,
            max_tokens: request.maxTokens,
            ...(request.system ? { system: request.system } : {}),
            ...(request.temperature != null ? { temperature: request.temperature } : {}),
            messages: [{ role: 'user', content: request.prompt }],
          }
        : {
            model,
            max_tokens: request.maxTokens,
            ...(request.temperature != null ? { temperature: request.temperature } : {}),
            messages: [
              ...(request.system ? [{ role: 'system', content: request.system }] : []),
              { role: 'user', content: request.prompt },
            ],
          },
    ),
    timeoutMs: 120_000,
  })
  const text = anthropic
    ? response.content
        ?.filter((item) => item.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text)
        .join('\n')
    : response.choices?.[0]?.message?.content
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('Spark model returned no text output')
  }
  return text
}

function parseProviderConfig(provider: ProviderRow): ProviderConfig {
  try {
    const parsed = JSON.parse(provider.config_json) as Record<string, unknown>
    return {
      ...(typeof parsed.apiEndpoint === 'string' ? { apiEndpoint: parsed.apiEndpoint } : {}),
      ...(typeof parsed.defaultModel === 'string' ? { defaultModel: parsed.defaultModel } : {}),
      ...(Array.isArray(parsed.modelIds)
        ? { modelIds: parsed.modelIds.filter((item): item is string => typeof item === 'string') }
        : {}),
    }
  } catch {
    return {}
  }
}

function publicAgent(agent: ReturnType<AgentRepository['list']>[number]) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    builtIn: agent.builtIn,
    enabled: agent.enabled,
    providerProfileId: agent.providerProfileId ?? null,
    modelId: agent.modelId ?? null,
  }
}

function publicModelSelection(selection: { provider: ProviderRow; model: string }) {
  return {
    providerId: selection.provider.id,
    providerName: selection.provider.name,
    providerType: selection.provider.provider_type,
    model: selection.model,
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function openAiChatEndpoint(apiEndpoint?: string): string {
  const base = (apiEndpoint?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '')
  if (base.endsWith('/chat/completions')) return base
  if (base.endsWith('/responses')) return `${base.slice(0, -'/responses'.length)}/chat/completions`
  if (/\/v\d+$/i.test(base)) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

function anthropicMessagesEndpoint(apiEndpoint?: string): string {
  const base = (apiEndpoint?.trim() || 'https://api.anthropic.com').replace(/\/+$/, '')
  if (base.endsWith('/messages')) return base
  if (/\/v\d+$/i.test(base)) return `${base}/messages`
  return `${base}/v1/messages`
}
