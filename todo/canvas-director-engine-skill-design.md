# 画布导演引擎 Skill（director-engine）默认注入方案

> 状态: 待开发 | 最后核对: 2026-07-13

## 1. 背景与目标

### 1.1 起点
参考开源项目 `seedance-2.0`（Skill OS，已 clone 至父目录 `/Users/zhangyang/spark_ai_project/seedance-2.0`）提炼出一套**与厂商/模型无关的影视创作方法论内核**，移植到 Spark-Agent 画布，补齐当前画布"有积木、无方法论"的缺口。

### 1.2 去向判断
seedance-2.0 中绑定厂商/平台的内容（model-name-map、platform-surface-matrix、api-status、Seedance 专属 FLF2V 模型行为）**不通用、不移植**。只抽离**纯方法论**，做成平台级公共能力，命名 **`director-engine`（导演引擎）**，不绑定 seedance 品牌。

### 1.3 目标（用户确认的诉求）
1. **抽离公共方法、命名中立**：不叫 seedance，供所有视频/影视创作场景复用。
2. **不勾选也可用**：作为内置 builtin skill，默认启用，普通会话可选用，无勾选门槛。
3. **画布 agent 默认注入、画布专用**：画布会话一开就强制带上，专门服务于画布创作，与现有 `canvas-studio`（工具手册）职责互补。

### 1.4 与 canvas-studio 的分工（两者都画布强制注入，不重叠）
| Skill | 职责 |
|---|---|
| `builtin:canvas-studio` | **怎么用工具**：40+ canvas 工具手册、operation 表、三层参数（已存在） |
| `builtin:director-engine`（新增） | **怎么创作/怎么导演**：Director's Read、Shot Contract、反 slop、五档重拍等方法论 |

---

## 2. 方案总览（L0：纯 skill + 注入常量改造）

**形态**：新增一个独立 builtin skill + 把画布 agent 的"强制 skill"从单值升级为数组。

| 链路 | 做法 | 满足诉求 |
|---|---|---|
| 普通会话 | 新建独立 builtin skill，`ensureBuiltInSkills()` 自动登记、默认 enabled，技能面板可见可选用 | "抽离公共方法可用" + "不勾选也可用" |
| 画布会话 | `REQUIRED_CANVAS_SKILL_ID`(string) → `REQUIRED_CANVAS_SKILL_IDS`(数组)，把新 skill 与 canvas-studio 一起强制注入 | "画布 agent 默认注入，画布专用" |

**底层可行性（已核实）**：会话级多 skill 注入**底层本就支持**——
- 画布 agent 通过 `syncSessionSkills(sid, skillIds[])`(:432) → `skill-config:update` IPC（`scope:'session'`、`skillIds` 数组透传）注入。
- `ChatInspectorPanel.tsx:111/572` 也按数组消费 `effectiveSkillIds`，跨视图一致。
- `platform-bridge.service.ts:389` 读 SKILL.md（去 frontmatter）拼进 system prompt；`session.service.ts` 注释确认 custom skills 已完全展开进 system prompt。

---

## 3. director-engine SKILL.md 内容大纲（去 seedance 化，纯方法论）

**落点**：`apps/desktop/resources/skills/director-engine/SKILL.md`（纯增量，零风险）

**frontmatter**（照 `canvas-studio/SKILL.md` 格式）：`name: 导演引擎` / `category: directing` / `version` / `author: Spark AI` / `description`（写"影视/视频创作通用导演方法论底盘，做分镜/出片/关键帧/角色一致性时优先加载"）/ `tags`（导演、分镜、镜头、felt_intent、Shot Contract、反 slop、重拍裁决、连贯性…）。

**正文 9 段方法论**（全部与厂商/模型无关，从 seedance-2.0 提炼并中文化）：

