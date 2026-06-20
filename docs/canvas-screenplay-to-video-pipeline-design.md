# 画布「剧本文稿 → 影视产物」全流程生产设计

> 状态: 待开发 | 最后核对: 2026-06-20
>
> 范围：把无限画布从「单点 AI 生成 + 影视资产中心」升级为一条
> 「文稿（小说/长文）→ 章节 → 剧本 → 资源设计 → 图卡 → 分镜（按秒 + 关键帧）→ 逐段视频」
> 的人机协作生产流水线。强调每一步都可由「人编辑 ↔ agent 基于人的结果续生成」双向协作完成。

## 1. 背景与目标

当前无限画布已经具备：节点/边血缘、影视资产中心（剧本/角色/场景/道具/特效/分镜分组/提示词库）、
镜头语言与表演提示词库、媒体模型 manifest 与任务生命周期（文生图/图生图/图生视频/文生视频…）。
但它还缺一条把「一部小说 / 一份长文稿」端到端推进到「成片视频」的**主线流水线**，尤其缺：

1. **超长文本的工程化管理**：导入小说/长文、按章切分、分片导入、按章编辑。
2. **阶段间的可执行编排**：章节→剧本→资源→分镜→关键帧→视频，每一步都能「基于上游已确认结果」往下生成。
3. **人机双向协作契约**：agent 生成的人能改，人改完 agent 能据此重算下游；改了上游能感知下游已过期。
4. **按秒分镜 + 关键帧**的细粒度分镜，以及把「角色/场景/关键帧/提示词」一起喂给视频模型逐段产出。

目标：在**尽量复用现有数据结构与节点系统**的前提下，补齐「文稿工作台 + 流水线编排 + 协作契约」，
让用户和 agent 在同一张画布（加一个独立的剧本/文稿工作台）上协作完成全流程。

## 2. 现状盘点（直接复用，不重造）

| 能力 | 现有载体 | 本设计中的角色 |
|------|----------|----------------|
| 影视资产（剧本/角色/场景/道具/特效） | `canvasFilmAssets.ts` `FilmAssetKind` + `asset.metadata.kind` | 复用，新增 `chapter` 等 kind |
| 分镜分组/片段 | `ShotGroup` / `ShotSegment`（`project.metadata.film.shotGroups`） | 扩展为「按秒 + 关键帧」分镜 |
| 分镜规格 | `ShotSpec`（`canvasFilmTypes.ts`） | 作为分镜节点的结构化数据 |
| 角色/场景/剧集 | `FilmCharacter` / `FilmScene` / `FilmEpisode` | 复用，章节映射到 episode |
| 镜头语言 / 表演提示词 | `canvasFilmPrompts.ts` / `canvasFilmPerformancePrompts.ts` | 作为「运镜设计 / 动作设计」积木 |
| 图片+描述词模型 | `FilmReference`（图卡 = 图 + 描述词） | 作为「图卡」原子单位 |
| 剧本拆解 | `handleBreakdownScriptAsset`（规则式本地拆解） | 升级为 agent 拆解 |
| 媒体任务 | `CanvasOperationType` + Media Runtime + 任务生命周期 | 每个生成步骤的执行底座 |
| 节点/边血缘 | `CanvasNode` / `CanvasEdge`（`used_as_input`/`generated`/`derived_from`） | 流水线的连线与「过期」判定基础 |
| 多 board | `CanvasBoard`（一项目多画布） | 每章/每集一个 board（泳道隔离） |

> 结论：**新增量集中在「文稿工作台 + 流水线节点类型 + 协作/过期契约 + agent 编排」，
> 而不是重写画布。** 这与既有「不新增数据库表、承载在 metadata/snapshot」的策略保持一致。

## 3. 你的核心问题：章节—剧本—资源—分镜—关键帧能否都是画布节点？

**能，但要分两类承载，否则画布会被长文本拖垮。**

- **重文本、强结构化、需要批量编辑的对象** → 放「剧本/文稿工作台」（独立面板），
  在画布上只以**轻量引用节点**出现（标题 + 摘要 + 状态 + 双击进工作台编辑）。
  适用：**整部文稿、单章原文、整本剧本**。
- **作为生产流水线节点、需要连线/生成/产物的对象** → 直接是画布节点。
  适用：**章节节点、场次/剧本片段节点、各类资源设计节点、图卡节点、分镜节点、关键帧节点、视频节点**。

