# 画布提示词库接入节点能力设计

> 状态: 待开发 | 最后核对: 2026-07-02

## 1. 背景

当前提示词库已经具备卡片浏览、分类、搜索、示例图、加入项目库和复制提示词能力，但它还没有真正成为画布生产链路的一部分。用户在卡片上点击「加入项目库」或「复制提示词」之后，仍然需要回到画布、找到节点、打开编辑器、粘贴或手动发起 AI 操作，实际效率提升有限。

参考 Liblib 类无限画布工作台的核心方式，素材库和提示词库不应只是收藏夹，而应直接服务画布上的创作对象：选中素材后能立即生成任务节点，拖放素材能创建输入关系，卡片动作应围绕“把当前素材变成下一步操作”展开。

本设计目标是把提示词库从「文本仓库」升级为「节点能力的提示词积木与操作预设」。

## 2. 现状判断

已存在能力：

- `CanvasPromptLibraryPanel` 可从项目资产和内置电影提示词生成统一条目。
- `CanvasFilmAssetCenter` 的提示词库 Tab 可以把内置词加入项目库，或把项目提示词插入画布。
- `CanvasNodeEditModal` 可在文本 / Prompt / 旧任务节点编辑时插入提示词片段。
- `CanvasNode` 已有节点头部 AI 操作按钮、右键「AI 操作」子菜单（内含上下文专属的「图片扩图 / 提取风格 / 细节设定图（九宫格）」 + 泛化能力）。
- `CanvasOperationPanel` 已是类型化操作节点的参数编辑与运行入口。
- `canvas.api.createOperationNode` 已支持从输入节点继承 prompt、negativePrompt 和 modelParams。

主要断点：

- 提示词库卡片动作停留在「复制」和「加入项目库」，没有表达“对当前节点做什么”。
- 提示词库不能直接创建 `text_to_image` / `image_to_video` / `image_edit` 等操作节点。
- 提示词库不能以参数块方式写入操作节点 `data.prompt`、`data.negativePrompt`、`data.modelParams`。
- 画布节点头部和右键菜单没有进入“基于此节点套用提示词”的快捷路径。
- 项目库资产被插入画布时只变成文本节点，没有形成“提示词资产 → 操作节点 → 输出节点”的生产关系。

## 3. 产品原则

提示词库接入画布时遵循四条原则：

- 卡片主动作必须落到画布对象上，而不是落到剪贴板。
- 每个提示词条目都要能解释它适合哪些操作和哪些输入类型。
- 项目库用于沉淀常用组合，内置库用于快速试错；两者在画布上使用方式一致。
- 不新增一套任务系统，继续复用 `CanvasOperationType`、`CanvasNode`、`CanvasTask`、`CanvasOperationPanel` 和现有血缘边。

## 4. 目标交互

### 4.1 选中节点时：卡片动作变成节点能力

当画布存在选中节点时，提示词卡片主按钮不再显示泛化的「应用」或「加入项目库」，而是根据上下文显示：

- 阶段一默认行为：在选中节点右侧新增一个平行级别的提示词文本节点，内容为卡片提示词。
- 选中文本 / Prompt 节点：`追加到节点`、`创建文生图`、`优化 Prompt`
- 选中图片节点：`创建图生图`、`创建图片转视频`、`作为风格参考`
- 选中多图：`创建多图合成`、`统一风格`
- 选中视频：`创建视频编辑`
- 未选中节点：`新建 Prompt 节点`、`创建文生图节点`

卡片仍保留次级动作：

- `收藏到项目库`
- `复制文本`
- `查看详情`

### 4.2 从节点进入提示词库

在节点头部和右键菜单中增加「套用提示词」入口：

- 普通节点头部：AI 按钮旁增加提示词按钮，点击打开轻量提示词面板。
- 节点右键：在「AI 操作」上方增加「套用提示词…」。
- 操作节点右键：增加「替换/追加提示词…」。

入口打开同一个 `CanvasPromptLibraryPanel`，但以当前节点作为 `target`，面板只展示和当前节点能力相关的卡片与动作。

