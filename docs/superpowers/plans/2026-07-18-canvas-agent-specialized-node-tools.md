# Canvas Agent Specialized Node Tools Implementation Plan

> 状态: 已落地 | 最后核对: 2026-08-11

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不新增底层节点类型的前提下，让画布 Agent 通过专用工具创建现有格式的剧本、分镜、影视资产和媒体语义节点，并让专用文本任务在校验后才物化为对应节点。

**Architecture:** 新增纯逻辑流水线契约、文本输出校验、分镜物化和专用工具模块；`canvas.tools.ts`、`canvas.api.ts` 只做薄接线。专用工具复用现有 `pipelineRole`、影视资产 `metadata.kind`、`ShotGroup/ShotSegment` 和 Markdown 展示格式，历史节点不迁移。

**Tech Stack:** TypeScript、Vitest、Electron renderer MCP bridge、现有 Canvas localStorage persistence

**GitNexus fallback:** 当前会话没有暴露 GitNexus MCP。实施前后使用 `rg` 调用点、定向测试、`git diff` 和 Git 历史完成影响与变更范围核对。

---

### Task 1: 完整分镜字段模型与持久化

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasFilmAssets.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.store.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasFilmAssetCenter.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasShotSegmentPersistence.test.ts`

- [x] **Step 1: 写失败测试，证明 createShotSegment 会丢字段**

```ts
const result = await canvasApi.createShotSegment('project-1', 'group-1', {
  title: '推进到特写',
  durationSec: 4,
  shotSize: '近景',
  angle: '平视',
  movement: '缓慢推进',
  lighting: '左侧暖光',
  negativePrompt: '文字水印',
})
expect(result.shotGroups[0]?.segments[0]).toMatchObject({
  durationSec: 4,
  shotSize: '近景',
  movement: '缓慢推进',
  negativePrompt: '文字水印',
})
```

- [x] **Step 2: 运行测试并确认因字段缺失失败**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasShotSegmentPersistence.test.ts`

Expected: FAIL，返回 segment 不包含 `durationSec` 或镜头字段。

- [x] **Step 3: 扩展 ShotSegment 并完整保存合法字段**

给 `ShotSegment` 增加 `shotSize/angle/movement/sceneLayout/blocking/lighting/focalLength/aperture/iso/colorTone/mood/microExpression/costume/negativePrompt` 可选字段。创建时排除外部 `id/index`，保留其余已声明字段：

```ts
const { id: _id, index: _index, ...fields } = input as Partial<ShotSegment>
const segment: ShotSegment = {
  ...fields,
  id: filmUid('shot_seg'),
  index: group.segments.length + 1,
  title: input.title,
}
```

让 store action 返回新建的 `ShotSegment`，现有忽略返回值的调用保持兼容。

- [x] **Step 4: 重跑测试确认通过**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasShotSegmentPersistence.test.ts src/renderer/design/views/canvas/canvasShotSplit.test.ts`

Expected: PASS。

### Task 2: 专用流水线动作契约

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasPipelineActionContracts.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasPipelineActionContracts.test.ts`

- [x] **Step 1: 写失败测试定义期望 API**

```ts
const draft = buildCanvasPipelineOperationDraft({
  actionId: 'screenplay.to_shot_script',
  sourceText: '场1 内景 茶馆 日',
})
expect(draft).toMatchObject({
  operation: 'text_generate',
  taskPipelineRole: 'shot',
  outputPipelineRole: 'shot',
  modelParams: { responseFormat: 'json' },
})
expect(draft.systemPrompt).toContain('JSON 顶层结构必须为')
```

同时覆盖 `chapter.to_screenplay`、四类实体抽取和分镜关键帧宫格。

- [x] **Step 2: 运行测试确认模块缺失失败**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasPipelineActionContracts.test.ts`

Expected: FAIL，无法导入模块。

- [x] **Step 3: 实现完整操作草稿构建器**

```ts
export type CanvasPipelineOperationDraft = {
  operation: CanvasOperationType
  title: string
  systemPrompt: string
  taskPipelineRole?: CanvasPipelineRole
  outputPipelineRole?: CanvasPipelineRole
  modelParams?: Record<string, unknown>
  shotScriptConfig?: ShotScriptConfig
}
```

复用 `buildAgentPresetPrompt`、`buildEntityExtractionPrompt`、`buildChapterToScreenplayInstruction` 和现有故事板提示词，不复制格式文本。

- [x] **Step 4: 重跑契约测试**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasPipelineActionContracts.test.ts src/renderer/design/views/canvas/canvasPipelineOps.test.ts`

