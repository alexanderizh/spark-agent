# 无限画布统一媒体任务输入配置器

> 状态: 实施中 | 最后核对: 2026-08-05

## 1. 背景与问题

无限画布当前允许媒体资源通过物理连线、Prompt `@`、Prompt 加号、画布选择器、上传和历史任务恢复进入操作节点。现有实现已经通过 `CanvasPromptDocument` 与 `CanvasInputBinding` 尝试统一这些入口，但执行角色仍可能由多个状态共同决定：

- 图片连线、`@` 和加号引用默认生成 `reference` binding；
- 首帧、尾帧和参考图选择器可能在默认 binding 之外继续叠加角色；
- UI 根据资源数量和角色重新推断 capability；
- 运行时再次从 operation、Prompt 引用、binding 和 inputRoles 合并输入；
- 缺少显式角色时，`buildTaskInputFiles()` 仍按资源顺序推断首帧、尾帧和参考图。

结果是界面展示、预校验和 Provider 最终请求可能不一致。Seedance 1.x 被错误发送为 `reference_image` / `r2v` 是这一结构问题的直接表现。

## 2. 设计目标

1. 同一资源无论从连线、`@`、加号、上传还是历史任务进入，只形成一份权威执行 assignment。
2. 模型、生成模式、资源角色、排序、参数和最终 capability 明确联动。
3. Prompt 引用负责语言语义；媒体 binding 负责 Provider 输入语义，两者关联但不互相隐式改写。
4. 提交前展示实际使用、未使用和不兼容资源；最终请求与预览一致。
5. 新任务持久化显式 `mediaInputMode` 和 `capabilityId`，运行时不得再次猜测。
6. 旧节点和旧任务可读、可迁移、可重试，不批量破坏历史数据。
7. Provider adapter 保留最终协议防线。

## 3. 非目标

- 不复制 Liblib 的视觉样式。
- 不在首期重做图片、音频和文本任务的全部界面。
- 不删除 Prompt V2、物理连线或历史 `inputBindings`。
- 不把 Provider/model id 硬编码进画布组件。

## 4. 竞品观察结论

Liblib 的关键机制是把模型选择与视频生成模式分离：文生、图生、首尾帧、全能参考和图片参考等模式由当前模型能力启用或禁用。资源先进入统一输入区，再由明确模式决定角色；资源不是因为“连线”就天然成为参考图。

Spark 应采用同样的决策顺序，但继续使用自身 Manifest / `rolePolicy` 作为能力来源：

```text
模型 Manifest + operation
  -> 可用输入模式
  -> 用户选定 mediaInputMode
  -> capabilityId
  -> 规范化 CanvasInputBinding（角色 + 顺序）
  -> 参数 schema / 预校验
  -> Provider 请求
```

## 5. 能力复核

输入模式不得由 Provider 名称判断，必须由 capability 与 `rolePolicy` 推导。

| Manifest 能力              | rolePolicy 特征                | 画布输入模式       |
| -------------------------- | ------------------------------ | ------------------ |
| `video.generate`           | 无媒体角色                     | 文生视频           |
| `video.generate`           | reference image/video/audio    | 文生视频、全能参考 |
| `video.image_to_video`     | `first_frame`                  | 首帧生视频         |
| `video.image_to_video`     | `first_frame + last_frame`     | 首帧、首尾帧       |
| `video.image_to_video`     | 仅 `reference_image`           | 图片参考           |
| `video.reference_to_video` | reference roles                | 图片参考或全能参考 |
| `video.edit`               | `input_video` + 可选 reference | 视频编辑           |
| `video.extend`             | `input_video`                  | 视频延长           |

重点模型族复核：

- 火山 Seedance 1.0 Pro / 1.5 Pro：文生视频、首帧生成、首尾帧生成；禁止 reference/r2v。
- 火山 Seedance 1.0 Pro Fast：文生、单首帧。
- 火山 Seedance 2.0 / Fast / Mini：文生视频、首帧生成、首尾帧生成、多模态参考、编辑和延长。
- APIMart Seedance 1.x 与火山对应；Seedance 2.x 支持最多 9 图、3 视频、3 音频参考。
- APIMart Sora、Hailuo、Wan、Kling、Vidu、Veo、HappyHorse、SkyReels、PixVerse 等依 `apimart-video-input-contracts.ts` 的 frame/reference/edit profile 推导。
- 百炼 Wan 2.7 T2V、I2V、R2V、VideoEdit 是独立 capability；R2V 可同时包含首帧、参考图、参考视频和参考音频。
- xAI Grok Imagine Video 1.5 仅单首帧 I2V。
- Google Veo 与腾讯 TokenHub 等继续按各自 Manifest 的 capability/rolePolicy 推导，不进入厂商硬编码分支。

