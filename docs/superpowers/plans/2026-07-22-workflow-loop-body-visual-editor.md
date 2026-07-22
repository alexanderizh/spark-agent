# Workflow Loop Body Visual Editor Implementation Plan

> 状态: 实施中 | 最后核对: 2026-07-22

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在桌面端工作流编辑器中为 `loop.config.body` 提供完整的可视化子图编辑画布，同时保持现有协议、导入导出和运行时兼容。

**Architecture:** 主工作流始终作为根图草稿保存；进入循环体时记录目标 loop 节点和父图快照，把 body 转换为当前 React Flow 画布。返回或保存时通过纯函数校验并把当前子图写回目标 loop 的 `config.body`。状态转换和校验放入独立模块，工具栏和循环体摘要拆成小组件，`WorkflowView` 只负责协调。

**Tech Stack:** React 19、TypeScript、`@xyflow/react`、Vitest、Lobe UI、现有 `WorkflowGraph` 协议。

---

## File map

- Create `apps/desktop/src/renderer/design/views/workflow/loop-body-editor.ts`: 父图/子图切换、校验、摘要、ID 生成纯函数。
- Create `apps/desktop/src/renderer/design/views/workflow/loop-body-editor.test.ts`: 纯函数 TDD 覆盖。
- Create `apps/desktop/src/renderer/design/views/workflow/WorkflowLoopBodyToolbar.tsx`: 子图模式面包屑和返回动作。
- Create `apps/desktop/src/renderer/design/views/workflow/WorkflowLoopBodyToolbar.test.tsx`: 工具栏静态渲染测试。
- Create `apps/desktop/src/renderer/design/views/workflow/WorkflowLoopBodySummary.tsx`: Inspector 中的摘要、可视化入口和高级 JSON 折叠区。
- Create `apps/desktop/src/renderer/design/views/workflow/WorkflowLoopBodySummary.test.tsx`: 摘要和禁用状态测试。
- Modify `apps/desktop/src/renderer/design/views/WorkflowView.tsx`: 接入编辑范围、保存、返回、禁用嵌套 loop 和 Inspector 回调。
- Modify `apps/desktop/src/renderer/design/views/workflow/WorkflowContextMenu.tsx`: 支持禁用指定节点类型。
- Modify `apps/desktop/src/renderer/design/views/workflow/graph-adapter.test.ts`: 增加 loop body 条件边与方向往返测试。
- Modify `apps/desktop/src/renderer/design/styles/views.css`: 子图工具栏、摘要、禁用节点样式。
- Modify `apps/website/src/content/docs-pages/workflow-usage.tsx`: 明确 Skill、Tool、MCP 为可选扩展，并加入可视化循环体编辑说明。
- Modify `apps/website/src/content/docs.ts`: 刷新工作流文档摘要与核对日期（若正文搜索摘要发生变化）。
- Modify `docs/superpowers/specs/2026-07-22-workflow-loop-body-visual-editor-design.md`: 完成后标记“已落地”。
- Modify `docs/superpowers/plans/2026-07-22-workflow-loop-body-visual-editor.md`: 实施完成后更新状态和勾选项。

### Task 1: Build loop body graph state and validation helpers

**Files:**

- Create: `apps/desktop/src/renderer/design/views/workflow/loop-body-editor.ts`
- Create: `apps/desktop/src/renderer/design/views/workflow/loop-body-editor.test.ts`

- [ ] **Step 1: Write failing tests for graph lookup, summary and commit**

```ts
it('opens an existing loop body and commits it back without changing siblings', () => {
  const opened = openLoopBodyGraph(rootGraph, 'loop-1', defaultLoopBodyGraph())
  expect(opened.graph.orientation).toBe('vertical')

  const changed = { ...opened.graph, orientation: 'horizontal' as const }
  const committed = commitLoopBodyGraph(rootGraph, 'loop-1', changed)

  expect(committed.nodes.find((node) => node.id === 'loop-1')?.config.body).toEqual(changed)
  expect(committed.nodes.find((node) => node.id === 'sibling')).toEqual(
    rootGraph.nodes.find((node) => node.id === 'sibling'),
  )
})

it('summarizes nodes, edges, conditional edges and orientation', () => {
  expect(summarizeLoopBodyGraph(bodyGraph)).toEqual({
    nodeCount: 2,
    edgeCount: 1,
    conditionalEdgeCount: 1,
    orientation: 'vertical',
  })
})
```

