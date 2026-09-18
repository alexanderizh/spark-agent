import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { FileArtifactStore, MemoryArtifactStore } from './events/artifact-store.js'
import { JsonlSessionStore, MemorySessionStore } from './events/ledger.js'
import { DefaultPromptComposer, EventContextProjector } from './events/projector.js'
import { DefaultBudgetFactory } from './kernel/budget.js'
import { SteppingClock, SystemClock } from './kernel/clock.js'
import { SequentialIdGen, UuidIdGen } from './kernel/ids.js'
import { FakeModel } from './llm/fake/model.js'
import type { FakeScriptItem } from './llm/fake/reply-dsl.js'
import { loadHookRunner } from './hooks/settings.js'
import { FileInstructionLoader } from './memory/instructions.js'
import { FileMemoryStore } from './memory/store.js'
import { memoryToolDefinitions, MemoryToolExecutor } from './memory/tools.js'
import { CompositeToolExecutor, McpToolManager } from './mcp/client.js'
import type { SparkMcpServerMap } from './mcp/types.js'
import { LocalSkillCatalog } from './skills/catalog.js'
import { skillToolDefinitions, SkillToolExecutor } from './skills/tools.js'
import type { LlmService } from './seams.js'
import type { ToolDefinition } from './tools/contract.js'
import type { AgentEnv, Approver, ContextCompactionPolicy } from './seams.js'
import { FakeApprover } from './permission/approver.js'
import { RulePermissionPolicy, wildcardMatches, type PermissionRule } from './permission/policy.js'
import type { PermissionDecision } from './permission/types.js'
import { NullTelemetry, MemoryTelemetry } from './telemetry.js'
import { FakeShell, type FakeShellReply } from './tools/fake/shell.js'
import { FakeToolExecutor, fakeToolDefinitions } from './tools/fake/tools.js'
import { VirtualFileSystem } from './tools/fake/virtual-fs.js'
import { OrderedToolRegistry } from './tools/registry.js'
import { taskToolDefinition } from './tools/task/definition.js'
import { planToolDefinitions, PlanToolExecutor } from './tools/plan/tools.js'
import { PlanStore } from './tools/plan/store.js'
import { todoToolDefinitions, TodoToolExecutor } from './tools/todo/tools.js'
import { TodoStore } from './tools/todo/store.js'
import { webFetchToolDefinition, WebFetchToolExecutor } from './tools/web-fetch.js'
import { workspaceToolDefinitions } from './tools/workspace/definitions.js'
import { WorkspaceToolExecutor } from './tools/workspace/executor.js'
import { withCustomEnvironment } from './tools/workspace/process.js'
import { createRuntimeLogger, type RuntimeLogger } from './observability/logger.js'

export interface DefaultEnvOptions {
  readonly cwd: string
  readonly dataRoot?: string
  readonly llm: LlmService
  readonly permissionRules?: readonly PermissionRule[]
  readonly approver?: Approver
  readonly systemPrompt?: string
  readonly skillSystemPrompt?: string
  /** Enables local `skills_list` / `skills_load` for CLI/TUI hosts. */
  readonly skillsEnabled?: boolean
  readonly customEnv?: Readonly<Record<string, string>>
  /** Tool names that may run without an interactive approval in manual mode. */
  readonly allowedTools?: readonly string[]
  /** Tool names/patterns that are always denied. */
  readonly disallowedTools?: readonly string[]
  /** Exclusive allowlist: when set, only matching tool patterns are exposed. */
  readonly enabledTools?: readonly string[]
  /** Tool patterns removed from the registry, so the model never sees them. */
  readonly hiddenTools?: readonly string[]
  /** Filesystem root for the desktop-compatible Markdown memory store. */
  readonly memoryRoot?: string
  /** Agent profile directory used by the agent memory scope. */
  readonly memoryAgentId?: string
  /** Whether memory tools and prompt injection are enabled. */
  readonly memoryEnabled?: boolean
  /** Maximum estimated tokens used by the injected memory summary. */
  readonly memoryMaxInjectTokens?: number
  /** Host logger; CLI defaults to a stderr logger. */
  readonly logger?: RuntimeLogger
  /** Context-window management overrides; absent = kernel defaults. */
  readonly compactionPolicy?: Partial<ContextCompactionPolicy>
}

export function defaultSparkHome(): string {
  return resolve(process.env.SPARK_HOME ?? resolve(homedir(), '.spark'))
}

