# 画布节点任务可观测性与异步视频修复

> 状态: 已落地 | 最后核对: 2026-08-24

## 背景

画布的媒体节点和文本节点都由主进程后台执行。此前日志分散在 IPC、媒体运行时和 provider adapter 多个 namespace 中，同一任务缺少稳定的关联字段；设置页只能查看全部日志，难以单独排查画布任务。

APIMart 视频任务先后暴露出两处状态查询契约问题：旧 adapter 曾错误查询 `GET /v1/videos/generations/{task_id}`，修复为官方统一的 `GET /v1/tasks/{task_id}` 后，2026-07-20 的真实任务 `task_01KXYNJJ1RND3XQA7AC3EP3SMS` 仍在渠道完成后持续轮询。根因是官方成功响应使用 `data.result.videos[].url: string[]`，而公共媒体 URL 提取器和旧测试只覆盖了 `url: string`，因此完成响应的视频 URL 数量始终被解析为 0，最终触发历史 Provider 配置中的 10 分钟超时。

xAI 另有一处终态解析错误：官方成功契约是 `status=done` 且产物位于 `video.url`；`file_output.public_url` 只是启用 Files 持久化后的可选地址。旧 adapter 只接受 `public_url`，因此渠道已完成但 CDN 持久化未完成或失败时仍会持续轮询。实际日志还暴露出本地图片上传缺少超时、图生视频会上传未使用图片、4096 字符限制未前置等提交阶段问题。

火山方舟的轮询端点和状态映射与官方契约一致。本次线上样本在创建阶段即返回 `ModelNotOpen`，账号未开通目标模型，因此不属于轮询故障；日志必须明确记录它停在 create 阶段并保留 RequestId。

## 已落地行为

### APIMart 视频任务

- APIMart 的图片和视频异步任务统一轮询 `/v1/tasks/{task_id}`。
- 成功响应从 `data.result.videos[].url[]` 提取视频地址；公共媒体 URL 提取器同时兼容字符串和字符串数组，下载到画布项目资产目录后再把任务置为成功。
- 视频任务的 Provider 表单、内置预设、manifest、adapter 和 MCP 兜底统一默认为 48 小时。数据库 migration 067 会把仍使用旧 30 分钟默认值的历史视频 Provider/manifest 更新为 48 小时，同时保留用户显式设置的其他超时。
- 画布前台等待媒体任务的默认上限也跟随统一视频轮询上限为 48 小时；显式传入的短超时仍仅用于测试或调用方主动收紧等待窗口。
- adapter 回归测试使用 APIMart 官方统一任务响应结构和真实的 `url: string[]` 形状，防止轮询路径或数组解析回退。

### xAI 视频任务

- `status=done` 时优先下载 `file_output.public_url`，不存在时回退到官方标准 `video.url`；CDN 持久化失败只记兼容告警，不再把已生成任务判为失败。
- 图生视频只解析并上传真正使用的首帧，不再上传额外未使用图片。
- xAI 视频提示词超过 4096 字符时在本地阻止提交，并显示当前字符数。
- xAI Files 请求 30 秒超时；图片上传失败或超时时回退为官方支持的 data URL。
- 视频创建请求超时会显示方法、脱敏端点与超时时长，不再只返回 `This operation was aborted`。

### 火山方舟视频任务

- 创建失败日志记录 `stage=create` 语义、模型、耗时、官方错误码和 RequestId；`ModelNotOpen` 需要在方舟控制台为对应账号开通目标模型，不能通过轮询重试修复。
- 创建成功后记录渠道任务 ID；轮询摘要记录 `queued/running/succeeded/failed`、产物数量与官方 RequestId。
- `succeeded + content.video_url` 进入下载阶段，下载开始/结束与耗时单独记录。

### 画布任务生命周期日志

所有经过 `canvas:task:create-media` 或 `canvas:task:generate-text` 的节点任务都会写入 `[canvas:task]` 日志：

