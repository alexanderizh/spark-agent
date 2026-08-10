# 无限画布真实工作流验收实验室实施计划

> 状态: 实施中 | 最后核对: 2026-07-19

## 当前实施进度（2026-07-19）

首轮 MVP 已开始落地：

- 已增加 Dev 模式「验收实验室」入口，不切换分支、不自动发起 Provider 调用。
- 已实现 W0–W10 阶段选择、上游依赖闭包和版本化短篇小说 Fixture。
- 已实现小说 → 剧本 → 实体抽取 → 风格 → 资源卡 → 资源图 → 分镜 → 关键帧 → 视频，以及可选配音/转写的真实操作节点蓝图。
- 已读取当前 Provider Profile 与媒体模型目录，将明确的 Provider/Model/Manifest 冻结到操作节点。
- 已实现专属验收项目、每次独立 Run Board、调用计划摘要和预检阻断节点。
- 已实现一次确认后串行运行可执行节点、等待任务终态和按上游失败阻断下游。
- 已在任务 stream 回写点追加调用前、实际请求、Provider 响应、模型原文、产物回显和基础断言证据。
- 已实现集中脱敏、`observability_gap` 判定、项目侧验收摘要和 JSON 证据导出。
- 已增加聚焦单元测试；SQLite Acceptance 表、完整 Inspector、HTML 报告、真实 ffprobe 和 Electron E2E 仍待后续阶段完成。

第二阶段进度（2026-07-19）：

- 已增加 Workflow Smoke / Model Matrix / Full Acceptance / Custom 四种计划模式。
- 已支持附加文本、图片、视频、音频模型多选，并在指定业务节点创建独立模型泳道。
- 矩阵分支复用主工作流冻结上游产物，不重复生成无关上游；每个分支使用独立 Case ID、Provider/Model/Manifest 和证据。
- 已支持节点级矩阵选择，并自动补齐该节点所需的真实工作流阶段。
- 已增加 60 次真实调用硬上限；视频矩阵分支纳入高成本任务计数和二次确认。
- 已增加项目侧栏模型矩阵结果表，按同一业务节点比较主模型和附加模型的 pending/running/passed/failed/blocked/cancelled 与证据缺口。

第三阶段进度（2026-07-19）：

- 已为每个 Case 的每次执行建立独立 `attemptId/attemptIndex`；调用前、stream 回写、终态和 Runner 异常共享同一 Attempt，旧证据不被覆盖。
- 已复用现有 `retryOperationNode` 实现“重跑失败”：基于旧任务创建新 Task 和新 Attempt，保留首次失败任务、产物与证据。
- 已增加 Attempt 历史表，展示节点、次数、状态、Task ID、事件数、失败断言和证据缺口。
- 已通过现有 `file:write-text` 将脱敏证据自动镜像到项目 `tasks/<runId>.canvas-acceptance.json`；localStorage 配额不足时以内存和项目文件镜像兜底。
- 已增加媒体资产 metadata probe，核验资产类型、MIME、项目内路径/URL、扩展名、图片尺寸、音视频时长和文件大小；缺失元数据标为 warned，矛盾或无产物标为 failed。
- 已将媒体 probe 失败纳入 Case 终态与“重跑失败”选择，不再把 Provider completed 直接等同于验收通过。
- 代码审查后补强冻结配置漂移阻断、Runner timeout 主动取消、历史 Run Board 上下文恢复、同名普通项目隔离和跨 Board 节点定位。
- 证据脱敏已覆盖签名 URL query/fragment、异常文本中的 Bearer token、循环数组和事件窗口滚动后的 sequence 单调性。
- 下一阶段继续建设 SQLite Acceptance repository、真实 ffprobe/可解码验证、刷新重载断言和缺陷 Inspector。

## 0. 结论与已确认决策

本计划建设一个仅在 Dev / 显式功能开关下可见的「无限画布验收实验室」。验收不是用 Mock 结果拼一张展示画布，也不是绕开 renderer 直接测 Provider HTTP，而是使用当前应用内已经配置好的 Provider Profile、模型、MediaModelManifest、Agent、Skill 和画布生产节点，执行与用户真实使用一致的完整调用链。

已确认的产品决策：

1. Dev 启动时可以自动创建或恢复一个专属验收项目，但**绝不自动发起真实模型调用**；真实调用只能由用户手动确认触发。
2. 验收项目使用真实画布节点、真实输入绑定、真实任务 IPC、真实异步流事件和真实资产物化流程，不维护一套与生产逻辑平行的调用实现。
3. 每次运行创建独立 Run Board；历史运行不可被后续运行覆盖，支持回看、对比、重跑和导出缺陷修复包。
4. 运行前可选择测试等级、渠道、Provider Profile、模型、Manifest、节点/能力、工作流阶段、参数变体和输入传输方式。
5. 验收以真实影视生产流程为主线：小说文本 → 章节/剧本 → 角色/场景/道具/特效抽取 → 资源设定与资源图 → 分镜 → 关键帧/故事板 → 视频片段；音频生成/转写作为可选支线。
6. 每一次调用都必须形成完整、脱敏、可追溯的「调用证据包」。调用未发出时必须能证明阻断发生在哪一步；调用已发出时必须能证明请求、Provider 处理、响应解析、资产下载、画布回显和持久化分别发生了什么。
7. 「业务失败」与「证据缺失」分别判定。即使 Provider 请求失败，如果证据完整，仍能定位缺陷；如果任务失败且缺少应有 request/response/stage 证据，应额外产生 `observability_gap` 缺陷。
8. 不把生成内容与固定 Golden 文件做像素或全文相等比较。文本按结构、完整性和语义约束验收；图片/音频/视频按文件、媒体元数据、可解码性、关联关系和可选质量检查验收。
9. API Key、Authorization、Cookie、完整 base64、敏感 URL query、完整环境变量不得进入 renderer、画布快照、验收数据库、日志和导出包。
10. 视频及全量矩阵默认低并发、显式二次确认；测试调用次数、预计耗时和高成本任务数必须在运行前可见。

