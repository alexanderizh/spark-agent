# Codex Permission Policy Unification Implementation Plan

> 状态: 实施中 | 最后核对: 2026-07-17

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Spark's three Codex permission modes produce one documented, user-controlled sandbox and approval policy across the TypeScript SDK and CLI executors.

**Architecture:** Add a small runtime-only policy resolver that converts Spark permission mode plus unattended state into Codex sandbox, approval, and reviewer semantics. Keep SDK and CLI transport rendering separate, but require both to consume the shared resolver; centralize renderer copy so platform entry points describe the same behavior.

**Tech Stack:** TypeScript, Vitest, `@openai/codex-sdk@0.144.5`, Codex CLI 0.144.5, Electron/React.

---

## File map

- Create `packages/agent-runtime/src/sdk/codex-permission-policy.ts`: the only semantic mapping from Spark Codex permission modes to official Codex settings.
- Create `packages/agent-runtime/src/__tests__/sdk/codex-permission-policy.test.ts`: exhaustive resolver matrix and safe fallback tests.
- Modify `packages/agent-runtime/src/sdk/codex-sdk-executor.ts`: render the shared policy into `ThreadOptions` and `CodexOptions.config` for new and resumed threads.
- Modify `packages/agent-runtime/src/__tests__/sdk/codex-sdk-executor.test.ts`: verify SDK options and official auto-review config.
- Modify `packages/agent-runtime/src/sdk/codex-cli-executor.ts`: render the shared policy into explicit `--sandbox` arguments and temporary profile settings.
- Modify `packages/agent-runtime/src/__tests__/sdk/codex-cli-executor.test.ts`: verify all CLI modes and prevent unattended privilege escalation.
- Modify `apps/desktop/src/renderer/design/utils/permission-options.ts`: own the canonical Codex permission copy.
- Create `apps/desktop/src/renderer/design/utils/permission-options.test.ts`: lock protocol values, labels, and security descriptions.
- Modify `apps/desktop/src/renderer/design/views/chat/ComposerV2.tsx`: consume canonical Codex copy without growing the existing large file.
- Modify `apps/desktop/src/renderer/design/views/SettingsView.tsx`: consume canonical Codex copy without growing the existing large file.
- Modify `apps/desktop/src/renderer/design/views/AgentsView.tsx`: consume canonical Codex labels.
- Modify `docs/superpowers/specs/2026-07-17-codex-permission-policy-unification-design.md`: mark the design implemented after verification.

### Task 1: Add the shared Codex policy resolver

**Files:**

- Create: `packages/agent-runtime/src/sdk/codex-permission-policy.ts`
- Test: `packages/agent-runtime/src/__tests__/sdk/codex-permission-policy.test.ts`

- [ ] **Step 1: Write the failing permission matrix test**

```ts
import { describe, expect, it } from 'vitest'
import { resolveCodexPermissionPolicy } from '../../sdk/codex-permission-policy.js'

describe('resolveCodexPermissionPolicy', () => {
  it.each([
    ['codex-default', false, 'workspace-write', 'on-request', undefined],
    ['codex-default', true, 'workspace-write', 'never', undefined],
    ['codex-auto-review', false, 'workspace-write', 'on-request', 'auto_review'],
    ['codex-auto-review', true, 'workspace-write', 'on-request', 'auto_review'],
    ['codex-full-access', false, 'danger-full-access', 'never', undefined],
    ['codex-full-access', true, 'danger-full-access', 'never', undefined],
  ] as const)(
    'maps %s unattended=%s',
    (mode, unattended, sandboxMode, approvalPolicy, approvalsReviewer) => {
      expect(resolveCodexPermissionPolicy(mode, unattended)).toEqual({
        sandboxMode,
        approvalPolicy,
        ...(approvalsReviewer == null ? {} : { approvalsReviewer }),
      })
    },
  )

  it('uses the safe default for a non-Codex legacy mode', () => {
    expect(resolveCodexPermissionPolicy('claude-bypass', false)).toEqual({
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
    })
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/sdk/codex-permission-policy.test.ts
```