- `event=started`：`kind`、`projectId`、`clientTaskId`、`operation`、provider profile、model、后台模式和输入数量；
- `event=finished`：终态、运行时任务 ID、provider 请求 ID、实际 provider/model、资产数或文本字符数、总耗时；
- `event=failed`：错误码、截断并压成单行的错误消息、运行时任务 ID和总耗时；
- `event=cancel-*`：媒体任务取消请求与结果。

`projectId + clientTaskId` 是画布侧的主关联键；媒体任务还可以继续用 `runtimeTaskId + providerRequestId` 串联 `[canvas:media-task-runtime]`、`[media:adapter]` 和 `[media:task-poll]`。

### 超时后产物恢复与引用完整性

Provider 可能在本地轮询超时后才完成生成。用户从 Provider 文件中心或项目目录把晚到产物重新挂回原操作节点时，画布必须把对应失败/取消任务恢复为 `completed`，补齐 `outputNodeIds` / `outputAssetIds`，清除超时错误，并写入恢复完成事件。任务队列执行「清空失败」时，有仍可访问产物的任务不得删除；仅无有效产物的失败记录可以清理。

旧版本可能已经只删除 `CanvasTask`，却保留操作节点的 `taskId`、`generated` 连线、产物节点和资产。操作节点产物投影因此增加图关系降级：任务记录缺失时，按 `generated.taskId` 从目标节点及其资产合成只读完成运行。只要产物关系仍在，图片、视频、音频和文本预览都不能因任务队列清理或后续画布重渲染而消失；存在可播放产物时，节点展示状态按完成处理，不再显示失败空壳。

媒体终态遵循单调性：任务已经 `completed` 且拥有物化产物后，晚到或重复的 `failed` / `cancelled` 回写不得覆盖成功状态或隐藏产物。真正无产物的超时任务仍维持失败语义。

### 任务状态权威、快照一致性与运行记录清理

操作节点的当前生命周期以 `CanvasTask.status/progress` 为唯一权威；`node.data.status/progress` 仅作为没有任务记录的旧数据兜底。节点徽标、跑马灯、进度、运行按钮、任务队列和退出守卫必须复用共享的状态判定，不能分别维护状态集合。退出画布时重新读取热存储并在用户确认后再次对账，弹窗出现前或期间已经进入终态的任务不得触发退出拦截或再次取消。前台快照合并不能只用毫秒级 `updatedAt` 判定新旧：时间相同且对象内容变化时允许 `pending/running` 向终态前进，禁止已知终态回退到 `running`；相同时间但 `taskId` 不同则视为新一轮运行，不能被上一轮对象吞掉。

任务运行态与终态写回采用不改变用户编辑 dirty 语义的静默持久化：clean 项目会防抖保存完整运行快照；dirty 项目读取上次持久化快照作为基线，只合并磁盘中已有、非 `pending` 任务的运行字段白名单、仍绑定节点的 `status/progress/message`，以及这些既有任务新生成的产物节点、资产和 `generated` 血缘。节点位置、Prompt、模型参数草稿和新建未保存任务继续沿用磁盘基线，避免把用户尚未保存的编辑顺带写盘；选择“放弃修改”时也会先对账并落盘后台终态，不能把已完成任务恢复成 `running` 或丢失产物。静默保存从读取基线开始占用公共持久化队列，防止更新的全量保存插入读写间隙后又被旧基线覆盖；保存期间再次收到运行态时必须重新调度，不能被在途保存吞掉。`openSnapshot()` 和 `hydrateFromStorage()` 发起异步读盘时记录项目 mutation 代次，返回后只要 dirty、运行态待落盘或代次发生变化，就拒绝提交该旧磁盘结果。主进程同项目的 snapshot save/load 进入同一顺序队列，`latest.json` 无效时回退 SQLite，避免并发 I/O 暴露截断或旧文件。

最新一次运行处于 `pending/running/failed/cancelled` 或 `completed` 但没有产物时，任务状态仍按真实生命周期展示，但节点主预览回退到最近一次有产物的运行；纯状态/进度更新不得重置用户已选择的历史运行和产物。多产物画廊与翻页因此独立于当前任务终态，取消或失败不会让此前成功产物消失。运行历史 Tab 以运行记录数而非产物数启用；全部运行都无产物时仍可打开列表，并进入单次失败、取消或空结果详情。