Expected: PASS。

### Task 3: 剧本与分镜输出校验和物化

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasTextOutputValidation.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasTextOutputValidation.test.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasStoryboardMaterialization.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasStoryboardMaterialization.test.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasSemanticTextTaskOutput.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts`

- [x] **Step 1: 写失败测试定义校验行为**

```ts
expect(validateCanvasSemanticTextOutput('screenplay', '随便写点内容').ok).toBe(false)
expect(validateCanvasSemanticTextOutput('screenplay', '# 场1 内景 茶馆 日\n\n林岚：你好').ok).toBe(
  true,
)
expect(
  validateCanvasSemanticTextOutput('shot', JSON.stringify({ shots: [validShot] })),
).toMatchObject({
  ok: true,
})
expect(validateCanvasSemanticTextOutput('shot', '{"shots":[]}').ok).toBe(false)
```

- [x] **Step 2: 运行测试确认模块缺失失败**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasTextOutputValidation.test.ts src/renderer/design/views/canvas/canvasStoryboardMaterialization.test.ts`

Expected: FAIL。

- [x] **Step 3: 实现纯逻辑校验和分镜 metadata 物化**

校验结果使用判别联合：

```ts
type CanvasSemanticTextValidation =
  | { ok: true; text: string; storyboardRows?: ParsedShotRow[] }
  | { ok: false; code: 'invalid_screenplay_output' | 'invalid_storyboard_output'; message: string }
```

分镜物化按 `groupName` 分组，匹配同名 character/scene/prop 资产，生成完整 `ShotSegment`，并返回更新后的 project metadata。

- [x] **Step 4: 接入文本任务完成路径**

在创建语义产物节点前调用校验器。剧本兼容现有“第N场｜内/外景｜地点｜时间”、`场次/场景`、数字场号和 `INT./EXT.` 等场次标题；非空响应未识别到标题时自动补入 `第1场｜｜｜`，场次中的未知字段留空供编辑，只有空响应才阻断剧本节点创建。分镜缺失的可编辑字段补空字符串，summary 不作为阻断条件。JSON 解析前先做低风险修复，容忍代码围栏、前后说明、尾逗号、注释、智能/单引号、未加引号字段名和字符串裸换行；被截断且无法安全修复的 JSON 不强行补齐。无法恢复专用语义时把 task 标记为 failed、保留 `rawResponse` 和 `modelOutputText`；只要模型返回了文本，就创建不带 screenplay/shot 角色的普通文本回显节点。可恢复的分镜结果继续使用程序生成的 Markdown 文本并更新 `project.metadata.film.shotGroups`。

- [x] **Step 5: 运行校验、物化和文本任务回归测试**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasTextOutputValidation.test.ts src/renderer/design/views/canvas/canvasStoryboardMaterialization.test.ts src/renderer/design/views/canvas/canvasOperationInheritance.test.ts`

Expected: PASS。

### Task 4: 专用节点 MCP 工具

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasSpecializedNodeSchemas.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasSpecializedNodeTools.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasSpecializedNodeTools.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.tools.ts`

- [x] **Step 1: 写失败测试锁定工具集合和行为**

要求存在：

```ts
expect(toolNames).toEqual(
  expect.arrayContaining([
    'canvas_create_chapter_node',
    'canvas_create_screenplay_node',
    'canvas_create_character_node',
    'canvas_create_scene_node',
    'canvas_create_prop_node',
    'canvas_create_effect_node',
    'canvas_create_storyboard_node',
    'canvas_create_shot_node',
    'canvas_insert_design_card_node',
    'canvas_insert_keyframe_node',
    'canvas_insert_clip_node',
    'canvas_insert_panorama_node',
    'canvas_create_pipeline_operation_node',
  ]),
)
```

行为测试使用内存 fake workspace，断言剧本工具创建/复用 script 资产、插入节点并写 screenplay role；分镜工具先校验全部 shots，再创建 groups、segments 和 Markdown 节点。