Expected: FAIL because `codex-permission-policy.js` does not exist.

- [ ] **Step 3: Implement the minimal shared resolver**

```ts
import type { SDKExecutorConfig } from './types.js'

export type CodexSandboxMode = 'workspace-write' | 'danger-full-access'
export type CodexApprovalPolicy = 'never' | 'on-request'
export type CodexApprovalsReviewer = 'auto_review'

export interface CodexPermissionPolicy {
  sandboxMode: CodexSandboxMode
  approvalPolicy: CodexApprovalPolicy
  approvalsReviewer?: CodexApprovalsReviewer
}

export function resolveCodexPermissionPolicy(
  mode: SDKExecutorConfig['permissionMode'],
  unattended: boolean,
): CodexPermissionPolicy {
  if (mode === 'codex-full-access') {
    return { sandboxMode: 'danger-full-access', approvalPolicy: 'never' }
  }
  if (mode === 'codex-auto-review') {
    return {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
    }
  }
  return {
    sandboxMode: 'workspace-write',
    approvalPolicy: unattended ? 'never' : 'on-request',
  }
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run the command from Step 2.

Expected: 7 matrix/fallback cases PASS.

- [ ] **Step 5: Commit the resolver and test**

```bash
git add packages/agent-runtime/src/sdk/codex-permission-policy.ts packages/agent-runtime/src/__tests__/sdk/codex-permission-policy.test.ts
git commit -m "feat(codex): centralize permission policy"
```

### Task 2: Apply the shared policy to the Codex SDK executor

**Files:**

- Modify: `packages/agent-runtime/src/sdk/codex-sdk-executor.ts:581-690`
- Test: `packages/agent-runtime/src/__tests__/sdk/codex-sdk-executor.test.ts`

- [ ] **Step 1: Add failing SDK mapping tests**

Add tests that execute the mocked SDK with `codex-auto-review`, `codex-full-access`, and resumed full-access sessions:

```ts
it('configures Codex auto review without widening the workspace sandbox', async () => {
  runStreamed.mockResolvedValue({ events: streamFrom([]) })
  await new CodexSdkExecutor().executeTurn(
    'session-1',
    'turn-1',
    'hello',
    makeConfig({ permissionMode: 'codex-auto-review', unattended: true }),
  )

  expect(codexCtor).toHaveBeenCalledWith(
    expect.objectContaining({
      config: expect.objectContaining({ approvals_reviewer: 'auto_review' }),
    }),
  )
  expect(startThread).toHaveBeenCalledWith(
    expect.objectContaining({
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
    }),
  )
})

it('grants explicit full access for Git metadata writes', async () => {
  runStreamed.mockResolvedValue({ events: streamFrom([]) })
  await new CodexSdkExecutor().executeTurn(
    'session-1',
    'turn-1',
    'hello',
    makeConfig({ permissionMode: 'codex-full-access' }),
  )

  expect(startThread).toHaveBeenCalledWith(
    expect.objectContaining({
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
    }),
  )
})

it('applies current full-access policy when resuming a thread', async () => {
  resumeThread.mockReturnValue({ runStreamed })
  runStreamed.mockResolvedValue({ events: streamFrom([]) })
  await new CodexSdkExecutor().executeTurn(
    'session-1',
    'turn-1',
    'hello',
    makeConfig({
      permissionMode: 'codex-full-access',
      sdkSessionId: 'thread-existing',
      continueSession: true,
    }),
  )

  expect(resumeThread).toHaveBeenCalledWith(
    'thread-existing',
    expect.objectContaining({
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
    }),
  )
})
```

- [ ] **Step 2: Run the SDK executor test and verify the new expectations fail**

```bash
pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/sdk/codex-sdk-executor.test.ts
```

Expected: auto-review config and unattended approval expectations FAIL; existing full-access behavior may already pass.

- [ ] **Step 3: Consume the resolver in SDK options and remove local mapping functions**

Import `resolveCodexPermissionPolicy`. In both config builders derive the same policy:

```ts
function buildCodexConfig(config: SDKExecutorConfig): CodexConfigObject {
  const policy = resolveCodexPermissionPolicy(config.permissionMode, config.unattended === true)
  return {
    model_reasoning_summary: 'concise',
    hide_agent_reasoning: false,
    ...(policy.approvalsReviewer == null
      ? {}
      : { approvals_reviewer: policy.approvalsReviewer }),
    ...buildCodexModelProviderConfig(config),
    ...buildCodexMcpConfig(config.mcpServers),
  }
}

