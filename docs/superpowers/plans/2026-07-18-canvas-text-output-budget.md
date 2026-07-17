# Canvas Text Output Budget Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-18

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace context-ratio-derived canvas output limits with 16K/32K/64K task defaults, a fixed context safety guard, and model-specific learned output caps with bounded retries.

**Architecture:** Keep pure task-budget calculation in `canvasTextTaskDiagnostics.ts`, keep each provider call in `canvas-text-generator.ts`, and add a focused desktop-main module for output-limit classification, persistent learned-cap storage, and retry sequencing. The oversized IPC registration file only resolves inputs, calls these helpers, and records diagnostics.

**Tech Stack:** TypeScript, Electron main process, Vitest, SQLite-backed `SettingsRepository`, existing canvas text IPC and provider adapters.

---

### Task 1: Replace ratio-derived budgets with task output tiers

**Files:**
- Modify: `apps/desktop/src/main/ipc/canvasTextTaskDiagnostics.ts`
- Modify: `apps/desktop/src/main/ipc/canvasTextTaskDiagnostics.test.ts`

- [x] **Step 1: Write failing tests for fixed defaults and context protection**

Add focused expectations covering the new semantics:

```ts
it('uses 32K for ordinary canvas text generation without an output-cap profile', () => {
  expect(resolveCanvasTextTokenBudget({ operation: 'text_generate', prompt: '短文本' }))
    .toMatchObject({ maxTokens: 32_768, source: 'task_default' })
})

it('uses 64K for screenplay and shot tasks', () => {
  expect(resolveCanvasTextTokenBudget({
    operation: 'text_generate',
    taskPipelineRole: 'screenplay',
    prompt: '长篇剧本',
  }).maxTokens).toBe(65_536)
})

it('uses a fixed 16K context safety buffer instead of an 85 percent output ratio', () => {
  expect(resolveCanvasTextTokenBudget({
    operation: 'text_generate',
    providerContextWindow: 100_000,
    prompt: '文'.repeat(74_999),
  })).toMatchObject({
    maxTokens: 23_616,
    source: 'context_remaining',
    contextSafetyTokens: 16_384,
    remainingContextTokens: 23_616,
  })
})
```

Retain coverage for explicit request overrides and provider caps, but update expected sources and remove the old 170K/217.6K ratio expectations.

- [x] **Step 2: Run the diagnostics test and verify RED**

Run:

```bash
pnpm --filter @spark/desktop exec vitest run src/main/ipc/canvasTextTaskDiagnostics.test.ts
```

Expected: FAIL because `operation`, tier defaults, and fixed safety diagnostics are not implemented.

- [x] **Step 3: Implement task defaults and independent constraints**

Introduce these constants and sources:

```ts
export const CANVAS_TEXT_CONTEXT_SAFETY_TOKENS = 16_384
export const CANVAS_TEXT_OUTPUT_TIERS = {
  minimum: 16_384,
  standard: 32_768,
  long: 65_536,
  explicitMaximum: 131_072,
} as const

export type CanvasTextMaxTokensSource =
  | 'request'
  | 'learned_model_cap'
  | 'provider_profile'
  | 'task_default'
  | 'context_remaining'
```

Resolve desired tokens separately from capability constraints:

```ts
const desired = requested ?? resolveTaskDefaultMaxTokens(input.operation, input.taskPipelineRole)
const knownCap = learnedMaxTokens ?? providerMaxTokens
const remainingContextTokens = providerContextWindow
  - promptTokensEstimate
  - CANVAS_TEXT_CONTEXT_SAFETY_TOKENS
if (remainingContextTokens <= 0) throw new CanvasTextContextBudgetError(...)

const constraints = [
  { value: desired, source: requested ? 'request' : 'task_default' },
  ...(knownCap ? [{ value: knownCap, source: learnedMaxTokens ? 'learned_model_cap' : 'provider_profile' }] : []),
  { value: remainingContextTokens, source: 'context_remaining' },
]
```

Use 16K for `prompt_optimize`, 64K for `screenplay`/`shot`, and 32K for all other canvas text generation and rewrite tasks. Clamp explicit requests to 128K before applying provider/context constraints.

- [x] **Step 4: Run the diagnostics test and verify GREEN**

Run the same Vitest command. Expected: all diagnostics tests pass and no expectation references `context_window_derived`.

- [x] **Step 5: Commit Task 1 files only**