- [ ] **Step 2: Run the helper test and verify it fails**

Run:

```bash
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/workflow/loop-body-editor.test.ts
```

Expected: FAIL because `loop-body-editor.ts` and its exports do not exist.

- [ ] **Step 3: Implement the scope types and immutable graph operations**

```ts
export type WorkflowEditorScope =
  | { kind: 'root' }
  | { kind: 'loop-body'; loopNodeId: string; rootGraph: WorkflowGraph }

export function openLoopBodyGraph(
  rootGraph: WorkflowGraph,
  loopNodeId: string,
  fallback: WorkflowGraph,
): { graph: WorkflowGraph; loopTitle: string } {
  const loopNode = rootGraph.nodes.find((node) => node.id === loopNodeId && node.kind === 'loop')
  if (loopNode == null) throw new Error(`Loop node ${loopNodeId} not found.`)
  return {
    graph: isWorkflowGraph(loopNode.config.body)
      ? structuredClone(loopNode.config.body)
      : structuredClone(fallback),
    loopTitle: loopNode.title,
  }
}

export function commitLoopBodyGraph(
  rootGraph: WorkflowGraph,
  loopNodeId: string,
  body: WorkflowGraph,
): WorkflowGraph {
  return {
    ...rootGraph,
    nodes: rootGraph.nodes.map((node) =>
      node.id === loopNodeId
        ? { ...node, config: { ...node.config, body: structuredClone(body) } }
        : node,
    ),
  }
}
```

Also export `defaultLoopBodyGraph`, `summarizeLoopBodyGraph`, `isWorkflowGraph`, and `collectWorkflowNodeIds` so defaults and validation have one source of truth.

- [ ] **Step 4: Add failing validation tests**

Cover these exact error codes:

```ts
expect(validateLoopBodyGraph(emptyGraph, rootGraph, 'loop-1')).toContainEqual({
  code: 'empty_body',
  message: '循环体至少需要一个节点。',
})
expect(validateLoopBodyGraph(nestedLoopGraph, rootGraph, 'loop-1')[0]?.code).toBe('nested_loop')
expect(validateLoopBodyGraph(collisionGraph, rootGraph, 'loop-1')[0]?.code).toBe(
  'node_id_collision',
)
expect(validateLoopBodyGraph(danglingEdgeGraph, rootGraph, 'loop-1')[0]?.code).toBe('dangling_edge')
expect(validateLoopBodyGraph(cyclicGraph, rootGraph, 'loop-1')[0]?.code).toBe('cycle')
```

- [ ] **Step 5: Implement deterministic validation and scoped ID creation**

`validateLoopBodyGraph` must return all discoverable errors in stable node/edge order. `createScopedWorkflowNodeId` must generate `{loopNodeId}__{kind}-{sequence}` and retry while the ID exists in either graph.

```ts
export type LoopBodyValidationError = {
  code:
    | 'empty_body'
    | 'nested_loop'
    | 'duplicate_node_id'
    | 'node_id_collision'
    | 'dangling_edge'
    | 'invalid_condition'
    | 'cycle'
  message: string
  nodeId?: string
  edgeId?: string
}
```

- [ ] **Step 6: Run helper tests**

Run the Task 1 Vitest command again.

Expected: all loop body helper tests PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add apps/desktop/src/renderer/design/views/workflow/loop-body-editor.ts \
  apps/desktop/src/renderer/design/views/workflow/loop-body-editor.test.ts