export function createDefaultEnv(options: DefaultEnvOptions): AgentEnv {
  return buildDefaultEnv(options)
}

export interface ManagedDefaultEnv {
  readonly env: AgentEnv
  readonly close: () => Promise<void>
}

export interface McpDefaultEnvOptions extends DefaultEnvOptions {
  readonly mcpServers?: SparkMcpServerMap
  readonly mcpStartupTimeoutMs?: number
}

/**
 * Builds an env after connecting configured MCP servers and returns the
 * lifetime handle that must be closed by the owning executor.
 */
export async function createDefaultEnvWithMcp(
  options: McpDefaultEnvOptions,
): Promise<ManagedDefaultEnv> {
  const manager = await McpToolManager.connect({
    cwd: options.cwd,
    servers: options.mcpServers ?? {},
    ...(options.mcpStartupTimeoutMs === undefined
      ? {}
      : { startupTimeoutMs: options.mcpStartupTimeoutMs }),
  })
  try {
    return {
      env: buildDefaultEnv(options, manager),
      close: () => manager.close(),
    }
  } catch (error) {
    await manager.close()
    throw error
  }
}

export interface ManagedEnvResult {
  readonly env: AgentEnv
  /** Set when configured MCP servers could not be connected. */
  readonly mcpError?: string
  readonly close: () => Promise<void>
}

/**
 * MCP-tolerant variant of {@link createDefaultEnvWithMcp} for the CLI and TUI:
 * a broken `[mcp]` entry degrades the session to built-in tools with a
 * diagnostic instead of aborting startup. Host embeddings that must fail
 * loudly keep using `createDefaultEnvWithMcp`.
 */
export async function createResilientEnv(options: McpDefaultEnvOptions): Promise<ManagedEnvResult> {
  if (Object.keys(options.mcpServers ?? {}).length === 0) {
    return { env: createDefaultEnv(options), close: async () => undefined }
  }
  try {
    const managed = await createDefaultEnvWithMcp(options)
    return { env: managed.env, close: managed.close }
  } catch (error) {
    return {
      env: createDefaultEnv(options),
      close: async () => undefined,
      mcpError: error instanceof Error ? error.message : String(error),
    }
  }
}

function buildDefaultEnv(options: DefaultEnvOptions, mcp?: McpToolManager): AgentEnv {
  const clock = new SystemClock()
  const dataRoot = resolve(options.dataRoot ?? defaultSparkHome())
  const logger = options.logger ?? createRuntimeLogger('engine')
  // Keep the SDK's historical no-memory default when an embedding host does
  // not opt into the memory layer. CLI/TUI always pass the resolved memory
  // settings, so standalone commands still enable it by default.
  const memoryConfigured =
    options.memoryRoot !== undefined ||
    options.memoryAgentId !== undefined ||
    options.memoryEnabled !== undefined ||
    options.memoryMaxInjectTokens !== undefined
  const memoryEnabled = memoryConfigured && options.memoryEnabled !== false
  const memory = new FileMemoryStore({
    cwd: options.cwd,
    ...(options.memoryRoot === undefined ? {} : { homeDir: options.memoryRoot }),
    ...(options.memoryAgentId === undefined ? {} : { agentId: options.memoryAgentId }),
    ...(options.memoryMaxInjectTokens === undefined
      ? {}
      : { maxInjectTokens: options.memoryMaxInjectTokens }),
    enabled: memoryEnabled,
    logger,
  })
  const memoryExecutor = new MemoryToolExecutor(memory)
  const registry = new OrderedToolRegistry(
    filterToolDefinitions(
      [
        ...workspaceToolDefinitions,
        ...(memoryEnabled ? memoryToolDefinitions : []),
        ...(options.skillsEnabled === true ? skillToolDefinitions : []),
        ...todoToolDefinitions,
        ...planToolDefinitions,
        webFetchToolDefinition,
        ...(mcp?.listDefinitions() ?? []),
        taskToolDefinition,
      ],
      options,
    ),
  )
  // Hidden tools are also hard-denied: a resumed session can still replay a
  // call that predates the filter, and it must not bypass the configuration.
  const disallowedTools = [...(options.disallowedTools ?? []), ...(options.hiddenTools ?? [])]
  const workspaceExecutor = new WorkspaceToolExecutor(options.cwd, options.customEnv)
  const todoExecutor = new TodoToolExecutor(new TodoStore({ cwd: options.cwd, logger }))
  const planExecutor = new PlanToolExecutor(new PlanStore({ cwd: options.cwd, logger }))
  const skillExecutor =
    options.skillsEnabled === true
      ? new SkillToolExecutor(new LocalSkillCatalog({ cwd: options.cwd, logger }))
      : undefined
  const webFetchExecutor = new WebFetchToolExecutor(logger)
  const executor = new CompositeToolExecutor(
    workspaceExecutor,
    mcp,
    memoryExecutor,
    todoExecutor,
    planExecutor,
    webFetchExecutor,
    skillExecutor,
  )
  const hooks = loadHookRunner({
    cwd: options.cwd,
    userSettingsDir: dataRoot,
    ...(options.customEnv === undefined ? {} : { env: withCustomEnvironment(options.customEnv) }),
  })
  return {
    clock,
    ids: new UuidIdGen(),
    store: new JsonlSessionStore({ dataRoot, projectDir: options.cwd }),
    artifacts: new FileArtifactStore(dataRoot),
    llm: options.llm,
    tools: { registry, executor },
    permission: {
      policy: new RulePermissionPolicy({
        layers:
          options.permissionRules === undefined
            ? []
            : [{ source: 'host', rules: options.permissionRules }],
        ...(options.allowedTools === undefined ? {} : { allowedTools: options.allowedTools }),
        ...(disallowedTools.length === 0 ? {} : { disallowedTools }),
      }),
      approver: options.approver ?? new FakeApprover(),
    },
    projector: new EventContextProjector(),
    prompt: new DefaultPromptComposer({
      instructions: new FileInstructionLoader({ cwd: options.cwd }),
      ...(options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt }),
      ...(options.skillSystemPrompt === undefined
        ? {}
        : { skillSystemPrompt: options.skillSystemPrompt }),
      memory,
    }),
    ...(hooks === undefined ? {} : { hooks }),
    ...(options.compactionPolicy === undefined
      ? {}
      : { context: { compaction: options.compactionPolicy } }),
    budgets: new DefaultBudgetFactory(clock),
    telemetry: new NullTelemetry(),
  }
}

