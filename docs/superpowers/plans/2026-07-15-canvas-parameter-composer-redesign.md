# 画布参数配置与菜单体验重设计 Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-15

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付双栏 Provider/模型选择器、Schema 驱动的可视化参数控件、常用/高级参数布局、统一底部图标工具栏、整理后的剧本流水线菜单，并修复画布项目卡片打开按钮。

**Architecture:** 保留 CanvasInlineAiComposer、CanvasOperationPanel 与 CanvasOperationPresetModal 的业务状态、草稿和提交链路，将模型分组、参数展示语义、具体控件、底部工具栏和菜单分类拆成独立模块。所有选择继续写回现有 selectedModelKey 与 modelParamDraft，因此任务 payload、参数裁剪和 Provider 调用语义不变。

**Tech Stack:** React 19、TypeScript、Vitest/jsdom、@lobehub/ui、antd、Less、Electron renderer IPC。

**Design reference:** docs/superpowers/specs/2026-07-15-canvas-parameter-composer-redesign.md

**GitNexus fallback:** 当前会话未暴露 GitNexus MCP。每个生产符号修改前使用 rg 检索调用点并向用户报告风险；完成后使用相关测试、git diff 和 git diff --check 代替 GitNexus impact/detect_changes。

---

## File map

- Create canvasModelPickerModel.ts and test: 模型稳定键、Provider 分组、搜索和选中项解析。
- Create CanvasModelPicker.tsx and tests/styles: 双栏模型选择器。
- Create canvasParameterPresentation.ts and test: 参数语义识别、常用/高级分类、比例形状和摘要。
- Create CanvasParameterControl.tsx and tests/styles: 可视化参数控件。
- Create canvasComposerPreferences.ts and test: 高级设置展开偏好。
- Create CanvasComposerToolbar.tsx and tests/styles: 底部摘要和图标操作组。
- Modify CanvasInlineAiComposer.tsx and test: 接入新模块。
- Create CanvasOperationParameterControls.tsx and tests/styles: 提供节点工具栏与面板两种统一模型/参数布局。
- Modify CanvasOperationPanel.tsx and test: 覆盖实际任务节点的内联与展开配置入口，移除旧平铺模型列表。
- Modify CanvasOperationPresetModal.tsx and test: 覆盖应用级节点预设入口，移除旧 Select/AutoComplete 参数网格。
- Create canvasNodeGenerationMenu.ts and test: 统一生成操作目录。
- Modify CanvasNode.tsx, CanvasFloatingNodeToolbar.tsx, CanvasWorkspaceView.tsx: 读取统一菜单目录。
- Create CanvasProjectCard.tsx and test: 可测试的项目卡片。
- Modify CanvasProjectsView.tsx and CanvasProjectsView.less: 使用新卡片并修复打开交互。
- Update design and plan docs when implementation starts and completes.

All source paths above are under apps/desktop/src/renderer/design/views/canvas unless otherwise stated.

---

### Task 1: Extract the provider/model presentation model

**Files:**
- Create: apps/desktop/src/renderer/design/views/canvas/canvasModelPickerModel.ts
- Test: apps/desktop/src/renderer/design/views/canvas/canvasModelPickerModel.test.ts
- Modify: apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.tsx

- [ ] **Step 1: Record impact before editing**

~~~powershell
rg -n "mediaModelKey\(|modelOptions|selectedModelKey|supportedMediaModels" apps/desktop/src/renderer/design/views/canvas apps/desktop/src/renderer/design/views/ProvidersView.tsx
~~~

Expected: mediaModelKey is composer-local, while selectedModelKey participates in draft persistence and submit payload. Report MEDIUM risk and state that the stable key format remains unchanged.

- [ ] **Step 2: Write the failing test**

Create canvasModelPickerModel.test.ts with a CanvasMediaModelSummary factory and these assertions:

~~~ts
expect(mediaModelKey(apimartModel)).not.toBe(mediaModelKey(xaiModel))
expect(buildCanvasModelProviderGroups(models).map((group) => [group.label, group.models.length])).toEqual([
  ['APIMart', 2],
  ['xAI 官方', 1],
])
expect(filterCanvasModelProviderGroups(buildCanvasModelProviderGroups(models), 'veo')
  .flatMap((group) => group.models)
  .map((model) => model.displayName)).toEqual(['VEO3'])