git commit -m "feat(workflow): add loop body graph helpers"
```

### Task 2: Add focused loop body UI components and disabled node kinds

**Files:**

- Create: `apps/desktop/src/renderer/design/views/workflow/WorkflowLoopBodyToolbar.tsx`
- Create: `apps/desktop/src/renderer/design/views/workflow/WorkflowLoopBodyToolbar.test.tsx`
- Create: `apps/desktop/src/renderer/design/views/workflow/WorkflowLoopBodySummary.tsx`
- Create: `apps/desktop/src/renderer/design/views/workflow/WorkflowLoopBodySummary.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/workflow/WorkflowContextMenu.tsx`

- [ ] **Step 1: Write static rendering tests**

Use `renderToStaticMarkup` to assert:

```tsx
const toolbar = renderToStaticMarkup(
  <WorkflowLoopBodyToolbar
    workflowName="编码流程"
    loopTitle="实现与自检"
    onBack={() => undefined}
  />,
)
expect(toolbar).toContain('返回主工作流')
expect(toolbar).toContain('编码流程')
expect(toolbar).toContain('实现与自检')

const summary = renderToStaticMarkup(
  <WorkflowLoopBodySummary
    summary={{ nodeCount: 2, edgeCount: 1, conditionalEdgeCount: 1, orientation: 'vertical' }}
    jsonDraft="{}"
    jsonError=""
    onOpen={() => undefined}
    onReset={() => undefined}
    onJsonChange={() => undefined}
  />,
)
expect(summary).toContain('2 个节点')
expect(summary).toContain('1 条连线')
expect(summary).toContain('编辑循环体')
expect(summary).toContain('高级 JSON')
```

- [ ] **Step 2: Run component tests and verify they fail**

```bash
pnpm --filter @spark/desktop exec vitest run \
  src/renderer/design/views/workflow/WorkflowLoopBodyToolbar.test.tsx \
  src/renderer/design/views/workflow/WorkflowLoopBodySummary.test.tsx
```

Expected: FAIL because both components do not exist.

- [ ] **Step 3: Implement toolbar and summary components**

The toolbar uses the existing `Button` and `Icons.ArrowLeft`. The summary uses a semantic `<details>` for Advanced JSON and receives all state through props; it must not own a second body graph.

- [ ] **Step 4: Extend the context menu with disabled node kinds**

Add:

```ts
disabledNodeKinds?: ReadonlySet<WorkflowNodeKind>
```

Pane menu buttons must set `disabled`, add a tooltip for loop, and never call `onAddNode` when disabled.

- [ ] **Step 5: Run Task 2 tests**

Expected: both component tests PASS. Add a context-menu assertion if the component is exported through a testable render path.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/desktop/src/renderer/design/views/workflow/WorkflowLoopBodyToolbar.tsx \
  apps/desktop/src/renderer/design/views/workflow/WorkflowLoopBodyToolbar.test.tsx \
  apps/desktop/src/renderer/design/views/workflow/WorkflowLoopBodySummary.tsx \
  apps/desktop/src/renderer/design/views/workflow/WorkflowLoopBodySummary.test.tsx \
  apps/desktop/src/renderer/design/views/workflow/WorkflowContextMenu.tsx
git commit -m "feat(workflow): add loop body editor controls"
```

### Task 3: Integrate drill-down editing into WorkflowView

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/WorkflowView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/workflow/graph-adapter.test.ts`

- [ ] **Step 1: Move the default body and graph guards to the helper module**

Delete `defaultLoopBodyGraph` and `isWorkflowGraphLike` duplicates from `WorkflowView.tsx`, importing their tested equivalents from `loop-body-editor.ts`.

- [ ] **Step 2: Add editor scope and root graph snapshot state**

```ts
const [editorScope, setEditorScope] = useState<WorkflowEditorScope>({ kind: 'root' })
const editingLoopBody = editorScope.kind === 'loop-body'
```

`loadWorkflowIntoCanvas` always resets to root scope. Entering a body first serializes the current root canvas, stores it in scope, then loads the body through `graphToReactFlow`.

- [ ] **Step 3: Add one composition function used by dirty state, return and save**

```ts
const currentEditorGraph = () => reactFlowToGraph(nodes, edges, orientation)
const completeRootGraph = () =>
  editorScope.kind === 'loop-body'
    ? commitLoopBodyGraph(editorScope.rootGraph, editorScope.loopNodeId, currentEditorGraph())
    : currentEditorGraph()