即：**章节、剧本（场次级）、资源、分镜、关键帧、视频都在画布上以节点存在；
但「整章原文 / 整本长文稿」这种大文本主体放在工作台，画布节点只引用它。**

## 4. 整体流水线与数据流

```text
[剧本/文稿工作台]                 [无限画布：流水线泳道]
 长文稿导入 ──分片/分章──►  章节节点(chapter)
   (Manuscript)                  │  ① 章节→剧本（agent 改写为场次剧本）
                                 ▼
                            剧本节点(screenplay/scene)  ── 抽取 ──►  角色/场景/道具/特效 资源节点
                                 │  ② 剧本→资源设计                         │
                                 │                                          │ ③ 资源→图卡
                                 │                                          ▼
                                 │                                   图卡节点(image card = 图 + 描述词)
                                 │  ④ 剧本+资源→分镜（按秒切分）              │
                                 ▼                                          │
                            分镜节点(shot, 含 in/out 秒、镜头语言、动作)──────┤ 复用资源/图卡
                                 │  ⑤ 分镜→关键帧（首/尾/中间帧出图）          │
                                 ▼                                          │
                            关键帧节点(keyframe image)◄────────────────────┘
                                 │  ⑥ 关键帧+分镜提示词→视频（逐段 I2V/T2V）
                                 ▼
                            视频片段节点(video) ──► ⑦ 拼接/合成 ──► 成片
```

每条「①…⑦」都是一次**可执行编排步骤**：选中上游节点 → 浮动工具条出现「下一步」→
agent/模型据上游已确认内容生成下游节点，并写入 `used_as_input` / `generated` 血缘边。

## 5. 节点模型设计

在现有 `CanvasNodeType` 基础上，**优先用 `subtype` + `displayCategory` 区分，不轻易新增底层 type**
（既有 `image_to_video` 等类型化操作节点已经能跑通真实任务）。建议引入「流水线语义子类型」：

| 流水线对象 | 底层 type | `data.subtype` | 承载数据 | 主要出/入边 |
|------------|-----------|----------------|----------|-------------|
| 章节 | `text` | `chapter` | `asset(kind=chapter)` 引用 + 摘要 | → 剧本 |
| 剧本（场次） | `text` | `screenplay` | `asset(kind=script)` 场次切片 | ← 章节；→ 资源/分镜 |
| 角色设计 | `prompt`/`image` | `character` | `FilmCharacter` + `FilmReference[]` | ← 剧本；→ 图卡/分镜 |
| 场景设计 | `prompt`/`image` | `scene` | `FilmScene` + refs | 同上 |
| 道具/特效设计 | `prompt`/`image` | `prop`/`effect` | film asset + refs | 同上 |
| 运镜设计 | `prompt` | `camera` | 选中的镜头语言积木（`cameraPromptItemIds`） | → 分镜 |
| 画面设计 | `prompt` | `frame` | 构图/光影/色彩/风格组合 prompt | → 图卡/分镜 |
| 动作设计 | `prompt` | `action` | 表演提示词（`performancePromptItemIds`） | → 分镜 |
| 图卡 | `image` | `image_card` | `FilmReference`（图 + 描述词） | ← 资源；→ 分镜/关键帧 |
| 分镜 | `text`/`group` | `shot` | `ShotSpec` + in/out 秒 | ← 剧本+资源；→ 关键帧/视频 |
| 关键帧 | `image` | `keyframe` | image asset + 帧位（first/mid/last/@t） | ← 分镜；→ 视频 |
| 视频片段 | `video` | `clip` | video asset + 时长/分镜引用 | ← 关键帧+分镜；→ 成片 |

> 说明：「运镜/画面/动作设计」本质是**提示词积木的命名组合**，复用 `canvasFilmPrompts` /
> `canvasFilmPerformancePrompts`，不需要新模型，只需要把「一组选中的积木」固化为一个可复用的设计节点。

### 5.1 泳道与布局

- **一章一 board**（复用 `CanvasBoard`，`episodeId`/`chapterId` 绑定 board）：章节内部的剧本→资源→分镜→视频在同一画布展开。
- **board 内按阶段分泳道（Frame/Group）**：剧本区 / 资源区 / 图卡区 / 分镜区 / 关键帧区 / 视频区，
  生成的下游节点默认排布到对应泳道（复用 `placeNodeRightOfNodes` 思路，改为「放到下一泳道」）。
