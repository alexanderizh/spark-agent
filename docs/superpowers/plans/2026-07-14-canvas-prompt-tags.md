# Canvas Prompt Tag 编排与编译实施计划

> 状态: 实施中 | 最后核对: 2026-07-14

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将画布任务节点的普通字符串提示词升级为带缩略图、关系语义、结构化参数和冻结输入快照的多模态 Prompt Document，并确保最终 Provider 入参可复现、可审计。

**Architecture:** 以 `@spark/protocol` 的版本化 Prompt Document 类型作为跨进程契约；renderer 负责编辑、节点引用解析和确定性编译，main/runtime 只消费编译结果并把系统能力提示词与用户输入分层传给 Provider。任务本地快照保存用户文档、关系清单和输入媒体稳定引用，任务详情复用同一预览组件。

**Tech Stack:** React 19 + TypeScript + Ant Design + Vitest + Electron IPC + 现有 Canvas API/媒体 Provider adapter；不新增富文本编辑器依赖，使用受控 block composer + `contentEditable`/隐藏纯文本 fallback。

---

## 文件地图与边界

新增文件：

- `packages/protocol/src/canvas-prompt.ts`：跨进程 Prompt Document、关系、快照和编译结果类型。
- `packages/protocol/src/canvas-prompt-ipc-augmentation.ts`：通过 TypeScript module augmentation 给现有 IPC request 增加可选 Prompt 字段，避免继续膨胀 `ipc/index.ts`。
- `packages/protocol/src/canvas-prompt.test.ts`：协议默认值、版本和 JSON round-trip 测试。
- `apps/desktop/src/renderer/design/views/canvas/canvasPromptDocument.ts`：block 编辑、规范化、旧字符串迁移和纯文本 fallback。
- `apps/desktop/src/renderer/design/views/canvas/canvasPromptDocument.test.ts`：迁移、编辑、撤销数据和失效引用测试。
- `apps/desktop/src/renderer/design/views/canvas/canvasPromptCompiler.ts`：唯一的提交编译入口。
- `apps/desktop/src/renderer/design/views/canvas/canvasPromptCompiler.test.ts`：关系清单、输入 role、结构化文本和错误测试。
- `apps/desktop/src/renderer/design/views/canvas/canvasPromptConnections.ts`：Tag/`used_as_input` 连线同步。
- `apps/desktop/src/renderer/design/views/canvas/canvasPromptConnections.test.ts`：连线去重、断线和失效态测试。
- `apps/desktop/src/renderer/design/views/canvas/CanvasPromptComposer.tsx`：block composer 主视图。
- `apps/desktop/src/renderer/design/views/canvas/CanvasPromptComposer.test.tsx`：composer、胶囊和悬浮窗交互测试。
- `apps/desktop/src/renderer/design/views/canvas/CanvasPromptHoverCard.tsx`：缩略图、完整内容和内部滚动预览。
- `apps/desktop/src/renderer/design/views/canvas/canvasPromptComposer.less`：胶囊、悬浮窗、失效态和无障碍焦点样式。
- `apps/desktop/src/renderer/design/views/canvas/CanvasTaskInputSnapshotList.tsx`：任务详情输入快照列表。
- `apps/desktop/src/renderer/design/views/canvas/canvasTaskInputSnapshotList.test.tsx`：任务详情快照渲染测试。

按职责修改的现有文件：

- `packages/protocol/src/index.ts`：导出新协议模块（保持该文件小而稳定）。
- `apps/desktop/src/renderer/design/views/canvas/canvas.types.ts`：CanvasNode/CanvasTask/CreateCanvasTaskRequest 引入 Prompt 字段。
- `apps/desktop/src/renderer/design/views/canvas/CanvasPromptMentionTextArea.tsx`：保留旧导出名，内部委托新版 composer，兼容既有调用方。
- `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.tsx`：仅替换两处输入组件 wiring；不把编译逻辑放入 2854 行面板。
- `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`：仅接入独立 submission helper，删除散落的 prompt/context 拼接调用；不在 8939 行文件新增业务逻辑。
- `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts`：仅透传/持久化 Prompt 字段，保留旧 prompt 兼容；不在 5615 行文件新增编译算法。
- `apps/desktop/src/renderer/design/views/canvas/CanvasTaskQueue.tsx`：插入快照列表组件，保留现有系统提示词、compiled prompt、request body 区块。
- `apps/desktop/src/main/ipc/index.ts`：只做 IPC handler 的最小 wiring，把 `systemPrompt`、`compiledUserText` 和关系摘要传入独立 helper；不在 3600 行 handler 内新增解析逻辑。
- `packages/agent-runtime/src/services/canvas-text-generator.ts`：扩展调用参数以接受已编译用户文本/图片输入，保持 provider content parts 逻辑集中。
- `apps/desktop/src/renderer/design/views/canvas/canvasTaskInputFiles.ts`、`canvasWorkspaceTaskInput.ts`：复用并扩展 role/快照转换，避免重复上传实现。

