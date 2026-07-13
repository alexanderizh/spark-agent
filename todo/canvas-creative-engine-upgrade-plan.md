# 画布创作引擎专业化升级总计划

> 状态: 待开发 | 最后核对: 2026-07-14

## 0. 执行门禁

本计划当前只完成方案设计与任务拆解，**不立即修改业务代码**。

启动开发必须同时满足：

- [ ] `docs/superpowers/plans/2026-07-13-canvas-uiux-v4-implementation-plan.md` 对应 V4 视觉改造及后续样式隔离收敛完成验收。
- [ ] 新节点框架、任务节点状态、空态、尺寸系统与统一放置引擎的数据契约稳定。
- [ ] UIUX 重构涉及的画布核心文件已合并，工作树不再存在同区域并行大改。
- [ ] 重新基于合并后的源码核对本计划中的文件落点、类型与调用链。
- [ ] 对公共 prompt 编译、任务预设、Agent 会话 skill 注入做实施前影响分析。

在门禁满足前，只允许：补充计划、整理参考材料、定义不落代码的验收样例；不允许提前改任务提示词、提示词库、画布 Agent 或节点 UI。

---

## 1. 目标

把当前画布从“有很多操作节点、词条和角色预设，但主要依赖用户自己拼装”升级为一套可复用、厂商无关的**专业创作引擎**：

1. 所有内置任务有明确的输入、输出、保持项、允许变化项、失败条件和验收标准。
2. 镜头、表演、风格、角色提示词库从“短词集合”升级为“词条 + 适用条件 + 冲突规则 + 组合策略”。
3. 画布 Agent 默认具备导演方法论，不依赖用户勾选某个 Seedance 专属 Skill。
4. 编剧、分镜、导演、动作指导从 persona 文案升级为可执行的工作流角色。
5. 生成结果进入“观察实际结果 → 接受偏差/修复/重拍 → 更新连续性”的闭环。
6. 模型厂商差异通过 Surface Profile 适配，不把某个模型或平台参数硬编码成通用规则。

## 2. 明确边界

### 2.1 本计划吸收的内容

从参考项目提炼并通用化：

- Director's Read：转折、视点、权力关系、潜台词、信息差。
- 单一 `felt_intent`：用一个动作性意图约束整段创作。
- Shot Contract：景别、角度、焦段感、支撑方式、运镜、主体关系、起始帧、结束帧、脆弱锚点。
- Camera Movement Grammar：每种运镜的适用场景和禁用条件。
- Coverage：建立空间、主体动作、结果细节的覆盖逻辑。
- Fragile Anchors：脸、手、Logo、文字、产品形状、服装、道具位置等连续性锚点。
- 多角色三层动作：全员微动、单人聚焦、默认避免多人同时大动作。
- Professional Avoid List：把“电影感、史诗感、动态镜头”等空泛词替换为物理选择。
- Take Review：基于实际起止状态、已完成节拍、意外完成节拍、连续性断裂作裁决。
- Surface Profile：按模型/平台能力编译参数和提示词，不假定所有厂商字段一致。
- 专业制作交接意识：剪辑、调色、声音、字幕、QC 是独立产物，不把生成模型输出冒充最终交付。

### 2.2 不直接照搬的内容

- 不使用 `seedance-*` 作为公共模块、Skill、类型或 UI 名称。
- 不把参考项目的厂商模型 ID、价格、限额、接口状态写死在前端常量中。
- 不把第三方路由商参数当成官方参数，也不自动泛化到其他平台。
- 不复制真实人物、版权敏感、平台政策敏感示例。
- 不承诺模型能精确完成帧级摄影机物理、ACES、响度或交付规范；这些只作为工作流约束和验收提醒。
- 不在本计划中重做 UIUX V4 已覆盖的节点视觉、尺寸、放置、状态动效和多产物布局。

---

## 3. 当前代码事实

### 3.1 内置任务提示词

主要入口：

- `apps/desktop/src/renderer/design/views/canvas/canvasOperationPresets.ts`
  - `CANVAS_OPERATION_PRESET_OPERATIONS`
  - `CANVAS_PIPELINE_PRESET_TARGETS`
  - `BUILTIN_PROMPTS`
  - `BUILTIN_PROMPT_PREFIXES`
  - `buildCanvasOperationPrompt`
  - `readCanvasResolvedPresetTarget`
