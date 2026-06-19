# Liblib 风格无限画布改造开发文档

> 状态: 已落地（CanvasBoardSidebar / CanvasAssetManagerPanel / CanvasBottomDock / CanvasFilmAssetCenter 已上线，后续优化持续推进） | 最后核对: 2026-06-19
>
> 日期：2026-06-16  
> 适用对象：后续负责实现 Spark 无限画布改造的 agent / 开发同学  
> 目标：在不推翻现有 Spark Canvas 架构的前提下，把当前“生产型 AI 画布”升级为更接近 Liblib 的“内容创作工作台”

## 1. 文档目的

这不是一份从零设计新的无限画布方案，而是一份基于 **现有 Spark Canvas 真实实现** 的改造开发文档。后续开发必须遵守下面两条原则：

- 优先复用现有项目、画布、节点、任务、资产、快照、任务运行时能力。
- 优先补齐交互层、信息架构层、菜单层和数据扩展层，不要重写底层任务系统和画布基础能力。

换句话说，我们当前不是“没有画布”，而是“已经有较强的画布内核，但产品形态还不够像 Liblib 这种创作工作台”。本次工作的重点是：**在已有能力基础上改造 UI 结构、交互入口、节点体系、资产管理和多画布组织方式。**

## 2. 改造目标

目标产品形态参考 Liblib 的无限画布，但不能机械照搬。要吸收其适合内容生产的结构优势，结合我们当前已经落地的 AI 任务基础设施，形成更适合 Spark 的版本。

本轮目标能力包括：

- 多画布管理：一个项目内管理多个 board，并有清晰切换入口。
- 左侧工作台：拆分为 `画布`、`资产`、`资产管理` 三个主入口。
- 更强的资产管理：文件夹、分类、来源、批量操作、插入画布、定位来源。
- 左下角工具区：承载模板/历史/帮助/上传等高频入口。
- 底部悬浮工具栏：承载节点创建、快速 AI 操作、视图操作、撤销重做等。
- 右键菜单体系：空白画布、普通节点、任务节点、组节点分别有不同菜单。
- 添加节点菜单升级：从“简单添加文本/图片”升级为“节点工厂”。
- 保持现有 AI 任务模型不变，优先扩展节点类型映射和菜单编排方式。

## 3. 当前代码基线

下面这些文件是本次改造的核心基础，不应绕开重做。

### 3.1 视图与交互层

- `apps/desktop/src/renderer/design/views/canvas/CanvasProjectsView.tsx`
  - 已有项目列表、新建、编辑、导入、导出、打开项目目录。
- `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`
  - 已有工作区整体编排，是本次 UI 改造的主入口。
- `apps/desktop/src/renderer/design/views/canvas/CanvasToolbar.tsx`
  - 已有顶部工具栏，后续要么收缩为基础工具栏，要么部分能力迁到底部悬浮栏。
- `apps/desktop/src/renderer/design/views/canvas/CanvasStage.tsx`
  - 已有画布核心能力：缩放、平移、节点选择、连线、分组、对齐引导、局部上下文操作。
- `apps/desktop/src/renderer/design/views/canvas/CanvasAssetDrawer.tsx`
  - 已有资产抽屉基础版，适合扩展为 `资产` 面板基础层。
- `apps/desktop/src/renderer/design/views/canvas/CanvasInspector.tsx`
  - 已有节点属性、任务参数、血缘查看，不要废弃。
- `apps/desktop/src/renderer/design/views/canvas/CanvasTaskQueue.tsx`
  - 已有任务队列、定位节点、重试/取消/查看详情。
- `apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.tsx`
  - 已有 AI 操作入口，可复用为底部浮动栏或右键快捷入口的任务发起器。

### 3.2 状态、API、数据模型

- `apps/desktop/src/renderer/design/views/canvas/canvas.store.ts`
  - 当前前端工作区状态中心，新增 panel/tab/menu 状态应优先接到这里。
- `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts`
  - 画布项目、快照、任务、资产相关 API 汇总。
- `apps/desktop/src/renderer/design/views/canvas/canvas.types.ts`
  - 当前画布数据类型定义，是本次数据扩展的主入口。
- `apps/desktop/src/renderer/design/views/canvas/canvas.capabilities.ts`
  - 当前 AI 能力定义层，菜单升级应建立在这里，而不是另起一套任务配置系统。

### 3.3 持久化层

- `packages/storage/src/repositories/canvas.repository.ts`
  - 当前项目元数据 + 快照的 SQLite Repository。
- 已有 migration：
  - `027_canvas_snapshots.sql`
  - `033_media_model_manifests.sql`
  - `029_media_generation_tasks.sql`
  - `031_canvas_project_root_path.sql`

### 3.4 当前已存在的关键能力

当前系统不是 MVP，而是已有以下较完整能力：

- 项目列表、新建、编辑、导入、导出、打开项目目录。
- 单项目工作区。
- 基础节点：`image | audio | video | text | prompt | task | group`
- 基础资产：`image | audio | video | text | prompt | file`
- AI 操作任务：
  - `text_to_image`
  - `image_to_image`
  - `image_edit`
  - `image_compose`
  - `text_generate`
  - `text_rewrite`
  - `prompt_optimize`
  - `text_to_audio`
  - `audio_transcribe`
  - `text_to_video`
  - `image_to_video`
  - `video_edit`
