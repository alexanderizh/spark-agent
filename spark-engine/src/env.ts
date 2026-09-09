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
import { CompositeToolExecutor, McpToolManager } from './mcp/client.js'
import type { SparkMcpServerMap } from './mcp/types.js'
import type { LlmService } from './seams.js'
import type { AgentEnv, Approver } from './seams.js'
import { FakeApprover } from './permission/approver.js'
import { RulePermissionPolicy, type PermissionRule } from './permission/policy.js'
import type { PermissionDecision } from './permission/types.js'
import { NullTelemetry, MemoryTelemetry } from './telemetry.js'
import { FakeShell, type FakeShellReply } from './tools/fake/shell.js'
import { FakeToolExecutor, fakeToolDefinitions } from './tools/fake/tools.js'
import { VirtualFileSystem } from './tools/fake/virtual-fs.js'
import { OrderedToolRegistry } from './tools/registry.js'
import { taskToolDefinition } from './tools/task/definition.js'
import { workspaceToolDefinitions } from './tools/workspace/definitions.js'
import { WorkspaceToolExecutor } from './tools/workspace/executor.js'
import { withCustomEnvironment } from './tools/workspace/process.js'

export interface DefaultEnvOptions {
  readonly cwd: string
  readonly dataRoot?: string
  readonly llm: LlmService
  readonly permissionRules?: readonly PermissionRule[]
  readonly approver?: Approver
  readonly systemPrompt?: string
  readonly skillSystemPrompt?: string
  readonly customEnv?: Readonly<Record<string, string>>
  /** Tool names that may run without an interactive approval in manual mode. */
  readonly allowedTools?: readonly string[]
  /** Tool names/patterns that are always denied and hidden from no model state. */
  readonly disallowedTools?: readonly string[]
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

function buildDefaultEnv(options: DefaultEnvOptions, mcp?: McpToolManager): AgentEnv {
  const clock = new SystemClock()
  const dataRoot = resolve(options.dataRoot ?? defaultSparkHome())
  const registry = new OrderedToolRegistry([
    ...workspaceToolDefinitions,
    ...(mcp?.listDefinitions() ?? []),
    taskToolDefinition,
  ])
  const workspaceExecutor = new WorkspaceToolExecutor(options.cwd, options.customEnv)
  const executor =
    mcp === undefined ? workspaceExecutor : new CompositeToolExecutor(workspaceExecutor, mcp)
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
        ...(options.disallowedTools === undefined
          ? {}
          : { disallowedTools: options.disallowedTools }),
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
    }),
    ...(hooks === undefined ? {} : { hooks }),
    budgets: new DefaultBudgetFactory(clock),
    telemetry: new NullTelemetry(),
  }
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