| 段 | 内容 | 补齐的画布缺口 |
|---|---|---|
| 核心信条 | Direct the model. Don't micro-manage the frame.（导戏，不要微操每一帧） | 立意 |
| ① Director's Read 五问 | 动手前先答：转折 / 视点 / 权力关系 / 潜台词 / 信息差 → 命名**一个** felt_intent 动词 | 画布"无方法" |
| ② felt_intent 单一意图 | 全片只服务一个意图动词，不堆砌形容词 | 反空泛 |
| ③ Director's Voice 全片统一 | 六种全片影像气质（写实/表现/古典/…），整片不混 | 全片一致性 |
| ④ Shot Contract 镜头契约 | 9 字段组装可执行镜头：景别/角度/焦距/起幅/单运镜+速度/主体动作/清晰终帧/脆弱锚点… | 散装积木→契约 |
| ⑤ 脆弱锚点（fragile anchors） | 多镜一致性锁什么：脸/手/logo/文字/产品形状/服装/道具位置 | "一致"具体化 |
| ⑥ 三层动作层级 | 多角色：微动全员 / 单聚焦反应 / 大动作默认禁止 | 多人物稳定器 |
| ⑦ 反陈词滥调映射表 | 中文化：电影感→具体光影焦段；史诗感→尺度+低角度+仪式感；震撼→物理冲击；cinematic→具体物理选择 | 反"模型味"，可对接 prompt_optimize |
| ⑧ 五档重拍裁决 | 保留 / 后期修 / 剪辑补救 / 重滚同参数 / 重写意图 + 每次只改一个变量 + 尝试预算 | 作为 `canvas_retry_operation` 的决策前置 |
| ⑨ Coverage 覆盖套路 | 三镜覆盖 + 尾帧=下镜首帧接续闭环 | 多镜接续 |

> 注：第 ⑧⑨ 段为方法论正文；落地为可调用工具（`canvas_review_take` 等）属 L2，不在本 todo。

---

## 4. 代码改造清单（单文件：CanvasAgentModal.tsx）

**文件**：`apps/desktop/src/renderer/design/views/canvas/CanvasAgentModal.tsx`

`REQUIRED_CANVAS_SKILL_ID` 全部引用点（grep 实测共 7 处，6 个行号簇）：

| 行 | 当前代码 | 改造后 | 性质 |
|---|---|---|---|
| **:88** | `const REQUIRED_CANVAS_SKILL_ID = 'builtin:canvas-studio'` | `const REQUIRED_CANVAS_SKILL_IDS = ['builtin:canvas-studio', 'builtin:director-engine'] as const` | **核心定义** |
| **:258** | `` `当前会话已启用 ${REQUIRED_CANVAS_SKILL_ID}。` `` | 语义化文案，如：`'当前会话已强制启用画布工具(canvas-studio)与导演方法论(director-engine)。'` | UI 文案（**不能裸拼数组**，否则显示裸 id） |
| **:399-408** `effectiveSkillIds` 构造 | `new Set([REQUIRED_CANVAS_SKILL_ID, ...extra.filter(id => id !== REQUIRED)])` | `new Set([...REQUIRED_CANVAS_SKILL_IDS, ...extra.filter(id => !REQUIRED_CANVAS_SKILL_IDS.includes(id))])` | **核心**：数组构造 → `syncSessionSkills` 自动透传多个 skill |
| **:410** `selectableSkills` filter | `skill.id !== REQUIRED_CANVAS_SKILL_ID` | `!REQUIRED_CANVAS_SKILL_IDS.includes(skill.id)` | UI 排除可选列表 |
| **:613** 加载时 toggle 排除 | `skillId !== REQUIRED_CANVAS_SKILL_ID` | `!REQUIRED_CANVAS_SKILL_IDS.includes(skillId)` | UI 排除持久化 |
| **:1011** submit-turn `skillId` | `skillId: REQUIRED_CANVAS_SKILL_ID` | **不动** | 独立语义：本次 turn 的"主 skill 标记"，保留 canvas-studio；director-engine 经 `syncSessionSkills` 注入，不走此字段 |

> `:399` 构造改对后，`:717 / :985` 的 `syncSessionSkills(sessionId, effectiveSkillIds)` 自动把两个强制 skill 带到 runtime，无需额外改动。

### 不在 L0 范围（明确划界，避免 scope creep）
- **`CanvasWorkspaceView.tsx:4684`** 的 `effectiveSkillIds` 来自 `operationPreset.skillIds`，是**节点 createTask（单个生成任务挂 skill）**链路，**非会话注入**。属 L1"操作预设默认带导演前缀"，不在本 todo。
- 镜头语言方法论层（`canvasFilmPrompts.ts` 加 `CAMERA_DECISION_RULES`）、角色 agent 升级（`canvasAgentPromptPresets.ts`）、五档重拍工具（`canvas.tools.ts` 新增 `canvas_review_take`）——属 L1/L2，各自独立 todo。