- 节点连线、分组、血缘、组内输入展开。
- 任务队列、任务详情、取消、重试。
- 资产抽屉、资产下载。
- 项目级 prompt / negative prompt。
- 快照双写：localStorage + SQLite + 项目目录。

结论：**我们已经有“底层生产能力”，缺的是更适合创作工作流的产品外壳和组织结构。**

## 4. 与目标产品的差距

### 4.1 已有但表现不够友好的部分

- 我们已有资产抽屉，但仍偏“列表工具”，不是“创作型资产库”。
- 我们已有 AI 任务能力，但入口更像工程工具，不像工作台快捷编排。
- 我们已有 group、edge、task、lineage，但没有围绕创作流程做显式组织。
- 我们已有项目级目录和快照，但没有把“多画布”和“画布导航”提升为一等入口。

### 4.2 明显缺失的部分

- 项目内多 board 切换与管理 UI。
- 左侧工作台分区。
- 资产管理专页或面板。
- 底部悬浮工具栏。
- 系统化右键菜单。
- 更丰富的添加节点菜单。
- 创作模板/工具箱/历史素材入口。
- 批量素材操作。

## 5. 改造原则

### 5.1 不重写的部分

以下模块原则上不得重写，只能扩展：

- `CanvasStage.tsx` 的基础缩放/平移/拖拽/连线逻辑。
- 现有 `CanvasTask` 与 `CanvasOperationType`。
- 当前任务创建 API 与媒体任务运行时。
- 当前 `CanvasSnapshot` 持久化方式。
- 当前项目目录化与资源存储策略。

### 5.2 应优先改造的部分

- `CanvasWorkspaceView.tsx`：重构工作区布局结构。
- `CanvasToolbar.tsx`：收缩定位，避免顶部按钮过载。
- `CanvasAssetDrawer.tsx`：从单一抽屉升级为资产工作台的一部分。
- `canvas.types.ts`：扩充 board / asset / node 的 UI 支撑字段。
- `canvas.store.ts`：新增左侧 tab、底部栏、上下文菜单、资产选择状态。

### 5.3 设计原则

- 优先“引导创作”，而不是“暴露底层机制”。
- 所有菜单都要优先映射到已存在能力，不要发明无法落地的入口。
- 节点菜单不等于任务系统，节点只是创作对象与任务入口。
- 资产管理既服务“项目内资产”，也要为未来“个人资产库 / 公共素材库”预留扩展位。

## 6. 总体改造结构

建议把当前工作区重构为下面的布局：

```text
+---------------------------------------------------------------+
| 顶部基础栏：项目标题 / board 切换 / 保存状态 / 导出 / 更多     |
+---------------+-----------------------------------------------+
| 左侧工作台     | 主画布区域                                    |
| 画布           |                                               |
| 资产           |              CanvasStage                      |
| 资产管理       |                                               |
| 工具箱/历史     |                                               |
+---------------+-----------------------------------------------+
| 左下角工具区    | 底部悬浮工具栏                                |
| 模板/上传/帮助  | 添加节点 / AI 操作 / 视图 / 历史 / 撤销重做     |
+---------------------------------------------------------------+
| 右侧信息区：属性 / 任务 / 项目信息 / 血缘                      |
+---------------------------------------------------------------+
```

当前右侧 `CanvasInspector + CanvasTaskQueue` 基础保留，只需优化 tab 结构。核心变化集中在左侧、底部、右键和节点添加体系。

## 7. 模块级开发方案

## 7.1 画布管理

### 目标

把“项目”与“画布 board”分离清楚。一个项目可包含多个 board，每个 board 对应一个创作场景，例如：

- 封面探索
- 角色设定
- 镜头设计
- 成片合成

### 当前基础

`canvas.types.ts` 里已经存在 `CanvasBoard` 类型：

- `id`
- `projectId`
- `name`
- `viewport`
- `settings`

说明数据模型已经为多 board 预留，但当前 UI 和快照使用上仍偏单 board 视角。

### 开发要求

1. 在 `CanvasWorkspaceView.tsx` 顶部增加 board 切换区。
2. 左侧 `画布` tab 负责展示当前项目所有 board。
3. 支持：
   - 新建 board
   - 重命名 board
   - 复制 board
   - 删除 board
   - 排序 board
   - 设置封面 board 或默认打开 board
4. 支持从某个节点或选区复制到新 board。
5. board 切换时保存 viewport、选中状态清理、未保存状态提示。

### 实现建议

- 先保持“快照仍以当前 board 视图读写”为主，再逐步演进为项目内多 board 快照集合。
- 如果当前 `CanvasSnapshot` 只承载单个 `board`，则需要演进为：
  - `boards: CanvasBoard[]`
  - `activeBoardId: string`
  - `nodes` / `edges` / `tasks` 继续按 `boardId` 区分
- 避免先拆数据库表；优先在 snapshot JSON 层扩容，保持 SQLite repository 兼容。

### 注意点

- 删除 board 前必须检查是否还有节点/任务/未导出产物。
- 最后一个 board 不允许删除。
- 切换 board 时不要把其他 board 的节点全部渲染进 Stage。

## 7.2 资产管理

### 目标

从“项目资产抽屉”升级为“资产工作台”，支持浏览、筛选、批量操作、插入画布、来源追溯。

### 当前基础

`CanvasAssetDrawer.tsx` 已支持：

- 搜索
- 类型筛选
- 资产列表
- 单项下载

### 改造方向

左侧拆成两个概念：

- `资产`
  - 用于快速插入当前 board 的素材
  - 偏轻量