- [x] **Step 2: 运行测试确认工具缺失失败**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasSpecializedNodeTools.test.ts`

Expected: FAIL。

- [x] **Step 3: 实现 schema 与薄 handler**

专用工具描述符保持与 `CanvasToolDescriptor` 结构兼容。影视资产工具通过共享 factory 构造，但对外保留独立工具名和字段说明。媒体语义工具接受现有 `nodeId` 或 `assetId`，只对现有媒体节点/资产补齐 role、shot ref 或 panorama 标记。

- [x] **Step 4: 接入 canvas.tools 注册表**

```ts
const tools: CanvasToolDescriptor[] = [
  // existing project/node/asset/task descriptors remain in their current order
  ...SPECIALIZED_CANVAS_NODE_TOOLS,
]
```

`canvas_get_available_actions` 把影视 pipeline/recommended_flow 动作的 recipe 改写为 `canvas_create_pipeline_operation_node({ actionId, sourceNodeId })`。通用工具描述明确只用于普通文本或基础任务。

- [x] **Step 5: 运行专用工具与 MCP schema 测试**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasSpecializedNodeTools.test.ts src/renderer/design/views/canvas/canvas.tools.test.ts src/renderer/design/views/canvas/canvasAgentCapabilities.test.ts`

Expected: PASS。

### Task 5: Agent 指引和文档同步

**Files:**

- Modify: `apps/desktop/resources/skills/canvas-studio/SKILL.md`
- Modify: `docs/superpowers/specs/2026-07-18-canvas-agent-specialized-node-tools-design.md`
- Modify: `docs/superpowers/plans/2026-07-18-canvas-agent-specialized-node-tools.md`

- [x] **Step 1: 更新 Canvas Skill**

把 Skill 版本升级，列出专用工具并明确：普通文本工具不得创建剧本、分镜和影视资产；影视 pipeline 必须使用 action id 工具；分镜 JSON 只输出一次，Markdown 由程序生成。

- [x] **Step 2: 刷新文档状态**

实现完成后把设计和计划的状态改为 `已落地`，刷新 `最后核对: 2026-07-18`，并记录实际交付工具集合和兼容边界。

- [x] **Step 3: 运行文档与 Skill 相关静态核对**

Run: `rg -n "canvas_create_(screenplay|storyboard|pipeline_operation)_node|canvas_insert_(keyframe|clip|panorama)_node" apps/desktop/resources/skills/canvas-studio/SKILL.md docs/superpowers/specs/2026-07-18-canvas-agent-specialized-node-tools-design.md`

Expected: 所有关键工具均被说明，无旧的双 JSON+Markdown 输出要求。

### Task 6: 完整验证、审查和提交

**Files:**

- Verify all files changed by Tasks 1-5