节点右下角仅为真实存在的非成功运行及成功但无产物的空记录提供纯图标快捷删除；没有 `CanvasTask` 运行历史时不得根据节点残留的 `taskId/status` 伪造删除入口，节点展示也必须恢复为待提交而不是幽灵 loading。若节点指针悬空但仍有真实历史，则回退到最近一条真实运行展示。`pending/running` 必须先尽力取消 runtime，并在删除任务记录前把最新终态写入持久化基线，避免 dirty 项目放弃修改后把已取消任务恢复成 `running`；随后再清理该运行的部分产物血缘和任务记录。删除完成后，操作节点的 `taskId/status/progress/message` 原子回指最近一条仍存在的运行，没有历史时恢复为待提交。若删除确认期间任务已经成功生成产物，完整性守卫保留该运行并提示用户改用产物级删除，不能误删竞态中刚完成的结果。

### 节点任务详情诊断

画布 Prompt 按来源隔离：普通操作节点只自动使用内置能力 Prompt、当前项目 Prompt 和节点显式 System Prompt，不得把全局操作预设中用户编写的 Prompt 静默带入其他项目。Provider、Manifest、Model、Agent、Skill、负面提示词与模型参数仍可作为全局运行偏好复用。历史普通节点若保存的完整 System Prompt 与旧全局预设组合完全一致，在重跑或重试前替换为内置能力 Prompt；不匹配的显式节点 Prompt 不做猜测性删除。

工作区任务队列按当前 board 展示。媒体和文本任务从 store 到创建 API 必须显式传递 `boardId`；绑定已有操作节点运行或重试时，以节点自身 `boardId` 为准。其他 board 的后台任务完成后只合并项目级资产和项目元数据，不切换当前 board，也不把节点或任务注入当前队列。

任务记录同时保存 `operationNodeId` 与真实生命周期事件。操作节点后续重试并切换到新 task 时，历史任务仍可定位到原节点；任务详情不再使用同一个 `updatedAt` 伪造多条运行日志。

文本任务把以下信息分开保存和展示：

- `modelOutputText`：模型/Agent 原始文本，结构解析失败时也必须保留；
- `rawResponse`：Session runtime 或 Provider 的非敏感诊断摘要，不再冒充模型正文；
- `systemPrompt` 与 `compiledUserText`：画布编译后、进入 Session Runtime 前的 System/User Prompt；
- 完整运行配置：Agent、Provider Profile、Manifest、Model、推理强度、Skill、pipeline role、模型参数和输入文件传输摘要；
- `completedAt`：成功、失败与取消三种终态都必须写入。

结构化输出校验失败时，详情仍显示模型原文，并尽量报告实际收到的 JSON 顶层字段。例如分镜任务收到 `episode/characters` 时，应明确指出期望 `shots`，而不是只显示“无法解析”。进入语义校验前会先做低风险 JSON 修复（代码围栏、前后说明、尾逗号、注释、智能/单引号和未加引号字段名等），不会强行补齐截断对象。只要响应包含文本，画布还会创建普通文本回显产物；专用语义角色仍只授予可恢复的结构化结果。剧本任务对非空文本采用可编辑优先策略：兼容常见的场次标题写法，未识别到标题时自动补入 `第1场｜｜｜`，只对真正的空响应报错，避免模型已经生成的内容因轻微格式差异丢失。

重试提供两种明确语义：“使用当前节点模型重试”复用冻结的任务输入但采用节点当前 Agent/Provider/Model/参数；“按原任务模型重试”完整复用原运行时配置。

任务一旦进入 `running` 或终态即成为不可变执行快照。后续在操作节点中切换模型、Provider、Agent、Skill 或参数，只修改节点的下一次运行配置，不得回写历史任务；分镜的 `shotScriptConfig` 也按任务独立保存，详情不能用节点当前值冒充历史值。