- `资产管理`
  - 用于项目级资产治理
  - 偏重管理

### 资产面板要求

`资产` 面板至少支持：

- 搜索
- 类型筛选
- 来源筛选：上传 / AI 生成 / AI 编辑 / 导入 / 手动
- 直接拖入画布
- 点击插入当前视口中心
- 定位到该资产对应节点
- 显示最近使用和最近生成

### 资产管理面板要求

`资产管理` 面板至少支持：

- 列表 / 网格视图切换
- 多选
- 批量下载
- 批量插入画布
- 批量删除引用
- 按文件夹/标签/类型/来源筛选
- 查看“被哪些节点引用”
- 查看“由哪个任务生成”
- 查看资源落盘路径

### 数据扩展建议

在 `CanvasAsset` 上增加可选字段：

- `folderId?: string | null`
- `tags?: string[]`
- `favorite?: boolean`
- `archived?: boolean`
- `originTaskId?: string | null`
- `originNodeId?: string | null`
- `lastUsedAt?: string | null`
- `usageCount?: number`

如果不想立刻做数据库表拆分，可先把这些字段放到 `metadata` 中，并在后续 migration 稳定后再结构化。

### 注意点

- 删除资产不等于删除文件，先做“移出项目引用”与“彻底清理文件”两段式。
- 一个资产可能被多个节点复用，不能简单按节点删除资产文件。
- 远程 URL、data URL、本地 project assets 路径三种来源都要兼容。

## 7.3 左侧工作台

### 目标

把当前零散入口集中成创作导向的左侧主工作台。

### 推荐结构

左侧主 tab：

- `画布`
- `资产`
- `资产管理`

左下角次级入口：

- `模板`
- `历史`
- `上传`
- `帮助`

### 对应职责

`画布`

- board 列表
- board 新建/复制/删除
- 画布缩略概览
- 最近打开顺序

`资产`

- 当前项目可快速使用的素材
- 最近生成 / 最近上传
- 一键插入画布

`资产管理`

- 项目资产治理
- 文件夹/标签/批量操作

`模板`

- 工作流模板
- prompt 模板
- 构图模板
- 镜头模板

`历史`

- 历史生成任务
- 历史插入素材
- 最近删除节点恢复

### 实现建议

- 左侧主工作台优先在 `CanvasWorkspaceView.tsx` 里做布局改造。
- 主 tab 状态放进 `canvas.store.ts`。
- 先实现单列面板，不要一开始就做复杂可拖拽停靠系统。

## 7.4 左下角工具区

### 目标

承载低频但高价值入口，不跟顶部/底部主流程抢空间。

### 建议入口

- 模板中心
- 素材上传
- 历史记录
- 帮助/快捷键
- 打开项目目录

### 注意点

- 这些入口适合做成 icon + label 的轻量工具块。
- 不要塞太多“系统设置”类内容，避免污染创作区。

## 7.5 底部悬浮工具栏

### 目标

把当前高频创作动作从顶部按钮条改为更接近内容创作产品的悬浮式操作区。

### 建议分组

- 添加：
  - 文本
  - 图片
  - 视频
  - 音频
  - Prompt
  - 组
  - 脚本
- AI：
  - 文生图
  - 图像编辑
  - 多图合成
  - 文生视频
  - 图生视频
  - 语音生成
  - 文本改写
  - Prompt 优化
- 视图：
  - 适配屏幕
  - 回到中心
  - 显示/隐藏网格
  - 小地图开关
- 历史：
  - 撤销
  - 重做

### 当前复用点

底层能力大部分已存在：

- 文本、图片添加：来自 `CanvasToolbar.tsx`
- AI 操作：来自 `CanvasInlineAiComposer.tsx`
- group 操作：已有 create/add/remove/dissolve

### 实现建议

- 第一阶段不要移除顶部工具栏，而是把顶部栏收缩成“项目级操作栏”。
- 底部浮栏负责“创作动作”，顶部负责“项目动作”。

### 注意点

- 底部浮栏必须可折叠，避免遮挡内容。
- 在小屏幕下切换为横向滚动或两层分组。

## 7.6 右键菜单体系

### 目标

把当前零散操作沉淀为语义化右键菜单，减少用户来回找按钮。

### 需要区分的菜单类型

1. 空白画布右键菜单
2. 普通内容节点右键菜单
3. 任务节点右键菜单
4. group 节点右键菜单
5. 多选状态右键菜单

### 空白画布菜单建议

- 添加文本
- 上传图片
- 添加视频
- 添加音频
- 新建 Prompt
- 从资产插入
- 从历史插入
- 粘贴
- 新建 board
- 视图重置

### 普通节点菜单建议

- 打开/预览
- 重命名
- 复制
- 复制为模板输入
- 定位来源任务
- 基于当前节点发起 AI 操作
- 加入组
- 移出组
- 锁定/解锁
- 隐藏/显示
- 删除

### 任务节点菜单建议

- 查看任务详情
- 重试
- 复制参数重新运行
- 基于输入重新运行
- 定位输出节点
- 查看 provider 请求摘要
- 删除任务节点

### group 节点菜单建议

- 进入组
- 重命名组
- 添加选中节点到组
- 自动整理布局
- 作为组合输入发起 AI 任务
- 解散组

### 注意点

- 右键菜单的每一项都必须映射到现有 handler 或新增明确 handler。
- 不要让菜单和顶部/底部功能出现概念冲突，只是入口不同。

## 7.7 添加节点菜单

### 目标