## 1. 建设目标

### 1.1 核心目标

- 验证选中渠道和模型能否完成真实调用，而不只是配置页“连接成功”。
- 验证 Provider 实际收到的模型、参数、输入媒体和请求协议符合预期。
- 验证同步、异步轮询、文件上传、产物下载、画布 materialize、节点/边/资产/任务持久化完整链路。
- 验证小说到影视资源和视频片段的真实生产工作流，而不是一组彼此无关的测试节点。
- 自动采集足以复现和定位缺陷的证据，减少后续依赖人工截图、回忆配置或再次付费复现。
- 支持同一工作流节点在不同渠道/模型之间横向对比，并保留每个分支的独立运行快照。
- 为新增 Provider、模型、Manifest、参数枚举、输入角色和画布节点建立统一验收入口。

### 1.2 非目标

- 第一阶段不自动判断图片“是否好看”或视频“是否具有电影感”；此类主观质量作为人工评分或后续可选评估器。
- 第一阶段不在普通生产构建中默认展示验收实验室。
- 不自动修复 Provider/Manifest/画布缺陷；验收系统负责给出证据、分类、复现入口和修复前后对比。
- 不把一次偶然成功等同于模型稳定可用；稳定性通过重复次数、重试结果和历史趋势单独评估。

## 2. 当前代码基础与缺口

### 2.1 可直接复用的基础

- Provider/媒体能力与模型发现：`canvas:media-capabilities:list`、`canvas:media-models:list`、`canvas:media-models:describe`。
- 参数 Contract V2：Manifest schema、defaults、aliases、transforms、strict/passthrough/forbidden、通用 compiler、Provider validator 和 dry-run。
- 真实任务入口：`canvas:task:create-media`、`canvas:task:generate-text`。
- 异步结果入口：`stream:canvas:media-task`、`stream:canvas:text-task`。
- 画布任务已经能保存 Provider、Model、Manifest、Agent、Skill、prompt snapshot、input snapshots、input file diagnostics、`requestCall`、`rawResponse`、`modelOutputText`、`submitResponse`、runtime events 和完成时间。
- 媒体 Runtime 已具备 runtime task、Provider request ID、提交响应、轮询和原始响应基础。
- 画布已经支持项目/Board/节点/边/资产/任务快照保存、加载、导出和项目资产落盘。
- `[canvas:task]`、`[canvas:media-task-runtime]`、`[media:adapter]`、`[media:task-poll]` 已提供部分生命周期日志。

### 2.2 需要补齐的缺口

- 当前 Playwright 配置仍是框架阶段，没有真正启动 Electron 并完成画布 UI E2E。
- 没有统一的 Acceptance Run / Case / Event / Assertion / Artifact 数据模型。
- 没有从已配置渠道、模型、Manifest 和节点能力自动生成测试矩阵的编译器。
- 没有真实小说生产工作流的稳定 Fixture、节点模板和阶段闸门。
- 现有 CanvasTask runtime event 粒度不足，无法完整表达 preflight、upload、compile、queue、poll、download、materialize、reload verify 等阶段。
- 诊断信息分散在 CanvasTask、media runtime、主进程日志和内存响应中，缺少统一关联 ID、不可变事件时间线和导出包。
- 缺少“证据完整性断言”：当前可能出现任务失败，但关键请求摘要、错误响应、轮询终态或 materialize diff 没有留下。
- 缺少真实产物的文件存在、hash、媒体探测、可解码、预览加载和刷新恢复断言。
- 缺少阻断/失败/警告/跳过/重试后通过的统一分类和失败阶段枚举。

## 3. 发起方式与专属验收项目

### 3.1 启动入口

建议提供两种等价入口：

```bash
pnpm --filter @spark/desktop dev:acceptance
```

或：

```bash
SPARK_CANVAS_ACCEPTANCE=1 pnpm --filter @spark/desktop dev
```

普通 Dev 是否默认显示入口由设置决定；生产包默认关闭。后续可增加 Support Build 开关，但不得依赖 `NODE_ENV` 单点判断授权。

### 3.2 专属项目行为

- 稳定项目 ID：`__spark_canvas_acceptance__`。
- 项目标题：`无限画布验收实验室`。
- 项目 metadata 标记 `projectKind=acceptance`、schemaVersion 和 fixtureVersion。
- 首次打开时创建「测试模板」Board；后续启动只做 schema/模板迁移，不覆盖历史 Run Board。
- 每次运行基于冻结后的 Test Plan 创建独立 Board：`YYYY-MM-DD HH:mm · <suite> · <runId-short>`。
- 用户点击运行前只生成节点和预检计划，不调用 Provider。
- 验收项目不计入普通项目最近使用、业务资产统计和自动封面策略。
- 提供“清理验收历史”能力，但需要按 Run 删除，不允许误删用户普通项目目录。

