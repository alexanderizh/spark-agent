import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { FileArtifactStore, MemoryArtifactStore } from './events/artifact-store.js';
import { JsonlSessionStore, MemorySessionStore } from './events/ledger.js';
import { DefaultPromptComposer, EventContextProjector } from './events/projector.js';
import { DefaultBudgetFactory } from './kernel/budget.js';
import { SteppingClock, SystemClock } from './kernel/clock.js';
import { SequentialIdGen, UuidIdGen } from './kernel/ids.js';
import { FakeModel } from './llm/fake/model.js';
import type { FakeScriptItem } from './llm/fake/reply-dsl.js';
import type { LlmService } from './seams.js';
import type { AgentEnv, Approver } from './seams.js';
import { FakeApprover } from './permission/approver.js';
import { RulePermissionPolicy, type PermissionRule } from './permission/policy.js';
import type { PermissionDecision } from './permission/types.js';
import { NullTelemetry, MemoryTelemetry } from './telemetry.js';
import { FakeShell, type FakeShellReply } from './tools/fake/shell.js';
import { FakeToolExecutor, fakeToolDefinitions } from './tools/fake/tools.js';
import { VirtualFileSystem } from './tools/fake/virtual-fs.js';
import { OrderedToolRegistry } from './tools/registry.js';
import { workspaceToolDefinitions } from './tools/workspace/definitions.js';
import { WorkspaceToolExecutor } from './tools/workspace/executor.js';

export interface DefaultEnvOptions {
  readonly cwd: string;
  readonly dataRoot?: string;
  readonly llm: LlmService;
  readonly permissionRules?: readonly PermissionRule[];
  readonly approver?: Approver;
}

export function defaultSparkHome(): string {
  return resolve(process.env.SPARK_HOME ?? resolve(homedir(), '.spark'));
}

export function createDefaultEnv(options: DefaultEnvOptions): AgentEnv {
  const clock = new SystemClock();
  const dataRoot = resolve(options.dataRoot ?? defaultSparkHome());
  const registry = new OrderedToolRegistry(workspaceToolDefinitions);
  const executor = new WorkspaceToolExecutor(options.cwd);
  return {
    clock,
    ids: new UuidIdGen(),
    store: new JsonlSessionStore({ dataRoot, projectDir: options.cwd }),
    artifacts: new FileArtifactStore(dataRoot),
    llm: options.llm,
    tools: { registry, executor },
    permission: {
      policy: new RulePermissionPolicy(options.permissionRules),
      approver: options.approver ?? new FakeApprover(),
    },
    projector: new EventContextProjector(),
    prompt: new DefaultPromptComposer(),
    budgets: new DefaultBudgetFactory(clock),
    telemetry: new NullTelemetry(),
  };
}

export interface DeterministicEnvOptions {
  readonly files?: Readonly<Record<string, string>>;
  readonly shell?: Readonly<Record<string, FakeShellReply>>;
  readonly approvals?: readonly PermissionDecision[];
  readonly permissionRules?: readonly PermissionRule[];
  readonly cwd?: string;
}

export interface DeterministicAgentEnv extends AgentEnv {
  readonly fixtures: {
    readonly model: FakeModel;
    readonly fs: VirtualFileSystem;
    readonly shell: FakeShell;
    readonly approver: FakeApprover;
    readonly telemetry: MemoryTelemetry;
  };
}

export function createDeterministicEnv(
  script: readonly FakeScriptItem[],
  options: DeterministicEnvOptions = {},
): DeterministicAgentEnv {
  const clock = new SteppingClock();
  const fs = new VirtualFileSystem(options.files);
  const shell = new FakeShell(options.shell);
  const executor = new FakeToolExecutor(fs, shell);
  const approver = new FakeApprover(options.approvals);
  const model = new FakeModel(script);
  const telemetry = new MemoryTelemetry();
  return {
    clock,
    ids: new SequentialIdGen(),
    store: new MemorySessionStore(),
    artifacts: new MemoryArtifactStore(),
    llm: model,
    tools: {
      registry: new OrderedToolRegistry(fakeToolDefinitions),
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
  };
}