从“添加文本/图片”升级为“节点工厂”，统一节点创建入口。

### 目标节点分类

建议把“添加节点”分成三类：

1. 内容节点
2. AI 工作节点
3. 资源入口节点

### 内容节点

- 文本
- Prompt
- 图片
- 视频
- 音频
- 脚本
- 组

### AI 工作节点

- 文生图任务
- 图像编辑任务
- 多图合成任务
- 文本生成任务
- Prompt 优化任务
- 文生视频任务
- 图生视频任务
- 视频编辑任务
- 文生音频任务
- 音频转写任务

### 资源入口节点

- 从项目资产选择
- 上传本地文件
- 从历史选择
- 从模板创建

### 与现有类型的映射

当前 `CanvasNodeType` 为：

- `image`
- `audio`
- `video`
- `text`
- `prompt`
- `task`
- `group`

建议第一阶段 **不要直接新增太多底层节点 type**，而是先通过 `task` 节点的 `data.operation` 区分 AI 工作节点的展示类型。也就是说：

- “视频合成节点” 第一阶段可以仍然是 `type: 'task' + operation: 'image_compose' | 'text_to_video'`
- “脚本节点” 第一阶段可先映射到 `text`，通过 `data.format = 'markdown' | 'plain'` 或额外 subtype 区分

### 建议新增字段

给 `CanvasNodeData` 新增：

- `subtype?: string`
- `displayCategory?: 'content' | 'task' | 'resource'`
- `presetId?: string | null`
- `origin?: 'manual' | 'asset' | 'history' | 'template' | 'task_output'`

### 注意点

- 不要为视觉命名立刻膨胀底层 node type，否则渲染和迁移成本会迅速升高。
- 先扩充 UI 表现层，再决定哪些节点值得升级成真正的一等类型。

### 当前落地状态（2026-06-17）

- 文本 / Prompt 节点支持通过节点头部编辑按钮或双击打开编辑弹窗。
- 文本 / Prompt 编辑弹窗复用 `CanvasPromptEditor`，支持 Markdown 工具、预览、展开编辑和反向提示词。
- 弹窗内可搜索并插入项目 `prompt_library` 资产，以及内置镜头语言、表情、动作、情绪提示词。
- 弹窗内的 `AI 优化` 与 `Agent 生成相关提示词` 通过现有 `prompt_optimize` / `text_generate` 画布任务生成结果，不直接覆盖用户当前文本。
- 分组关系 `group_contains` 继续保存在数据层，但不再作为可见连线渲染，避免组内内容出现无意义连线。

## 7.8 模板与工具箱

### 目标

提供接近 Liblib“工具箱/模板中心”的能力，但必须与我们已有 AI 任务编排一致。

### 第一阶段模板类型

- Prompt 模板
- 任务参数模板
- 工作流模板
- board 模板
- 常用布局模板

### 工作流模板示例

- 角色立绘生成流
- 电商海报生成流
- 镜头脚本到视频流
- 多图参考合成流

### 数据建议

先不建复杂模板系统，可在项目内或本地配置层定义：

- `id`
- `name`
- `type`
- `description`
- `nodeBlueprints`
- `edgeBlueprints`
- `defaultParams`

第一阶段支持“从模板生成节点组合”即可。

## 7.9 历史素材与历史任务入口

### 目标

补齐“从历史选择”这种高频创作入口。

### 范围

- 最近生成的资产
- 最近上传的资产
- 最近成功的任务
- 最近失败但可重试的任务

### 复用点

- 任务数据来自 `CanvasTaskQueue.tsx` 当前已有任务列表能力。
- 资产数据来自 `assets`。

### 注意点

- 历史面板不是新的数据源，而是已有 task/assets 的聚合视图。
- 后续如要扩展到跨项目历史，再考虑独立 repository。

## 7.10 影视剧集开发内置能力

### 背景

如果无限画布的主要使用场景是电影、剧集、短剧和漫剧开发，那么画布不应只承担“生成素材”的职责，还应该承载影视前期开发中的结构化工作：

- 剧本整理
- 故事蓝图
- 角色资产
- 场景资产
- 分镜脚本
- 镜头语言
- 表情、动作、情绪、服装、道具提示词
- 多集连续生产

小云雀短剧 Agent 2.0 的公开资料中有几个值得吸收的产品方向：支持长剧本上传，自动解析世界观、时间线和人物关系，生成故事蓝图、角色设计和分镜，并开放分镜和角色的自定义编辑；同时支持系列短剧连续生成、旁白改编、2D/3D/仿真人视觉风格选择。这些能力非常适合被拆成 Spark Canvas 的内置节点、模板和提示词库。

### 推荐新增的影视工作台入口

建议在左侧工作台或底部浮栏中新增 `影视开发` 入口。它不是一个独立页面，而是当前 canvas project 的行业模式面板。

`影视开发` 面板建议包含：

- 剧集剧本
- 故事蓝图
- 角色库
- 场景库
- 分镜脚本
- 镜头提示词
- 表情动作库
- 旁白与对白
- 多集生产队列

### 剧集剧本整理

目标：把长剧本或小说章节拆成可被画布消费的结构化资产。

建议能力：

- 上传剧本文件或粘贴长文本。
- 自动识别剧名、集数、章节、场次、角色、对白、旁白、动作描述。
- 生成 `故事蓝图`：
  - 世界观
  - 时间线
  - 主线/支线
  - 人物关系
  - 每集梗概
  - 每场戏目标