### 3.3 页面布局

- 顶部：Suite、调用数量、预计时长、高成本任务数、并发、生成测试画布、运行、暂停、取消、导出。
- 左侧：渠道 → Provider Profile → 模型 → Capability/节点 → 参数变体选择树。
- 中央：真实工作流画布；按阶段从左到右布局，模型横向分支按泳道排列。
- 右侧：Run 总览、当前阶段、阻断、失败、实时事件、断言、证据和缺陷列表。
- 底部：运行选中节点、从此节点运行下游、重跑失败、仅重新校验产物、使用原配置重跑、使用当前配置重跑。

## 4. 两条互补的验收主线

### 4.1 A 线：真实端到端生产工作流

端到端 Run 使用一个短篇小说 Fixture，所有调用结果继续作为下游真实输入，确保每次调用都有生产价值和链路价值。

```text
小说原文
→ 章节/场次拆解
→ 剧本生成
→ 角色 / 场景 / 道具 / 特效并行抽取
→ 视觉风格总设定
→ 角色卡 / 场景卡 / 道具卡 / 特效卡
→ 资源设定图生成
→ 分镜脚本
→ 分镜节点拆分
→ 故事板 / 关键帧生成
→ 图生视频 / 文生视频片段
→ 可选配音与转写
→ 项目刷新、重载、资产和血缘复核
```

工作流阶段：

| 阶段 | 真实节点/任务 | 主要验收 |
|---|---|---|
| W0 原文 | 文本/文稿节点 | 文本完整、版本冻结、输入 hash |
| W1 剧本 | `text_generate`，`chapter.to_screenplay` | Prompt 编译、长输出、剧本结构、截断检测 |
| W2 实体抽取 | `extract_character/scene/prop/effect` | JSON schema、实体种类、原文保留、解析失败诊断 |
| W3 风格设定 | `text_generate/prompt_optimize` | 上游引用、风格约束、Prompt Document 快照 |
| W4 资源卡 | 专用 pipeline task | 角色/场景/道具/特效资产中心回挂、版本与确认状态 |
| W5 资源图 | `text_to_image/image_to_image/image_edit/image_compose` | 输入角色、参数映射、图片落盘、尺寸/MIME/预览 |
| W6 分镜 | `screenplay.to_shot_script` | `shots` schema、时长、镜号、JSON 完整性、节点拆分 |
| W7 关键帧 | `storyboard_grid/text_to_image/image_to_image` | 分镜引用、构图提示、批量物化、主产物选择 |
| W8 视频 | `text_to_video/image_to_video/video_edit/video_extend` | 首帧/参考图、异步轮询、下载、时长/编码、clip 血缘 |
| W9 音频（可选） | `text_to_audio/audio_transcribe` | 音频可解码、时长、转写非空、文本/音频双向血缘 |
| W10 恢复 | snapshot save/load + reopen | 节点、边、任务、资产、历史诊断和预览全部可恢复 |

默认 Fixture 应满足：篇幅足以包含 2 个场景、2–3 个角色、至少 1 个道具和 1 个视觉特效，但足够短，避免每次验收产生不可控文本和视频成本。

### 4.2 B 线：渠道/模型横向矩阵

完整工作流不应对每个模型全部复制，否则调用数量呈指数增长。横向矩阵从 A 线冻结的标准输入节点分支，只比较用户选中的关键节点：

- 同一剧本输入 → 多个文本模型执行相同实体抽取。
- 同一角色卡/Prompt → 多个图片模型生成资源图。
- 同一关键帧/视频 Prompt → 多个视频模型生成片段。
- 同一媒体输入 → 不同传输方式或参数变体。

每个分支保留独立 Provider/Model/Manifest、参数编译结果、输出节点和 Case 证据。对比面板展示通过率、耗时、费用字段（若 Provider 返回 usage/cost）、输出元数据和人工评分，不自动宣布某个模型“质量最好”。

### 4.3 工作流与矩阵的组合策略

- `Workflow Smoke`：A 线每阶段一个推荐模型，完整跑通一次。
- `Changed Nodes`：只运行选中或最近变更的工作流阶段，并复用上次通过的冻结上游产物。
- `Model Matrix`：从稳定输入节点分支，对选中的渠道/模型执行关键节点。
- `Full Acceptance`：A 线完整工作流 + B 线选中矩阵 + 持久化/UI 验证。
- `Evidence Replay`：不重新调用 Provider，只对已保存响应/产物重新执行解析、materialize 和断言。

## 5. Test Plan 编译与选择器

### 5.1 选择维度

测试计划至少支持：

- Suite：Workflow Smoke / Model Matrix / Full Acceptance / Custom / Evidence Replay。
- Provider Profile：只展示安全摘要，不读取或展示 API Key。
- 文本 Provider、Agent、Skill、modelId、reasoningEffort。
- 媒体 Provider、modelId、manifestId、capability。
- 工作流阶段、Canvas operation、pipeline role、workflow metadata。
- 参数模式：默认值、推荐值、边界值、自定义值。
- 输入传输：`auto`、公开 URL、safe-file、base64、Provider file ID（支持时）。
- 输入角色：input、first frame、last frame、reference、mask、input video/reference video/reference audio（按能力实际支持）。
- 重复次数、是否允许一次瞬时错误重试、是否执行 reload/reopen/preview 验证。

### 5.2 编译规则

`AcceptancePlanCompiler` 必须先生成只读 Plan，不直接发任务：