```

Do not duplicate this composition in three callbacks. Dirty comparison must serialize `completeRootGraph()` so body edits immediately mark the page dirty.

- [ ] **Step 4: Implement enter, return and save callbacks**

`openLoopBodyEditor(loopNodeId)` loads body nodes/edges/direction, clears selection, closes menus, then fits the child graph.

`returnToRootGraph()` validates current body. On errors, show one toast containing the first message and retain the child canvas. On success, load the composed root graph and reselect the parent loop.

`saveWorkflow()` validates and composes the body before invoking `workflow:update`. After saving while in child mode, update the scope root snapshot from the saved graph but keep the user inside the same child editor.

- [ ] **Step 5: Prevent nested loops through every creation path**

- Palette: loop button is disabled in child mode with title “运行时 v1 不支持嵌套循环”。
- Pane context menu: pass `new Set(['loop'])` as `disabledNodeKinds`.
- `addNodeAt`: return early when child mode requests `loop`.
- Inspector kind selector: remove `loop` from options in child mode and guard `handleKindChange`.
- Duplication: existing non-loop nodes remain duplicable; malformed old nested loop nodes can be deleted but not copied.

- [ ] **Step 6: Replace the raw loop JSON section with WorkflowLoopBodySummary**

Extend `InspectorProps` with:

```ts
editingLoopBody: boolean
onOpenLoopBody: (loopNodeId: string) => void
onResetLoopBody: (loopNodeId: string) => void
```

Only root loop nodes show the visual editor entry. Advanced JSON keeps the existing parse-without-write-on-error behavior. Reset uses the existing confirmation service before applying `defaultLoopBodyGraph()`.

- [ ] **Step 7: Add the child toolbar**

Render `WorkflowLoopBodyToolbar` instead of the root name/status controls while `editingLoopBody`. Keep orientation, node palette and Save actions visible. Delete Workflow must only be available in root mode.

- [ ] **Step 8: Expand graph adapter regression coverage**

Add a root graph containing a loop whose body has vertical orientation and a conditional edge. Round trip the root graph and separately round trip the body; expect both conditions and orientations unchanged.

- [ ] **Step 9: Run focused tests and desktop typecheck**

```bash
pnpm --filter @spark/desktop exec vitest run \
  src/renderer/design/views/workflow/loop-body-editor.test.ts \
  src/renderer/design/views/workflow/graph-adapter.test.ts \
  src/renderer/design/views/workflow/WorkflowLoopBodyToolbar.test.tsx \
  src/renderer/design/views/workflow/WorkflowLoopBodySummary.test.tsx
pnpm --filter @spark/desktop exec tsc --noEmit -p tsconfig.json
```

Expected: focused tests PASS and renderer typecheck exits 0.

- [ ] **Step 10: Commit Task 3**

```bash
git add apps/desktop/src/renderer/design/views/WorkflowView.tsx \
  apps/desktop/src/renderer/design/views/workflow/graph-adapter.test.ts