expect(resolveSelectedCanvasModel(models, mediaModelKey(xaiModel))?.providerProfileId).toBe('xai-1')
~~~

- [ ] **Step 3: Verify RED**

~~~powershell
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasModelPickerModel.test.ts
~~~

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement the pure model**

Create these exports:

~~~ts
export type CanvasModelProviderGroup = {
  key: string
  label: string
  providerKind: string
  providerProfileId?: string
  models: CanvasMediaModelSummary[]
}

export function mediaModelKey(model: CanvasMediaModelSummary): string {
  return [
    model.providerProfileId ?? 'catalog',
    model.manifestId,
    model.effectiveModelId,
  ].join('::')
}

export function buildCanvasModelProviderGroups(
  models: readonly CanvasMediaModelSummary[],
): CanvasModelProviderGroup[]

export function filterCanvasModelProviderGroups(
  groups: readonly CanvasModelProviderGroup[],
  query: string,
): CanvasModelProviderGroup[]

export function resolveSelectedCanvasModel(
  models: readonly CanvasMediaModelSummary[],
  selectedKey: string,
): CanvasMediaModelSummary | undefined
~~~

Group by providerProfileId, falling back to catalog:providerKind. Search provider label/kind plus displayName, manifestId, effectiveModelId and modelId. Move mediaModelKey out of the composer without changing its returned string.

- [ ] **Step 5: Verify GREEN and commit**

~~~powershell
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasModelPickerModel.test.ts src/renderer/design/views/canvas/CanvasInlineAiComposer.test.ts
git add apps/desktop/src/renderer/design/views/canvas/canvasModelPickerModel.ts apps/desktop/src/renderer/design/views/canvas/canvasModelPickerModel.test.ts apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.tsx apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.test.ts
git commit -m "refactor(canvas): extract model picker presentation"
~~~

Expected: tests PASS and the stable key remains backward-compatible.

---

### Task 2: Implement the hierarchical model picker

**Files:**
- Create: apps/desktop/src/renderer/design/views/canvas/CanvasModelPicker.tsx
- Create: apps/desktop/src/renderer/design/views/canvas/CanvasModelPicker.test.tsx
- Create: apps/desktop/src/renderer/design/views/canvas/CanvasModelPicker.less

- [ ] **Step 1: Write failing jsdom tests**

Render two Provider groups. Test opening the popover, switching Provider, searching VEO3, selecting it, and choosing automatic routing. Assert:

~~~tsx
expect(container.querySelector('[aria-label="选择模型"]')).not.toBeNull()
expect(container.querySelector('[data-provider-key="apimart-1"]')).not.toBeNull()
expect(container.querySelector('[data-model-key="apimart-1::google:veo-3::veo-3"]')).not.toBeNull()
expect(onChange).toHaveBeenCalledWith('apimart-1::google:veo-3::veo-3')
~~~

Also assert role=listbox, aria-selected, Escape close, loading and empty states.

- [ ] **Step 2: Verify RED**

~~~powershell
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasModelPicker.test.tsx
~~~

Expected: FAIL because CanvasModelPicker does not exist.

- [ ] **Step 3: Implement the component**

Use this controlled contract:

~~~ts
export type CanvasModelPickerProps = {
  models: CanvasMediaModelSummary[]
  value: string
  loading?: boolean
  disabled?: boolean
  onChange: (modelKey: string) => void
}
~~~

Use Popover, Button, Input and Tooltip. Use ProviderLogo with getProviderIconForVendor(group.providerKind). Component state is limited to open/search/active Provider. Reset the active Provider to the selected model’s group whenever the popover opens. Close after selecting a model or automatic routing. Render model capability labels without altering capability filtering.

- [ ] **Step 4: Add production styles**

CanvasModelPicker.less must provide:

- 560–640px desktop popup with a 190px Provider column and flexible model column.
- Independent scrolling up to approximately 420px.
- Selected, hover, focus-visible, loading and empty states.
- A compact trigger compatible with current canvas theme variables.
- Below 560px, Provider choices become a horizontal rail above the model list.