1. 解析 Provider Profile 和 keystore 可用性，只记录 `credentialAvailable=true/false` 与凭据引用指纹。
2. 解析 `mediaModelRefs` 和 Manifest；Provider 已绑定 refs 时严格使用绑定关系。
3. 解析 operation → capability，不支持组合标记 blocked candidate，不静默换渠道或模型。
4. 合并项目默认、节点草稿、Preset、Provider defaults、Manifest defaults 和 Case override，同时保留每层 diff。
5. 执行 Contract V2 compile/dry-run，保存 dropped params、warnings、validation issues 和 provider-specific validator 结果。
6. 解析真实输入绑定、资产和 role，预计算传输策略与可能发生的上传。
7. 输出确定的调用数、高成本调用数、并发计划、最长超时、可执行/阻断/跳过 Case 数量。
8. 用户确认后冻结 Plan hash；运行期间配置变化不得偷偷修改已经冻结的 Case。

### 5.3 防止测试矩阵失控

- 默认不做所有参数的笛卡尔积；每个 capability 默认只生成 canonical Case。
- 边界参数和传输变体必须显式勾选。
- 同一 Provider 默认并发 1，全局默认并发 2。
- 视频调用单独计数并二次确认。
- 支持全局最大调用数和每 Provider 最大调用数；超过上限时 Plan 不可启动。

## 6. 每次调用的全链路证据包

每个 Case 的证据包分为调用前、调用中、调用后和画布验证四层。证据采用 append-only event + 不可变 snapshot，任何后续重试都创建新 Attempt，不能覆盖旧证据。

### 6.1 调用前证据 Pre-call Evidence

必须保存：

- `runId/caseId/attemptId`、项目、Board、操作节点、clientTaskId。
- App 版本、构建模式、Git commit、数据库 schema 版本、操作系统、Electron/Node 版本。
- Provider Profile ID/name/kind、配置安全指纹、endpoint 脱敏结果、credential 是否可用。
- 请求模型、预期实际模型、Manifest ID/version/hash、capability、invocation mode。
- Agent/Skill/reasoning、pipeline role、workflow、response format。
- 节点原始参数、项目/Provider/Manifest/Preset 默认值、继承过程、Case override。
- Contract 编译后的 canonical params、Provider params、dropped params、warnings、validation issues。
- System Prompt、compiled user text、Prompt Document snapshot；按现有隐私策略脱敏和限长。
- 输入节点/边/资产快照、文件名、MIME、size、width/height/duration、sha256、role、传输意图。
- 预计上传行为、输出目录、timeout、poll interval、retry policy、取消能力。
- preflight 每个检查项的通过/失败依据。

如果调用被阻断，必须写入结构化 `blockedReason` 和失败的 preflight assertion；禁止只有一句 Toast。

### 6.2 调用中证据 In-flight Evidence

必须按真实时间记录：

- 入队、出队、实际开始时间和排队耗时。
- 输入解析、读取、压缩/转换、Provider Files 上传、Spark 上传或 base64 物化阶段。
- 上传请求 ID、文件 ID、脱敏 URL、耗时、大小和 fallback 原因。
- 最终实际调用的 method、脱敏 URL、脱敏 headers、脱敏 body 或 SDK/CLI 调用参数。
- Provider 提交状态码、响应 headers 摘要、request/task ID、submit response 摘要。
- 每次轮询的 attempt、status、progress、HTTP 状态、Provider RequestId、产物数量和累计耗时；响应原文按大小上限和脱敏策略保存。
- transient failure、backoff、retry reason；不能把第一次失败覆盖成最终成功。
- 取消请求、取消是否被 Provider 接受、任务最终是否仍产生产物。
- stream event 的发送时间、renderer 接收时间、序列号和重复/乱序判定。

### 6.3 调用后证据 Post-call Evidence

必须保存：

- 最终 HTTP/SDK 响应摘要、Provider finish reason、usage、错误 code/message/body、RequestId。
- 文本模型原始输出 `modelOutputText`，与业务解析结果分开保存。
- JSON/结构化解析过程、顶层字段、schema issue、截断检测和 fallback 行为。
- 媒体产物远端 URL 摘要、下载 URL 脱敏值、下载开始/结束/重试、字节数和 sha256。
- 文件落盘路径的项目内相对表示；导出报告不得泄露无关本机路径。
- 图片 width/height/MIME/格式/可解码；音视频 duration/codec/container/MIME/可解码。
- Provider 请求配置与最终实际模型/产物元数据是否一致。
- Case 总耗时、分阶段耗时、重试次数、终态和失败阶段。

### 6.4 画布回显与持久化证据

- materialize 前后 CanvasSnapshot diff，只记录相关节点/边/资产/任务的结构化变化。
- 操作节点状态流转、任务绑定、产物节点、`generated`/`used_as_input` 边和资产血缘。
- 输出资产是否进入正确 pipeline role、影视资产中心和主产物选择。
- renderer 是否实际加载图片/音频/视频预览；失败时记录 DOM/媒体错误和截图。
- snapshot save 后重新 load 的结构比较。
- 可选关闭并重新打开画布窗口后的恢复比较。
- 历史 Task 是否仍保持原 Provider/Model/Manifest/参数快照，不被节点当前配置污染。

### 6.5 证据完整性断言

每个 Case 终态后运行 `EvidenceCompletenessAssertions`：

