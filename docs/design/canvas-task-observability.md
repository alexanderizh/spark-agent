# 画布节点任务可观测性与异步视频修复

> 状态: 已落地 | 最后核对: 2026-07-18

## 背景

画布的媒体节点和文本节点都由主进程后台执行。此前日志分散在 IPC、媒体运行时和 provider adapter 多个 namespace 中，同一任务缺少稳定的关联字段；设置页只能查看全部日志，难以单独排查画布任务。

APIMart 视频任务还存在一处状态查询契约错误：提交使用 `POST /v1/videos/generations`，但旧 adapter 随后查询 `GET /v1/videos/generations/{task_id}`。APIMart 当前统一要求通过 `GET /v1/tasks/{task_id}` 获取图片和视频异步任务状态，因此渠道已经完成后，客户端仍会持续轮询错误端点并最终报 `Task timed out after 600000ms`。

xAI 另有一处终态解析错误：官方成功契约是 `status=done` 且产物位于 `video.url`；`file_output.public_url` 只是启用 Files 持久化后的可选地址。旧 adapter 只接受 `public_url`，因此渠道已完成但 CDN 持久化未完成或失败时仍会持续轮询。实际日志还暴露出本地图片上传缺少超时、图生视频会上传未使用图片、4096 字符限制未前置等提交阶段问题。

火山方舟的轮询端点和状态映射与官方契约一致。本次线上样本在创建阶段即返回 `ModelNotOpen`，账号未开通目标模型，因此不属于轮询故障；日志必须明确记录它停在 create 阶段并保留 RequestId。

## 已落地行为

### APIMart 视频任务

- APIMart 的图片和视频异步任务统一轮询 `/v1/tasks/{task_id}`。
- 成功响应从 `data.result.videos[].url` 提取视频地址，下载到画布项目资产目录后再把任务置为成功。
- VEO、Sora 和视频合集预设的轮询超时统一为 30 分钟；未显式配置超时的 OpenAI-compatible 视频任务也使用 30 分钟兜底。
- adapter 回归测试使用 APIMart 官方统一任务响应结构，防止轮询路径回退。

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

### 节点任务详情诊断

任务记录同时保存 `operationNodeId` 与真实生命周期事件。操作节点后续重试并切换到新 task 时，历史任务仍可定位到原节点；任务详情不再使用同一个 `updatedAt` 伪造多条运行日志。

文本任务把以下信息分开保存和展示：

- `modelOutputText`：模型/Agent 原始文本，结构解析失败时也必须保留；
- `rawResponse`：Session runtime 或 Provider 的非敏感诊断摘要，不再冒充模型正文；
- `systemPrompt` 与 `compiledUserText`：最终提交的 System/User Prompt；
- 完整运行配置：Agent、Provider Profile、Manifest、Model、推理强度、Skill、pipeline role、模型参数和输入文件传输摘要；
- `completedAt`：成功、失败与取消三种终态都必须写入。

结构化输出校验失败时，详情仍显示模型原文，并尽量报告实际收到的 JSON 顶层字段。例如分镜任务收到 `episode/characters` 时，应明确指出期望 `shots`，而不是只显示“无法解析”。

重试提供两种明确语义：“使用当前节点模型重试”复用冻结的任务输入但采用节点当前 Agent/Provider/Model/参数；“按原任务模型重试”完整复用原运行时配置。

任务一旦进入 `running` 或终态即成为不可变执行快照。后续在操作节点中切换模型、Provider、Agent、Skill 或参数，只修改节点的下一次运行配置，不得回写历史任务；分镜的 `shotScriptConfig` 也按任务独立保存，详情不能用节点当前值冒充历史值。

角色、场景、道具和特效抽取共用完整实体解析链路。模型返回后先写入独立诊断快照，再开始解析和资产物化；即使解析器抛错，任务详情仍保存完整 `modelOutputText`、Provider 摘要和实际模型信息，而不是只保留截断的异常预览。

文本执行路径按 Provider 的真实 wire protocol 选择：Anthropic-compatible 走 Messages；明确声明 `chat`/`responses` 的 OpenAI-compatible Profile 才可进入对应 Codex Session Runtime；缺少 `codexApiKind` 的旧 OpenAI-compatible Profile 保守回退直连 Chat Completions，避免被默认探测 `/responses`。

旧任务迁移按边类型恢复操作节点：`used_as_input` 使用 target，`generated` 使用 source。迁移结果按实际数据库对象缓存，项目重载或回滚得到的新快照仍会执行兼容迁移。

### 异步轮询诊断

共享轮询器会记录：

- 脱敏后的状态查询 URL（移除 query 和 fragment）；
- 初始轮询间隔和超时；
- pending 尝试次数（debug）；
- 每次响应的 provider、capability、渠道任务 ID、状态、进度或产物数量摘要；
- done、failed、request-failed、timeout 终态及累计耗时；
- xAI 的输入解析、Files 上传、任务创建和产物下载分段耗时；
- 火山的任务创建、轮询和产物下载分段耗时。

日志不得写入 API Key、Authorization、base64 原文或 URL 查询参数。超长 prompt 只保留 800 字符预览并记录原字符数；错误消息最多保留 500 个字符，避免第三方响应刷满日志文件。

### 设置页查询

“应用设置 → 遥测与日志 → 日志查看器”新增范围选择：

- `画布任务`：聚合 `canvas:*` 与 `media:*`，包含 adapter、Files、输入解析和轮询阶段；
- `全部日志`：维持原始主进程日志视图。

画布范围是默认值，可继续按级别以及任务 ID、项目、模型等关键词过滤和导出。新安装在没有遥测配置时使用 `info` 日志级别，确保 started/finished 生命周期日志会实际落盘。

## 排查顺序

1. 用画布节点详情里的任务 ID 搜索 `clientTaskId`，确认 started 与 finished/failed 是否成对。
2. 媒体任务根据 `runtimeTaskId` 查看运行时记录，再根据 `providerRequestId` 对照渠道后台。
3. 检查 `[media:task-poll] event=started` 的 URL 是否符合 provider 当前任务查询契约。
4. 检查终态的 attempts、elapsedMs 与错误码，区分接口错误、平台失败和本地超时。
5. xAI 按 `input-resolution → upload → create → poll → download` 检查卡点；火山若在 create 阶段返回 `ModelNotOpen`，先在控制台核对账号和模型开通状态。