- `apps/desktop/src/renderer/design/views/canvas/canvasPipelineOps.ts`
  - `CANVAS_PIPELINE_OPS`
  - 文本、抽取、图像、视频专用流水线操作目录。

当前多数 `BUILTIN_PROMPTS` 仍是一句通用描述，而且它们主要是空 prompt 时的兜底值；`mergeCanvasOperationPresetPrompt` 不会把 preset 自动追加到用户 prompt。当前真正强制进入任务 prompt 的 prefix 主要只有 `storyboard_grid`、`panorama_360`。后续必须先确认每条任务创建链最终调用了哪一个 build/merge 函数，不能只扩写 `BUILTIN_PROMPTS` 就宣称完成升级。

### 3.2 提示词库

- `canvasFilmPrompts.ts`：20 类镜头与制作词条，量足够，缺决策规则。
- `canvasFilmPerformancePrompts.ts`：表情、动作、情绪、对白状态，主要是英文短片段。
- `canvasFilmStylePresets.ts`：内置风格包，缺结构化风格维度与冲突检测。
- `canvasCharacterSheetPrompts.ts`：角色设定图模板，缺跨镜头 Character Contract。
- `canvasAgentPromptPresets.ts`：编剧、分镜、导演、动作指导预设，缺贯穿生成与评审的决策闭环。
- `CanvasPromptLibraryPanel.tsx`：当前主要负责展示并把原始短语追加到编辑内容。
- `buildCameraPromptFragment`、`collectCameraParamHints`、`buildPerformancePromptFragment` 尚未统一进入任务 prompt 编译主链，后续升级 metadata 时必须同时补接线和回归测试。

### 3.3 画布 Agent Skill 注入

- `CanvasAgentModal.tsx` 当前以 `REQUIRED_CANVAS_SKILL_ID = 'builtin:canvas-studio'` 强制注入工具 Skill。
- `effectiveSkillIds` 与 `syncSessionSkills(sessionId, skillIds[])` 虽支持数组，但 `skill-config:update` 只更新 session scope 的**可用技能目录**，不能证明多个完整 `SKILL.md` 正文已进入 system context。
- 完整 Skill 正文当前仍由 `session:submit-turn.skillId` 单值链路解析并内联；因此多 Skill 默认注入需要扩展运行时提交/组合协议，不能只改 `CanvasAgentModal` 常量。
- 新 builtin Skill 除 `SKILL.md` 外还需要 `manifest.json` 显式声明 `id: "builtin:director-engine"`；否则可能按 `local:bundled:<hash>` 登记。

旧子计划 `todo/canvas-director-engine-skill-design.md` 基于“数组即可完整注入”的误判，已标记为废弃。Phase 1 以本文件修正后的运行时方案为准。

### 3.4 UIUX V4 样式收敛影响

画布已进入 UIUX V4 基线，但旧样式迁移与作用域隔离仍需继续收敛。以下内容与这一过程高耦合，必须后置：

- 提示词库面板的信息架构与词条详情展示。
- 任务节点的“契约、缺失输入、保持项、验收项”可视化。
- Agent 的阶段状态、评审结论、重拍建议展示。
- 多产物、Take 历史、连续性警告、模型降级提示。

实施期间应避开并在 UIUX 合并后重新定位：`CanvasAgentModal.tsx`、`CanvasWorkspaceView.tsx`、`CanvasWorkspaceView.less`、`CanvasOperationPanel.tsx`、`CanvasPromptLibraryPanel.tsx`、`CanvasFilmAssetCenter.tsx`。其中 `CanvasWorkspaceView.tsx` 与 `CanvasFilmAssetCenter.tsx` 已是超大文件，相关新增能力应拆到独立模块而不是继续内嵌。

内容模型和编译逻辑也应等 UIUX 类型稳定后再编码，避免按旧节点结构实现后返工。

---

## 4. 推荐架构

采用六层结构，避免继续把内容堆进单个 preset 文件：

