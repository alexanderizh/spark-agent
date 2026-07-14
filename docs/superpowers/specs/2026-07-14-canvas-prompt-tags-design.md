# 画布多模态 Prompt Tag 编排与编译设计

> 状态: 已落地 | 最后核对: 2026-07-14

## 1. 目标与非目标

本改造把画布文本、生图、生视频、音频和资产类任务节点的提示词输入，从“普通字符串 + 提交前拼接上游文本”升级为可编排的 Prompt Document。用户在输入区看到自然语言、带缩略图的引用 Tag、参数胶囊和结构化内容 Tag；提交时把它们解析为带关系语义的多模态模型入参，并保留可复现的任务快照。

目标：

- 自动连线和用户 `@` 引用都以 Tag 进入输入区，不再把上游文本直接展开进可见输入框。
- Tag 显式携带角色、场景、道具、首帧、尾帧、参考图、音色、分镜表等关系；文本顺序和上下文仍保留，用于表达“谁对谁做什么”。
- 节点能力、格式约束、内置 preset 和默认提示词进入隐藏的节点系统提示词；任务详情和运行日志可审计，但不污染用户输入区。
- 图片/视频/音频保留真实输入通道，结构化文本（剧本、分镜表、JSON）保留结构并以可读形式提供给模型。
- 提交后冻结输入快照，任务详情可展示缩略图、角色关系、实际编译结果并支持基于快照重试。

非目标：本期不重做模型 Provider adapter 的业务能力，不把所有供应商的私有字段统一成同一套 UI；只定义 Prompt Document 到现有 `prompt`、`inputFiles`、`modelParams` 和系统提示词层的稳定编译契约。

## 2. 当前问题与约束

当前 `CanvasPromptMentionTextArea` 以 string 保存输入，旧 `@[label](node:id)` 只用于展示 token 条；`CanvasWorkspaceView` 在提交时通过 `mergePromptWithNodeContext` 再次把上游文本拼入 prompt。图片通过 `inputFiles` 发送，文本任务的 vision 输入由 `canvas-text-generator` 另行转换。节点系统能力由 `buildCanvasOperationPrompt`/preset 逻辑混入可见 prompt，任务详情虽能显示 `systemPrompt`、prompt 和 request body，但不能完整显示每个图片输入的冻结快照。

本设计必须保持旧任务和旧节点可读，不能因迁移误删用户文本；GitNexus MCP 当前不可用，影响范围以源码、测试和 `git diff` 核对为准。

## 3. 统一数据模型

### 3.1 Prompt Document

新增共享类型（建议放在 `packages/protocol`，renderer/runtime 共用）：

```ts
type CanvasPromptDocument = {
  version: 2
  blocks: CanvasPromptBlock[]
}

type CanvasPromptBlock =
  | { kind: 'text'; id: string; text: string }
  | {
      kind: 'reference'
      id: string
      source: 'connection' | 'manual'
      sourceNodeId: string
      relation: CanvasPromptRelation
      label: string
      order: number
      note?: string
    }
  | {
      kind: 'parameter'
      id: string
      parameter: 'duration' | 'dialogue' | 'blocking' | 'custom'
      value: string | number
      unit?: string
      relation?: string
    }
  | {
      kind: 'structured'
      id: string
      sourceNodeId: string
      schema: 'storyboard' | 'screenplay' | 'json' | 'table'
      summary: string
    }

type CanvasPromptRelation =
  | 'character'
  | 'supporting_character'
  | 'scene'
  | 'prop'
  | 'first_frame'
  | 'last_frame'
  | 'reference_image'
  | 'reference_video'
  | 'reference_audio'
  | 'storyboard'
  | 'screenplay'
  | 'generic'
```

