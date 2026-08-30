import type { LlmService } from '../seams.js';
import { AnthropicMessagesService } from './anthropic/messages.js';
import type { FetchLike } from './http/client.js';
import { OpenAiResponsesService } from './openai/responses.js';
import { ResilientLlmService, type ResilientLlmOptions } from './resilience.js';
import type { ModelCapabilities } from './types.js';

export type ModelProtocol = 'anthropic-messages' | 'openai-responses';

export interface ModelDescriptor {
  readonly id: string;
  readonly providerId: string;
  readonly protocol: ModelProtocol;
  readonly model: string;
  readonly baseUrl: string;
  readonly capabilities: ModelCapabilities;
}

export interface HttpModelRegistration {
  readonly id: string;
  readonly providerId: string;
  readonly protocol: ModelProtocol;
  readonly model: string;
  readonly baseUrl?: string;
  readonly apiKey: string;
  readonly capabilities?: Partial<ModelCapabilities>;
  readonly fetch?: FetchLike;
}

interface RegisteredModel {
  readonly descriptor: ModelDescriptor;
  readonly create: () => LlmService;
}

export class ModelRegistry {
  readonly #models = new Map<string, RegisteredModel>();

  register(descriptor: ModelDescriptor, create: () => LlmService): () => void {
    if (this.#models.has(descriptor.id)) throw new Error(`Model already registered: ${descriptor.id}`);
    const registered = { descriptor: freezeDescriptor(descriptor), create };
    this.#models.set(descriptor.id, registered);
    return () => {
      if (this.#models.get(descriptor.id) === registered) this.#models.delete(descriptor.id);
    };
  }

  registerHttp(options: HttpModelRegistration): () => void {
    const baseUrl =
      options.baseUrl ??
      (options.protocol === 'anthropic-messages'
        ? 'https://api.anthropic.com'
        : 'https://api.openai.com/v1');
    const descriptor: ModelDescriptor = {
      id: options.id,
      providerId: options.providerId,
      protocol: options.protocol,
      model: options.model,
      baseUrl,
      capabilities: {
        ...defaultCapabilities(options.protocol),
        ...options.capabilities,
      },
    };
    return this.register(descriptor, () => {
      if (options.protocol === 'anthropic-messages') {
        return new AnthropicMessagesService({
          apiKey: options.apiKey,
          model: options.model,
          baseUrl,
          promptCaching: descriptor.capabilities.promptCaching,
          ...(options.fetch ? { fetch: options.fetch } : {}),
        });
      }
      return new OpenAiResponsesService({
        apiKey: options.apiKey,
        model: options.model,
        baseUrl,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
    });
  }

  get(id: string): ModelDescriptor | undefined {
    return this.#models.get(id)?.descriptor;
  }

  list(): readonly ModelDescriptor[] {
    return [...this.#models.values()].map((registered) => registered.descriptor);
  }

  create(id: string): LlmService {
    const registered = this.#models.get(id);
    if (!registered) throw new Error(`Unknown model: ${id}`);
    return registered.create();
  }

  createRoute(modelIds: readonly string[], options: Omit<ResilientLlmOptions, 'routes'> = {}): LlmService {
    if (modelIds.length === 0) throw new Error('At least one model id is required');
    return new ResilientLlmService({
      ...options,
      routes: modelIds.map((id) => ({ id, service: this.create(id) })),
    });
  }
}

export function defaultCapabilities(protocol: ModelProtocol): ModelCapabilities {
  return {
    tools: true,
    parallelToolCalls: true,
    thinking: true,
    promptCaching: true,
    assistantPrefill: false,
    images: false,
    ...(protocol === 'openai-responses' ? {} : {}),
  };
}

function freezeDescriptor(descriptor: ModelDescriptor): ModelDescriptor {
  return Object.freeze({
    ...descriptor,
    capabilities: Object.freeze({ ...descriptor.capabilities }),
  });
}