```text
用户意图 / 上游节点 / 项目 Style Bible
                ↓
Director Engine（导演方法论与决策）
                ↓
Operation Contract（任务输入输出与保持规则）
                ↓
Prompt Library（镜头/表演/角色/风格可组合词条）
                ↓
Surface Profile（模型能力、输入角色、参数和降级）
                ↓
Prompt Compiler + Linter（编译、冲突检测、可解释结果）
                ↓
生成任务 → Take Review → 连续性状态更新
```

建议模块边界（最终路径需在 UIUX 合并后复核）：

```text
apps/desktop/src/renderer/design/views/canvas/prompts/
├── operationPromptContracts.ts
├── pipelinePromptContracts.ts
├── promptCompiler.ts
├── promptLintRules.ts
├── negativePromptRules.ts
├── surfacePromptProfiles.ts
└── types.ts

apps/desktop/src/renderer/design/views/canvas/creative/
├── cameraDecisionRules.ts
├── performanceDecisionRules.ts
├── characterContracts.ts
├── styleBibleRules.ts
├── takeReview.ts
└── continuityState.ts
```

约束：

- 保持 `canvasOperationPresets.ts` 为预设存储和兼容入口，不继续塞入大段专业内容。
- 新模块按纯函数设计，避免依赖 DOM/IPC，便于单测。
- 不新增 npm 依赖；优先使用现有 TypeScript、schema 与测试能力。
- 旧用户保存的 preset 继续可读；内置契约作为前缀或编译层叠加，不覆盖用户正文。
- 若任何目标文件在实施时超过 3000 行，必须拆分，不继续追加。

---

## 5. 分阶段实施

## Phase 0：UIUX V4 样式收敛后的重新基线审查

目标：确认计划没有因 UIUX V4 及旧样式迁移落地而失效。

任务：

- [ ] 核对节点配置、任务状态、运行历史、多产物、空态的最终类型。
- [ ] 核对 `CanvasWorkspaceView`、任务创建、任务运行、结果物化的最终入口。
- [ ] 核对提示词编辑器与提示词库面板是否已拆分新组件。
- [ ] 核对当前并行改动是否触及本计划列出的文件。
- [ ] 对 `buildCanvasOperationPrompt`、`CANVAS_PIPELINE_OPS`、`CanvasAgentModal` skill 注入做影响分析。
- [ ] 确定兼容旧 preset 的迁移策略和版本号。
- [ ] 把本文件状态改为“实施中”，刷新核对日期。

退出条件：文件落点、公共类型、迁移策略、测试入口均已确认。

## Phase 1：Director Engine 通用方法论底盘

废弃旧的“只改 required skill 数组”方案，按完整运行时链路实施：

- [ ] 新增 `director-engine/SKILL.md` 与 `director-engine/manifest.json`，manifest 显式声明 `builtin:director-engine`，不使用 Seedance 命名。
- [ ] 内容覆盖 Director's Read、felt intent、Director's Voice、Shot Contract、锚点、多角色动作、反空泛词、Coverage、重拍裁决。
- [ ] 为 submit-turn/runtime composition 增加兼容的多 Skill 正文注入字段，例如新增 `skillIds?: string[]`，保留旧 `skillId?: string` 兼容现有调用方。
- [ ] 运行时对单值和数组统一去重、解析并内联完整 Skill 正文；`effectiveSkillIds` 继续只承担技能可用目录语义，不与正文注入混用。
- [ ] 画布 Agent 提交时显式传入 `canvas-studio + director-engine` 两个 required skill；用户 extra skill 继续按现有语义叠加，不互相覆盖。
- [ ] 普通会话可选择该 Skill，但不强制注入。
- [ ] 不改变画布节点和资产数据结构。

验收：用户不勾选任何额外 Skill，实际组合后的 system context 中同时包含两个 Skill 的完整正文；普通会话未选择 `director-engine` 时不被污染。

## Phase 2：内置任务 Prompt Contract

### 2.1 通用契约字段

每个内置任务定义：

- `purpose`：任务目标。
- `requiredInputs` / `optionalInputs`：输入类型、数量、角色与顺序。
- `outputContract`：输出类型、结构和最低质量要求。
- `preserve`：必须保持的主体、语义、像素或连续性内容。
- `allowedChanges`：允许改变的维度。
- `forbiddenChanges`：默认禁止的变化。
- `failureModes`：常见失败和可观测信号。
- `qualityChecks`：任务完成后的验收项。
- `fallbacks`：模型不支持时的降级策略。
- `promptSections`：编译时的稳定段落顺序。