角色、场景、道具和特效抽取共用完整实体解析链路。模型返回后先写入独立诊断快照，再开始解析和资产物化；即使解析器抛错，任务详情仍保存完整 `modelOutputText`、Provider 摘要和实际模型信息，而不是只保留截断的异常预览。

文本执行路径按 Provider 的真实 wire protocol 选择：Anthropic-compatible 走 Messages；明确声明 `chat`/`responses` 的 OpenAI-compatible Profile 才可进入对应 Codex Session Runtime；缺少 `codexApiKind` 的旧 OpenAI-compatible Profile 保守回退直连 Chat Completions，避免被默认探测 `/responses`。

任务详情以“实际模型调用”为最终事实源。直连 HTTP 保存最终 URL、方法、脱敏请求头、模型实际请求体以及响应状态/请求 ID；Session Runtime 在 executor 提交边界保存明确标注的 Codex SDK、Claude SDK 或本地 CLI 地址，并分别记录真实 `sdk.query` Prompt/options、Codex client/thread/input 或 CLI command/args/stdin。API Key、Authorization、MCP header/env 和完整运行环境只显示脱敏占位，不再把画布侧 `modelParams` 或上层 `createSession`/`sendTurn` 冒充最终模型参数。画布提交 Prompt、冻结输入、节点血缘、画布配置和运行时诊断默认折叠；模型原始输出、实际模型调用和错误默认展开。System/User Prompt 合并为一个“调用前快照”，最终组合后的 Prompt 以实际 HTTP body 或 executor 调用快照为准。运行时诊断展示时移除已经单独展示的 `outputText`、`text` 和 `parsedEntities`，避免重复刷屏。

旧任务迁移按边类型恢复操作节点：`used_as_input` 使用 target，`generated` 使用 source。迁移结果按实际数据库对象缓存，项目重载或回滚得到的新快照仍会执行兼容迁移。

功能身份不能依赖 Provider 参数裁剪后的 `modelParams` 单点判断。`workflow`、`responseFormat` 和来源资产 id 属于画布控制元数据，文本模型 Contract 裁剪后必须恢复；分镜旧节点只要输入角色或输出角色为 `shot`，即使 `taskPipelineRole`/`workflow` 缺失或残留 `extract_character`，也必须解析为 `screenplay.to_shot_script`。当前节点运行和编辑优先读取节点草稿，历史 task 只作为缺省回退；API 提交边界再次强制功能 workflow 并规范化 system prompt，避免不可变历史快照反向污染下一次运行。

### 异步轮询诊断

共享轮询器会记录：

- 脱敏后的状态查询 URL（移除 query 和 fragment）；
- 初始轮询间隔和超时；
- pending 尝试次数（debug）；
- 每次响应的 provider、capability、渠道任务 ID、状态、进度或产物数量摘要；OpenAI-compatible 视频轮询至少记录 `status` 和 `videoUrls` 数量，不记录实际签名 URL；
- done、failed、request-failed、timeout 终态及累计耗时；
- xAI 的输入解析、Files 上传、任务创建和产物下载分段耗时；
- 火山的任务创建、轮询和产物下载分段耗时。

日志不得写入 API Key、Authorization、base64 原文或 URL 查询参数。超长 prompt 只保留 800 字符预览并记录原字符数；错误消息最多保留 500 个字符，避免第三方响应刷满日志文件。

### 异步任务恢复轮询

恢复轮询沿用同一条任务关联链，但明确区分 `runtimeTaskId`、`providerTaskId` 和画布侧 `projectId + clientTaskId`。恢复请求只查询已有 Provider Task ID，不重新调用创建接口。

Runtime 会保存无凭据的查询协议快照和脱敏提交响应。Manifest 渠道按保存的 HTTP 方法、Task ID 位置、状态映射、结果路径和 artifact 请求恢复；火山方舟、百炼、MiniMax、Sora、Google Veo/Omni、腾讯 TokenHub 等专用协议使用各自的查询客户端。恢复阶段重新读取当前 API Key，不把凭据写入任务记录。

恢复日志至少包含：