- Blocked Case 必须有 preflight evidence 和 blocked reason，且不得出现 Provider submit event。
- Submitted Case 必须有 actual request evidence 或明确的 SDK/CLI invocation evidence。
- Async Case 必须有 provider task ID 及 poll terminal/timeout/cancel evidence。
- Failed Case 必须有 failure stage、error code/message 和最后一个成功阶段。
- Succeeded Case 必须有 Provider response、业务解析、materialize 和 persistence evidence。
- 任何必需证据缺失时新增独立 `observability_gap` assertion，原业务终态保持不变。

## 7. 状态机、阻断和缺陷分类

### 7.1 Case 状态机

```text
planned
→ preflighting
→ blocked | queued
→ preparing_input
→ submitting
→ provider_processing
→ downloading
→ materializing
→ verifying
→ passed | warned | failed | cancelled
```

重试不把 Case 状态回滚，而是新建 Attempt；Case 汇总可以是 `passed_after_retry`。

### 7.2 Failure Stage

统一阶段枚举：

```text
plan
resolve_provider
resolve_model
resolve_manifest
compile_prompt
compile_params
resolve_input
upload
submit
poll
provider_terminal
parse_response
download
probe_asset
materialize
render_preview
persist
reload
reopen
cancel
observability
```

### 7.3 结果分类

- `blocked`：调用前配置、能力、输入、Manifest 或凭据不满足。
- `failed`：真实执行或画布验证失败。
- `warned`：产物可用但发生 fallback、忽略参数、缺少非关键元数据或重试后成功。
- `passed`：所有必需断言通过且证据完整。
- `cancelled`：用户取消；仍需记录 Provider/本地取消结果。
- `skipped`：用户未选择或被 Suite 明确排除。

### 7.4 缺陷去重指纹

建议指纹：

```text
providerKind | manifestId | modelId | operation | failureStage | errorCode | normalizedMessage
```

同一 Run 的重复缺陷聚合展示，但保留每个 Attempt 的证据。

## 8. 数据模型与存储

建议新增独立表，不把所有验收事件继续塞入 CanvasTask：

```text
canvas_acceptance_runs
canvas_acceptance_cases
canvas_acceptance_attempts
canvas_acceptance_events
canvas_acceptance_assertions
canvas_acceptance_artifacts
```

核心结构：

```ts
type AcceptanceRun = {
  id: string
  projectId: string
  boardId: string
  suite: string
  planHash: string
  fixtureVersion: string
  status: 'draft' | 'running' | 'paused' | 'completed' | 'cancelled'
  selection: unknown
  environment: unknown
  summary: unknown
  createdAt: string
  completedAt?: string
}

type AcceptanceCase = {
  id: string
  runId: string
  workflowStage: string
  operationNodeId: string
  operation: string
  providerProfileId?: string
  manifestId?: string
  modelId?: string
  capability?: string
  expectedAssertions: string[]
  status: string
  failureStage?: string
  blockedReason?: unknown
}

type AcceptanceEvent = {
  id: string
  runId: string
  caseId: string
  attemptId: string
  sequence: number
  at: string
  stage: string
  kind: string
  level: 'debug' | 'info' | 'warn' | 'error'
  payload: unknown
}
```

### 8.1 Artifact 目录

```text
<acceptance-project-root>/acceptance-runs/<runId>/
├── plan.json
├── environment.json
├── summary.json
├── report.html
├── report.md
├── cases/<caseId>/
│   ├── case.json
│   ├── events.jsonl
│   ├── assertions.json
│   ├── request.json
│   ├── response.json
│   ├── before-snapshot.json
│   ├── after-snapshot.json
│   └── screenshots/
└── artifacts/
```

数据库用于索引、查询和 UI；大事件流、截图、trace 和媒体探测结果放项目目录。数据库和文件写入需要原子化，并提供孤儿清理。

### 8.2 数据保留

- 默认保留最近 20 个 Run；用户标记“保留”的 Run 不自动清理。
- 媒体产物是否清理由用户决定，证据 JSON 和断言报告优先保留。
- 清理前显示预计释放空间；不得删除仍被其他 Board/资产引用的文件。

## 9. 断言体系

### 9.1 通用断言

- 选中的 Provider Profile、Manifest、modelId 与实际调用一致。
- 没有静默切换 Provider/模型；发生 fallback 时必须有 warning 和依据。
- request body 不包含 forbidden/dropped 参数。
- API Key/Authorization/base64 原文没有进入证据包。
- 任务在 timeout 内进入终态，stream 没有丢失或乱序破坏终态。
- 任务详情、节点状态和 Acceptance Case 状态一致。
- 快照 reload 后关联实体数量、ID、关键字段和诊断信息一致。

### 9.2 文本与结构化输出断言

- 原始模型文本非空并独立保存。
- finish reason、usage 和输出预算可查询。
- screenplay、entities、shots 等输出通过相应 schema。
- JSON 解析失败时保留原文、实际顶层字段和具体 schema issue。
- 分镜镜号、时长、关键 prompt 字段满足业务约束。
- 角色/场景/道具/特效不会因解析器异常全部丢失且无证据。

### 9.3 图片断言

- 文件存在、size > 0、hash 可计算、MIME 与解码格式一致。
- width/height 有效，比例/分辨率与请求约束不冲突；Provider 调整时给 warning。
- 预览能被 renderer 实际加载。
- 输入图、mask、参考图 role 与 Provider body 一致。

### 9.4 音频/视频断言