### 2.2 现有内置任务逐项升级

| 任务               | 专业化重点                                            | 核心验收                           |
| ------------------ | ----------------------------------------------------- | ---------------------------------- |
| `text_generate`    | 输出格式、事实边界、引用来源、缺失信息标记            | 不虚构未提供事实，输出结构符合用途 |
| `text_rewrite`     | 保真范围、允许改写范围、禁止新增事实                  | 原意和关键实体不漂移               |
| `prompt_optimize`  | 意图提取、反空泛词、冲突检查、锚点、能力适配          | 输出可执行且能解释修改理由         |
| `text_to_image`    | 主体、空间、构图、光线、材质、风格、锚点              | 主体身份和关键形状明确             |
| `image_to_image`   | 保持项/变化项分离，默认单变量变化                     | 不同时改身份、构图和风格           |
| `image_edit`       | 目标区域/属性、单层编辑、其他语义保持                 | 未指定区域不发生明显变化           |
| `image_compose`    | 参考图角色映射、空间层级、透视、遮挡、光照统一        | 每张参考图职责可追踪               |
| `storyboard_grid`  | Coverage、屏幕方向、动作连续性、终帧意图              | 单图多格，镜间逻辑连续             |
| `panorama_360`     | 等距柱状投影、地标方位、接缝、初始朝向                | 左右接缝连续，无普通透视误生成     |
| `text_to_video`    | Shot Contract、单一主运动、节拍、终点、时长可完成性   | 镜头起止状态可验证                 |
| `image_to_video`   | 首帧锁定、允许运动、静态锚点、终帧、相机/主体运动分离 | 身份与首帧构图不无故漂移           |
| `video_edit`       | 时间范围、单层修改、口型/声音/主体保持                | 未指定时间段和属性保持             |
| `video_extend`     | 读取真实尾帧、继承已发生偏差、连续性接力              | 新段从实际尾态继续而非原计划       |
| `text_to_audio`    | 说话人、语气、节奏、停顿、重音、语言与发音            | 人设、语速和关键读音稳定           |
| `audio_transcribe` | 时间戳、说话人、置信度、不可辨识标记                  | 不猜测补词，低置信内容显式标记     |

### 2.3 编译顺序

统一为：

```text
操作契约
+ 项目级创作意图 / Style Bible
+ 输入节点摘要与资产映射
+ 连续性锚点
+ Surface Profile
+ 用户自定义 preset
+ 用户本次补充
+ Negative / Forbidden Rules
```

必须能返回“编译后的 Prompt + 来源段落 + 警告”，便于 UI 展示和调试。

接线要求：

- 空 prompt：允许使用内置默认正文，再叠加硬 prefix/contract。
- 显式用户 prompt：保留用户正文，只叠加不可省略的任务契约与能力约束。
- Pipeline prompt：通过独立 pipeline contract 编译，不假设复用普通 operation fallback 就足够。
- 镜头/表演库：结构化 metadata 必须经 compiler 消费，不能只在 `CanvasPromptLibraryPanel` 里追加短语。
- 所有创建入口最终必须汇合到同一编译函数，避免 Inline Composer、Operation Panel、右键流水线和 Agent/MCP 创建产生不同结果。

## Phase 3：影视 Pipeline 内置任务补齐

### 3.1 保留并专业化现有任务

- [ ] `chapter.to_screenplay`
- [ ] `screenplay.to_shot_script`
- [ ] `screenplay.extract_characters`
- [ ] `screenplay.extract_scenes`

### 3.2 补充缺失任务

- [ ] `manuscript.split_chapters`
- [ ] `screenplay.extract_props`
- [ ] `screenplay.extract_effects`
- [ ] `screenplay.extract_locations`
- [ ] `shot.enhance_directing`
- [ ] `shot.to_keyframe_prompt`
- [ ] `shot.to_video_prompt`
- [ ] `clip.review_take`
- [ ] `clip.plan_continuation`
- [ ] `sequence.build_edl`

每个 Pipeline 任务必须有稳定输出 schema，并声明：