- 支持一键拆成：
  - 剧集节点
  - 场次节点
  - 角色节点
  - 场景节点
  - 分镜节点

实现建议：

- 第一阶段把“剧本”作为 `text` 或 `file` asset 保存。
- 解析结果保存到 `CanvasAsset.metadata.scriptBreakdown`，并同步生成若干 `text/prompt/group` 节点。
- 不要新增复杂数据库表，等工作流稳定后再结构化。

### 分镜脚本生成与修改

目标：让用户能从剧本段落生成可编辑分镜，而不是直接黑盒生成视频。

分镜结构建议：

```ts
type ShotSpec = {
  id: string
  episodeId?: string
  sceneId?: string
  shotIndex: number
  summary: string
  dialogue?: string
  narration?: string
  camera: {
    shotSize?: string
    angle?: string
    movement?: string
    lens?: string
    composition?: string
  }
  subject: {
    characters?: string[]
    action?: string
    expression?: string
    emotion?: string
    costume?: string
    props?: string[]
  }
  environment: {
    location?: string
    timeOfDay?: string
    weather?: string
    lighting?: string
    mood?: string
  }
  generation: {
    prompt?: string
    negativePrompt?: string
    durationSec?: number
    aspectRatio?: string
    stylePresetId?: string
    modelParams?: Record<string, unknown>
  }
}
```

画布表现：

- 每个场次可生成一个 group。
- 每个镜头可生成一个 `shot card`，第一阶段可映射为 `task` 或 `text` 节点，使用 `data.subtype = 'shot'` 区分。
- shot card 内显示镜号、场景、角色、动作、镜头语言、对白/旁白、生成状态。
- shot card 可直接触发 `text_to_video` 或 `image_to_video`。
- 用户修改分镜后，允许重新生成提示词，而不是必须重新解析整部剧本。

注意点：

- 分镜是可编辑资产，不是一次性 AI 输出。
- 镜头提示词、视频生成任务和产物节点要保留血缘关系。
- 同一镜头建议允许多版本产物，便于比较和回滚。

### 角色库

目标：解决影视生成中最关键的角色一致性问题。

角色库建议字段：

- 角色名
- 别名
- 年龄阶段
- 性别
- 身份/职业
- 外貌特征
- 发型
- 服饰
- 标志性道具
- 性格关键词
- 表情基准
- 声线/口音
- 参考图 assetIds
- 禁止变化项
- 生命周期变化记录

内置能力：

- 从剧本自动抽取角色。
- 自动合并同一角色的别名。
- 生成角色设定卡。
- 为角色生成首张定妆图。
- 支持同一角色的年龄/服装阶段管理。
- 分镜生成时自动引用角色库，避免每个镜头重复描述。

画布表现：

- 角色可以是 asset，也可以在画布上表现为角色卡节点。
- 角色卡节点可拖入分镜作为输入。
- 角色卡右键菜单支持：
  - 生成定妆图
  - 生成表情包
  - 生成动作参考
  - 应用到选中分镜
  - 查看被哪些镜头使用

### 场景库

目标：让影视项目中的地点、时间、光线、氛围成为可复用资产。

场景库建议字段：

- 场景名
- 内景/外景
- 地点类型
- 时代背景
- 时间段
- 天气
- 光线
- 色彩基调
- 美术风格
- 可复用场景 prompt
- 参考图 assetIds
- 已使用镜头数

内置能力：

- 从剧本中抽取场景。
- 自动生成场景设定卡。
- 支持场景概念图生成。
- 选中场景后批量应用到分镜。

画布表现：

- 场景库在左侧 `影视开发` 或 `资产管理` 中作为一类特殊资产。
- 场景卡可拖到分镜节点上，自动补齐环境提示词。

### 镜头语言提示词库

目标：把专业镜头语言变成可选择、可组合、可保存的提示词资产。

建议内置分类：

- 景别：
  - 远景
  - 全景
  - 中景
  - 近景
  - 特写
  - 大特写
- 角度：
  - 平视
  - 俯拍
  - 仰拍
  - 过肩
  - 主观视角
  - 鸟瞰
- 运镜：
  - 推镜
  - 拉镜
  - 摇镜
  - 移镜
  - 跟拍
  - 环绕
  - 升降
  - 手持
  - 一镜到底
- 构图：
  - 三分法
  - 中心构图
  - 对称构图
  - 前景遮挡
  - 框中框
  - 纵深构图
- 镜头质感：
  - 浅景深
  - 长焦压缩
  - 广角透视
  - 电影颗粒
  - 柔焦
  - 高动态范围
- 剪辑节奏：
  - 快节奏
  - 慢节奏
  - 紧张停顿
  - 情绪铺垫
  - 蒙太奇

用户保存能力：

- 用户可把任意镜头语言组合保存为 `镜头预设`。
- 预设可绑定适用场景：
  - 对话
  - 打斗
  - 悬疑
  - 爱情
  - 追逐
  - 回忆
  - 梦境
- 预设可指定默认模型参数：
  - 时长
  - 比例
  - 运动强度
  - 风格
  - 负面提示词

实现建议：

- 内置库先用静态 JSON 或 TS 常量。
- 用户保存内容先放入 project settings 或 local storage，后续再做跨项目用户库。
- 最终生成任务时，将镜头语言库输出合并到 `prompt` 和 `modelParams`。

### 表情、动作、情绪提示词库

目标：为角色表演和视频动作提供更稳定的输入结构。

建议内置分类：

