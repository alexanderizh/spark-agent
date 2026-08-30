# Canvas Input Bindings and Model Reference Protocol Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-17

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify every canvas task input entry point and emit model-readable image/text references whose labels match the final provider payload.

**Architecture:** Introduce a protocol-level binding list and a renderer pure model as the only task-input truth. UI surfaces become projections of bindings, while a two-stage compiler resolves/deduplicates inputs before assigning provider-facing ordinals and rendering text boundaries.

**Tech Stack:** TypeScript, React 19, Lexical, Vitest, Electron IPC, `@spark/protocol`, `@spark/agent-runtime`.

---

### Task 1: Protocol and pure binding model

**Files:**

- Modify: `packages/protocol/src/canvas-prompt.ts`
- Modify: `packages/protocol/src/schemas/index.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasInputBindings.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasInputBindings.test.ts`

- [x] **Step 1: Write failing tests for connection/manual/picker bindings, same-role deduplication, different-role preservation, disable/remove semantics, and derived active node IDs.**

```ts
expect(addCanvasInputBinding([], imageBinding({ id: 'a' }))).toHaveLength(1)
expect(addCanvasInputBinding([imageBinding({ id: 'a' })], imageBinding({ id: 'b' }))).toHaveLength(
  1,
)
expect(removeCanvasInputBinding([connectionBinding], connectionBinding.id)[0]?.enabled).toBe(false)
expect(removeCanvasInputBinding([manualBinding], manualBinding.id)).toEqual([])
```

- [x] **Step 2: Run `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasInputBindings.test.ts` and verify failures are caused by the missing model.**

- [x] **Step 3: Add protocol types and implement pure normalization/actions without React or IPC dependencies.**

```ts
export function activeCanvasInputBindings(bindings: CanvasInputBinding[]) {
  return bindings.filter((binding) => binding.enabled).sort(compareBindingOrder)
}
```

- [x] **Step 4: Run the focused tests and protocol schema tests until green.**

### Task 2: Model-facing text and media presentation

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasModelInputPresentation.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasModelInputPresentation.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasTextInputPresentation.ts`

- [x] **Step 1: Write failing tests for storyboard JSON/table parity, generic Markdown table records, raw text boundaries, empty-field omission, and stable reference labels.**

```ts
expect(
  renderCanvasTextReference({ ordinal: 1, label: '分镜脚本', relation: 'storyboard', content }),
).toContain('[文本引用 T1 开始]')
expect(
  renderCanvasReferenceImageList([{ ordinal: 1, label: '苏烬', relation: 'character' }]),
).toContain('参考图 #1：苏烬（角色）')
```

- [x] **Step 2: Run the focused test and verify the desired APIs are missing.**

- [x] **Step 3: Implement field-value serializers using `parseShotTable`; keep UI Markdown formatting available but remove it from the model request path.**

- [x] **Step 4: Run focused text, shot-table and presentation tests until green.**

### Task 3: Two-stage prompt compilation

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasPromptCompiler.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasPromptCompiler.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasPromptSubmission.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasPromptSubmission.test.ts`

- [x] **Step 1: Add failing tests proving reference image ordinals use only the final reference-file order, text uses T ordinals and boundaries, duplicate media mentions reuse one file, and structured text cannot shift image numbering.**

```ts
expect(result.compiledUserText).toContain('参考图 #1：小满')
expect(result.inputFiles?.filter((file) => file.role === 'reference')).toHaveLength(1)
expect(result.relationManifest[0]?.modelReference).toMatchObject({
  channel: 'reference_images',
  ordinal: 1,
})
```

- [x] **Step 2: Run compiler/submission tests and verify legacy `ref-n` output causes the expected failures.**

- [x] **Step 3: Resolve all active blocks/bindings and input files first, assign per-channel ordinals second, and render prompt third.**

- [x] **Step 4: Preserve legacy calls by deriving bindings when `inputBindings` is absent; run focused tests until green.**

### Task 4: UI binding coordination

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/useCanvasInputBindings.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/useCanvasInputBindings.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasPromptComposer.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasPromptLexicalNode.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.test.ts`

- [x] **Step 1: Write failing component/model tests for `@` image/text addition, Tag removal, media-strip removal, connected-input suppression and prompt-block cleanup.**

```ts
expect(afterRemovingPromptTag.activeBindings).not.toContainEqual(
  expect.objectContaining({ sourceNodeId: 'image-1' }),
)
expect(afterRemovingMediaTile.document.blocks).not.toContainEqual(
  expect.objectContaining({ sourceNodeId: 'image-1' }),
)
```

- [x] **Step 2: Verify the tests fail because the existing callbacks only mutate `promptDocument` or local ID arrays.**

- [x] **Step 3: Implement the Hook as the state coordinator; expose coordinated document, binding, role-selection and removal actions.**

- [x] **Step 4: Wire composer and strip callbacks to the Hook. Keep orchestration changes in `CanvasOperationPanel.tsx` small enough to remain below 3000 lines.**

- [x] **Step 5: Run focused component tests until green.**

### Task 5: Persistence, validation, and provider contract

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasOperationSubmission.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasTaskSubmissionValidation.ts`
- Modify: `apps/desktop/src/main/ipc/canvas-prompt-runtime.ts`
- Modify tests adjacent to each file
- Extend existing xAI adapter contract tests without overwriting concurrent media capability work

- [x] **Step 1: Write failing tests for draft/reopen/retry binding preservation, final-input-only validation, and xAI request order.**

```ts
expect(capture.body?.reference_images?.[0]).toEqual(expectedFirstReference)
expect(String(capture.body?.prompt)).toContain('参考图 #1')
```

- [x] **Step 2: Verify failures occur at persistence/contract boundaries, not test setup.**

- [x] **Step 3: Thread optional `inputBindings` through task fields and compile before validation; preserve existing adapter ordering.**

- [x] **Step 4: Run renderer, IPC and agent-runtime contract tests until green.**

### Task 6: Regression and delivery verification

**Files:**

- Modify: `docs/design/canvas-prompt-composer.md`
- Review: all files changed by this plan

- [x] **Step 1: Update current-behavior documentation and freshness date.**

- [x] **Step 2: Run focused Vitest suites for bindings, composer, panel, compiler, submission, validation, IPC and xAI.**

- [x] **Step 3: Run `pnpm --filter @spark/desktop typecheck`, relevant protocol/runtime tests, and lint on touched source files.**

- [x] **Step 4: Review `git diff --check`, `git diff --stat`, direct call sites, and the final diff; confirm unrelated shared-worktree changes remain untouched.**

- [x] **Step 5: Verify the design acceptance list line by line and report any remaining limitation instead of claiming completion.**

验证记录：本方案定向桌面端测试、renderer typecheck、协议 typecheck/schema、xAI 请求合约、相关 lint 与 `git diff --check` 均通过。共享工作区完整 desktop typecheck 的 node 阶段仍受另一项并行媒体适配改动影响，错误位于 `openai-compatible-media.adapter.ts`，未越界修改。