- 上游允许的 `pipelineRole`。
- 输出 `pipelineRole` 和 `productionState`。
- 上游变化后是否把下游标记为 `stale`。
- 哪些字段可由 Agent 推断，哪些必须用户确认。
- 批量创建失败时的部分成功/回滚策略。

当前 `CANVAS_PIPELINE_OPS` 已有 12 个专用操作，但 `CANVAS_PIPELINE_PRESET_TARGETS` 仅暴露 4 个可独立配置目标。实施时先建立两者对照表：明确哪些操作复用通用 contract、哪些需要独立 pipeline contract、哪些需要进入可配置 preset 列表，避免只新增 id 却没有编辑和持久化入口。

Phase 3 不直接把所有任务都暴露到 UI；先建立单一事实源，再由 UIUX V4 的菜单和节点编辑器按能力展示。

## Phase 4：提示词库从词条升级为决策库

### 4.1 镜头语言库

保留现有 20 category 和 item id，扩展可选字段：

```ts
type CameraPromptItem = {
  id: string
  label: string
  promptFragment: string
  useFor?: string[]
  avoidWhen?: string[]
  compatibleWith?: string[]
  conflictsWith?: string[]
  fragileAnchors?: string[]
  riskLevel?: 'low' | 'medium' | 'high'
  examples?: string[]
}
```

重点规则：

- locked-off：口型、Logo、文字、产品身份、精确 VFX。
- push-in/dolly：发现、意识变化、亲密、产品揭示。
- lateral track：行进、队列、舞蹈、前景层次。
- orbit：产品英雄镜头；身份仅在单角度稳定时避免。
- crane/drone：尺度、地理、到达、揭示；对白和小文字慎用。
- handheld：写实/紧张；身份敏感时幅度要小。
- rack focus：两个锚定对象之间转移注意；避免叠复杂运镜。

### 4.2 表演与动作库

每个动作从短词升级为：

- 起始状态。
- 动作动词与节奏。
- 接触点。
- 终止状态。
- 表情/呼吸/视线等微动作。
- 多角色时的聚焦层级。
- 手脸和道具风险。
- 适合的景别与镜头稳定度。

### 4.3 角色库

新增通用 Character Contract：

- Tag / 名称。
- Identity anchor / 身份锚点。
- Position / 空间位置。
- Action / 动作。
- Expression / 表情。
- Constraint / 禁止变化项。

角色身份板、表情变体、服装变体、动作变体必须共享同一 identity anchor；复杂动作时优先用道具和轮廓表达，避免同时要求手脸高精度和大幅运动。

### 4.4 风格库

把单段 `promptFragment` 拆为可组合维度：

- 色彩与对比。
- 光线方向与质感。
- 镜头/介质感。
- 美术与材质。
- 时代与场景。
- 运动与节奏。
- Negative traits。
- 适用题材与禁用组合。

Style Bible 负责全项目稳定风格；单镜只允许有限覆盖，并显式记录偏离原因。

### 4.5 反空泛词 Linter

首批规则：

- “电影感” → 具体景别、焦段感、机位支撑、光线和终点。
- “史诗感” → 尺度关系、低角度/高位地理、仪式性调度、声画节奏。
- “震撼” → 可观察的物理冲击、反应、环境反馈。
- “动态镜头” → 单一明确运镜、速度、主体关系。
- “唯美构图” → 主体位置、前中后景、负空间、光线方向。

Linter 默认提供警告和替换建议，不擅自删除用户文本。

## Phase 5：Agent 角色能力升级

### 5.1 编剧 Agent

- 从故事目标、人物欲望、阻力、转折、信息差生成结构。
- 输出场次级可拍内容，不直接写泛化视觉形容词。
- 提取角色、场景、道具、特效时使用稳定 schema 和来源定位。
- 不确定内容标记为待确认，不把推测写成事实。

### 5.2 分镜 Agent

- 每镜必须包含 Shot Contract、时长、节拍、屏幕方向、起止状态和锚点。
- 使用 Coverage 检查空间建立、主体动作和结果细节。
- 多人物镜头标注动作层级。
- 每镜终帧声明下一镜接续用途。
- 超过模型单段时长时按动作节拍拆段，不简单平均切割。

### 5.3 导演 Agent