function buildThreadOptions(config: SDKExecutorConfig): ThreadOptions {
  const policy = resolveCodexPermissionPolicy(config.permissionMode, config.unattended === true)
  return {
    model: config.model,
    workingDirectory: config.workspaceRootPath,
    skipGitRepoCheck: true,
    sandboxMode: policy.sandboxMode,
    approvalPolicy: policy.approvalPolicy,
    // Preserve the existing reasoning, network, web search, and additional directory fields.
  }
}
```

Delete `mapSandboxMode` and `mapApprovalPolicy`; no executor-local policy branch may remain.

- [ ] **Step 4: Run the SDK tests and typecheck**

```bash
pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/sdk/codex-permission-policy.test.ts src/__tests__/sdk/codex-sdk-executor.test.ts
pnpm --filter @spark/agent-runtime typecheck
```

Expected: tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit SDK integration**

```bash
git add packages/agent-runtime/src/sdk/codex-sdk-executor.ts packages/agent-runtime/src/__tests__/sdk/codex-sdk-executor.test.ts
git commit -m "fix(codex): apply user permission policy in SDK"
```

### Task 3: Apply the shared policy to the Codex CLI executor

**Files:**

- Modify: `packages/agent-runtime/src/sdk/codex-cli-executor.ts:444-575`
- Test: `packages/agent-runtime/src/__tests__/sdk/codex-cli-executor.test.ts`

- [ ] **Step 1: Replace the unsafe unattended test with a failing permission matrix**

Add a helper that returns spawn args and captured profile, then assert the three meaningful cases:

```ts
it.each([
  ['codex-default', true, 'workspace-write', "approval_policy='never'", null],
  ['codex-auto-review', true, 'workspace-write', "approval_policy='on-request'", "approvals_reviewer='auto_review'"],
  ['codex-full-access', false, 'danger-full-access', "approval_policy='never'", null],
] as const)(
  'maps %s unattended=%s without implicit privilege escalation',
  async (permissionMode, unattended, sandboxMode, approvalConfig, reviewerConfig) => {
    spawnMock.mockImplementation((_command: string, args: string[]) => new MockChildProcess(args))
    await new CodexCliExecutor().executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({ permissionMode, unattended }),
    )

    const args = spawnMock.mock.calls[0]?.[1] as string[]
    expect(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2)).toEqual([
      '--sandbox',
      sandboxMode,
    ])
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(lastProfileConfig).toContain(approvalConfig)
    if (reviewerConfig == null) expect(lastProfileConfig).not.toContain('approvals_reviewer=')
    else expect(lastProfileConfig).toContain(reviewerConfig)
  },
)
```

- [ ] **Step 2: Run the CLI executor test and verify it fails**

```bash
pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/sdk/codex-cli-executor.test.ts
```

Expected: unattended auto-review still uses the bypass flag and profile permission entries are missing.

- [ ] **Step 3: Render the shared policy into CLI args and profile config**

Import `resolveCodexPermissionPolicy`. Replace `mapCodexPermissionArgs` with a transport-only renderer:

```ts
function buildCodexPermissionArgs(config: SDKExecutorConfig): string[] {
  const policy = resolveCodexPermissionPolicy(config.permissionMode, config.unattended === true)
  return ['--sandbox', policy.sandboxMode]
}
```

Use it from `buildCodexArgs`. Add official approval settings to `buildCodexProfileConfigItems`:

```ts
const policy = resolveCodexPermissionPolicy(config.permissionMode, config.unattended === true)
items.push(`approval_policy=${tomlString(policy.approvalPolicy)}`)
if (policy.approvalsReviewer != null) {
  items.push(`approvals_reviewer=${tomlString(policy.approvalsReviewer)}`)
}
```

Remove the unconditional unattended bypass and the old `mapCodexPermissionArgs` switch.

- [ ] **Step 4: Run the CLI/SDK policy tests and typecheck**

```bash
pnpm --filter @spark/agent-runtime exec vitest run \
  src/__tests__/sdk/codex-permission-policy.test.ts \
  src/__tests__/sdk/codex-sdk-executor.test.ts \
  src/__tests__/sdk/codex-cli-executor.test.ts