- `event=poll-resume-requested`：恢复入口、Runtime Task ID、Provider Task ID、Provider Profile、画布归属校验结果；
- `event=poll-resumed`：恢复策略、查询方法、attempt、间隔和超时；
- `event=poll-resume-failed`：结构化错误码、终态来源（Provider/网络/下载/取消）和是否仍允许再次恢复。

取消、跨任务归属不一致、Provider Task ID 不一致和已有产物都在主进程拒绝；每次查询前后再检查任务状态。成功/失败写回使用 `running + providerTaskId` 条件更新，晚到回调不能覆盖取消、重新提交或已有产物。日志不得记录 API Key、Authorization、签名 URL、完整提交响应或完整视频地址。

### 设置页查询

“应用设置 → 遥测与日志 → 日志查看器”新增范围选择：

- `画布任务`：聚合 `canvas:*` 与 `media:*`，包含 adapter、Files、输入解析和轮询阶段；
- `全部日志`：维持原始主进程日志视图。

画布范围是默认值，可继续按级别以及任务 ID、项目、模型等关键词过滤和导出。新安装在没有遥测配置时使用 `info` 日志级别，确保 started/finished 生命周期日志会实际落盘。

### Dev 无限画布验收实验室

Dev 模式的项目页提供「验收实验室」入口。它使用当前已配置的 Provider Profile、模型和 Manifest 生成专属验收项目与真实小说生产工作流；生成画布只冻结计划，不会自动调用模型。用户在项目侧栏确认后，Runner 才通过现有 `runOperationNode`/`retryOperationNode` 真实提交任务。

验收证据按 `runId → caseId → attemptId → taskId` 关联。每次重跑都创建新 Task 和新 Attempt，旧任务、旧产物和首次失败证据保持不变。证据包含 preflight、实际请求/响应、运行时事件、模型原文、错误详情、产物节点/资产/边和断言；缺少实际调用、生命周期或失败依据时单独标记 `observabilityGap`，不与业务失败混为一谈。

项目 metadata 保留最近 50 个 Run 的 Board/Plan/Case 节点映射，因此创建新 Run 后，在旧 Run Board 上发生的 stream 回写仍会进入原 Run 证据。Runner 提交前会比较冻结 Plan 与节点当前 Provider/Model/Manifest；发生漂移时在 preflight 阻断，避免意外调用错误渠道。等待任务超时会先请求取消真实任务，再保存 timeout 终态。

媒体完成后会核对资产类型、MIME、项目内路径或 URL、扩展名、图片尺寸、音视频时长和文件大小。缺少可选元数据记为 warning，类型矛盾、MIME 矛盾、零值或无产物记为 failed；当前阶段尚未执行 ffprobe 解码和 codec/container 验证。

每次 stream 回写及 Runner 终态都会更新脱敏证据，并自动镜像到项目目录：

```text
<projectRoot>/tasks/<runId>.canvas-acceptance.json
```

浏览器 localStorage 作为即时查询缓存；配额不足时内存仍保留本次 Run，并继续写项目文件镜像。侧栏可查看 Case 汇总、模型矩阵、Attempt 历史、证据缺口，手动导出 JSON，或仅重跑当前失败项。

脱敏覆盖结构化 secret key、Authorization/Cookie、长 base64、签名 URL 的 query/fragment，以及异常文本里的 Bearer token；证据采集失败不得打断生产 task stream 回写。

## 排查顺序

1. 用画布节点详情里的任务 ID 搜索 `clientTaskId`，确认 started 与 finished/failed 是否成对。
2. 媒体任务根据 `runtimeTaskId` 查看运行时记录，再根据 `providerRequestId` 对照渠道后台。
3. 检查 `[media:task-poll] event=started` 的 URL 是否符合 provider 当前任务查询契约。
4. 检查终态的 attempts、elapsedMs 与错误码，区分接口错误、平台失败和本地超时。
5. xAI 按 `input-resolution → upload → create → poll → download` 检查卡点；火山若在 create 阶段返回 `ModelNotOpen`，先在控制台核对账号和模型开通状态。