## Task 1: 建立跨进程 Prompt Document 契约

**Files:**

- Create: `packages/protocol/src/canvas-prompt.ts`
- Create: `packages/protocol/src/canvas-prompt-ipc-augmentation.ts`
- Create: `packages/protocol/src/canvas-prompt.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.types.ts`

- [ ] **Step 1: Write failing protocol tests**

在 `canvas-prompt.test.ts` 覆盖：`version: 2` 的 document JSON round-trip；`reference`、`parameter`、`structured` block 的必填字段；`CanvasPromptTaskFields` 缺省字段不改变旧 request。

```ts
it('round-trips a mixed document without losing relation order', () => {
  const document: CanvasPromptDocument = {
    version: 2,
    blocks: [
      { kind: 'text', id: 't1', text: '让' },
      { kind: 'reference', id: 'r1', source: 'manual', sourceNodeId: 'n1', relation: 'character', label: '小满', order: 0 },
      { kind: 'structured', id: 's1', sourceNodeId: 'n2', schema: 'storyboard', summary: '镜头 03–06' },
    ],
  }
  expect(JSON.parse(JSON.stringify(document))).toEqual(document)
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter @spark/protocol exec vitest run src/canvas-prompt.test.ts`

Expected: FAIL because the new types/module do not exist。

- [ ] **Step 3: Implement the protocol types and IPC augmentation**

在 `canvas-prompt.ts` 定义 `CanvasPromptDocument`、`CanvasPromptBlock`、`CanvasPromptRelation`、`CanvasPromptSnapshot`、`CanvasPromptInputSnapshot`、`CanvasPromptCompilation`、`CanvasPromptTaskFields` 和 `CanvasPromptResponseFields`。在 augmentation 中声明：

```ts
declare module './ipc/index.js' {
  interface CanvasMediaTaskCreateRequest extends CanvasPromptTaskFields {}
  interface CanvasTextTaskCreateRequest extends CanvasPromptTaskFields {}
  interface CanvasMediaTaskCreateResponse extends CanvasPromptResponseFields {}
  interface CanvasTextTaskCreateResponse extends CanvasPromptResponseFields {}
}
```

让 `packages/protocol/src/index.ts` 导出两个新模块；`canvas.types.ts` 用交叉类型引入 task/request 字段。

- [ ] **Step 4: Run protocol tests and typecheck**

Run: `pnpm --filter @spark/protocol exec vitest run src/canvas-prompt.test.ts && pnpm --filter @spark/protocol run typecheck`

Expected: PASS，且旧 IPC interface 的现有测试不回归。

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/canvas-prompt.ts packages/protocol/src/canvas-prompt-ipc-augmentation.ts packages/protocol/src/canvas-prompt.test.ts packages/protocol/src/index.ts apps/desktop/src/renderer/design/views/canvas/canvas.types.ts
git commit -m "feat(protocol): add canvas prompt document contract"
```

## Task 2: 实现 Document 编辑模型与旧数据迁移

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasPromptDocument.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasPromptDocument.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasPromptMentions.ts`

- [ ] **Step 1: Write failing migration and edit tests**

测试 `migrateLegacyPrompt` 将 `@[角色](node:n1)` 转成 reference block；固定的“画布节点内容”段仅转成 reference/structured block；普通歧义文本原样保留；插入/删除 Tag 保留文本顺序；删除 block 后能生成纯文本 fallback。

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasPromptDocument.test.ts`

Expected: FAIL because the document helpers do not exist。

- [ ] **Step 3: Implement pure document helpers**

实现以下稳定 API：

```ts
export function emptyCanvasPromptDocument(): CanvasPromptDocument
export function migrateLegacyPrompt(input: { prompt: string; nodes: CanvasNode[]; assets: CanvasAsset[] }): CanvasPromptDocument
export function normalizeCanvasPromptDocument(document: CanvasPromptDocument): CanvasPromptDocument
export function serializeCanvasPromptDocument(document: CanvasPromptDocument): string
export function toCanvasPromptPlainText(document: CanvasPromptDocument): string
export function replacePromptBlock(document: CanvasPromptDocument, blockId: string, next: CanvasPromptBlock): CanvasPromptDocument
export function removePromptBlock(document: CanvasPromptDocument, blockId: string): CanvasPromptDocument
```

扩展现有 mention parser 只负责识别旧 token 和候选项，不再把 token 当作最终发送格式。

- [ ] **Step 4: Run tests and inspect migration snapshots**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasPromptDocument.test.ts src/renderer/design/views/canvas/canvasPromptMentions.test.ts`