- **跨章共享资源**：角色/场景/道具/特效/提示词库是**项目级**（已在 `project.metadata.film`），
  在任意章 board 里以「引用节点」出现，编辑回写项目库，所有引用同步。

## 6. 各阶段详细设计（人机双向协作）

每一阶段统一遵循一个**协作契约**（见 §7）：`draft（agent）→ edit（human）→ confirm → 下游可生成`。

### 6.1 剧本/文稿工作台（大文本导入 · 分章 · 分片 · 编辑）—— 画布之外的独立面板

这是「剧本管理可以额外放」的落点。它不是画布，而是一个**文档型工作台**，原因：长文本不适合塞进画布节点。

**功能：**

1. **导入**：支持 `.txt/.md/.docx`、粘贴超长文本。大文件**分片流式导入**（避免一次性载入内存/渲染卡顿）。
2. **自动分章**：
   - 规则优先：识别「第N章 / Chapter N / 卷 / 序章 / 番外」等标题正则，切出章节。
   - agent 兜底：规则识别不到时，调 agent 按语义切分并给出每章标题/摘要（人可确认/调整边界）。
3. **手动编章**：用户可新增/合并/拆分/重排章节，逐章富文本编辑（复用既有 Markdown 编辑器）。
4. **章节状态**：每章带状态（草稿/已定稿）、字数、摘要、关联到画布的 chapter 节点。
5. **落库**：每章作为 `asset(kind=chapter)`（`contentText` 存原文，`metadata` 存章号/摘要/状态）；
   整部文稿作为 `asset(kind=manuscript)` 仅存元信息与分章索引，**不内联全文进画布快照**。

**协作点**：人导入并分好章（或确认 agent 分章）→ 在画布「拉入章节节点」→ 进入下一阶段。

### 6.2 章节 → 剧本（screenplay）

- 章节节点上「转剧本」：agent 读章节原文 + 项目风格设定（`series.visualStyle/format`），
  产出**场次化剧本**（场号、内/外景、时间、地点、人物、动作、对白、旁白）。
- 产出落为 `asset(kind=script)`，并在画布生成**每个场次一个剧本节点**（便于后续逐场出资源/分镜）。
- **人编辑**：直接改场次剧本文本；**agent 续作**：可对单场「润色/扩写/精简/改风格」（复用 `text_rewrite`）。
- 升级点：把现有规则式 `handleBreakdownScriptAsset` 拆成两层——
  「**章节→剧本**」（本步）和「**剧本→资源**」（下步），并都改为可走 agent。

### 6.3 剧本 → 资源设计（角色 / 场景 / 道具 / 特效 / 运镜 / 画面 / 动作）

- 选中剧本节点（或整章剧本）→「抽取资源」：agent 扫描剧本，产出/更新：
  - **角色详细表**：`FilmCharacter`（外貌/服饰/发型/标志道具/性格/表情基准/声线/一致性锁定项），按出场聚合。
  - **场景设计**：`FilmScene`（内外景/地点/年代/时间/天气/光线/色调/美术风格/可复用 prompt）。
  - **道具/特效设计**：film asset（用途/视觉/触发条件）。
- **运镜/画面/动作设计**：从 §5 的提示词积木库里，agent 推荐一组适配本剧风格的组合，
  固化为「运镜设计 / 画面设计 / 动作设计」节点（可复用到多个分镜）。
- **去重/合并**：沿用现有 `existingByKindAndName` 思路——同名资源合并而非重复创建。
- **协作点**：每个资源是一个可编辑节点；人改完字段 → agent 据此生成「角色定妆图/场景概念图」提示词。

### 6.4 资源设计 → 图卡生成（image card = 图 + 描述词）

- 每个角色/场景/道具/特效/画面设计节点 → 「出图卡」：
  用资源的结构化字段 + 画面设计积木拼 prompt，走 `text_to_image`，产物作为 `FilmReference`（图 + 描述词）回挂到资源。
- 支持**一资源多图卡**（多角度/多表情/多服饰/多光线），即 `FilmReference[]` 的不同 `kind`
  （concept/expression/costume/action/angle…，已存在）。
- 角色一致性：以「定妆图」为基准，后续图卡走 `image_to_image` 保持一致（喂基准图 + 变化描述）。
- **协作点**：人可挑选/淘汰图卡、标注「这张作为基准」、补描述词；agent 据被选基准继续出衍生图卡。

### 6.5 剧本 + 资源 → 分镜（按秒切分 + 详细分镜设计）