```bash
git add apps/desktop/src/main/ipc/canvasTextTaskDiagnostics.ts apps/desktop/src/main/ipc/canvasTextTaskDiagnostics.test.ts
git commit -m "fix(canvas): use task-based text output budgets"
```

### Task 2: Raise the provider-call fallback from 4K to 16K

**Files:**
- Modify: `packages/agent-runtime/src/services/canvas-text-generator.ts`
- Modify: `packages/agent-runtime/src/__tests__/services/canvas-text-generator.test.ts`

- [x] **Step 1: Write failing request-body tests**

Add one omitted-`maxTokens` assertion for Anthropic, OpenAI chat, and OpenAI Responses:

```ts
expect(captured.lastBody().max_tokens).toBe(16_384)
expect(capturedResponses.lastBody().max_output_tokens).toBe(16_384)
```

- [x] **Step 2: Run the generator test and verify RED**

```bash
pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/canvas-text-generator.test.ts
```

Expected: FAIL with received value `4096`.

- [x] **Step 3: Raise the single fallback constant**

```ts
const DEFAULT_MAX_TOKENS = 16_384
```

Do not add provider-specific branching in the generator; provider-specific learning belongs to the desktop orchestration layer.

- [x] **Step 4: Run the generator test and verify GREEN**

Run the same Vitest command. Expected: all generator tests pass.

- [x] **Step 5: Commit Task 2 files only**

```bash
git add packages/agent-runtime/src/services/canvas-text-generator.ts packages/agent-runtime/src/__tests__/services/canvas-text-generator.test.ts
git commit -m "fix(canvas): raise default text output to 16k"
```

### Task 3: Add output-limit classification, retry sequencing, and learned-cap storage

**Files:**
- Create: `apps/desktop/src/main/ipc/canvasTextOutputCapability.ts`
- Create: `apps/desktop/src/main/ipc/canvasTextOutputCapability.test.ts`

- [x] **Step 1: Write failing classifier and retry tests**

Cover structured NewAPI nesting, Anthropic/OpenAI parameter names, non-token 400s, exact numeric extraction, and ladder fallback:

```ts
expect(classifyCanvasTextOutputLimitError({
  statusCode: 400,
  responseBody: JSON.stringify({
    error: { type: 'InvalidParameter', message: "max_tokens expected <= 128000, got 170000" },
  }),
})).toMatchObject({ kind: 'output_limit', exactLimit: 128_000 })

expect(classifyCanvasTextOutputLimitError({
  statusCode: 400,
  responseBody: '{"error":{"message":"max_output_tokens is too large"}}',
})).toMatchObject({ kind: 'output_limit' })

expect(classifyCanvasTextOutputLimitError({
  statusCode: 400,
  responseBody: '{"error":{"message":"invalid image"}}',
})).toEqual({ kind: 'other' })

expect(nextCanvasTextOutputRetryMax(65_536)).toBe(32_768)
expect(nextCanvasTextOutputRetryMax(16_384)).toBe(8_192)
expect(nextCanvasTextOutputRetryMax(4_096)).toBeUndefined()
```

- [x] **Step 2: Write failing persistent-cache tests**

Use an in-memory fake implementing `get`/`set` and a deterministic clock. Verify:

```ts
cache.record(key, 32_768, 'successful_downgrade')
expect(cache.get(key)).toBe(32_768)
cache.record(key, 65_536, 'successful_downgrade')
expect(cache.get(key)).toBe(32_768) // never raise before expiry
cache.record(key, 16_384, 'exact_error_limit')
expect(cache.get(key)).toBe(16_384)
```

Advance beyond seven days and expect the entry to expire.
Record two models under one Provider plus one model under another Provider, call `clearProvider`, and verify only the selected Provider entries are removed.

- [x] **Step 3: Run the new test and verify RED**

```bash
pnpm --filter @spark/desktop exec vitest run src/main/ipc/canvasTextOutputCapability.test.ts
```

Expected: FAIL because the module does not exist.

- [x] **Step 4: Implement the focused capability module**

Export these public units:

```ts
export type CanvasTextOutputCapabilityKey = {
  providerProfileId: string
  endpoint?: string
  model: string
  apiKind: 'chat' | 'responses'
}

export class CanvasTextOutputCapabilityCache {
  constructor(
    settings: Pick<SettingsRepository, 'get' | 'set'>,
    now: () => number = Date.now,
  )
  get(key: CanvasTextOutputCapabilityKey): number | undefined
  record(key: CanvasTextOutputCapabilityKey, safeMaxOutputTokens: number,
    learnedFrom: 'exact_error_limit' | 'successful_downgrade'): void
  clearProvider(providerProfileId: string): void
}

export function classifyCanvasTextOutputLimitError(error: unknown): OutputLimitError
export function nextCanvasTextOutputRetryMax(current: number): number | undefined
```