## 6. 协议设计

### 6.1 显式输入模式

新增可持久化的通用类型：

```ts
type CanvasMediaInputMode =
  | 'text'
  | 'first_frame'
  | 'first_last_frame'
  | 'reference'
  | 'edit'
  | 'extend'
```

在 `CanvasPromptTaskFields`、任务节点数据和媒体 IPC 请求中增加可选字段：

```ts
mediaInputMode?: CanvasMediaInputMode
capabilityId?: MediaCapabilityId
```

字段可选以兼容历史数据。新媒体任务必须写入；旧任务缺失时只在兼容层推导一次。

### 6.2 Canonical binding 规则

`CanvasInputBinding` 继续作为唯一执行 assignment，不新增长期平行的输入列表。

- 对 image/video/audio/file，同一 `sourceNodeId` 同时最多一个 active 执行角色。
- 修改首帧、尾帧或参考角色必须替换已有默认角色，而不是叠加。
- `origin` 只记录 binding 创建来源；物理连线和 Prompt block 继续分别保存真实来源。
- `order` 是 Provider 输入顺序的唯一来源。
- 删除一个 Prompt `@` 不应删除仍由物理连线持有的资源；删除连线也不应删除仍手动固定的资源。
- 同一资源确需多角色的 Provider 特例首期不通过重复 binding 表达；由 capability adapter 显式映射，避免普通 UI 产生重复素材。

### 6.3 旧任务兼容

旧任务首次进入配置器时执行纯函数迁移：

1. active binding 按 `order` 排序；
2. 同源角色优先级：显式 `first_frame/last_frame/mask` > `reference` > `input`；
3. 根据模型能力与资源类型推导一次 input mode；
4. Seedance 1.x 的 reference 图片迁移为第一张首帧、第二张尾帧，Fast 只保留首帧；
5. 无法确定的素材保留为未使用并显示警告，不静默发送；
6. 只有用户保存或运行后才写回新字段。

## 7. UI 设计

新增独立 `CanvasMediaInputConfigurator`，避免继续扩大 `CanvasOperationPanel.tsx`。

- 素材编排标题后显示统一视频模式选择器，固定提供“文生视频 / 首帧生成 / 首尾帧生成 / 全能参考 / 视频编辑 / 视频延长”六种模式；当前模型不支持的模式保留在下拉列表中并禁用。
- 模式可选性只由当前模型 Manifest 决定。缺少素材属于提交前校验，不得禁用模式；用户可以先选择模式，再补充该模式所需素材。
- 新建菜单只暴露一个“视频生成”节点。历史 `text_to_video`、`image_to_video`、`video_edit`、`video_extend` 节点不迁移，打开后均使用同一套六模式配置器。
- 节点展示类型与任务执行类型解耦：节点继续作为输出归属容器，任务按所选 capability 映射实际 operation。
- “任务输入”托盘按 canonical binding 顺序展示资源缩略图。
- 每项展示来源徽标（连线、Prompt、手动）、角色、序号、使用状态和模型限制。
- 首帧/首尾帧模式展示明确槽位；参考模式展示有序参考列表。
- 支持角色切换、移除和顺序调整；首期可使用上下移动按钮，后续再补拖拽。
- Prompt 中的 `@` 和加号继续是添加入口，添加后立即出现在托盘。
- 模型或模式切换时运行 reconcile，界面展示“已转换 / 未使用 / 超额”，禁止静默丢弃。
- 提交按钮附近显示 capability 与实际发送摘要。

视觉保持 Spark 现有暗色工业化画布语言：紧凑、低层级噪声、角色颜色稳定，不引入独立品牌风格。

## 8. 实施阶段

### 阶段 A：协议与纯函数

1. 新增 `CanvasMediaInputMode`、可选 `mediaInputMode/capabilityId` schema。
2. 新增模式推导、模式到 capability 映射、binding 规范化与旧数据迁移纯函数。
3. 为 APIMart、火山、百炼、xAI 和多能力模型建立参数化测试矩阵。

### 阶段 B：配置器 UI

1. 新增 `CanvasMediaInputConfigurator.tsx` 与样式。
2. 接入 `CanvasOperationPanel`，替换分散的首帧/尾帧/参考图选择区域。
3. 修改 `useCanvasInputBindings`：媒体角色 setter 执行替换式更新。
4. Prompt `@`、加号和连线变化后统一 reconcile。