- 开始前执行 Director's Read，并确定单一 felt intent。
- 维护 Director's Voice 和项目 Style Bible。
- 在调用生成任务前选择镜头策略，而不是只添加“电影感”。
- 生成后读取实际结果，决定接受、带偏差接受、修复或拒绝。
- 每轮重试只改变一个核心变量，并维护尝试预算。

### 5.4 动作指导 Agent

- 把动作拆为起点、准备、接触、反应、终点。
- 明确重心、肢体方向、速度和空间障碍。
- 多角色默认只允许一个主动作，其他角色保持微反应。
- 对手脸、武器、道具交互等高风险动作给出镜头降级建议。

### 5.5 后期角色（后置能力）

在前四个角色稳定后再评估新增：

- 剪辑 Agent：节奏、覆盖、匹配剪辑、EDL、缺镜判断。
- 调色 Agent：颜色意图、镜间一致、HDR/SDR 交接说明。
- 声音 Agent：对白、环境、SFX、音乐、M&E、字幕/无障碍需求。
- QC Agent：技术错误、连续性、字幕、声音、比例、安全区和交付清单。

这些角色只生成计划、检查项和结构化资产，不假装替代专业后期软件。

## Phase 6：Take Review 与连续性闭环

定义厂商无关的 Take Review：

- `sourceStatus`
- `verdict`: accept / accept_with_deviation / repair / reject
- `observedStartState`
- `observedEndState`
- `completedBeats`
- `incompleteBeats`
- `unexpectedCompletedBeats`
- `continuityBreaks`
- `acceptedDeviations`
- `observationConfidence`
- `uncertainties`
- `requiresUserConfirmation`

核心原则：

1. 后续镜头从**实际接受的尾态**继续，而不是机械沿用最初计划。
2. 接受偏差必须写回连续性状态，避免下一镜把偏差“纠正”成新的断裂。
3. 人物身份、服装、道具、屏幕方向、光线、天气、损伤、情绪均可成为连续性字段。
4. 低置信评审不得自动推进正式下游，必须用户确认。
5. 首期只做文本/结构化评审；视觉模型自动检查作为后续增强，不阻塞基础闭环。

与 UIUX V4 的结合：任务节点展示 verdict 摘要和修复入口，详细记录放入运行历史或 Inspector，不把所有字段堆在节点卡片上。

## Phase 7：模型 Surface Profile 与厂商参数适配

参考项目确实包含模型名称、平台 surface、API 状态和参数形态资料，但它们应作为**研究样本**，不能直接变成稳定代码常量。

### 7.1 统一 Profile 字段

- provider / surface / model / manifest 标识。
- 支持的 capability：T2I、I2I、编辑、T2V、I2V、V2V、扩展、首尾帧、参考图/视频/音频。
- `maxImages`、输入角色、默认角色分配。
- 时长、比例、分辨率、音频、人物参考等参数能力。
- 异步任务语义、状态映射、取消能力。
- 内容政策、真人/声音授权提示。
- Prompt 偏好、已知失败模式和推荐降级。
- `verifiedAt`、来源、可信级别。

### 7.2 适配规则

- 参数以现有 provider manifest / capability 描述为权威来源。
- Profile 只补充 prompt 行为和编译策略，不复制 API key、base URL 或敏感配置。
- 易变字段必须带核对日期；过期时退化到 conservative generic profile。
- 不支持某能力时先解释并降级，不静默丢弃输入。
- 视频任务统一按异步任务处理，但具体提交、轮询和状态仍由 provider adapter 负责。
- 真人、肖像、声音输入必须提示授权敏感性，不从“用户上传了文件”推断已获授权。

### 7.3 首批 Profile

首批只覆盖仓库中已经配置并能从 manifest 读取能力的模型；不因为参考项目列了某厂商就自动新增 Provider 或依赖。

## Phase 8：UI 接入（仅在 UIUX V4 样式边界稳定后）

- 提示词库词条显示“适用 / 避免 / 冲突 / 风险”，默认折叠高级信息。
- 任务节点只展示关键缺失输入、风险和主要验收项，详细契约放 Inspector。
- Prompt 优化结果支持查看“保留内容、替换空泛词、添加锚点、模型适配”差异。
- Agent 面板显示当前阶段：理解意图、制定镜头、准备任务、生成中、评审、待确认。
- Take Review 提供接受、带偏差接受、修复、重拍四个清晰动作。
- Surface Profile 不做厂商参数大表格，按当前模型只展示相关限制和降级提示。
- 所有新增 UI 遵守 UIUX V4 节点尺寸、状态、动效和 `prefers-reduced-motion` 规则。
- 不向 `CanvasWorkspaceView.less` 继续追加大段样式；使用 UIUX V4 模块化 Less，并在迁移后删除对应旧规则。