- 表情：
  - 微笑
  - 冷笑
  - 震惊
  - 恐惧
  - 愤怒
  - 哭泣
  - 隐忍
  - 疑惑
  - 轻蔑
- 动作：
  - 转身
  - 抬头
  - 低头
  - 奔跑
  - 停步
  - 回眸
  - 伸手
  - 拥抱
  - 推门
  - 拔剑
  - 举杯
- 情绪：
  - 紧张
  - 压抑
  - 温柔
  - 疯狂
  - 绝望
  - 克制
  - 犹豫
  - 得意
- 对白状态：
  - 低声说
  - 哽咽说
  - 怒吼
  - 耳语
  - 冷静陈述
  - 快速争辩

用户保存能力：

- 保存自定义动作短语。
- 保存角色专属表情包。
- 保存角色专属口头禅和对白语气。
- 把某个成功镜头的表演描述反存为模板。

注意点：

- 表情/动作库应当是“短语积木”，不是单独节点。
- 当它被应用到分镜时，应写入 shot spec 或 prompt metadata，方便追踪来源。

### 旁白与对白改编

目标：支持从演绎类剧本转成解说类短剧，或从小说段落转成可口播内容。

建议能力：

- 原剧本对白提取。
- 旁白改写。
- 解说风格选择：
  - 悬疑解说
  - 爽文解说
  - 情感解说
  - 纪录片解说
  - 儿童故事
- 方言/语气预设。
- 数字人口播任务入口。

复用点：

- 可复用当前 `text_generate`、`text_rewrite`、`text_to_audio`。
- 后续如果接数字人模型，可扩展为新 operation，但第一阶段先用文本和音频任务承接。

### 多集连续生产

目标：支持系列剧/短剧从同一套角色和场景资产连续生成，不需要每集重新配置。

建议能力：

- 项目级剧集设置：
  - 剧名
  - 视觉风格
  - 画幅
  - 旁白风格
  - 角色一致性规则
  - 默认镜头语言
- 每集独立 board。
- 每集生成队列。
- 全剧角色库和场景库共享。
- 单集可复制上一集的风格、角色和场景配置。

实现建议：

- 多 board 能力完成后，将 `episode` 映射为 board 是最自然的方式。
- 项目级 settings 增加 `series` 配置。
- 每集 board 的 nodes/tasks 仍通过 `boardId` 隔离。

### 可以加入内置的功能清单

第一批建议内置：

- 剧本导入与自动拆解
- 故事蓝图生成
- 角色库生成
- 场景库生成
- 分镜脚本生成
- 分镜卡片编辑
- 镜头语言提示词库
- 表情动作提示词库
- 用户自定义提示词预设
- 旁白一键改编
- 多集 board 生成

第二批建议内置：

- 角色生命周期管理
- 分镜版本对比
- 单镜头多版本生成
- 成片粗剪时间线
- 数字人口播
- 爆款视频结构拆解
- 横竖屏多平台适配
- 镜头质量评分

第三批建议内置：

- 跨项目角色资产库
- 跨项目场景资产库
- 团队协作审阅
- 分镜批注
- 制片进度看板
- 剧集预算/资产成本估算

### 数据结构补充建议

第一阶段不建议新增大量数据库表，可以先在 snapshot 和 asset metadata 中承载：

```ts
type CanvasFilmProjectMetadata = {
  series?: {
    title?: string
    format?: 'film' | 'series' | 'short_drama' | 'animation' | 'commercial'
    visualStyle?: '2d' | '3d' | 'realistic' | 'anime' | 'custom'
    aspectRatio?: string
    narrationStyle?: string
  }
  scriptBreakdown?: {
    sourceAssetId: string
    episodes: Array<{ id: string; title: string; summary: string; boardId?: string }>
    characters: Array<Record<string, unknown>>
    scenes: Array<Record<string, unknown>>
    timeline: Array<Record<string, unknown>>
  }
  promptLibraries?: {
    cameraPresets: Array<Record<string, unknown>>
    actionPresets: Array<Record<string, unknown>>
    expressionPresets: Array<Record<string, unknown>>
    userPresets: Array<Record<string, unknown>>
  }
}
```

后续稳定后，再考虑拆为：

- `film_characters`
- `film_scenes`
- `film_shots`
- `film_prompt_presets`

### 与现有画布能力的映射

- 剧本：`CanvasAsset(type: 'text' | 'file')`
- 故事蓝图：`CanvasAsset(type: 'text')` + `CanvasNode(type: 'text')`
- 角色卡：`CanvasAsset(type: 'prompt' | 'image')` + `CanvasNode(data.subtype: 'character')`
- 场景卡：`CanvasAsset(type: 'prompt' | 'image')` + `CanvasNode(data.subtype: 'scene')`
- 分镜卡：`CanvasNode(type: 'text' | 'task', data.subtype: 'shot')`
- 镜头提示词：`CanvasAsset(type: 'prompt')`
- 表情动作库：`CanvasAsset(type: 'prompt')` 或 project metadata
- 视频生成：继续复用 `text_to_video` / `image_to_video`

### 当前落地状态（2026-06-17）

本轮实现先把影视流程打通为可用的第一版闭环，不把它做成一次性黑盒成片：