Expected: PASS；迁移测试确认未知文本未被删除。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/design/views/canvas/canvasPromptDocument.ts apps/desktop/src/renderer/design/views/canvas/canvasPromptDocument.test.ts apps/desktop/src/renderer/design/views/canvas/canvasPromptMentions.ts
git commit -m "feat(canvas): add prompt document migration model"
```

## Task 3: 建立唯一的确定性 Prompt 编译器

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasPromptCompiler.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasPromptCompiler.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasTaskInputFiles.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasWorkspaceTaskInput.ts`

- [ ] **Step 1: Write failing compiler tests**

覆盖以下输入/结果：角色图片、场景图片、首帧/尾帧图片按 document 首次出现顺序生成 role；分镜 JSON 生成 schema + Markdown 摘要；文本关系 manifest 保留；缺失节点返回阻断错误；系统 prompt 不出现在 `compiledUserText`；相同 document/snapshot 两次编译结果深相等。

```ts
const result = compileCanvasPromptDocument({ document, nodes, assets, operation: 'image_to_video', systemPrompt: 'hidden capability' })
expect(result.compiledUserText).not.toContain('hidden capability')
expect(result.inputFiles.map((file) => file.role)).toEqual(['first_frame', 'last_frame', 'reference'])
expect(result.relationManifest.map((item) => item.relation)).toEqual(['character', 'scene', 'storyboard'])
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasPromptCompiler.test.ts`

Expected: FAIL because the compiler is not implemented。

- [ ] **Step 3: Implement compiler and snapshot helpers**

实现：

```ts
export function compileCanvasPromptDocument(input: {
  document: CanvasPromptDocument
  nodes: CanvasNode[]
  assets: CanvasAsset[]
  operation: CanvasOperationType
  systemPrompt?: string
  negativePrompt?: string
}): CanvasPromptCompilation
```

编译器负责节点解析、稳定 ID、hash/preview 元数据、文本/结构化 block 序列化和 relation manifest；媒体 role 映射集中调用 `buildTaskInputFiles`。`buildCloudTaskInputFiles` 只负责 URL/base64 transport，不再修改关系顺序。data URL 不进入日志预览。

- [ ] **Step 4: Run compiler, input-file and existing text-input tests**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasPromptCompiler.test.ts src/renderer/design/views/canvas/canvasTaskInputFiles.test.ts src/renderer/design/views/canvas/canvasTextInputPresentation.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/design/views/canvas/canvasPromptCompiler.ts apps/desktop/src/renderer/design/views/canvas/canvasPromptCompiler.test.ts apps/desktop/src/renderer/design/views/canvas/canvasTaskInputFiles.ts apps/desktop/src/renderer/design/views/canvas/canvasWorkspaceTaskInput.ts
git commit -m "feat(canvas): compile prompt tags into multimodal inputs"
```

## Task 4: 实现带缩略图与滚动悬浮窗的 Composer

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasPromptComposer.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasPromptComposer.test.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasPromptHoverCard.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasPromptComposer.less`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasPromptMentionTextArea.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.tsx`

- [ ] **Step 1: Add component contract tests**

在 `CanvasPromptComposer` 的 jsdom 测试中验证：图片 Tag 渲染缩略图；结构化 Tag 渲染类型图标；失效 Tag 带 `aria-invalid`；悬浮卡存在 `max-height` + `overflow-y:auto`；点击 Tag 触发关系编辑而不是把胶囊拆成文字。

- [ ] **Step 2: Run focused UI test and verify failure**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasPromptComposer.test.tsx`

Expected: FAIL because the component files do not exist。

- [ ] **Step 3: Implement composer and hover card**

`CanvasPromptComposer` props 使用：