### 4.3 创建操作节点

用户在提示词库卡片点击 `创建文生图` 时，应生成：

```text
文本/Prompt 节点 或 选中输入节点
        │ used_as_input
        ▼
text_to_image 操作节点（prompt 已写入）
```

生成后默认选中新操作节点并打开 `CanvasOperationPanel`，用户可以直接选模型、看继承参数并运行。

阶段一可以先不直接创建操作节点，而是创建一个与选中图片 / 视频 / 文本节点同级的提示词文本节点。这样用户能在画布上显式看到“素材节点 + 提示词节点”的组合，再用已有节点能力创建 AI 操作，避免提示词被隐式塞进某个参数面板。

对图片、视频、多图场景同理：

- 图片 + 风格提示词 → `image_edit`
- 图片 + 运镜提示词 → `image_to_video`
- 多图 + 合成提示词 → `image_compose`
- 视频 + 编辑提示词 → `video_edit`

### 4.4 拖放卡片到画布

提示词库卡片支持拖放：

- 拖到空白画布：创建 Prompt 节点。
- 拖到文本 / Prompt 节点：追加片段。
- 拖到图片 / 视频节点：弹出可用操作菜单并创建操作节点。
- 拖到操作节点：追加或替换该节点 prompt。

拖放是第二阶段能力，第一阶段先完成点击式动作。

## 5. 数据模型扩展

### 5.1 提示词条目能力字段

扩展 `CanvasPromptLibraryEntry`：

```ts
type CanvasPromptLibraryEntry = {
  id: string
  source: 'project' | 'camera' | 'performance'
  group: string
  label: string
  text: string
  negativePrompt?: string
  recommendedOperations?: CanvasOperationType[]
  supportedInputTypes?: CanvasNodeType[]
  applyMode?: 'append_prompt' | 'create_operation' | 'replace_prompt'
  modelParams?: Record<string, unknown>
  tags?: string[]
  assetId?: string
}
```

能力推断规则：

- 类型片风格、光影、色彩、质感：优先推荐 `text_to_image`、`image_edit`、`image_to_video`。
- 运镜、剪辑节奏、连贯性：优先推荐 `text_to_video`、`image_to_video`、`video_edit`。
- 景别、构图、镜头焦距、焦点：优先推荐 `text_to_image`、`image_edit`。
- 表情、动作、对白状态：优先推荐 `text_generate`、`image_to_video`、`video_edit`。
- 反向词：写入 `negativePrompt`，不单独创建任务。
- 项目库条目：优先读取资产 `metadata.recommendedOperations`；没有时按标签和内容推断。

### 5.2 节点来源追踪

扩展 `CanvasNodeData`：

```ts
promptSourceIds?: string[]
promptFragments?: Array<{
  entryId: string
  label: string
  source: 'project' | 'camera' | 'performance'
  text: string
  appliedAt: string
}>
```

这些字段只作为 UI 与追踪辅助，不改变任务运行协议。提交任务时仍使用最终合成后的 `prompt` 和 `negativePrompt`。

### 5.3 项目库资产元数据

项目提示词库资产继续复用 `CanvasAsset.metadata.kind = 'prompt_library'`，补充：

```ts
{
  kind: 'prompt_library',
  prompt: string,
  negativePrompt?: string,
  recommendedOperations?: CanvasOperationType[],
  supportedInputTypes?: CanvasNodeType[],
  tags?: string[],
  usageCount?: number,
  lastUsedAt?: string
}
```

## 6. 组件改造方案

### 6.1 `CanvasPromptLibraryPanel`

新增 props：

```ts
type CanvasPromptLibraryTarget =
  | { kind: 'none'; boardId: string }
  | { kind: 'node'; node: CanvasNode; selectedNodes: CanvasNode[] }
  | { kind: 'operation'; node: CanvasNode }

type CanvasPromptLibraryAction =
  | 'append_to_node'
  | 'create_operation'
  | 'replace_operation_prompt'
  | 'save_to_project'
  | 'copy'

onAction?: (action: CanvasPromptLibraryAction, entry: CanvasPromptLibraryEntry) => void
target?: CanvasPromptLibraryTarget
```