- [x] **Step 1: 运行完整定向测试**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasShotSegmentPersistence.test.ts src/renderer/design/views/canvas/canvasPipelineActionContracts.test.ts src/renderer/design/views/canvas/canvasTextOutputValidation.test.ts src/renderer/design/views/canvas/canvasStoryboardMaterialization.test.ts src/renderer/design/views/canvas/canvasSpecializedNodeTools.test.ts src/renderer/design/views/canvas/canvas.tools.test.ts src/renderer/design/views/canvas/canvasAgentCapabilities.test.ts src/renderer/design/views/canvas/canvasPipelineOps.test.ts src/renderer/design/views/canvas/canvasShotTableParse.test.ts src/renderer/design/views/canvas/canvasOperationInheritance.test.ts`

Expected: PASS，0 failures。

- [x] **Step 2: 运行类型检查、lint 和构建**

Run:

```bash
pnpm --filter @spark/desktop typecheck
pnpm --filter @spark/desktop lint
NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @spark/desktop build
```

Expected: 全部 exit 0。若仓库既有未提交修改导致无关失败，记录具体文件和错误，并确保本次相关文件无新增错误。

- [x] **Step 3: 五轴代码审查**

按正确性、可读性、架构、安全和性能检查全部 diff；重点检查批量写入是否先校验、专用工具是否越权接受任意字段、历史节点是否仍兼容、是否误提交工作区既有修改。

- [x] **Step 4: 变更范围核对**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: 本次文件与设计一致；GitNexus 不可用，以上步骤替代 detect_changes。

- [x] **Step 5: 只暂存本次相关文件并提交**

```bash
git add \
  apps/desktop/src/renderer/design/views/canvas/canvasFilmAssets.ts \
  apps/desktop/src/renderer/design/views/canvas/canvas.api.ts \
  apps/desktop/src/renderer/design/views/canvas/canvas.store.ts \
  apps/desktop/src/renderer/design/views/canvas/canvasShotSegmentPersistence.test.ts \
  apps/desktop/src/renderer/design/views/canvas/canvasPipelineActionContracts.ts \
  apps/desktop/src/renderer/design/views/canvas/canvasPipelineActionContracts.test.ts \
  apps/desktop/src/renderer/design/views/canvas/canvasTextOutputValidation.ts \
  apps/desktop/src/renderer/design/views/canvas/canvasTextOutputValidation.test.ts \
  apps/desktop/src/renderer/design/views/canvas/canvasStoryboardMaterialization.ts \
  apps/desktop/src/renderer/design/views/canvas/canvasStoryboardMaterialization.test.ts \
  apps/desktop/src/renderer/design/views/canvas/canvasSpecializedNodeSchemas.ts \
  apps/desktop/src/renderer/design/views/canvas/canvasSpecializedNodeTools.ts \
  apps/desktop/src/renderer/design/views/canvas/canvasSpecializedNodeTools.test.ts \
  apps/desktop/src/renderer/design/views/canvas/canvas.tools.ts \
  apps/desktop/src/renderer/design/views/canvas/canvas.tools.test.ts \
  apps/desktop/resources/skills/canvas-studio/SKILL.md \
  docs/superpowers/specs/2026-07-18-canvas-agent-specialized-node-tools-design.md \
  docs/superpowers/plans/2026-07-18-canvas-agent-specialized-node-tools.md
git diff --cached --check
git diff --cached --stat
git commit -m "feat(canvas): add specialized agent node tools"
```

不得暂存用户在任务开始前已经存在的修改。

## 实施结果

- 画布目录回归：125 个测试文件、883 个测试通过。
- `pnpm --filter @spark/desktop typecheck`、`pnpm --filter @spark/desktop lint` 和桌面生产构建通过。
- 五轴审查补充了文本任务终态幂等、媒体类型/分镜回链前置校验和空语义名称校验。
- GitNexus MCP 未暴露，按项目降级规则使用 `rg` 调用点、全量画布测试、类型检查、构建和 `git diff` 完成影响核对。

### 2026-07-18 运行时与诊断维护补充

- [x] Anthropic-compatible Provider 不再因 Agent adapter 为 Codex 而被错误路由到 Responses WebSocket；本地 Codex/Claude CLI 路由保持不变。
- [x] 专用功能 Prompt 与通用操作 Prompt 隔离，空白画布入口补齐 task/output role 与 workflow。
- [x] 历史污染的分镜、剧本和实体抽取 Prompt 在运行/重试时按专用契约标记修复。
- [x] 结构解析失败独立保留模型原文，写入失败终态时间并输出 schema 诊断。
- [x] 任务详情展示最终 System/User Prompt、完整运行配置、真实生命周期事件与独立运行时诊断。
- [x] 节点卡片同步最新 Agent/Provider/Model；重试区分当前节点模型与原任务模型。
- [x] 终态任务配置冻结，节点草稿不再覆盖原任务模型；分镜时长配置按任务快照保存。
- [x] 角色、场景、道具、特效统一进入实体解析与资产物化路径，解析前先保存完整模型原文。
- [x] 旧 OpenAI Chat Profile 缺少 wire protocol 时回退直连，不再默认探测 Responses。
- [x] 旧任务按边语义恢复操作节点，生成边使用 source、输入边使用 target。
- [x] 专用 workflow 与 Provider 参数裁剪分层；旧分镜节点可由输出 `shot` 角色恢复身份，并在提交边界清除残留角色抽取 Prompt。
- [x] 任务详情按实际模型调用去重：HTTP/SDK/CLI 地址与最终参数优先展开，画布 Prompt、输入快照和非最终配置折叠展示。