---

## 5. 底层支撑（已存在，无需改动，仅备查）

| 位置 | 作用 |
|---|---|
| `main/ipc/index.ts:1346` `ensureBuiltInSkills()` | 启动时扫描 `resources/skills/`，新目录自动登记为 `builtin:<name>`，**无需改白名单** |
| `CanvasAgentModal.tsx:432` `syncSessionSkills` | → `skill-config:update` IPC，`skillIds` 数组透传、`scope:'session'`，多 skill 会话注入底层支持 |
| `ChatInspectorPanel.tsx:111/572` | 跨视图按数组消费 `effectiveSkillIds`，标准字段 |
| `platform-bridge.service.ts:389` | 读 SKILL.md 去 frontmatter 拼进 system prompt |

---

## 6. 风险点

1. **`REQUIRED_CANVAS_SKILL_ID` 是画布 agent 会话 skill 同步的核心常量**，单值→数组后，需冒烟验证：两个强制 skill + 用户 extra skill 都正确带到 runtime、不互相覆盖、去重正常（对应项目习惯：并行改动审查 / 代码审查从源码核实）。
2. **`:258` 文案**必须语义化，不能裸拼数组（否则用户看到 `builtin:canvas-studio,builtin:director-engine`，体验差）。
3. **`ensureBuiltInSkills` 登记 builtin skill 时默认 enabled 与否需核实**——若默认 disabled，普通会话"不勾选也可用"不成立。实现时第一步先验证此默认值；若非默认启用，需在登记逻辑或该 skill 元数据里显式置 enabled。
4. **`director-engine` 在普通会话的边界**：用户要"普通会话可选、不强制"。builtin skill 默认出现在面板、默认 enabled，满足"可用"；不强制注入由其 `description`（"画布创作时优先加载"）引导模型按需加载，普通对话不会被污染。需在冒烟时确认普通会话**不**自动展开该 skill 正文。

---

## 7. 验证清单（落地后执行）

1. **画布 agent 会话**：让 agent 自述"加载了哪些 skill" → 应同时出现 canvas-studio 与 director-engine 正文。
2. **画布 agent 面板**：技能勾选项里 canvas-studio + director-engine 均**不可取消勾选**（被 filter 排除出可选列表）。
3. **普通会话（非画布）**：director-engine 出现在技能面板、默认 enabled、可手动选用；**不**自动强制注入。
4. **普通会话手动勾选** director-engine 后，system prompt 含方法论正文（验证 `platform-bridge` 读 SKILL.md 生效）。
5. **静态检查**：`tsc --noEmit` + 构建（CanvasAgentModal.tsx 单文件改动，影响面可控）。
6. **回归**：用户已选的 extra skill 仍能正常叠加（去重逻辑正确）。

> 验证范围说明：若实现时工作树存在他人并行修改，验证只针对本改动涉及的 `CanvasAgentModal.tsx` + 新增 SKILL.md，跳过全项目 typecheck/构建噪声（遵循项目编码习惯）。

---

## 8. 建议落地步骤（拆 2 个 commit）

- **Commit 1（内容）**：新增 `apps/desktop/resources/skills/director-engine/SKILL.md`（9 段方法论正文）。纯增量，可独立验收"普通会话可选用"。
- **Commit 2（注入）**：改 `CanvasAgentModal.tsx` 7 处引用（:88/:258/:399-408/:410/:613，:1011 不动）。完成后验收"画布默认强制注入"。

> 提交前按项目习惯：`git diff --cached --name-only` 核对 stage 范围，精准隔离；不擅自 commit，交用户决定。

---

## 9. 后续衔接（不在本 todo，仅备忘）

- **L1**：操作预设层（`canvasOperationPresets.ts` 给视频操作加 Shot Contract 前缀）、镜头语言方法论层（`canvasFilmPrompts.ts` 加 `CAMERA_DECISION_RULES` / 脆弱锚点 / 反 slop 映射）、角色 agent 升级（`canvasAgentPromptPresets.ts` 的 director/storyboard persona 补 Director's Read 与三层动作层级）。
- **L2**：五档重拍工具 `canvas_review_take`（`canvas.tools.ts`，复用 seedance `take-review.schema.json`）。
- 各自独立 todo，待本 L0 落地验证后再启动。