Store normalized entries under the settings category `canvas-text-output-capability`, discard malformed/expired values on read, use a seven-day TTL, and retain only the lower observed value for an unexpired key. `clearProvider` removes entries belonging to one Provider profile. Redact evidence to a bounded parameter-validation excerpt.

- [x] **Step 5: Run the new test and verify GREEN**

Run the same Vitest command. Expected: all classifier, ladder, and cache tests pass.

- [x] **Step 6: Commit Task 3 files only**

```bash
git add apps/desktop/src/main/ipc/canvasTextOutputCapability.ts apps/desktop/src/main/ipc/canvasTextOutputCapability.test.ts
git commit -m "feat(canvas): learn model text output limits"
```

### Task 4: Wire learned caps and bounded retry into HTTP canvas text generation

**Files:**
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Modify: `apps/desktop/src/main/ipc/canvasTextTaskDiagnostics.ts`
- Modify: `apps/desktop/src/main/ipc/canvasTextTaskDiagnostics.test.ts`
- Create: `apps/desktop/src/main/ipc/canvasTextAdaptiveGeneration.ts`
- Create: `apps/desktop/src/main/ipc/canvasTextAdaptiveGeneration.test.ts`

- [x] **Step 1: Write failing adaptive-generation tests**

Test the orchestration with an injected `generate(maxTokens)` callback:

```ts
const attempts: number[] = []
const result = await generateCanvasTextWithAdaptiveOutput({
  initialMaxTokens: 65_536,
  generate: async (maxTokens) => {
    attempts.push(maxTokens)
    if (attempts.length === 1) throw outputLimitErrorWithoutExactValue()
    return { text: 'ok' }
  },
})
expect(attempts).toEqual([65_536, 32_768])
expect(result.retryDiagnostics.retryCount).toBe(1)
expect(result.learnedSafeMaxTokens).toBe(32_768)
```

Also verify exact 128K extraction, immediate stop on unrelated 400, strict decrease, and the five-retry bound.

- [x] **Step 2: Run the adaptive test and verify RED**

```bash
pnpm --filter @spark/desktop exec vitest run src/main/ipc/canvasTextAdaptiveGeneration.test.ts
```

Expected: FAIL because the adaptive wrapper does not exist.

- [x] **Step 3: Implement a generic adaptive wrapper**

The new module accepts a callback and returns the provider result plus diagnostics:

```ts
export async function generateCanvasTextWithAdaptiveOutput<T>(input: {
  initialMaxTokens: number
  generate: (maxTokens: number) => Promise<T>
  onLearnedSafeMaxTokens?: (value: number,
    source: 'exact_error_limit' | 'successful_downgrade') => void
  maxRetries?: number
}): Promise<{
  value: T
  learnedSafeMaxTokens?: number
  retryDiagnostics: {
    retryCount: number
    attempts: number[]
    evidence?: string
  }
}>
```

Use the classifier and ladder from Task 3. An extracted exact limit is usable only when it is positive and strictly lower than the failed attempt; otherwise continue with the next lower ladder value. Invoke `onLearnedSafeMaxTokens` immediately for a credible exact error limit and after a downgraded attempt succeeds. Never retry errors classified as `other`.

- [x] **Step 4: Wire cache lookup before budget resolution**

In the HTTP path of `canvas:task:generate-text`:

1. Resolve `model` and `apiKind`.
2. Build the capability key from profile ID, endpoint, model, and API kind.
3. Read `learnedMaxTokens` from a lazily created cache backed by `SettingsRepository(getDatabase())`.
4. Pass `operation` and `learnedMaxTokens` into `resolveCanvasTextTokenBudget`.
5. Call `generateCanvasTextWithAdaptiveOutput`, with the callback invoking `generateCanvasText({... maxTokens: attempt })`.
6. Record exact learned caps or successful downgrade values.

In the existing `provider:update` and `provider:delete` IPC handlers, call `getCanvasTextOutputCapabilityCache().clearProvider(req.id)` after the Provider mutation succeeds. Endpoint/model changes also create new cache keys, while explicit clearing removes obsolete rows promptly.

Do not apply HTTP parameter retries to the local CLI/Session runtime path because that path does not send this IPC `maxTokens` as a direct provider request parameter.