/**
 * Applies the `[tools]` configuration to the definitions handed to the model.
 * Patterns use the same `*` wildcard syntax as permission rules, so `mcp__*`
 * disables every MCP tool of an environment at once.
 */
function filterToolDefinitions(
  definitions: readonly ToolDefinition[],
  options: DefaultEnvOptions,
): readonly ToolDefinition[] {
  const hidden = options.hiddenTools ?? []
  const enabled = options.enabledTools
  if (hidden.length === 0 && enabled === undefined) return definitions
  return definitions.filter((definition) => {
    if (hidden.some((pattern) => wildcardMatches(pattern, definition.name))) return false
    if (enabled === undefined) return true
    return enabled.some((pattern) => wildcardMatches(pattern, definition.name))
  })
}

export interface DeterministicEnvOptions {
  readonly files?: Readonly<Record<string, string>>
  readonly shell?: Readonly<Record<string, FakeShellReply>>
  readonly approvals?: readonly PermissionDecision[]
  readonly permissionRules?: readonly PermissionRule[]
  readonly cwd?: string
}

export interface DeterministicAgentEnv extends AgentEnv {
  readonly fixtures: {
    readonly model: FakeModel
    readonly fs: VirtualFileSystem
    readonly shell: FakeShell
    readonly approver: FakeApprover
    readonly telemetry: MemoryTelemetry
  }
}

export function createDeterministicEnv(
  script: readonly FakeScriptItem[],
  options: DeterministicEnvOptions = {},
): DeterministicAgentEnv {
  const clock = new SteppingClock()
  const fs = new VirtualFileSystem(options.files)
  const shell = new FakeShell(options.shell)
  const executor = new FakeToolExecutor(fs, shell)
  const approver = new FakeApprover(options.approvals)
  const model = new FakeModel(script)
  const telemetry = new MemoryTelemetry()
  return {
    clock,
    ids: new SequentialIdGen(),
    store: new MemorySessionStore(),
    artifacts: new MemoryArtifactStore(),
    llm: model,
    tools: {
      registry: new OrderedToolRegistry([...fakeToolDefinitions, taskToolDefinition]),
      executor,
    },
    permission: {
      policy: new RulePermissionPolicy(options.permissionRules),
      approver,
    },
    projector: new EventContextProjector(),
    prompt: new DefaultPromptComposer(),
    budgets: new DefaultBudgetFactory(clock),
    telemetry,
    fixtures: { model, fs, shell, approver, telemetry },
  }
}