- 选中「场次剧本 + 相关资源/图卡」→「生成分镜」：agent 把场次拆成**分镜序列**，每个分镜 = 一个 `ShotSpec`/`ShotSegment`，含：
  - **时间**：`in/out` 秒（或时长），支持「按秒出」——用户可设定目标节奏（如平均 3s/镜），agent 据此切分。
  - **镜头语言**：景别/角度/运镜/构图/焦段（引用运镜设计积木 `cameraPromptItemIds`）。
  - **主体**：涉及角色（引用角色资源）、动作（动作设计积木）、表情、情绪、服饰、道具。
  - **环境**：地点/时间/天气/光线/氛围（引用场景资源）。
  - **画面**：构图/光影/色彩/风格（引用画面设计积木）。
  - **对白/旁白**。
- 分镜以**分镜分组（ShotGroup）→ 片段（ShotSegment）** 承载（已存在），片段升级字段：`durationSec`、`keyframeNodeIds`。
- **协作点**：分镜是结构化表单 + 时间轴双视图；人可增删镜、改时长、改镜头语言、调引用资源；
  agent 可「重切分这一场」「把这镜拆成两镜」「补一个反打镜」。

### 6.6 分镜 → 关键帧（同时出关键帧图）

- 每个分镜节点 →「出关键帧」：根据分镜的镜头语言 + 引用的角色/场景图卡，
  生成 **首帧 / 尾帧 /（可选）中间帧** 的关键帧图（`text_to_image` 或以角色基准图 `image_to_image`）。
- 关键帧节点带**帧位**（`first`/`last`/`mid`/`@t=Ns`）和对应分镜引用。
- **协作点**：人可换关键帧、重生成、锁定某帧；这些帧是下一步喂视频模型的视觉锚点。

### 6.7 关键帧 + 分镜 → 逐段视频

- 每个分镜节点 →「出视频」：把**首帧（+尾帧）关键帧 + 分镜提示词（镜头语言/动作/对白节奏）+ 时长**
  喂给视频模型，逐段产出 `video` 片段节点：
  - 有首尾帧 → 走 `image_to_video` / 视频编辑（首尾帧插值，manifest `maxImages>=2` 时）。
  - 仅一帧 → 单图 I2V；多参考图先 `image_compose` 合成一张再 I2V（沿用现有面板策略）。
  - 无关键帧 → `text_to_video` 兜底。
- **逐段** = 一镜一段；段间一致性靠「共享角色基准图 + 上一镜尾帧作下一镜首帧」。
- **协作点**：人可对单段重跑、换模型、调时长/运镜后重生成；agent 可「让这段更慢」「补一个转场」。
- **成片**：分镜区→视频区全部生成后，提供「按分镜顺序拼接」导出（先做顺序拼接 + 转场占位，音轨/配音后续）。

## 7. 人机协作与「过期」契约（贯穿全流程的关键机制）

这是把「人编辑 ↔ agent 续生成」做扎实的核心，建议统一一套**节点生产状态机**：

```text
empty → drafting(agent) → draft → editing(human) → confirmed → (上游变更) stale → 重生成/手动确认
```

- **来源标记**：每个节点记 `origin`（manual/ai_generated/ai_edited）+ `editedByHuman` 标志（已有 `origin` 字段，扩展语义）。
- **确认/锁定**：节点可被「确认（confirm）」或「锁定（lock）」。下游生成**默认只读上游 confirmed 内容**，
  保证「agent 基于人已确认的结果生成」。锁定节点 agent 不得覆盖（只能旁路出新版本）。
- **过期传播**：上游 confirmed 内容变化 → 沿 `used_as_input`/`generated` 边把下游标 `stale`（视觉上加「待更新」角标），
  让用户清楚「改了剧本，分镜/关键帧/视频已过期」，可选择「仅标记」或「级联重算」。
- **版本而非覆盖**：agent 重生成默认产**新版本节点/产物**（复用现有「复制任务为分支/换模型重跑」思路），
  人改 agent 产物则原地 `ai_edited`。互不破坏对方成果。
- **双向都能继续**：
  - 人编辑 → 触发「基于此结果生成下游」按钮（agent 续作）。
  - agent 生成 → 节点即可进入人工编辑态（所有结构化字段/文本可改）。

> 这套契约只需在节点 `data` 上加少量字段（`productionState`、`confirmedAt`、`staleFrom`、`version`），
> 配合边血缘做过期传播，不动数据库表。