git commit -m "feat(workflow): edit loop bodies visually"
```

### Task 4: Style the editor and update user documentation

**Files:**

- Modify: `apps/desktop/src/renderer/design/styles/views.css`
- Modify: `apps/website/src/content/docs-pages/workflow-usage.tsx`
- Modify: `apps/website/src/content/docs.ts`

- [ ] **Step 1: Add focused styles**

Add styles for `.wf-loop-body-toolbar`, `.wf-loop-breadcrumb`, `.wf-loop-summary`, `.wf-loop-summary-stats`, `.wf-loop-json-details`, and disabled palette/context-menu buttons. Preserve the existing 980px responsive breakpoint.

- [ ] **Step 2: Update the website guide**

Add an “打开循环体可视化编辑器” procedure and explicitly label Skill / Tool / MCP as optional parallel audit extensions:

```text
Skill = 固定方法论；Tool = 限制手段；MCP = 连接外部系统。
普通本地编码流程可以删除 MCP；没有独立审计需求时可以删除 Tool。
```

- [ ] **Step 3: Run formatting and website build**

```bash
pnpm exec prettier --write \
  apps/desktop/src/renderer/design/views/WorkflowView.tsx \
  apps/desktop/src/renderer/design/views/workflow/loop-body-editor.ts \
  apps/desktop/src/renderer/design/views/workflow/WorkflowLoopBodyToolbar.tsx \
  apps/desktop/src/renderer/design/views/workflow/WorkflowLoopBodySummary.tsx \
  apps/desktop/src/renderer/design/styles/views.css \
  apps/website/src/content/docs-pages/workflow-usage.tsx \
  apps/website/src/content/docs.ts
pnpm --filter @spark/website build
```

Expected: formatting exits 0 and website production build succeeds.

- [ ] **Step 4: Commit Task 4**

```bash
git add apps/desktop/src/renderer/design/styles/views.css \
  apps/website/src/content/docs-pages/workflow-usage.tsx \
  apps/website/src/content/docs.ts
git commit -m "docs(workflow): explain visual loop body editing"
```

### Task 5: Visual QA, full verification, code review and documentation freshness

**Files:**

- Modify: `docs/superpowers/specs/2026-07-22-workflow-loop-body-visual-editor-design.md`
- Modify: `docs/superpowers/plans/2026-07-22-workflow-loop-body-visual-editor.md`

- [ ] **Step 1: Run desktop visual QA**

Launch the desktop app or a controlled component harness and verify with normal clicks:

1. Open a workflow containing a loop.
2. Click “编辑循环体”.
3. Add an agent and review node, connect them, configure a condition, change orientation.
4. Confirm loop is disabled in palette and pane context menu.
5. Return to root; reopen body and confirm changes persisted in draft.
6. Save, refresh, and confirm the body reloads.
7. Confirm an invalid empty body blocks save with a readable message.

Capture root, child editor, Advanced JSON, and validation-error screenshots.

- [ ] **Step 2: Run full relevant verification**

```bash
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/workflow \
  src/services/workflow-executor.test.ts
pnpm --filter @spark/desktop typecheck
pnpm --filter @spark/desktop build
pnpm --filter @spark/website build
git diff --check
```

Expected: tests, both desktop TypeScript configs, desktop build, website build and diff check all succeed. If the runtime test path is not owned by desktop Vitest, run it through `@spark/agent-runtime` instead.

- [ ] **Step 3: Review the diff and fix findings**

Review these failure modes explicitly:

- child save overwriting root graph;
- dirty state failing to include unsaved body changes;
- loop creation still possible through one path;
- body orientation or conditional edges lost on round trip;
- stale selected node/edge after scope switch;
- advanced JSON overwriting live child edits;
- unrelated dirty-worktree files accidentally included.

Re-run the focused tests and typecheck after every fix.

- [ ] **Step 4: Refresh docs status**

Set the design and plan status to `已落地`, refresh `最后核对: 2026-07-22`, and mark all completed plan checkboxes.

- [ ] **Step 5: Update GitNexus index or record the documented fallback**

Run the repository GitNexus incremental analyze command from the project skill. If unavailable or incompatible, use direct caller search, focused tests and `git diff` as required by `AGENTS.md`, then note the downgrade in delivery.

- [ ] **Step 6: Final commit**

```bash
git add docs/superpowers/specs/2026-07-22-workflow-loop-body-visual-editor-design.md \
  docs/superpowers/plans/2026-07-22-workflow-loop-body-visual-editor.md
git commit -m "docs(workflow): mark loop body editor implemented"
```