```ts
type CanvasPromptComposerProps = {
  document: CanvasPromptDocument
  mentionNodes: CanvasNode[]
  assets: CanvasAsset[]
  disabled?: boolean
  onChange(document: CanvasPromptDocument): void
  onMentionSelect(node: CanvasNode, relation: CanvasPromptRelation): void
  onBlockEdit(blockId: string): void
}
```

使用不可拆分的 `contentEditable` block span + 隐藏纯文本 fallback，处理中文 IME、键盘删除、粘贴纯文本、撤销/重做和 `@` 菜单。图片/视频 Tag 采用 `AssetThumbnail`/封面；`CanvasPromptHoverCard` 固定最大高度 280px、内部滚动、键盘 focus 可见，悬浮只读，点击交给关系侧栏。

- [ ] **Step 4: Keep the legacy export and wire both panel locations**

让 `CanvasPromptMentionTextArea` 接受旧 `value` 时先 `migrateLegacyPrompt`，接受新版 document 时直接渲染；保留 `onChange(string)` 适配给尚未迁移的调用方。修改 `CanvasOperationPanel.tsx` 的两处使用只做 props 适配，不把编译逻辑塞入面板。保留工作区现有未提交的“每镜最长”文案改动。

- [ ] **Step 5: Run UI tests and typecheck**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasPromptComposer.test.tsx src/renderer/design/views/canvas/CanvasOperationPanel.test.ts && pnpm --filter @spark/desktop run typecheck`

Expected: PASS，且现有面板测试继续通过。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/design/views/canvas/CanvasPromptComposer.tsx apps/desktop/src/renderer/design/views/canvas/CanvasPromptHoverCard.tsx apps/desktop/src/renderer/design/views/canvas/canvasPromptComposer.less apps/desktop/src/renderer/design/views/canvas/CanvasPromptMentionTextArea.tsx apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.tsx
git commit -m "feat(canvas): add thumbnail prompt tag composer"
```

## Task 5: 接入 Tag/连线双向同步与关系侧栏

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasPromptConnections.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasPromptConnections.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`

- [ ] **Step 1: Write failing connection tests**

验证新增连接只插入一个 connection Tag；手动重复引用不重复物理 edge；删除最后一个 Tag 删除 edge；断线删除未修改的自动 Tag；已修改 Tag 转为 `disconnected`；同节点多个关系保留多个 block。

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasPromptConnections.test.ts`

Expected: FAIL。

- [ ] **Step 3: Implement connection synchronization helpers**

实现纯函数：

```ts
export function addConnectionReference(document: CanvasPromptDocument, node: CanvasNode, relation: CanvasPromptRelation): CanvasPromptDocument
export function removeConnectionReference(document: CanvasPromptDocument, nodeId: string): CanvasPromptDocument
export function reconcilePromptConnections(document: CanvasPromptDocument, edges: CanvasEdge[]): { document: CanvasPromptDocument; inputNodeIds: string[] }
```

在 workspace 的 connect/disconnect wiring 中调用 helper；关系侧栏只修改 block 的 relation/note/range，不直接改 edge 数组。

- [ ] **Step 4: Run tests and existing canvas inheritance tests**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasPromptConnections.test.ts src/renderer/design/views/canvas/canvasOperationInheritance.test.ts`

Expected: PASS；现有自动连线行为不丢失。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/design/views/canvas/canvasPromptConnections.ts apps/desktop/src/renderer/design/views/canvas/canvasPromptConnections.test.ts apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.tsx apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx
git commit -m "feat(canvas): sync prompt tags with input connections"
```

## Task 6: 收敛提交入口并保存 Prompt 快照

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasPromptSubmission.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasPromptSubmission.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.store.ts`

- [ ] **Step 1: Write failing submission tests**

测试 `buildCanvasPromptSubmission` 返回 `promptDocument`、`promptSnapshot`、`compiledUserText`、`inputFiles`、`inputSnapshots`，并确认节点能力 prompt 只在 `systemPrompt` 字段；旧 string request 仍生成兼容 `prompt`；失效 Tag 不调用 create task。

- [ ] **Step 2: Run focused test and verify failure**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasPromptSubmission.test.ts`

Expected: FAIL。

- [ ] **Step 3: Implement the submission adapter**

实现：

```ts
export async function buildCanvasPromptSubmission(input: {
  document: CanvasPromptDocument
  snapshot: CanvasSnapshot
  operation: CanvasOperationType
  systemPrompt: string
  negativePrompt?: string
  inputTransport?: CanvasInputTransport
}): Promise<CanvasPromptTaskFields>
```