- container/codec/duration 可探测且文件可解码。
- 首帧、参考图、输入视频和音频 role 符合 capability/Manifest。
- async submit、poll、terminal、download 事件完整。
- 视频片段节点正确关联 keyframe/shot；video edit/extend 正确关联输入视频。
- 音频生成和转写形成正确的文本/音频资产血缘。

### 9.5 画布生产语义断言

- 下游正式生成只读取已冻结/确认的上游版本，或明确记录测试绕过原因。
- 上游重新运行后旧 Run 证据不可被覆盖。
- 输出 pipeline role、影视资源回挂、主产物和候选产物语义正确。
- 分支模型的输出不会串到其他模型 Case。

## 10. 调度、费用和异常策略

- 默认全局并发 2、单 Provider 并发 1；用户可调但受到上限保护。
- 文本、图片、音频、视频分别配置默认 timeout；优先采用 Manifest/Provider 明确值。
- 运行前展示总 Case、预计真实调用、视频调用、高分辨率调用、最长理论时间和输入上传数量。
- 第一版不猜测货币成本；Provider 返回 usage/cost 时保存，未返回时只显示调用数量和高成本权重。
- 默认不自动重试。开启后仅对明确 transient 的网络、429、5xx 或轮询请求失败重试一次，并完整保留首次失败。
- 参数错误、鉴权错误、模型未开通、业务 schema 错误和 materialize 错误不自动重试。
- 暂停只停止新 Case 出队，不中断已提交 Provider 任务。
- 取消必须区分本地取消、Provider 已接受取消、Provider 不支持取消和取消后仍产生产物。
- App 异常退出后 Run 标记 interrupted；重启后可以恢复查询仍在运行的异步任务，或明确标记无法恢复的证据。

## 11. UI 查询与缺陷修复包

### 11.1 节点详情页签

- 概览：状态、阶段、耗时、Provider/Model/Manifest、请求 ID。
- 调用前快照：Prompt、输入、配置合并、参数编译和 preflight。
- 实际调用：HTTP/SDK/CLI 摘要、submit、poll、response。
- 模型原文与解析：原文、结构化结果、schema issues。
- 产物：下载、hash、媒体探测、预览。
- 画布回显：snapshot diff、materialize、reload/reopen。
- 生命周期：Acceptance events + CanvasTask runtime events 对齐时间线。
- 断言：通过/警告/失败和证据链接。
- 复现：按原配置重跑、按当前配置重跑、Evidence Replay、导出修复包。

### 11.2 修复包

导出 ZIP 必须包含：

- Run/Case/Attempt 标识和环境信息。
- 冻结 Test Plan、配置安全指纹、Manifest 快照/hash。
- 调用前参数合并与 compile 结果。
- 脱敏 actual request/response、轮询事件和 Provider RequestId。
- 原始模型文本、解析问题、媒体探测和断言。
- 相关画布 before/after snapshot diff、截图和日志片段。
- 最小复现步骤和可导入的 Case JSON。

导出前再执行一次集中脱敏扫描；发现疑似 API Key/Authorization/base64 大块时阻止导出并报告具体 Artifact。

## 12. 协议、模块和文件规划

为避免继续扩大已超过 3000 行的 `CanvasWorkspaceView.tsx` 和 `canvas.api.ts`，验收功能必须拆分为独立模块，只在现有入口做最小挂载。

建议新增：

```text
packages/protocol/src/canvas-acceptance.ts
packages/storage/src/repositories/canvas-acceptance.repository.ts
packages/storage/migrations/<next>_canvas_acceptance.sql

apps/desktop/src/main/services/canvas-acceptance/
├── CanvasAcceptanceRunner.ts
├── CanvasAcceptancePlanCompiler.ts
├── CanvasAcceptanceScheduler.ts
├── CanvasAcceptanceEvidenceCollector.ts
├── CanvasAcceptanceRedactor.ts
├── CanvasAcceptanceArtifactStore.ts
├── CanvasAcceptanceAssertions.ts
├── CanvasAcceptanceReportBuilder.ts
├── CanvasAcceptanceRecovery.ts
└── fixtures/

apps/desktop/src/main/ipc/canvasAcceptanceIpc.ts

apps/desktop/src/renderer/design/views/canvas/acceptance/
├── CanvasAcceptanceLab.tsx
├── CanvasAcceptanceToolbar.tsx
├── CanvasAcceptanceSelector.tsx
├── CanvasAcceptanceRunPanel.tsx
├── CanvasAcceptanceCaseInspector.tsx
├── CanvasAcceptanceTimeline.tsx
├── CanvasAcceptanceAssertionsPanel.tsx
├── canvasAcceptanceProject.ts
├── canvasAcceptanceWorkflowBuilder.ts
└── canvasAcceptanceLayout.ts

apps/desktop/e2e/canvas.acceptance.test.ts
```

建议 IPC：

```text
canvas:acceptance:bootstrap
canvas:acceptance:plan
canvas:acceptance:run
canvas:acceptance:pause
canvas:acceptance:resume
canvas:acceptance:cancel
canvas:acceptance:get
canvas:acceptance:list
canvas:acceptance:rerun
canvas:acceptance:verify-artifacts
canvas:acceptance:export
stream:canvas:acceptance-event
```

Renderer 不得直接读取 keystore；主进程只返回 Provider/凭据可用性的安全摘要。

## 13. 分阶段实施任务

### P0：契约冻结与真实链路核对