- [ ] **Step 5: Verify and commit**

~~~powershell
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasModelPicker.test.tsx src/renderer/design/components/ProviderLogo.test.tsx
pnpm --filter @spark/desktop exec eslint src/renderer/design/views/canvas/CanvasModelPicker.tsx src/renderer/design/views/canvas/canvasModelPickerModel.ts
git add apps/desktop/src/renderer/design/views/canvas/CanvasModelPicker.tsx apps/desktop/src/renderer/design/views/canvas/CanvasModelPicker.test.tsx apps/desktop/src/renderer/design/views/canvas/CanvasModelPicker.less
git commit -m "feat(canvas): add hierarchical model picker"
~~~

---

### Task 3: Build the parameter presentation engine

**Files:**
- Create: apps/desktop/src/renderer/design/views/canvas/canvasParameterPresentation.ts
- Create: apps/desktop/src/renderer/design/views/canvas/canvasParameterPresentation.test.ts
- Modify: apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.tsx

- [ ] **Step 1: Record impact before editing**

~~~powershell
rg -n "SchemaField|schemaFields\(|modelSuggestedFields\(|parameterFields" apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.tsx apps/desktop/src/renderer/design/views/canvas/*.test.ts
~~~

Expected: schema parsing and draft normalization are composer-local. Report MEDIUM risk because ordering affects visible defaults, while field names and values must remain unchanged.

- [ ] **Step 2: Write failing classification tests**

~~~ts
expect(presentField(field('aspect_ratio', ['1:1', '16:9']))).toMatchObject({ control: 'aspect-ratio', tier: 'common' })
expect(presentField(field('resolution', ['1K', '2K', '4K']))).toMatchObject({ control: 'resolution', tier: 'common' })
expect(presentField(field('n', ['1', '2', '4']))).toMatchObject({ control: 'count', tier: 'common', unit: '张' })
expect(presentField(field('durationSeconds', ['5', '8', '10']))).toMatchObject({ control: 'duration', tier: 'common', unit: '秒' })
expect(presentField(field('searchEnabled', ['true', 'false'], 'boolean'))).toMatchObject({ control: 'boolean', tier: 'advanced' })
expect(presentField(field('seed', [], 'integer'))).toMatchObject({ control: 'number', tier: 'advanced' })
expect(aspectRatioShape('16:9')).toEqual({ width: 32, height: 18 })
expect(aspectRatioShape('adaptive')).toEqual({ width: 24, height: 18, adaptive: true })
~~~

- [ ] **Step 3: Verify RED**

~~~powershell
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasParameterPresentation.test.ts
~~~

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement aliases, presentation, partitioning and fallback**

Export:

~~~ts
export type CanvasParameterControlKind =
  | 'aspect-ratio'
  | 'resolution'
  | 'count'
  | 'duration'
  | 'boolean'
  | 'enum'
  | 'autocomplete'
  | 'number'
  | 'text'

export type CanvasParameterPresentation = {
  field: SchemaField
  control: CanvasParameterControlKind
  tier: 'common' | 'advanced'
  label: string
  unit?: string
}

export function presentField(field: SchemaField): CanvasParameterPresentation
export function partitionParameterFields(fields: readonly SchemaField[]): {
  common: CanvasParameterPresentation[]
  advanced: CanvasParameterPresentation[]
}
export function aspectRatioShape(value: string): {
  width: number
  height: number
  adaptive?: boolean
}
export function parameterSummaryValue(
  item: CanvasParameterPresentation,
  value: string,
): string
~~~

Recognize camelCase and snake_case aliases for aspect ratio, resolution/quality, count, duration, frame rate, audio, seed, watermark, search and service tier. Unknown fields remain editable and default to advanced.

Move the existing `SchemaField` type into this module and import it from the composer and control component. Keep `schemaFields()` in the composer for now, returning the exported type, so the presentation module never imports the React composer and no circular dependency is introduced.

- [ ] **Step 5: Verify and commit**

~~~powershell
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasParameterPresentation.test.ts src/renderer/design/views/canvas/CanvasInlineAiComposer.test.ts
git add apps/desktop/src/renderer/design/views/canvas/canvasParameterPresentation.ts apps/desktop/src/renderer/design/views/canvas/canvasParameterPresentation.test.ts apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.tsx
git commit -m "feat(canvas): classify model parameter presentation"
~~~


---

### Task 4: Implement visual parameter controls

**Files:**
- Create: apps/desktop/src/renderer/design/views/canvas/CanvasParameterControl.tsx
- Create: apps/desktop/src/renderer/design/views/canvas/CanvasParameterControl.test.tsx
- Create: apps/desktop/src/renderer/design/views/canvas/CanvasParameterControl.less

- [ ] **Step 1: Write failing component tests**

Test one behavior per case:

- Ratio choices render miniature frames and choosing 16:9 emits 16:9.
- Resolution, count and duration choices expose aria-pressed.
- Boolean fields emit string values true/false, preserving modelParamDraft type.
- Custom enums accept values outside the recommended enum.
- Unknown numeric fields render input type=number.

- [ ] **Step 2: Verify RED**

~~~powershell
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasParameterControl.test.tsx
~~~

Expected: FAIL because CanvasParameterControl does not exist.

- [ ] **Step 3: Implement the controlled renderer**

~~~ts
export type CanvasParameterControlProps = {
  presentation: CanvasParameterPresentation
  value: string
  onChange: (value: string) => void
  compact?: boolean
}
~~~

The component must not own duplicate draft state. Ratio options are real buttons with visible text and aria labels. More than six compact options use a horizontal rail. Autocomplete, generic enum, boolean, number and text controls preserve the existing field description and placeholder.

- [ ] **Step 4: Add styles**

Use existing canvas theme variables. Ratio tiles need at least a 52px hit area, consistent shape scale, a visible selected ring and focus-visible state. Avoid decorative effects that reduce contrast.

- [ ] **Step 5: Verify and commit**

~~~powershell
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasParameterControl.test.tsx src/renderer/design/views/canvas/canvasParameterPresentation.test.ts
pnpm --filter @spark/desktop exec eslint src/renderer/design/views/canvas/CanvasParameterControl.tsx
git add apps/desktop/src/renderer/design/views/canvas/CanvasParameterControl.tsx apps/desktop/src/renderer/design/views/canvas/CanvasParameterControl.test.tsx apps/desktop/src/renderer/design/views/canvas/CanvasParameterControl.less
git commit -m "feat(canvas): add visual model parameter controls"
~~~

---

### Task 5: Implement advanced-setting persistence and bottom toolbar

**Files:**
- Create: apps/desktop/src/renderer/design/views/canvas/canvasComposerPreferences.ts
- Create: apps/desktop/src/renderer/design/views/canvas/canvasComposerPreferences.test.ts
- Create: apps/desktop/src/renderer/design/views/canvas/CanvasComposerToolbar.tsx
- Create: apps/desktop/src/renderer/design/views/canvas/CanvasComposerToolbar.test.tsx
- Create: apps/desktop/src/renderer/design/views/canvas/CanvasComposerToolbar.less

- [ ] **Step 1: Write failing preference tests**

Use the key spark-canvas:inline-ai-composer:advanced-open:v1. Test default false, persist/restore true, malformed data fallback false, and unavailable storage fallback false.

- [ ] **Step 2: Write failing toolbar tests**

Assert that summaries precede actions, every action button is icon-only but has Tooltip and aria-label, advanced toggles, submit calls its handler, and disabled submit is disabled on the native button.

- [ ] **Step 3: Verify RED**

~~~powershell
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasComposerPreferences.test.ts src/renderer/design/views/canvas/CanvasComposerToolbar.test.tsx
~~~

Expected: FAIL because both modules are absent.

- [ ] **Step 4: Implement preferences and toolbar**

Use these public types:

~~~ts
export type CanvasComposerSummaryAction = {
  key: string
  label: string
  value: string
  icon: ReactNode
  onClick: () => void
}

export type CanvasComposerToolbarProps = {
  summaries: CanvasComposerSummaryAction[]
  advancedAvailable: boolean
  advancedOpen: boolean
  canSubmit: boolean
  submitting: boolean
  onToggleAdvanced: () => void
  onCancel: () => void
  onSubmit: () => void
}
~~~

Cancel, advanced and submit are icon-only. Selected summary values remain readable text because they communicate state rather than generic actions.

- [ ] **Step 5: Add responsive styles**

Normal width uses one row. Summary buttons form a horizontally scrollable non-wrapping rail; actions never shrink. Below 620px, summaries may occupy the first row, but submit remains visible without horizontal scrolling.

- [ ] **Step 6: Verify and commit**

~~~powershell
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasComposerPreferences.test.ts src/renderer/design/views/canvas/CanvasComposerToolbar.test.tsx
git add apps/desktop/src/renderer/design/views/canvas/canvasComposerPreferences.ts apps/desktop/src/renderer/design/views/canvas/canvasComposerPreferences.test.ts apps/desktop/src/renderer/design/views/canvas/CanvasComposerToolbar.tsx apps/desktop/src/renderer/design/views/canvas/CanvasComposerToolbar.test.tsx apps/desktop/src/renderer/design/views/canvas/CanvasComposerToolbar.less
git commit -m "feat(canvas): add compact composer toolbar"
~~~

---

### Task 6: Integrate the redesign into CanvasInlineAiComposer

**Files:**
- Modify: apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.tsx
- Modify: apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.test.ts
- Modify: apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.less

- [ ] **Step 1: Record the composer blast radius**

~~~powershell
rg -n "<CanvasInlineAiComposer|CanvasInlineAiComposer\(" apps/desktop/src/renderer
rg -n "canvas-inline-ai-footer|canvas-param-grid|canvas-param-field" apps/desktop/src/renderer/design/views/canvas
~~~

Expected: one workspace integration plus tests/styles. Report HIGH risk before editing because the component owns draft persistence and task submission. State that only rendering is replaced and the submit pipeline remains intact.

- [ ] **Step 2: Add failing integration assertions**

Extend composer tests to prove:

- Common and advanced fields are partitioned without changing field names.
- Model selection still resolves the same Provider/manifest/model tuple.
- Advanced-open preference is not added to ComposerDraft.
- Visual controls continue to supply string values to existing buildModelParams.
- Existing panorama defaults and alias normalization remain unchanged.

- [ ] **Step 3: Verify RED**

~~~powershell
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasInlineAiComposer.test.ts src/renderer/design/views/canvas/CanvasComposerToolbar.test.tsx
~~~

Expected: new integration assertions FAIL against legacy rendering.

- [ ] **Step 4: Integrate new modules**

Make these structural changes:

1. Replace modelOptions/LobeSelect model UI with CanvasModelPicker.
2. Memoize partitionParameterFields(parameterFields).
3. Render common fields through CanvasParameterControl.
4. Put input transport, project prompt injection, custom params and advanced field presentations inside one collapsible advanced section.
5. Build clickable summary actions from selected model and current common values.
6. Replace canvas-inline-ai-footer text buttons with CanvasComposerToolbar.
7. Extract the existing async submit body into a named handleSubmit callback without changing payload construction, pruning, duplicate-click protection, draft clearing or prompt reset.
8. Remove obsolete model chips and duplicate hints.

- [ ] **Step 5: Remove only obsolete styles**

Before deleting a selector, run rg for its call sites. Preserve composer container, head, body, fullscreen and drag behavior. New modules own model picker, parameter controls and toolbar styles.

- [ ] **Step 6: Run focused regression tests and typecheck**

~~~powershell
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasInlineAiComposer.test.ts src/renderer/design/views/canvas/CanvasModelPicker.test.tsx src/renderer/design/views/canvas/CanvasParameterControl.test.tsx src/renderer/design/views/canvas/CanvasComposerToolbar.test.tsx src/renderer/design/views/canvas/canvasMediaContract.test.ts src/renderer/design/views/canvas/canvasOperationInheritance.test.ts
pnpm --filter @spark/desktop typecheck
~~~

Expected: all tests PASS and typecheck exits 0.

- [ ] **Step 7: Commit**

~~~powershell
git add apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.tsx apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.test.ts apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.less
git commit -m "feat(canvas): integrate redesigned parameter composer"
~~~


---

### Task 7: Unify node generation menu classification

**Files:**
- Create: apps/desktop/src/renderer/design/views/canvas/canvasNodeGenerationMenu.ts
- Create: apps/desktop/src/renderer/design/views/canvas/canvasNodeGenerationMenu.test.ts
- Modify: apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx
- Modify: apps/desktop/src/renderer/design/views/canvas/CanvasFloatingNodeToolbar.tsx
- Modify: apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx

- [ ] **Step 1: Record duplicate definitions**

~~~powershell
git diff -- apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx
rg -n "storyboard_grid|panorama_360|text_to_image|image_edit|image_compose" apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx apps/desktop/src/renderer/design/views/canvas/CanvasFloatingNodeToolbar.tsx apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx
~~~

Expected: three UI lists overlap. Preserve and merge around the pre-existing user changes in CanvasWorkspaceView.tsx; do not overwrite or stage unrelated hunks. Report MEDIUM risk because classification changes while operation IDs and handlers remain unchanged.

- [ ] **Step 2: Write failing menu tests**

~~~ts
expect(CANVAS_PIPELINE_CREATE_OPERATIONS.map((item) => item.operation)).toEqual([
  'storyboard_grid',
  'panorama_360',
])
expect(generalOperationIds).not.toContain('storyboard_grid')
expect(generalOperationIds).not.toContain('panorama_360')
expect(new Set(allOperationIds).size).toBe(allOperationIds.length)
~~~

- [ ] **Step 3: Verify RED**

~~~powershell
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasNodeGenerationMenu.test.ts
~~~

Expected: FAIL because the catalog does not exist.

- [ ] **Step 4: Implement the catalog**

~~~ts
export type CanvasNodeGenerationMenuItem = {
  operation: CanvasOperationType
  label: string
  icon: 'Image' | 'Grid' | 'Globe' | 'Edit' | 'FileText' | 'Video' | 'Audio'
}

export const CANVAS_PIPELINE_CREATE_OPERATIONS: CanvasNodeGenerationMenuItem[] = [
  { operation: 'storyboard_grid', label: '故事板', icon: 'Grid' },
  { operation: 'panorama_360', label: '360 全景图', icon: 'Globe' },
]
~~~

Define general image, text, video and audio groups with current labels and IDs except these two operations.

- [ ] **Step 5: Integrate all duplicate lists**

In CanvasNode, append the two direct create operations to “剧本流水线” and remove them from “生成任务”. Existing semantic pipeline actions continue to call actions.pipelineAction; direct operations call actions.createOperationChild. Floating toolbars read the same catalog. Preserve standalone preview_panorama for generated panorama images.

- [ ] **Step 6: Verify and commit**

~~~powershell
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasNodeGenerationMenu.test.ts src/renderer/design/views/canvas/canvasPipelineOps.test.ts src/renderer/design/views/canvas/canvasContextMenuModel.test.ts
pnpm --filter @spark/desktop typecheck
git add apps/desktop/src/renderer/design/views/canvas/canvasNodeGenerationMenu.ts apps/desktop/src/renderer/design/views/canvas/canvasNodeGenerationMenu.test.ts apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx apps/desktop/src/renderer/design/views/canvas/CanvasFloatingNodeToolbar.tsx apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx
git commit -m "refactor(canvas): unify generation menu groups"
~~~

---

### Task 8: Extract and fix the canvas project card

**Files:**
- Create: apps/desktop/src/renderer/design/views/canvas/CanvasProjectCard.tsx
- Create: apps/desktop/src/renderer/design/views/canvas/CanvasProjectCard.test.tsx
- Modify: apps/desktop/src/renderer/design/views/canvas/CanvasProjectsView.tsx
- Modify: apps/desktop/src/renderer/design/views/canvas/CanvasProjectsView.less

- [ ] **Step 1: Record the root cause and impact**

~~~powershell
rg -n "handleOpenProject|canvas-project-actions|stopPropagation|openingProjectId" apps/desktop/src/renderer/design/views/canvas/CanvasProjectsView.tsx
~~~

Expected: action wrapper stops propagation while the open button has no handler. Report LOW risk because all valid open paths already converge on handleOpenProject.

- [ ] **Step 2: Write the failing card test**

Render CanvasProjectCard and verify:

~~~tsx
await act(async () => openButton.click())
expect(onOpen).toHaveBeenCalledTimes(1)
expect(onOpen).toHaveBeenCalledWith('project-1')

await act(async () => moreButton.click())
expect(onOpen).toHaveBeenCalledTimes(1)
~~~

Also assert that opening disables the button and exposes “正在打开项目” through aria-label or Tooltip.

- [ ] **Step 3: Verify RED**

~~~powershell
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasProjectCard.test.tsx
~~~

Expected: FAIL because CanvasProjectCard does not exist.

- [ ] **Step 4: Extract the controlled card**

Pass the project snapshot plus callbacks for open, pin, edit, folder, export, archive and delete. The open button calls onOpen(project.id) directly and stops propagation. Keep the whole card clickable. API calls remain in CanvasProjectsView.

- [ ] **Step 5: Verify and commit**

~~~powershell
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasProjectCard.test.tsx src/renderer/design/views/canvas/canvas-window-client.test.ts
pnpm --filter @spark/desktop typecheck
git add apps/desktop/src/renderer/design/views/canvas/CanvasProjectCard.tsx apps/desktop/src/renderer/design/views/canvas/CanvasProjectCard.test.tsx apps/desktop/src/renderer/design/views/canvas/CanvasProjectsView.tsx apps/desktop/src/renderer/design/views/canvas/CanvasProjectsView.less
git commit -m "fix(canvas): restore project card open action"
~~~

---

### Task 9: Full verification and documentation freshness

**Files:**
- Modify: docs/superpowers/specs/2026-07-15-canvas-parameter-composer-redesign.md
- Modify: docs/superpowers/plans/2026-07-15-canvas-parameter-composer-redesign.md

- [ ] **Step 1: Start implementation status correctly**

Before Task 1 production edits, update both documents to:

~~~markdown
> 状态: 实施中 | 最后核对: 2026-07-15
~~~

Commit the status change together with the first implementation commit, not as an unrelated standalone commit.

- [ ] **Step 2: Run formatting, lint and typecheck**

Format only the plan-listed files. Do not format the whole canvas directory if that would touch unrelated user changes.

~~~powershell
pnpm --filter @spark/desktop lint
pnpm --filter @spark/desktop typecheck
~~~

Expected: lint and typecheck exit 0.

- [ ] **Step 3: Run full desktop tests and build**

~~~powershell
pnpm --filter @spark/desktop test:unit
pnpm --filter @spark/desktop build
~~~

Expected: all unit tests PASS and the Electron build completes.

- [ ] **Step 4: Verify the rendered experience**

Run the desktop app and verify:

1. Provider/model two-column hierarchy, icons, search and same-name models under different Providers.
2. Ratio shapes for 1:1, 16:9, 9:16 and adaptive.
3. Resolution/count/duration controls and advanced collapse persistence.
4. Bottom summaries left and icon actions right at normal and narrow widths.
5. Storyboard and 360 panorama only under “剧本流水线”.
6. Panorama output still has standalone “全景预览”.
7. Project card open button opens once and shows loading state.

Capture screenshots when the environment supports it.

- [ ] **Step 5: Inspect final scope**

~~~powershell
git diff --check
git status --short
git log --oneline -10
rg -n "storyboard_grid|panorama_360" apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx apps/desktop/src/renderer/design/views/canvas/CanvasFloatingNodeToolbar.tsx apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx
~~~

Expected: only planned files and pre-existing user changes are present; no whitespace errors or duplicated operation placement.

- [ ] **Step 6: Update documentation status**

Change both document markers to:

~~~markdown
> 状态: 已落地 | 最后核对: 2026-07-15
~~~

Then commit:

~~~powershell
git add docs/superpowers/specs/2026-07-15-canvas-parameter-composer-redesign.md docs/superpowers/plans/2026-07-15-canvas-parameter-composer-redesign.md
git commit -m "docs(canvas): mark composer redesign implemented"
~~~

- [ ] **Step 7: Final completion report**

Report user-visible changes, test/typecheck/lint/build results, GitNexus degradation, direct-search/diff checks, preserved user-owned changes and screenshot paths.