- [x] **Step 5: Add retry and budget diagnostics to raw responses**

Extend `buildCanvasTextRawResponse` inputs and output with:

```ts
desiredMaxTokens
remainingContextTokens
contextSafetyTokens
learnedOutputCap
outputLimitRetryCount
outputLimitAttempts
outputLimitEvidence
```

On final failure, preserve the last provider request summary and the full attempt list.

- [x] **Step 6: Run focused desktop tests and verify GREEN**

```bash
pnpm --filter @spark/desktop exec vitest run \
  src/main/ipc/canvasTextTaskDiagnostics.test.ts \
  src/main/ipc/canvasTextOutputCapability.test.ts \
  src/main/ipc/canvasTextAdaptiveGeneration.test.ts
```

Expected: all focused tests pass.

- [x] **Step 7: Commit Task 4 files only**

```bash
git add apps/desktop/src/main/ipc/index.ts \
  apps/desktop/src/main/ipc/canvasTextTaskDiagnostics.ts \
  apps/desktop/src/main/ipc/canvasTextTaskDiagnostics.test.ts \
  apps/desktop/src/main/ipc/canvasTextAdaptiveGeneration.ts \
  apps/desktop/src/main/ipc/canvasTextAdaptiveGeneration.test.ts
git commit -m "feat(canvas): retry unsupported text output budgets"
```

### Task 5: Verify integration and refresh documentation status

**Files:**
- Modify: `docs/superpowers/specs/2026-07-18-canvas-text-output-budget-design.md`
- Modify: `docs/superpowers/plans/2026-07-18-canvas-text-output-budget.md`

- [x] **Step 1: Run all affected unit tests**

```bash
pnpm --filter @spark/agent-runtime exec vitest run \
  src/__tests__/services/canvas-text-generator.test.ts \
  src/__tests__/services/provider.service.test.ts
pnpm --filter @spark/desktop exec vitest run \
  src/main/ipc/canvasTextTaskDiagnostics.test.ts \
  src/main/ipc/canvasTextOutputCapability.test.ts \
  src/main/ipc/canvasTextAdaptiveGeneration.test.ts
```

Expected: all affected tests pass with zero failures.

- [x] **Step 2: Run type checks and focused lint**

```bash
pnpm --filter @spark/agent-runtime typecheck
pnpm --filter @spark/desktop typecheck
pnpm --filter @spark/agent-runtime exec eslint \
  src/services/canvas-text-generator.ts \
  src/__tests__/services/canvas-text-generator.test.ts
pnpm --filter @spark/desktop exec eslint \
  src/main/ipc/canvasTextTaskDiagnostics.ts \
  src/main/ipc/canvasTextTaskDiagnostics.test.ts \
  src/main/ipc/canvasTextOutputCapability.ts \
  src/main/ipc/canvasTextOutputCapability.test.ts \
  src/main/ipc/canvasTextAdaptiveGeneration.ts \
  src/main/ipc/canvasTextAdaptiveGeneration.test.ts \
  src/main/ipc/index.ts
git diff --check
```

Expected: commands exit zero; pre-existing lint warnings may be reported separately, but no new errors or warnings may originate from changed lines.

- [x] **Step 3: Inspect the final diff and direct call sites**

```bash
rg -n "resolveCanvasTextTokenBudget|generateCanvasTextWithAdaptiveOutput|DEFAULT_MAX_TOKENS" \
  apps/desktop/src/main packages/agent-runtime/src
git diff --stat
git diff -- apps/desktop/src/main/ipc packages/agent-runtime/src/services/canvas-text-generator.ts \
  docs/superpowers/specs/2026-07-18-canvas-text-output-budget-design.md
```

Confirm the change is limited to canvas text budgets, adaptive retries, learned capability storage, diagnostics, and their documentation. GitNexus impact/detect steps are skipped only if MCP remains unavailable or the stale index cannot be safely refreshed without touching user-owned dirty instruction files.

- [x] **Step 4: Mark design and plan as landed**

Change the status lines in both documents to:

```text
> 状态: 已落地 | 最后核对: 2026-07-18
```

Mark every implementation-plan checkbox complete.

- [x] **Step 5: Commit verification documentation only**

```bash
git add docs/superpowers/specs/2026-07-18-canvas-text-output-budget-design.md \
  docs/superpowers/plans/2026-07-18-canvas-text-output-budget.md
git commit -m "docs(canvas): mark adaptive text budgets landed"
```