- [ ] 绘制文本任务、媒体任务、异步轮询、画布 materialize、snapshot reload 的实际调用图。
- [ ] 核对小说生产流水线所有专用 target、workflow、pipeline role 和输出 schema。
- [ ] 核对 Provider Profile、Manifest resolver、Contract compiler、validator、adapter 的真实顺序。
- [ ] 定义 Acceptance status、failure stage、event、assertion、artifact 和 redaction schema。
- [ ] 明确当前哪些诊断只存在内存，哪些已经进入 CanvasTask/snapshot/SQLite。
- [ ] 对拟修改的符号逐一执行 GitNexus impact；HIGH/CRITICAL 风险先向用户报告。

**验收**：设计评审可以从任一工作流节点追踪到实际 Provider 请求和画布回写入口；不存在依靠猜测的平行调用方案。

### P1：Protocol、Migration 与 Repository

- [ ] 新增 AcceptanceRun/Case/Attempt/Event/Assertion/Artifact 协议和 Zod schema。
- [ ] 新增 SQLite migration、repository 和分页/按关联 ID 查询。
- [ ] 实现 append-only event sequence 和 Run/Case 汇总状态更新。
- [ ] 增加数据库 migration 验证和 repository 单测。

**验收**：应用重启后 Run、Case、Attempt、事件时间线和断言完整恢复；旧数据库可无损迁移。

### P2：集中脱敏与证据采集基础

- [ ] 复用并统一现有 request body sanitizer，覆盖 HTTP、SDK、CLI、multipart、URL、headers、base64。
- [ ] 实现环境、配置指纹、输入文件 hash、Manifest hash 和 snapshot diff。
- [ ] 实现 EvidenceCompletenessAssertions。
- [ ] 实现 Artifact 大小上限、原子写入、损坏恢复和导出前二次扫描。
- [ ] 为密钥、Authorization、Cookie、URL token、data URL 和异常对象补安全测试。

**验收**：成功、Provider 失败、调用前阻断三种 Case 都能生成可读证据包，且安全测试中没有敏感值泄漏。

### P3：Test Plan Compiler 与选择器模型

- [x] 枚举已配置文本/媒体 Provider、模型、Manifest、Agent、Skill 和能力。
- [ ] 实现工作流阶段、模型矩阵、参数变体、输入 role/transport 的选择模型。
- [ ] 实现配置合并 trace、Contract dry-run、阻断候选和调用数估算。
- [ ] 冻结 planHash，运行中配置变化只提示，不污染当前 Case。
- [ ] 实现推荐 Smoke、上次失败、当前选中节点和自定义 Suite。

**验收**：同一配置与 Fixture 重复编译得到稳定 Plan；不支持组合明确 blocked，不静默 fallback。

### P4：Dev 专属项目与 Run Board

- [ ] 增加 `dev:acceptance` 启动脚本和显式功能开关。
- [ ] 实现专属项目 bootstrap、模板版本迁移和历史 Run Board 管理。
- [x] 实现选择器、顶部预检摘要和“生成测试画布”。
- [x] 确保生成节点阶段零 Provider 调用。
- [x] 将 UI 拆入 `canvas/acceptance/`，现有大文件仅做入口挂载。

**验收**：重复启动只恢复一个专属项目；历史 Board 不被覆盖；生产默认不可见；未点击确认时无网络模型请求。

### P5：小说真实工作流 Fixture 与节点生成器

- [x] 创建版本化短篇小说 Fixture、预期最小实体和业务约束。
- [x] 构建 W0–W10 工作流节点、边、输入绑定和分组布局。
- [x] 接入现有 `chapter.to_screenplay`、实体抽取、shot script 和影视资产回挂语义。
- [x] 支持从 A 线标准输入生成 B 线模型分支。
- [x] 支持冻结上游产物并从任一阶段继续，避免每次都重新付费调用全部上游。

**验收**：生成的不是演示假节点；每个 operation 节点可被现有 UI 手动检查和运行，下游引用真实上游产物。

### P6：Runner、Scheduler 与生产任务桥接

- [x] Runner 通过现有画布任务创建/运行入口提交，不直接重写 Provider 调用。
- [ ] 统一注入 `runId/caseId/attemptId` 到 task lifecycle、media runtime 和 stream correlation。
- [ ] 实现队列、单 Provider 并发、暂停、取消、timeout 和 interrupted recovery。
- [ ] 捕获 upload/submit/poll/download/materialize 各阶段事件。
- [x] 重试创建新 Attempt，保留首次失败。

**验收**：用户可以运行全部、选中节点、某个阶段、某个渠道或某个模型；任何任务都能在时间线中关联到 CanvasTask 和 Provider request ID。

### P7：响应解析、资产与画布断言

- [ ] 实现通用、文本、图片、音频、视频和生产语义断言。
- [ ] 接入媒体文件 probe；开发环境缺少 probe 能力时提供明确 blocked/warning，不伪造通过。
- [ ] 实现 renderer 预览加载确认和失败截图。
- [ ] 实现 materialize diff、snapshot reload 和可选 reopen 验证。
- [x] 将 observability gap 作为独立断言展示。

**验收**：Provider 成功但画布未回显、文件损坏、结构化文本错误、刷新后丢失等问题都能被准确定位到不同 failure stage。

### P8：Inspector、报告与修复包