`reference` 和 `structured` 在草稿期只保存节点 ID，提交时解析节点/资产的最新内容；任务创建后在 `CanvasPromptSnapshot` 中保存解析后的内容哈希、稳定存储引用、缩略图、MIME、尺寸/时长、原始节点标题、关系和顺序。一个节点可出现多个 block 并拥有不同关系，但物理连线按节点去重。

### 3.2 任务字段

在现有 canvas task/request 上增加可选字段，保留旧 `prompt` 作为兼容字段：

- `promptDocument`：用户编辑区的结构化文档。
- `promptSnapshot`：提交时编译前的不可变文档快照。
- `compiledPrompt` 或 `compiledUserText`：用于详情和旧 provider 的可读编译文本。
- `inputSnapshots`：按文档顺序保存图片/视频/音频/结构化输入的稳定引用、缩略图和关系。
- `promptWarnings`：失效引用、降级为文本、供应商不支持的部分等非阻断信息。

已有 `prompt` 继续承载兼容的用户可读文本；新流程不再把隐藏系统提示词写入其中。

## 4. 编辑器交互

### 4.1 编排区

将 `CanvasPromptMentionTextArea` 演进为基于 block 的 `CanvasPromptComposer`，保留现有 props 适配层，避免一次性改动所有面板。编辑器内部使用受控 Prompt Document，渲染为可编辑文本节点 + 不可拆分的 Tag/参数胶囊；同步维护纯文本 fallback 供复制和旧数据读取。

- 图片 Tag 胶囊内固定显示 28–32px 缩略图；视频显示封面帧；文本/分镜表显示类型图标、名称和摘要。
- `@` 菜单按关系分类，支持角色、场景、道具、分镜、参考图、音色等；选中后写入 block，并按关系建立/复用 `used_as_input` 连线。
- 参数胶囊支持时长、台词、站位等内置参数和自定义参数；编辑使用小弹窗，确认后更新 block，不把参数转成不可追踪的纯文本。
- Tag 与连线双向同步：新增连线插入 `source='connection'` Tag；删除最后一个引用删除连线；断线只移除未被用户改写的自动 Tag，已改写 Tag 标记为“已断开”。
- 悬浮 Tag 显示只读预览窗：完整元数据、缩略图/大图、关系、来源、作用范围和内容；最大高度 240–320px，超出内部滚动。点击胶囊进入关系侧栏编辑；键盘聚焦与鼠标悬浮行为一致。
- 失效 Tag 使用错误态，显示原标签和“重新绑定”，提交前阻止静默丢失；可复制/撤销/重做，兼容中文 IME、粘贴和键盘导航。

### 4.2 隐藏系统提示词

编辑器只显示用户文本和输入 block。节点能力、内置 operation prefix、preset 约束、格式/安全规则进入 `systemPrompt` 分层；用户可在节点预设配置页编辑，但不注入输入区。任务详情单独显示系统层、用户文档、编译结果和 Provider request body。

## 5. 提交编译协议

提交由单一 `compileCanvasPromptDocument(document, snapshot, capability)` 完成，所有 text/media operation 复用，禁止在 `CanvasWorkspaceView`、`canvas.api`、adapter 内各自拼接。

编译步骤：

1. 校验 block schema、去除空文本、保持 block 顺序和用户显式关系。
2. 解析引用节点的最新内容；节点/资产不存在时返回阻断错误，不静默降级。
3. 为每个引用生成冻结快照和 `relationManifest`（稳定引用 ID、关系、顺序、来源、摘要、哈希）。图片/视频/音频进入 `inputFiles`，其 role 由关系映射：`first_frame`、`last_frame`、`reference` 或 `input`；顺序以文档中首次出现顺序为准，不再以节点数组顺序猜测。
4. 文本 block 直接保留；结构化 block 同时保留 schema + 原始数据，并生成可读 Markdown/JSON 摘要。编译文本用明确边界表达关系，例如 `[角色 ref-1 / 主角]`、`[分镜 storyboard-1 / 叙事约束]`，避免模型仅凭图片顺序推断身份。
5. 生成 `compiledUserText`、`inputFiles`、`relationManifest`、`promptSnapshot` 和 warnings；将系统能力 prompt 单独合并到 `systemPrompt`。负面提示词继续作为独立用户可编辑字段，并在 provider contract 中单独传递。
6. Provider adapter 只消费编译产物：Anthropic/OpenAI vision 使用文本 + image content parts；媒体 adapter 使用 prompt + 有 role 的 `inputFiles`；不支持结构化部分的 provider 使用确定性可读降级并记录 warning。

