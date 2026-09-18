import { z } from 'zod'

/**
 * Spark CLI settings sections that live next to the model channel config in
 * `~/.spark/config.toml` and `<cwd>/.spark/config.toml`.
 *
 * Every section is optional at the root so existing configs keep parsing, and
 * every field inside a section carries a default so a partially written section
 * is still a complete, valid section after parsing. Sections are strict: a
 * misspelled key is a configuration error instead of a silent no-op.
 */
const ToolPatternSchema = z.string().min(1).max(256)

export const PermissionSettingsSchema = z
  .object({
    /** Default permission mode for new sessions when no flag/preference overrides it. */
    mode: z.enum(['manual', 'auto', 'bypass']).optional(),
    /** Tool patterns that run without an interactive approval in manual mode. */
    allow: z.array(ToolPatternSchema).default([]),
    /** Tool patterns that are always denied, in every mode. */
    deny: z.array(ToolPatternSchema).default([]),
    /** Tool patterns that always require approval, even when another rule allows them. */
    ask: z.array(ToolPatternSchema).default([]),
  })
  .strict()
export type PermissionSettings = z.output<typeof PermissionSettingsSchema>

export const ToolSettingsSchema = z
  .object({
    /** Exclusive allowlist: when set, only matching tools are exposed. */
    enabled: z.array(ToolPatternSchema).optional(),
    /** Tools hidden from the model and denied at execution time. */
    disabled: z.array(ToolPatternSchema).default([]),
  })
  .strict()
  .superRefine((tools, context) => {
    if (tools.enabled !== undefined && tools.disabled.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'enabled and disabled are mutually exclusive; keep one of them',
        path: ['disabled'],
      })
    }
  })
export type ToolSettings = z.output<typeof ToolSettingsSchema>

export const McpServerSettingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** stdio transport: the executable to launch. */
    command: z.string().min(1).max(4_096).optional(),
    args: z.array(z.string().max(4_096)).default([]),
    env: z.record(z.string(), z.string()).default({}),
    cwd: z.string().min(1).max(4_096).optional(),
    /** Streamable HTTP transport: the server endpoint. */
    url: z.url().max(2_000).optional(),
    headers: z.record(z.string(), z.string()).default({}),
  })
  .strict()
  .superRefine((server, context) => {
    if (server.command !== undefined && server.url !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'set either command (stdio) or url (http), not both',
        path: ['url'],
      })
    }
    if (server.command === undefined && server.url === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'an MCP server requires command (stdio) or url (http)',
        path: ['command'],
      })
    }
    if (
      server.command === undefined &&
      (server.args.length > 0 || server.cwd !== undefined || Object.keys(server.env).length > 0)
    ) {
      context.addIssue({ code: 'custom', message: 'args/env/cwd require command', path: ['args'] })
    }
    if (server.url === undefined && Object.keys(server.headers).length > 0) {
      context.addIssue({ code: 'custom', message: 'headers require url', path: ['headers'] })
    }
  })
export type McpServerSettings = z.output<typeof McpServerSettingsSchema>

export const McpSettingsSchema = z
  .object({
    /** Per-server startup budget override for slow stdio servers. */
    startup_timeout_ms: z.number().int().min(100).max(600_000).optional(),
    // Keys must satisfy the MCP client's server-name contract, so a bad name
    // fails at configuration time instead of at connection time.
    servers: z
      .record(
        z
          .string()
          .min(1)
          .max(96)
          .regex(/^[A-Za-z0-9._:-]+$/u, 'use letters, digits and . _ : - only'),
        McpServerSettingsSchema,
      )
      .default({}),
  })
  .strict()
export type McpSettings = z.output<typeof McpSettingsSchema>

export const MemorySettingsSchema = z
  .object({
    /** Disable prompt injection and memory tools without deleting files. */
    enabled: z.boolean().default(true),
    /** Estimated token budget for the compact summary injected into each turn. */
    max_inject_tokens: z.number().int().min(100).max(100_000).default(4_000),
    /** Agent profile used for the agent-scoped Markdown directory. */
    agent_id: z
      .string()
      .min(1)
      .max(96)
      .regex(/^[A-Za-z0-9._-]+$/u, 'use letters, digits and . _ - only')
      .default('default'),
  })
  .strict()
export type MemorySettings = z.output<typeof MemorySettingsSchema>

export const PlatformSettingsSchema = z
  .object({
    /** Spark account server (edu-server) base URL, including the http(s) scheme. */
    server_url: z.url().max(2_000).optional(),
    /** Web login page opened by `spark login`; resolved from the server when unset. */
    web_login_url: z.url().max(2_000).optional(),
  })
  .strict()
export type PlatformSettings = z.output<typeof PlatformSettingsSchema>

export const ContextSettingsSchema = z
  .object({
    /** Master switch for automatic mid-turn context compaction. */
    auto_compact: z.boolean().optional(),
    /** Fraction of the context window that triggers auto-compact (0.5–0.95). */
    compact_threshold: z.number().min(0.5).max(0.95).optional(),
    /** Most recent turns that are never summarized away (1–10). */
    keep_recent_turns: z.number().int().min(1).max(10).optional(),
    /** Smallest dropped-part size in tokens an automatic compaction accepts. */
    min_compactable_tokens: z.number().int().min(1_000).max(500_000).optional(),
    /** Upper bound of compactions within a single turn. */
    max_compactions_per_turn: z.number().int().min(1).max(50).optional(),
    /** Microcompact: sink stale tool bodies into artifacts, keep stubs. */
    micro_compact: z.boolean().optional(),
    /** Most recent assistant exchanges that keep full tool bodies (1–10). */
    micro_compact_keep_exchanges: z.number().int().min(1).max(10).optional(),
    /** Tool bodies below this many tokens are never slimmed. */
    micro_compact_min_tokens: z.number().int().min(50).max(100_000).optional(),
    /** Upper bound of slimmed tool results within a single turn. */
    micro_compact_max_per_turn: z.number().int().min(1).max(500).optional(),
  })
  .strict()
export type ContextSettings = z.output<typeof ContextSettingsSchema>