- [ ] 实现 Run/Case/Attempt 总览、过滤、时间线和证据页签。
- [ ] 实现失败聚类、去重指纹和点击定位画布节点。
- [ ] 实现 Markdown/HTML/JSON 报告。
- [ ] 实现修复包导出、导入和 Evidence Replay。
- [ ] 实现按原任务配置重跑、按当前节点配置重跑、只重新验证产物。

**验收**：开发者仅凭修复包即可确认输入、实际请求、响应、失败阶段、画布差异和最小复现步骤，无需再次调用模型获取基本证据。

### P9：Playwright Electron E2E

- [ ] 补齐 Electron launch fixture、隔离 userData、稳定 `data-testid` 和应用退出清理。
- [ ] 覆盖验收项目 bootstrap、选择、生成画布、手动确认和运行控制。
- [ ] 使用 Mock Provider 覆盖 UI 的 blocked/failed/warned/passed 展示。
- [ ] 在显式 live 环境变量下允许少量真实 Smoke；默认 CI 不消耗真实凭据和费用。
- [ ] 覆盖刷新/reopen、截图、导出和失败重跑。

**验收**：默认 CI 可稳定验证 UI 和错误路径；人工 live suite 可验证一个完整真实工作流。

### P10：故障注入与异常恢复

- [ ] 提供本地 Mock Provider：400/401/403/429/5xx、超时、断流、无效 JSON、错误 schema。
- [ ] 模拟异步任务永远 running、终态无产物、轮询 endpoint 错误、Provider 成功但下载失败。
- [ ] 模拟 renderer stream 丢失/重复/乱序、materialize 抛错、snapshot 保存失败和 App 异常退出。
- [ ] 验证每种失败都有 failure stage、最后成功阶段和完整证据。

**验收**：异常不再只表现为“任务失败”；报告能区分 Provider、Adapter、下载、画布回显、持久化和可观测性缺陷。

### P11：文档、发布闸门与 GitNexus

- [ ] 新增正式设计文档并保持状态行与日期更新。
- [ ] 更新画布任务可观测性、多媒体渠道配置和开发验收指南。
- [ ] 定义新增 Provider/Manifest/模型的最低 Acceptance Suite。
- [ ] 定义发布前 Workflow Smoke 和高风险改动 Model Matrix 闸门。
- [ ] 实现完成后运行 `gitnexus_detect_changes()`；提交后刷新 GitNexus 索引。

**验收**：新增渠道或模型的 PR 可以明确指出运行了哪些 Case、哪些被阻断、证据包位置和未覆盖能力。

## 14. 测试与验证命令规划

实施过程中至少覆盖：

```bash
pnpm --filter @spark/protocol test
pnpm --filter @spark/storage test
pnpm --filter @spark/agent-runtime test
pnpm --filter @spark/desktop test:unit
pnpm --filter @spark/desktop typecheck
pnpm --filter @spark/desktop test:e2e
pnpm --filter @spark/desktop build
```

Live 测试必须显式启用并选择 Provider allowlist，例如：

```bash
SPARK_ACCEPTANCE_LIVE=1 \
SPARK_ACCEPTANCE_PROVIDERS=xai,volcengine-ark \
pnpm --filter @spark/desktop test:e2e -- canvas.acceptance.live
```

命令只是自动化入口；应用内手动运行仍是主要产品体验。

## 15. 最终验收标准

完整功能只有同时满足以下条件才可标记已落地：

1. Dev 显式入口可以创建/恢复唯一验收项目，未确认前不会发真实调用。
2. 用户可选择渠道、Provider Profile、模型、Manifest、工作流阶段、节点、参数和输入模式。
3. 可以从小说 Fixture 真实运行到剧本、实体资源、资源图、分镜、关键帧和至少一个视频片段。
4. 可以在关键节点为多个选中模型创建横向分支，且结果不会串线。
5. 每个 Case 都有调用前、调用中、调用后、画布回显和持久化证据；失败时可定位 failure stage。
6. Blocked、Failed、Warned、Passed、Cancelled、Skipped 和 Passed After Retry 语义清楚。
7. Provider 成功但解析、下载、materialize、preview、reload 失败时不会被误判为通过。
8. 任务历史配置不可变；按原配置和按当前配置重跑有明确区别。
9. 报告和修复包可导出、可脱敏检查、可用于 Evidence Replay。
10. 密钥、Authorization、Cookie、完整 base64 和敏感 URL 参数不会落入证据或导出包。
11. Mock 故障注入覆盖主要调用前/调用后意外，Electron E2E 覆盖真实 UI 回显链路。
12. 新增代码按模块拆分，不继续向超过 3000 行的大文件堆叠验收实现。

## 16. 推荐首个可交付里程碑

首个里程碑先交付「可用且证据完整的 Workflow Smoke」：

- Dev 专属验收项目和渠道/模型/阶段选择器。
- 一份短篇小说 Fixture。
- 小说 → 剧本 → 角色/场景抽取 → 一张角色/场景资源图 → 分镜 → 一张关键帧 → 一个视频片段。
- 每个任务的 preflight、actual request、Provider response、model output、asset probe、materialize diff、reload assertion。
- Blocked/Failed/Passed/Observability Gap 分类。
- 重跑失败、按原配置重跑和 Markdown/JSON 修复包。

这个里程碑跑通后，再扩展所有资源类型、完整模型矩阵、音频、视频编辑/扩展、HTML 报告和 Playwright 全覆盖。这样可以优先验证最关键的“真实工作流 + 证据闭环”，避免先投入大量 UI 和全量矩阵，却仍然无法解释一次失败究竟发生在哪里。