面板内部根据 `target` 和条目能力生成动作按钮。原有 `onApply` 保留一版兼容，但新入口应使用 `onAction`。

### 6.2 `CanvasWorkspaceView`

新增统一动作函数：

```ts
applyPromptEntryToCanvas({
  entry,
  action,
  targetNodeIds,
  operation,
  placement,
})
```

它负责：

- 追加文本节点内容。
- 创建 Prompt 节点。
- 调用 `createOperationNode` 创建操作节点。
- 写入操作节点 `data.prompt` / `data.negativePrompt`。
- 设置选中节点并打开 `CanvasOperationPanel`。
- 更新项目提示词资产 `usageCount` / `lastUsedAt`。

### 6.3 `canvas.api.createOperationNode`

第一阶段可以在前端创建操作节点后再调用 `updateNodeData` 写入提示词。第二阶段建议扩展输入参数：

```ts
prompt?: string
negativePrompt?: string
modelParams?: Record<string, unknown>
promptSourceIds?: string[]
```

这样创建节点和任务时可以一次性落库，避免前端双写。

### 6.4 `CanvasOperationPanel`

在 prompt 编辑器附近增加「提示词库」入口：

- `追加片段`
- `替换当前 prompt`
- `写入反向词`

面板打开时 target 为 `{ kind: 'operation', node }`，只展示与当前 operation 匹配的条目。

### 6.5 `CanvasNode`

节点头部新增一个轻量提示词按钮。点击后向 `CanvasWorkspaceView` 传出 `onOpenPromptLibrary(nodeId)`，由工作区打开目标化提示词面板。

右键菜单增加：

- `套用提示词…`
- `用提示词创建 AI 操作 ▸`

已有「AI 操作」仍保留，用于不从提示词库开始的流程。

## 7. 分阶段落地

### 阶段一：点击式接入

- 有选中节点时，提示词卡片主按钮显示 `应用到画布`，在选中节点右侧创建同级提示词文本节点。
- 扩展 `CanvasPromptLibraryEntry` 的推荐操作推断。
- `CanvasPromptLibraryPanel` 支持 target-aware actions。
- 在 `CanvasNodeEditModal`、`CanvasOperationPanel`、项目资产中心复用同一套动作。
- 支持从提示词卡片创建操作节点，并自动打开操作面板。
- 保留复制按钮，但降级为次级动作。

### 阶段二：项目库资产化

- 项目库资产保存推荐操作、输入类型、反向词、使用次数。
- 项目库卡片默认主动作从「插入画布」改为「套用到当前节点」。
- 资产详情页展示最近使用、适用操作、来源内置条目。

### 阶段三：拖放与组合预设

- 卡片拖到画布创建 Prompt 节点。
- 卡片拖到节点创建带输入边的操作节点。
- 支持把多个提示词片段保存为组合预设，例如「赛博朋克夜景 + 低机位 + 体积光 + 电影净化反向词」。

## 8. 验收标准

- 用户选中一张图片后，可以在 2 次点击内用提示词库创建 `image_edit` 或 `image_to_video` 操作节点。
- 用户选中文本节点后，可以在 2 次点击内创建带提示词的 `text_to_image` 操作节点。
- 用户不需要复制粘贴，也能把内置提示词应用到任务 prompt。
- 创建的操作节点保留输入边和 prompt 来源，任务面板能看到最终 prompt。
- 项目提示词库中的条目可以直接套用到当前节点，而不是只插入为一个文本节点。
- 复制提示词仍可用，但不是卡片主路径。

## 9. 风险与约束

- 不要把所有卡片都硬编码成同一个主动作，否则会回到低效率的「文本复制」。
- 不要把提示词库做成新的任务发起系统，应继续复用操作节点和任务面板。
- 如果第一阶段扩展 `createOperationNode` 风险较高，可以先以前端 `createOperationNode` + `updateNodeData` 组合实现，后续再收敛到 API 层。
- 反向词需要特殊处理：追加到 negative prompt，而不是直接拼到正向 prompt。