### 阶段 C：提交与运行时

1. `OperationRunParams`、任务草稿、节点、任务和 IPC 传递显式字段，并根据 capability 映射实际执行 operation。
2. 预校验使用显式 capability。
3. 主进程将 capability 传入 `MediaTaskRuntimeService` / `MediaRouterService`。
4. `buildTaskInputFiles` 对新任务禁止隐式首尾帧推断；历史兼容只在迁移层执行。
5. 保留 Provider adapter 的模型协议兜底。

### 阶段 D：迁移与回归

1. 新字段双读：优先显式值，缺失才走旧推断。
2. 新任务只写 canonical binding + 显式模式/capability。
3. 覆盖新建、保存草稿、重开、运行、重试、复制模板和工作流抽取。
4. 通过后更新本文状态为“已落地”，运行 GitNexus analyze 更新索引。

## 9. 验收标准

- 同一资源通过连线、`@`、加号重复加入时，任务输入托盘只出现一次。
- 删除一个来源不会误删仍由其他来源持有的资源。
- 首帧、尾帧和参考图的界面角色、relationManifest、inputFiles 与 Provider 请求一致。
- 视频生成选择器始终提供文生视频、首帧生成、首尾帧生成、全能参考、视频编辑、视频延长六种模式；模型不支持的模式明确禁用，缺少素材只阻止提交，不阻止选择模式。
- Seedance 2.x 的全能参考可接收 Manifest 声明上限内的图片、视频和音频；编辑与延长模式把第一段视频作为主体，其余兼容素材作为参考。
- 同一视频节点可连续运行不同模式，任务记录使用实际 operation，历史输出仍通过 `operationNodeId` 回写同一节点。
- Manifest 同一 capability 同时声明帧角色与参考角色时，首帧/首尾帧模式允许混合参考素材：帧槽优先，剩余兼容图片、视频和音频按上限作为参考输入；全能参考模式则不占帧槽，全部按参考角色提交。
- Seedance 1.x 请求体永不包含 `reference_image`；2.x reference 行为不变。
- 旧任务可打开、保存、运行和重试。
- APIMart、火山、百炼、xAI、Google/Tencent 相关媒体测试通过。
- renderer、protocol、agent-runtime 类型检查通过；Lint 无新增错误。

## 10. 风险与控制

本改动覆盖超过 15 个直接/间接调用文件，属于 HIGH 风险画布核心路径。

- 先纯函数和测试，后 UI，最后运行时。
- 所有新字段可选，保证旧数据可读。
- 不在同一步删除旧兼容逻辑。
- 新旧推导结果不一致时优先阻止静默发送并给出可操作提示。
- GitNexus 不可用时使用 `rg` 调用点、相关测试、`git diff` 和 Git 历史完成影响核对。

## 11. 落地结果

- 协议层已持久化 `mediaInputMode` 与 `capabilityId`，并贯通草稿、任务、IPC、预校验和媒体路由。
- `CanvasMediaInputConfigurator` 已接入操作节点的紧凑与完整面板，统一展示连线、`@`、加号和选择器资源，并支持模式选择、顺序调整、移除非连线资源、使用/未使用状态和来源说明。
- 进阶 UI 已改为剪辑台式“素材轨道”：紧凑版位于提示词与模型参数之间，全屏版使用独立 inputs 网格区域；模式改为直接可见的胶囊切换，原始 capability 收进 tooltip，缩略图只显示序号与角色，排序/移除操作在悬浮或键盘聚焦时出现。
- 视频生成模式采用标题行紧凑选择器：文生视频、首帧生成、首尾帧生成、全能参考固定存在，是否可用完全由当前模型 Manifest 能力决定；不支持项以禁用态展示，不会构造或提交不存在的 capability。
- 完整任务配置采用扁平紧凑主题：提示词编辑区降低固定高度，素材编排移除嵌套卡片边框与渐变背景，模式选择器、素材缩略图和说明统一缩小密度；仍保留完整可见性、键盘焦点和角色提示。
- 操作节点、分组等间接输入会解析到实际产物节点作为轨道预览，避免出现有素材却只有文件占位图的情况。
- 模式选项、资源角色、数量上限和 capability 均由 Manifest capability / `rolePolicy` 推导；未使用或超额素材保留可见但不提交。
- 新任务的执行 binding 会按模式确定性去重并写入 relation/role；旧任务缺少显式字段时只在配置层推导，重试仍由 Provider adapter 兜底。
- Prompt 编译器现已一致识别 `reference_image`、`reference_video` 与 `reference_audio`；视频编辑和延长的主视频保持 `input` 角色。
- 火山 Seedance 1.x 实际 adapter 请求回归确认只包含 `first_frame` / `last_frame`，不包含 `reference_image` 或 `task_type=r2v`；Seedance 2.x 和 APIMart 参考模式保持独立。
- 操作节点或分组标签解析到实际产物时，提示词 owner 与产物 binding 视为同一逻辑输入；任务边与素材轨道只保留实际产物，避免单条连线显示两份相同素材。
- 最终验证覆盖 protocol 46 项、desktop 129 项、agent-runtime 74 项相关测试，三个包类型检查通过，变更文件 ESLint 无错误。