- `项目资产中心` 已提供 `剧本 / 角色 / 场景 / 道具 / 特效 / 分镜分组 / 提示词库` 入口。
- 剧本资产卡片支持 `拆解剧本`：基于剧本文本抽取角色、场景，并按 `第 N 集 / EP / Episode` 识别分集分镜分组。
- 自动生成的角色、场景以 `CanvasAsset.metadata.kind` 保存，附带 `剧本拆解` 和来源标签，后续仍可人工编辑、补参考图、插入画布。
- 分镜片段保存到 `project.metadata.film.shotGroups`，每个片段可关联角色资产、场景资产、对白、旁白和镜头提示词。
- 角色/场景/道具/特效资产卡片支持 `生成参考图`，通过现有 `text_to_image` 任务写回画布。
- 分镜片段卡片支持 `生成视频`，通过现有 `text_to_video` 任务写回画布，prompt 会合并分镜描述、对白、场景、角色设定和参考图描述。
- 从资产中心发起 AI 任务时应显式传空输入节点，避免误用画布当前选区作为任务输入。

后续增强建议：

- 剧本拆解现在是确定性首版解析，适合做草稿；后续应接入模型能力生成更完整的故事蓝图、人物关系和分集梗概。
- 分镜视频生成目前优先走 `text_to_video`；当角色/场景参考图已有真实 asset 文件后，应升级为可选 `image_to_video` 或多图参考输入。
- 拆解剧本重复执行会复用同名角色/场景，但会新建分镜分组；如果要支持“重新拆解覆盖”，需要增加来源脚本 ID 和版本管理。
- 分镜片段的 `nodeIds` 字段已预留，后续视频任务完成后应把产物节点 ID 回写到对应片段，形成分镜到视频产物的可追踪闭环。

### 影视开发注意点

- 影视剧集工作流一定要支持“AI 生成后人工改”，不能只有一键成片。
- 角色、场景、镜头提示词要作为可复用资产保存，不能只拼在一次任务 prompt 里。
- 分镜生成和视频生成要拆开，用户应能先审分镜，再批量生成视频。
- 多集连续生成必须共享角色库和场景库，否则角色一致性很难保证。
- 影视提示词库要支持用户保存、项目内保存和未来跨项目保存三个层级。

## 8. 需要改的数据模型

## 8.1 Snapshot 结构演进

当前：

```ts
type CanvasSnapshot = {
  project: CanvasProject
  board: CanvasBoard
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  assets: CanvasAsset[]
  tasks: CanvasTask[]
}
```

建议演进为：

```ts
type CanvasSnapshotV2 = {
  project: CanvasProject
  boards: CanvasBoard[]
  activeBoardId: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  assets: CanvasAsset[]
  tasks: CanvasTask[]
  uiState?: {
    leftPanelTab?: 'boards' | 'assets' | 'asset_manager'
    leftBottomTab?: 'templates' | 'history' | 'help'
    rightPanelTab?: 'inspector' | 'tasks' | 'project'
  }
}
```

兼容策略：

- 读取时兼容旧字段 `board`
- 保存时新旧字段可阶段性双写
- 待主流程稳定后再清理旧结构

## 8.2 Board 扩展

建议给 `CanvasBoard.settings` 增加：

- `coverAssetId?: string | null`
- `isDefault?: boolean`
- `sortOrder?: number`
- `theme?: string`
- `templateId?: string | null`

## 8.3 Asset 扩展

建议扩展：

- `folderId`
- `tags`
- `favorite`
- `archived`
- `originTaskId`
- `originNodeId`
- `lastUsedAt`
- `usageCount`

第一阶段可挂 `metadata`，第二阶段再结构化。

## 8.4 Node 扩展

建议扩展：

- `subtype`
- `displayCategory`
- `origin`
- `presetId`

同时保留现有 `type` 不大改。

## 8.5 UI Store 扩展

`canvas.store.ts` 至少需要新增：

- `activeLeftPanelTab`
- `activeLeftUtilityTab`
- `activeRightPanelTab`
- `assetViewMode`
- `selectedAssetIds`
- `contextMenuState`
- `bottomToolbarCollapsed`

## 9. 需要改的文件与责任划分

## 9.1 第一优先级文件

- `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`
  - 主布局改造
- `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.less`
  - 新的工作台布局样式
- `apps/desktop/src/renderer/design/views/canvas/canvas.store.ts`
  - 工作台 UI 状态
- `apps/desktop/src/renderer/design/views/canvas/canvas.types.ts`
  - snapshot / asset / node / board 扩展

## 9.2 第二优先级文件

- `apps/desktop/src/renderer/design/views/canvas/CanvasToolbar.tsx`
  - 顶栏收缩
- `apps/desktop/src/renderer/design/views/canvas/CanvasAssetDrawer.tsx`
  - 拆分成资产面板基础能力
- `apps/desktop/src/renderer/design/views/canvas/CanvasStage.tsx`
  - 接入更完整右键菜单、插入点定位、空白右键创建
- `apps/desktop/src/renderer/design/views/canvas/CanvasInspector.tsx`
  - 与新的右侧 tab 结构对齐
- `apps/desktop/src/renderer/design/views/canvas/CanvasTaskQueue.tsx`
  - 为历史视图和任务视图复用数据

## 9.3 可能新增的组件

建议新增而不是把所有东西堆进现有文件：

- `CanvasBoardSidebar.tsx`
- `CanvasAssetsPanel.tsx`
- `CanvasAssetManagerPanel.tsx`
- `CanvasBottomDock.tsx`
- `CanvasContextMenu.tsx`
- `CanvasAddNodeMenu.tsx`
- `CanvasTemplatePanel.tsx`
- `CanvasHistoryPanel.tsx`

## 9.4 持久化与 API 相关