---

## 6. 数据兼容与迁移

- 现有 `CanvasOperationPreset` 继续保留 `prompt`、`negativePrompt`、runtime、`skillIds`、`modelParams`。
- 内置 contract 不直接持久化进每个用户 preset，避免升级后产生大量脏数据。
- 用户保存的 prompt 作为 `userPreset` 段参与编译，优先级和覆盖边界明确。
- 新增字段一律可选并有默认值，旧项目和旧节点无需一次性迁移。
- Prompt library item id 保持稳定；只扩展 metadata，不改现有 id。
- Agent 预设 id 保持稳定；角色能力升级不破坏用户已绑定的 agent/preset。
- Take Review 与 continuity state 首期使用独立结构化记录，不塞进自由文本。
- 若需要本地存储版本升级，提供幂等迁移与回退读取，不清除用户 preset。

---

## 7. 测试计划

### 7.1 纯逻辑单测

- 每种 Operation Contract 可被完整读取。
- Prompt Compiler 段落顺序稳定，空段不会产生多余噪声。
- 用户 preset 不被内置升级覆盖。
- 同一 fragile anchor 不重复注入。
- 冲突词条产生警告而不是静默丢弃。
- Surface Profile 缺失/过期时正确降级。
- Pipeline 输出 schema、角色和 production state 正确。
- Take Review verdict 与用户确认门禁正确。

### 7.2 兼容测试

- 旧 localStorage preset 可读取、编辑、重置。
- 已有画布项目无需迁移即可打开。
- 用户 extra skill 与两个 required skill 正确去重叠加。
- 编译后的 system context 确认含两个 required Skill 的完整正文，而不只是 `effectiveSkillIds` 目录中可见。
- 未配置 Surface Profile 的模型仍能运行通用任务。
- UIUX V4 的多产物、放置事务和运行历史不因 prompt 层改动回归。

### 7.3 Prompt 黄金样例

至少为以下场景建立输入/编译输出快照：

1. 单人物对白近景：锁脸、口型、眼神，locked-off。
2. 多人物室内调度：单主动作、其他人微反应、屏幕方向。
3. 产品 Logo 镜头：锁产品形状、文字、反光和终点英雄构图。
4. 首尾帧图生视频：首帧身份、单一运动、明确终帧。
5. 视频扩展：从实际尾帧继续，接受已发生偏差。
6. 角色身份板与服装变体：同一 identity anchor。
7. 360 场景：地标方位和左右接缝。
8. Prompt 优化：把“电影感、史诗感、震撼”替换为物理描述。

黄金样例只验证结构、约束和稳定性，不声称某模型每次都能生成相同视觉结果。

### 7.4 运行时与浏览器验证

- 类型检查、相关 lint、相关单测。
- 真实画布创建各类操作节点，核对最终 prompt、模型参数和输入角色。
- 运行至少一条文本、一条图片、一条视频链路。
- 检查 Console 无新增 error/warning。
- 检查窄面板、长 prompt、错误态、无 Profile 降级态。
- 检查键盘、focus、aria-label、reduced motion。

若实施时工作树仍有并行改动，只运行针对本模块的只读检查和聚焦测试，不处理他人变更造成的噪声。

---

## 8. 风险与控制