pnpm --filter @spark/agent-runtime typecheck
```

Expected: all focused tests PASS and typecheck exits 0.

- [ ] **Step 5: Commit CLI integration**

```bash
git add packages/agent-runtime/src/sdk/codex-cli-executor.ts packages/agent-runtime/src/__tests__/sdk/codex-cli-executor.test.ts
git commit -m "fix(codex): align CLI permission enforcement"
```

### Task 4: Centralize user-facing Codex permission copy

**Files:**

- Modify: `apps/desktop/src/renderer/design/utils/permission-options.ts`
- Create: `apps/desktop/src/renderer/design/utils/permission-options.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/chat/ComposerV2.tsx:4784-5000`
- Modify: `apps/desktop/src/renderer/design/views/SettingsView.tsx:5813-5833`
- Modify: `apps/desktop/src/renderer/design/views/AgentsView.tsx:2384-2395`

- [ ] **Step 1: Write the failing canonical-copy test**

```ts
import { describe, expect, it } from 'vitest'
import { CODEX_PERMISSION_MODE_OPTIONS } from './permission-options'

describe('Codex permission copy', () => {
  it('describes the real sandbox behavior for every platform entry point', () => {
    expect(CODEX_PERMISSION_MODE_OPTIONS).toEqual([
      expect.objectContaining({
        value: 'codex-default',
        label: '请求批准',
        description: expect.stringContaining('workspace-write'),
      }),
      expect.objectContaining({
        value: 'codex-auto-review',
        label: '替我批准',
        description: expect.stringContaining('自动审查'),
      }),
      expect.objectContaining({
        value: 'codex-full-access',
        label: '完全访问',
        description: expect.stringMatching(/Git|\.git/),
        tone: 'danger',
      }),
    ])
  })
})
```

- [ ] **Step 2: Run the renderer test and verify it fails**

```bash
pnpm --filter @spark/desktop exec vitest run src/renderer/design/utils/permission-options.test.ts
```

Expected: existing English labels and generic descriptions do not match.

- [ ] **Step 3: Update the canonical options with accurate copy**

```ts
export const CODEX_PERMISSION_MODE_OPTIONS: Array<ComposerMenuOption> = [
  {
    value: 'codex-default',
    label: '请求批准',
    description: 'workspace-write；越界操作请求批准，SDK 无法承接时会拒绝',
  },
  {
    value: 'codex-auto-review',
    label: '替我批准',
    description: 'workspace-write；越界操作交由 Codex 自动审查',
    tone: 'auto',
  },
  {
    value: 'codex-full-access',
    label: '完全访问',
    description: 'danger-full-access；允许修改 .git 和工作区外文件',
    tone: 'danger',
  },
]
```

- [ ] **Step 4: Reuse the canonical values in Composer, Settings, and Agents**

Import `CODEX_PERMISSION_MODE_OPTIONS` with an alias where a local symbol already exists. Map only presentation-specific fields:

```ts
const CODEX_RUNTIME_PERMISSION_OPTIONS: RuntimePermissionModeOption[] =
  SHARED_CODEX_PERMISSION_MODE_OPTIONS.map(({ value, label, description, tone }) => ({
    value,
    label,
    desc: description,
    ...(tone == null ? {} : { tone }),
  }))