编译结果必须可序列化、可重复：同一快照和同一文档版本产生同一内容顺序和关系清单。日志显示摘要和哈希，不写入完整 base64。

## 6. 任务详情、快照与重试

任务详情新增“输入编排”区域：按文档顺序显示 Tag 缩略图/封面、关系、来源节点、提交快照与当前节点差异；文本和分镜表可展开滚动查看。现有 System、实际提交 Prompt、模型输出、结构化解析、参数和 request body 区域保留。图片/视频失败或被 provider 丢弃时显示原因。

任务提交时：项目内已有文件复用稳定对象；外部 URL/data URL 先落到项目任务输入存储；保存内容哈希和预览图。重试默认复用 `inputSnapshots` 和 `promptSnapshot`，另提供“使用当前节点最新内容重跑”生成新快照。

## 7. 旧数据迁移

- `version < 2` 节点打开时，将可识别的 `@[label](node:id)` 转为 reference block。
- 只剥离可由固定前缀/边界确定的内置系统 prompt 和旧“画布节点内容”段；歧义字符串原样保留为 text block，并标记 `migratedLegacy=true`。
- 历史 task 不重写；再次编辑时生成 v2 文档，重试默认仍使用历史请求快照。
- 迁移失败或引用节点缺失时显示可修复错误，允许用户手动保留为纯文本/重新绑定。

## 8. 错误处理与安全

- 失效引用、无法读取本地文件、上传失败均为可见错误；不产生空 prompt 或无图调用。
- 上传优先稳定云 URL，失败按现有策略回退 base64；base64 只进入请求，不进入日志和任务详情原文。
- 悬浮窗内容转义并限制最大渲染长度；Markdown/JSON 只作为文本展示，禁止执行 HTML。
- 对 provider 不支持的关系/媒体类型记录 warning，并在详情中显示实际降级后的入参。

## 9. 测试与验收

单元测试覆盖：

- Prompt Document block 插入、删除、撤销、IME/粘贴边界和旧 token 迁移。
- 连线与 Tag 双向同步、重复引用去重、断线失效态。
- 编译器顺序稳定性、关系 manifest、图片/视频 role 映射、分镜 JSON/Markdown 编译、系统 prompt 不混入用户文本。
- 外部 URL/data URL 快照、上传失败回退、失效引用阻断、日志不泄漏 base64。
- 任务详情渲染输入缩略图/滚动内容、历史任务兼容、快照重试与当前内容重跑差异。

集成验收至少包括：文本生成带角色图与分镜表；文生图带角色/场景/参考图；图生视频带首帧/尾帧/参考图；自动连线后 Tag 可见、断线可修复；任务详情能看到真实图片输入和实际 Provider request body。

## 10. 分阶段实施

1. 先在 protocol/renderer 建立 Prompt Document、快照和编译器，补齐纯函数测试。
2. 将现有文本域替换为兼容适配的 block composer，接入缩略图、悬浮滚动预览、关系侧栏和连线同步。
3. 把 CanvasWorkspaceView/canvas.api 的多处分散拼接收敛到编译器；隐藏系统 prompt 分层并保持旧 prompt 字段兼容。
4. 扩展 runtime/provider 请求与任务持久化，完善任务详情和快照重试。
5. 执行迁移、端到端验收和回归；确认旧节点/旧任务可打开后再默认启用 v2。