此 helper 调用 Task 3 compiler，再调用现有 `buildCloudTaskInputFiles`；上传失败抛出可见错误；返回 `promptSnapshot` 和 `inputSnapshots` 供本地 task 立即保存。

- [ ] **Step 4: Replace scattered merge calls with the adapter**

在 `CanvasWorkspaceView.tsx` 的 create/run/retry 路径仅替换为 `buildCanvasPromptSubmission` 的 wiring；删除这些路径对 `mergePromptWithNodeContext` 的新调用。`canvas.api.ts` 仅透传字段、在 task record 中保存快照并保留旧 `prompt`。重试默认从 `oldTask.promptSnapshot/inputSnapshots` 生成 request；“使用当前节点最新内容重跑”显式走新 document。

- [ ] **Step 5: Run submission, inheritance and API tests**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasPromptSubmission.test.ts src/renderer/design/views/canvas/canvasOperationInheritance.test.ts src/renderer/design/views/canvas/canvasMediaContract.test.ts`

Expected: PASS；现有用户的未提交 CanvasOperationPanel 改动不被回滚。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/design/views/canvas/canvasPromptSubmission.ts apps/desktop/src/renderer/design/views/canvas/canvasPromptSubmission.test.ts apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx apps/desktop/src/renderer/design/views/canvas/canvas.api.ts apps/desktop/src/renderer/design/views/canvas/canvas.store.ts
git commit -m "feat(canvas): persist compiled prompt snapshots"
```

## Task 7: 分层系统提示词并贯通 text/media IPC

**Files:**

- Create: `apps/desktop/src/main/ipc/canvas-prompt-runtime.ts`
- Create: `apps/desktop/src/main/ipc/canvas-prompt-runtime.test.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`（仅替换 handler wiring）
- Modify: `packages/agent-runtime/src/services/canvas-text-generator.ts`
- Modify: `packages/agent-runtime/src/__tests__/services/canvas-text-generator.test.ts`

- [ ] **Step 1: Write failing runtime tests**

验证 runtime helper 将 capability/preset/agent/skill/negative 组成 `systemPrompt`，用户 `compiledUserText` 不被重复拼接；text request 的图片 content parts 顺序与 `inputSnapshots` 一致；media request 保留 role；request preview 不包含完整 data URL。

- [ ] **Step 2: Run focused runtime tests and verify failure**

Run: `pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/canvas-text-generator.test.ts && pnpm --filter @spark/desktop exec vitest run src/main/ipc/canvas-prompt-runtime.test.ts`

Expected: 新 helper 测试 FAIL，现有 text generator 测试保持可运行。

- [ ] **Step 3: Implement main/runtime adapter**

在 `canvas-prompt-runtime.ts` 实现：

```ts
export function buildCanvasSystemPrompt(input: { capabilityPrompt: string; presetPrompt?: string; agentPrompt?: string; skillPrompts: string[]; negativePrompt?: string }): string
export function buildCanvasRuntimeRequest(input: CanvasPromptTaskFields): { prompt: string; system: string; images: CanvasTextImageInput[]; relationManifest: unknown }
```

将现有 main IPC handler 中的 system/base/skill/negative 拼接迁入 helper；handler 只组装 provider/profile 并调用 helper。媒体请求继续使用 `inputFiles`，text generator 接收已解析的 `images` 和 prompt，不再自行猜关系。`rawResponse` 增加非敏感 `systemPrompt`、`compiledUserText` 和 relation 摘要。

- [ ] **Step 4: Run runtime tests and package typechecks**

Run: `pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/canvas-text-generator.test.ts && pnpm --filter @spark/agent-runtime run typecheck && pnpm --filter @spark/desktop run typecheck`

Expected: PASS；Anthropic、OpenAI Chat、Responses 三条 content path 均保留原有图片行为。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ipc/canvas-prompt-runtime.ts apps/desktop/src/main/ipc/canvas-prompt-runtime.test.ts apps/desktop/src/main/ipc/index.ts packages/agent-runtime/src/services/canvas-text-generator.ts packages/agent-runtime/src/__tests__/services/canvas-text-generator.test.ts
git commit -m "feat(runtime): separate canvas system and user prompt layers"
```

## Task 8: 任务详情展示输入快照和滚动内容

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasTaskInputSnapshotList.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasTaskInputSnapshotList.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasTaskQueue.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.less`

- [ ] **Step 1: Write failing render tests**