可能需要调整：

- `canvas.api.ts`
  - board CRUD
  - asset batch operations
  - board switch persistence
- `packages/storage/src/repositories/canvas.repository.ts`
  - snapshot JSON 兼容新结构

注意：第一阶段如果仅改 snapshot JSON，可以不先拆新的 repository 表。

## 10. 建议开发顺序

## Phase 1：信息架构和布局重构

目标：先把产品骨架搭起来。

包含：

- `CanvasWorkspaceView` 重构
- 左侧主 tab
- 顶部 board 切换
- 右侧 tab 统一
- 底部悬浮工具栏占位版

交付标准：

- 不破坏现有项目打开、保存、AI 操作
- 只是入口位置变化，不影响原能力

## Phase 2：多画布管理

目标：让项目内 board 成为一等对象。

包含：

- board 列表
- 新建/删除/复制/重命名
- snapshot 演进为多 board
- board 级 viewport 持久化

## Phase 3：资产工作台

目标：把资产从抽屉升级为工作流中心。

包含：

- 资产面板
- 资产管理面板
- 批量操作
- 从资产插入画布
- 资产引用追踪

## Phase 4：底部栏 + 右键菜单 + 添加节点菜单

目标：把高频操作全部收口为创作型入口。

包含：

- 悬浮底栏
- 空白/节点/group/task 右键菜单
- 节点工厂菜单

## Phase 5：模板、历史、增强治理

目标：补齐工作流效率层。

包含：

- 模板中心
- 历史任务与历史资产视图
- 更细的资产标签/收藏/清理策略

## 11. 关键注意点

## 11.1 不要过早扩张底层 node type

当前很多“新节点名词”本质上只是 UI 分类，不一定要新增真正的 `CanvasNodeType`。第一阶段推荐：

- 任务类统一仍是 `task`
- 脚本类先映射到 `text`
- 素材入口类尽量是菜单动作，不一定是持久节点

这样可以显著降低渲染、迁移、历史兼容和血缘逻辑复杂度。

## 11.2 多 board 改造的风险最高

这是本轮最容易带来兼容问题的部分，因为它会影响：

- snapshot 结构
- board 切换
- 节点过滤
- 任务定位
- 选区恢复

因此必须先做兼容读取策略，再做 UI 切换，不要反过来。

## 11.3 资产删除要区分“引用删除”和“文件删除”

很多资产已落到项目目录。删除某个节点时，不能默认删资产文件。建议区分：

- 从当前 board 移除节点
- 从项目移除资产引用
- 彻底删除本地文件

这三个动作的权限和提示文案都不同。

## 11.4 右键菜单必须服务当前上下文

不要做一个巨大统一菜单。空白画布、普通节点、任务节点、group 节点必须拆开，否则菜单会很长且不清晰。

## 11.5 不要破坏现有 AI 任务链路

当前 AI 任务链路已经接上 manifest-driven runtime、lineage、项目级 prompt、任务详情。新交互只能换入口，不能绕开它们。

## 11.6 保持项目目录化策略不变

所有新增资产相关功能都要兼容当前项目目录化：

- 下载
- 插入
- 批量导出
- 定位文件
- 清理孤儿文件

## 12. 验收标准

### 必须满足

- 一个项目可看到多个 board，并可切换。
- 左侧可在 `画布 / 资产 / 资产管理` 间切换。
- 底部有悬浮工具栏，能完成主要创作动作。
- 空白画布和节点均有右键菜单。
- 添加节点菜单支持内容节点、AI 工作节点、资源入口节点。
- 现有 AI 任务能力全部仍可正常使用。
- 项目导入导出、保存、目录打开、任务队列不回归。

### 应尽量满足

- 资产支持多选、批量插入、批量下载。
- 历史入口可快速复用最近产物。
- 模板可一键生成一组节点。

## 13. 推荐给其他 agent 的实施要求

后续接手的 agent 在每个开发子任务中都应遵守：

1. 先复用现有 `CanvasWorkspaceView`、`CanvasStage`、`canvas.types.ts`、`canvas.store.ts`，不要自己平行造一套画布模块。
2. 涉及数据结构改造时，先写兼容策略，再写 UI。
3. 所有新增菜单项都必须能映射到现有 handler 或明确新增 handler。
4. 所有新增入口都要明确属于：
   - 项目级
   - board 级
   - 节点级
   - 资产级
5. 所有资产操作都要考虑：
   - 是否影响节点引用
   - 是否影响项目目录文件
   - 是否影响快照
6. 每完成一个 phase，都要先做回归检查：
   - 打开旧项目
   - 保存
   - 新建任务
   - 导出项目
   - 打开项目目录

## 14. 本轮建议先做的最小可交付版本

如果要拆给多个 agent 并尽快推进，建议最先做下面四块：

1. `CanvasWorkspaceView` 信息架构重构
2. snapshot 多 board 兼容改造
3. 左侧 `画布 / 资产 / 资产管理` 三 tab
4. 底部悬浮工具栏 + 右键菜单基础版

这四块完成后，整体产品气质会先明显从“工程工具”升级为“创作工作台”，而且不会过早碰太多底层任务逻辑。

## 15. 总结

本次改造不是补一个零散功能，而是把 Spark 现有无限画布从“已经能运行 AI 生产流程的画布”升级为“更适合日常内容创作的工作台”。

最重要的开发判断只有一句话：

**优先改造结构、入口和组织方式，尽量不要重写底层任务与画布内核。**