## 8. 数据结构扩展（最小增量）

复用「承载在 `asset.metadata` + `project.metadata.film` + `node.data`，不新建表」策略：

1. **`FilmAssetKind` 新增** `manuscript`（整部文稿索引）、`chapter`（单章原文）。
2. **`ShotSegment` 扩展**：`durationSec?`、`inSec?`、`outSec?`、`keyframeNodeIds?`、`cameraDesignId?`、`actionDesignId?`、`frameDesignId?`。
3. **`CanvasNodeData` 扩展**：
   - `productionState?: 'empty'|'drafting'|'draft'|'confirmed'|'stale'`
   - `editedByHuman?: boolean`、`confirmedAt?`、`version?: number`、`staleFrom?: string[]`（导致过期的上游节点 id）
   - `pipelineRole?`：§5 表里的语义角色（chapter/screenplay/character/.../keyframe/clip），与 `subtype` 对齐。
4. **`CanvasFilmProjectMetadata` 扩展**：`manuscript?: { sourceAssetId; chapters: Array<{id,title,order,status,chapterAssetId,boardId?}> }`、
   `designs?: { camera/frame/action 复用组合的命名预设 }`。
5. **`FilmEpisode` ↔ chapter ↔ board** 三者建立映射（一章 = 一集 = 一 board，可 N 章合 1 集）。

## 9. Agent 能力与编排

每个流水线步骤本质是「带上下文 + 工具权限的一次 agent/模型调用」（与多媒体方案 §11.3 一致）。建议提供这些 agent 动作（经画布 task / MCP 暴露）：

- `manuscript.split_chapters`（语义分章兜底）
- `chapter.to_screenplay`（章→场次剧本）
- `screenplay.extract_resources`（剧本→角色/场景/道具/特效 + 推荐运镜/画面/动作设计）
- `resource.to_image_prompt` / 出图卡（复用 `text_to_image`/`image_to_image`）
- `screenplay.to_shots`（剧本+资源→按秒分镜）
- `shot.to_keyframes`（分镜→关键帧出图）
- `shot.to_clip`（分镜+关键帧→逐段视频）

编排执行沿用 DAG 思路：单节点运行 / 从某节点向后运行 / 整章全流程运行 / 失败从失败节点续跑。
所有调用只读**上游 confirmed** 内容，产物回写节点 + 血缘 + `productionState`。

## 10. 分期落地建议

- **P0 文稿工作台**：大文本分片导入、规则分章、手动编章、章落 `asset(kind=chapter)`、画布拉入 chapter 节点。
- **P1 主线打通（章→剧本→分镜→视频）**：章→场次剧本、剧本→分镜（先复用 ShotGroup）、分镜→视频，跑通最短闭环。
- **P2 资源与图卡**：剧本→角色/场景/道具/特效，资源→图卡，角色一致性（基准图 + I2I）。
- **P3 细粒度分镜**：按秒切分、关键帧（首/尾/中）、首尾帧 I2V 逐段。
- **P4 协作契约**：生产状态机、confirm/lock、过期传播与级联重算、版本化。
- **P5 编排与成片**：DAG 全流程运行、失败续跑、按分镜拼接导出。

每期都保持「人能编辑 + agent 能基于人结果续生成」的双向性，不允许出现只能 agent 一把梭、人改不了的环节。

## 11. 开放问题（需产品确认）

1. **章/集映射**：默认「一章一集一 board」，还是允许「多章合一集」？（影响 board 与 episode 建模）
2. **文稿工作台位置**：作为画布内右侧抽屉，还是与画布平级的独立顶级视图？（倾向独立视图 + 画布引用节点）
3. **按秒分镜的切分依据**：固定节奏（N 秒/镜）、按对白时长估算、还是 agent 自由判断？（可三选一 + 人工微调）
4. **成片拼接范围**：本期是否含音轨/配音/字幕，还是只做画面顺序拼接 + 转场占位？
5. **一致性策略**：角色一致性走「基准图 + I2I」还是后续接角色 LoRA/参考一致性模型？（manifest 能力决定）

---

附：本设计**不新增数据库表**，全部承载在既有 `asset.metadata` / `project.metadata.film` / `node.data` 与 snapshot 中，
与《多媒体模型运行时与无限画布生产工作台方案》§7.10、§11 的既定策略一致，可视为其「行业流水线」分支的细化。