## 12. 统一视频节点二期改造

本次改造采用兼容型统一容器，不新增 `video_generation` 协议枚举，也不批量迁移旧画布：

1. 新建视频节点固定创建为 `text_to_video` 容器，标题显示“视频生成”。
2. 所有历史视频操作节点读取当前模型的全部视频 capability，不再先由旧 operation 裁剪模式或模型。
3. `video.generate` / `video.reference_to_video` 映射 `text_to_video`，`video.image_to_video` 映射 `image_to_video`，`video.edit` 映射 `video_edit`，`video.extend` 映射 `video_extend`。
4. 保存草稿时持久化 `mediaInputMode` 与 `capabilityId`；运行时把映射后的 operation 写入任务记录，但保持 `operationNodeId` 指向原容器节点。
5. 编辑和延长的第一段视频固定为 `input`；其余图片、视频、音频仅在 rolePolicy 允许且未超过 Manifest 上限时作为 `reference` 发送。
6. 内联快捷生成器与节点配置面板复用同一套模式、capability、素材分配和执行 operation 纯函数。
7. 重试任务从 relationManifest 恢复图片、视频和音频的 reference 角色，避免二次运行退化为普通 input。
8. 旧编辑/延长节点在缺少新模式字段时分别保持 edit/extend 语义；Workspace 在 prompt、preset、样式与参数处理前即完成实际 operation 映射。

## 13. 统一图片节点改造（文生图 / 图生图 / 编辑 / 多图合成合并）

与 §12 视频二期改造同构，采用兼容型统一容器，不新增协议枚举、不批量迁移旧画布。将历史四种图片操作（`text_to_image` / `image_edit` / `image_compose` / `image_to_image`）合并为单一「图片生成」节点：

1. 新建菜单图像组与内联快捷生成器只暴露 `text_to_image` 容器（标题「图片生成」）+ 图片反推；`CANVAS_CAPABILITIES` 中 `image_edit` / `image_compose` 条目保留以兼容旧节点。
2. 容器 `text_to_image.inputTypes` 扩为宽入口 `['text','prompt','image']`（对齐 `text_to_video`）。
3. 模式仅 2 种（协议层 `CanvasMediaInputMode` 已含，零枚举新增）：
   - `text`（文生图）→ capability `image.generate` → operation `text_to_image` → 产物 `ai_generated`；
   - `reference`（图生图 / 编辑）→ capability `image.edit` → operation 按参考图数量反推：≥2 张 `image_compose`，否则 `image_edit` → 产物 `ai_edited`。
4. 模式可选性仅由模型 manifest 决定（缺素材只在提交时阻断，不禁用模式胶囊）；模式族按 capability 命名空间（`image.*` vs `video.*`）判定，**不可按 mode 判定**——图片与视频共享 `text` / `reference` mode，否则图片节点会泄露「文生视频 / 全能参考」文案。
5. 提交链路 `imageInputCount` 必须取自 `params.inputBindings`（标准 UI 路径 `inputFiles` 始终为 undefined）；`retryOperationNode` 同样走 capability + 冻结 inputBindings 数量的反向映射，使统一任务重试还原出正确的 image_edit / image_compose。
6. `validateBasicMediaSubmission` 校验改为 capability 命名空间分层：`image.generate` 要求 prompt、`image.edit` 要求图片，视频分支保持原样（capabilityId 缺失时回退字面 operation，兼容旧 retry / inline 边界）。
7. 旧 `image_edit` / `image_compose` / `image_to_image` 节点默认落在 `reference` 模式（`legacyCanvasMediaInputMode`），`text_to_image` 默认 `text`，不漂移。
8. 已知行为变化：`image_to_image`（角色身份板）反向映射后产物 `asset.source` 由 `ai_generated` 变为 `ai_edited`（与「基于参考图生成」语义一致，默认接受；若产品需保留旧标签，可在 `canvas.api.ts` asset.source 判定里显式纳入历史 operation）。