```

Composer adds icons by permission value while keeping shared labels/descriptions. Agents maps to `{ value, label }`. Remove the three duplicate literal copy blocks.

- [ ] **Step 5: Run renderer tests and desktop typecheck**

```bash
pnpm --filter @spark/desktop exec vitest run src/renderer/design/utils/permission-options.test.ts
pnpm --filter @spark/desktop typecheck
```

Expected: test PASS and both renderer/main TypeScript checks exit 0.

- [ ] **Step 6: Commit UI copy integration**

```bash
git add \
  apps/desktop/src/renderer/design/utils/permission-options.ts \
  apps/desktop/src/renderer/design/utils/permission-options.test.ts \
  apps/desktop/src/renderer/design/views/chat/ComposerV2.tsx \
  apps/desktop/src/renderer/design/views/SettingsView.tsx \
  apps/desktop/src/renderer/design/views/AgentsView.tsx
git commit -m "fix(ui): explain Codex permission boundaries"
```

### Task 5: Verify the integrated behavior and refresh documentation

**Files:**

- Modify: `docs/superpowers/specs/2026-07-17-codex-permission-policy-unification-design.md`
- Modify: `docs/superpowers/plans/2026-07-17-codex-permission-policy-unification.md`

- [ ] **Step 1: Run focused tests**

```bash
pnpm --filter @spark/agent-runtime exec vitest run \
  src/__tests__/sdk/codex-permission-policy.test.ts \
  src/__tests__/sdk/codex-sdk-executor.test.ts \
  src/__tests__/sdk/codex-cli-executor.test.ts
pnpm --filter @spark/desktop exec vitest run src/renderer/design/utils/permission-options.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run package typechecks**

```bash
pnpm --filter @spark/agent-runtime typecheck
pnpm --filter @spark/desktop typecheck
```

Expected: both commands exit 0.

- [ ] **Step 3: Inspect only task-owned diffs and whitespace**

```bash
git diff --check -- \
  packages/agent-runtime/src/sdk/codex-permission-policy.ts \
  packages/agent-runtime/src/sdk/codex-sdk-executor.ts \
  packages/agent-runtime/src/sdk/codex-cli-executor.ts \
  packages/agent-runtime/src/__tests__/sdk/codex-permission-policy.test.ts \
  packages/agent-runtime/src/__tests__/sdk/codex-sdk-executor.test.ts \
  packages/agent-runtime/src/__tests__/sdk/codex-cli-executor.test.ts \
  apps/desktop/src/renderer/design/utils/permission-options.ts \
  apps/desktop/src/renderer/design/utils/permission-options.test.ts \
  apps/desktop/src/renderer/design/views/chat/ComposerV2.tsx \
  apps/desktop/src/renderer/design/views/SettingsView.tsx \
  apps/desktop/src/renderer/design/views/AgentsView.tsx
```

Expected: no output.

- [ ] **Step 4: Run GitNexus change detection or documented fallback**

If GitNexus tools are available, run `gitnexus_detect_changes()` and verify only Codex permission flows are affected. In the current session they are not exposed, so use:

```bash
rg -n "resolveCodexPermissionPolicy|codex-full-access|approvals_reviewer" packages apps
git diff --stat
```

Expected: call sites are limited to the shared resolver, two Codex executors, their tests, and permission UI copy.

- [ ] **Step 5: Mark documents current**

Change the design status line to:

```markdown
> 状态: 已落地 | 最后核对: 2026-07-17
```

Change this plan status line to:

```markdown
> 状态: 已落地 | 最后核对: 2026-07-17
```

- [ ] **Step 6: Update the GitNexus index after the feature lands**

Run:

```bash
npx gitnexus analyze
```

Expected: the `spark-agent` index updates successfully. If the command is unavailable or incompatible, record the degradation in the final handoff and do not block delivery.

- [ ] **Step 7: Commit documentation and final verification state**

```bash
git add \
  docs/superpowers/specs/2026-07-17-codex-permission-policy-unification-design.md \
  docs/superpowers/plans/2026-07-17-codex-permission-policy-unification.md
git commit -m "docs(codex): record permission policy rollout"
```