验证图片快照显示缩略图、名称、relation、hash/提交状态；长分镜文本容器可滚动；失效/上传失败显示原因；不存在 snapshot 的历史 task 回退到旧 `inputNodes/inputAssets`。

- [ ] **Step 2: Run focused test and verify failure**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasTaskInputSnapshotList.test.tsx`

Expected: FAIL。

- [ ] **Step 3: Implement snapshot list and integrate modal**

`CanvasTaskInputSnapshotList` 按 `inputSnapshots` 顺序渲染，复用 `AssetThumbnail` 和 `CanvasPromptHoverCard` 的滚动内容样式；`CanvasTaskQueue` 保留现有 System/实际 Prompt/模型输出/request body 区块，并在“输入/输出”前增加“提交快照输入”。

- [ ] **Step 4: Run task queue tests and typecheck**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasTaskInputSnapshotList.test.tsx src/renderer/design/views/canvas/CanvasOperationPanel.test.ts && pnpm --filter @spark/desktop run typecheck`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/design/views/canvas/CanvasTaskInputSnapshotList.tsx apps/desktop/src/renderer/design/views/canvas/canvasTaskInputSnapshotList.test.tsx apps/desktop/src/renderer/design/views/canvas/CanvasTaskQueue.tsx apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.less
git commit -m "feat(canvas): show input snapshots in task details"
```

## Task 9: 迁移、回归和端到端验收

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasOperationInheritance.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasPromptMentions.test.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasPromptE2E.fixture.ts`

- [ ] **Step 1: Add regression fixtures**

准备四个 fixture：文本生成 + 角色图 + 分镜表；文生图 + 角色/场景/参考图；图生视频 + 首帧/尾帧/参考图；旧字符串节点含系统前缀和未知文本。断言 UI document、compiled request、task snapshot、详情展示四层数据一致。

- [ ] **Step 2: Run all focused canvas tests**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasPrompt*.test.ts* src/renderer/design/views/canvas/canvasTaskInputFiles.test.ts src/renderer/design/views/canvas/canvasOperationInheritance.test.ts src/renderer/design/views/canvas/canvasMediaContract.test.ts`

Expected: PASS。

- [ ] **Step 3: Run repository verification**

Run: `pnpm --filter @spark/protocol run typecheck && pnpm --filter @spark/agent-runtime run typecheck && pnpm --filter @spark/desktop run typecheck && pnpm --filter @spark/desktop run lint && pnpm --filter @spark/desktop run build`

Expected: 全部命令退出码 0；若已有 unrelated dirty file 造成 lint 失败，记录文件和规则，不覆盖其改动。

- [ ] **Step 4: Run direct change-scope review**

由于 GitNexus MCP 未暴露，运行：

```bash
git diff --stat HEAD~9..HEAD
git diff --name-only HEAD~9..HEAD
rg -n "mergePromptWithNodeContext|buildCanvasOperationPrompt|CanvasPromptMentionTextArea|inputFiles" apps/desktop/src/renderer/design/views/canvas packages/protocol/src apps/desktop/src/main/ipc packages/agent-runtime/src
```

确认所有 prompt 组装调用都经过 compiler/runtime helper；确认没有把完整 base64 写入日志；确认用户原有未提交改动仍存在且未被重写。

- [ ] **Step 5: Commit final verification notes**

```bash
git add apps/desktop/src/renderer/design/views/canvas/canvasOperationInheritance.test.ts apps/desktop/src/renderer/design/views/canvas/canvasPromptMentions.test.ts apps/desktop/src/renderer/design/views/canvas/canvasPromptE2E.fixture.ts
git commit -m "test(canvas): cover prompt tag migration and multimodal flows"
```

## 规格覆盖自检

- 缩略图胶囊、悬浮完整内容、内部滚动：Task 4。
- 自动连线、`@` 引用、断线失效和关系侧栏：Task 5。
- 系统 prompt 隐藏、用户输入不混入能力提示：Task 6–7。
- 文本/图片/视频/音频/分镜结构化编译和 role：Task 3、Task 7、Task 9。
- 提交冻结快照、任务详情图片和重试：Task 6、Task 8。
- 旧节点保守迁移：Task 2、Task 9。
- 单元、集成、类型、lint、build 和变更范围核对：每个任务的 focused test + Task 9。

## 执行约定

每个 Task 完成后单独提交，提交前运行该 Task 的 focused test；不使用 `git reset --hard` 或覆盖现有 dirty worktree。编辑超过 3000 行的现有文件时只做最小 wiring，新增逻辑全部放在上面列出的独立模块中。
