import { z } from 'zod'

import {
  ContextSettingsSchema,
  McpSettingsSchema,
  MemorySettingsSchema,
  PermissionSettingsSchema,
  PlatformSettingsSchema,
  ToolSettingsSchema,
} from './settings-schema.js'

/**
 * Root schema for `~/.spark/config.toml` and `<cwd>/.spark/config.toml`.
 *
 * It lives in its own module so both the model runtime (`model-config.ts`) and
 * the CLI settings commands (`settings.ts`) validate against exactly the same
 * contract instead of drifting apart.
 */
const ProtocolSchema = z.enum(['anthropic-messages', 'openai-responses'])
const PermissionModeSchema = z.enum(['manual', 'auto', 'bypass'])
const ReasoningEffortSchema = z.enum(['off', 'low', 'medium', 'high', 'max'])
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
    /** Model-level limits for standalone CLI configurations. */
    context_window: z.number().int().positive().optional(),
    max_tokens: z.number().int().positive().optional(),
    capabilities: CapabilitiesSchema.optional(),
  })
  .strict()
const AgentSchema = z
  .object({
    model: z.string().min(1).optional(),
    permission_mode: PermissionModeSchema.optional(),
    reasoning_effort: ReasoningEffortSchema.optional(),
    failover: z.array(z.string().min(1)).default([]),
    max_retries: z.number().int().min(0).max(10).default(2),
    retry_initial_delay_ms: z.number().int().min(0).max(60_000).default(500),
    retry_max_delay_ms: z.number().int().min(0).max(300_000).default(60_000),
    retry_jitter_ratio: z.number().min(0).max(1).default(0.2),
  })
  .strict()
  .default({
    failover: [],
    max_retries: 2,
    retry_initial_delay_ms: 500,
    retry_max_delay_ms: 60_000,
    retry_jitter_ratio: 0.2,
  })
const ModelConfigSchema = z
  .object({
    agent: AgentSchema,
    providers: z.record(z.string(), ProviderSchema).default({}),
    models: z.record(z.string(), ModelSchema).default({}),
    permissions: PermissionSettingsSchema.optional(),
    tools: ToolSettingsSchema.optional(),
    mcp: McpSettingsSchema.optional(),
    memory: MemorySettingsSchema.optional(),
    platform: PlatformSettingsSchema.optional(),
    context: ContextSettingsSchema.optional(),
  })
  .strict()

export type ModelConfig = z.output<typeof ModelConfigSchema>

export const SPARK_CONFIG_SCHEMA = ModelConfigSchema
export { ModelConfigSchema }