| 风险                                      | 等级   | 控制措施                                                                     |
| ----------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| 与 UIUX V4 样式收敛同区域并行修改导致覆盖 | HIGH   | 本计划设置硬门禁，样式迁移完成后重新基线审查                                 |
| 把可用技能目录误当成完整 Skill 正文注入   | HIGH   | 扩展 submit-turn/runtime composition 协议，并直接验证组合后的 system context |
| builtin Skill 缺 manifest 导致 id 漂移    | HIGH   | `SKILL.md + manifest.json` 成对交付并测试注册 id                             |
| Prompt 过长，降低模型遵循度               | HIGH   | 分层编译、按任务和 Surface 裁剪、限制重复锚点                                |
| 内置契约覆盖用户意图                      | HIGH   | 用户正文独立分段；只对硬能力冲突给警告/降级                                  |
| 旧 preset/项目不兼容                      | HIGH   | 保持旧字段，新增字段可选，幂等迁移和回退读取                                 |
| 把厂商样例误当通用 API                    | HIGH   | Profile 带来源/日期/可信级别，adapter/manifest 为权威                        |
| Agent 自动推进错误连续性                  | HIGH   | 低置信和关键偏差强制用户确认                                                 |
| 词库 metadata 过多造成 UI 负担            | MEDIUM | 节点只显摘要，Inspector/详情承载高级信息                                     |
| 角色能力互相重叠                          | MEDIUM | 明确输入输出和交接资产，不只写 persona                                       |
| 方法论变成空泛长文                        | MEDIUM | 每条规则绑定可执行字段、编译结果或验收项                                     |

任何实施前影响分析出现 HIGH/CRITICAL 公共调用风险，先暂停并向用户确认，不直接修改。

---

## 9. 文档与交付

这是跨模块大功能，实施时必须同步：

- 更新 `docs/` 下画布创作引擎/提示词编译/Agent 能力相关设计文档，并维护状态行。
- 更新 `canvas-studio/SKILL.md` 的能力清单和工作流说明。
- 为 `director-engine` 建立独立说明和版本记录。
- 记录 Operation Contract、Surface Profile、Take Review 的字段与兼容策略。
- UIUX V4 样式收敛若改变本计划的数据边界，先更新本 todo，再编码。
- 实施完成后运行 `git diff`、直接调用点检索、相关测试核对改动范围。
- GitNexus 健康可用时执行 impact/detect changes；不可用时按项目降级规则使用源码、`rg`、测试和 `git diff`，并在交付说明注明。

---

## 10. 推荐实施批次

每批独立评审、独立验证，不一次性大爆改：

1. **Batch A — 方法论底盘**：Phase 0 + Phase 1。
2. **Batch B — Prompt Contract**：Phase 2，先纯逻辑和兼容测试。
3. **Batch C — Pipeline 与词库**：Phase 3 + Phase 4，保持旧 id。
4. **Batch D — Agent 能力**：Phase 5，逐角色验收。
5. **Batch E — 质量闭环**：Phase 6，先结构化评审再接 UI。
6. **Batch F — 模型适配**：Phase 7，只覆盖现有 manifest 能力。
7. **Batch G — UI 接入**：Phase 8，遵守完成后的 UIUX V4 架构。

每批开始前重新确认调用链和并行改动；每批完成后从源码事实回看改动仍存在且未被其他 Agent 覆盖。

---

## 11. 总体验收标准

- [ ] 画布 Agent 默认加载工具能力和导演方法论，用户无需勾选 Seedance Skill。
- [ ] 两个 required Skill 的完整正文真实进入 system context，不以目录可见或 Agent 自述代替运行时验证。
- [ ] 15 类内置 Operation 都有可测试的 Prompt Contract。
- [ ] Pipeline 任务覆盖剧本、资产提取、分镜、关键帧、视频、评审、接续和 EDL 主链路。
- [ ] 镜头/表演/角色/风格词条具备适用、避免、冲突和风险信息。
- [ ] 编剧/分镜/导演/动作 Agent 有明确输入、输出、决策和交接，不只是 persona。
- [ ] Prompt Compiler 可解释每段来源，并能给出冲突/降级警告。
- [ ] Take Review 能基于实际生成结果更新后续连续性。
- [ ] 模型差异通过 Surface Profile 与现有 manifest 适配，不硬编码易变厂商参数。
- [ ] 旧 preset、旧项目、旧 item id、旧 agent preset 保持兼容。
- [ ] UI 接入符合 Canvas UIUX V4，不向超大样式文件继续堆叠。
- [ ] 相关类型检查、单测、浏览器冒烟和关键生成链路验证通过；未验证项明确列出。

---

## 12. 当前结论

计划已完成，当前停留在“待开发”。下一步不是编码，而是等待 Canvas UIUX V4 样式隔离与旧样式迁移完成并通过验收；届时从 Phase 0 重新核对源码和影响范围，再按批次实施。
