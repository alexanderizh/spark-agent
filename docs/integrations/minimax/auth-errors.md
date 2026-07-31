# MiniMax 鉴权、错误模型与异步任务汇总

> 状态: 已落地 | 最后核对: 2026-07-31

本文件汇总 MiniMax 开放平台所有模态共用的鉴权方式、错误响应模型与异步任务约定，作为 `image-models.md` / `video-models.md` / `video-templates.md` / `speech-music.md` / `files-api.md` 的横向参考。各模块文档中只描述其特有的状态枚举与字段，公共部分以本表为准。

## 0. 入口与文档基线

| 用途 | URL | 抓取日期 |
| --- | --- | --- |
| 错误码官方汇总（全表 24 条） | https://platform.minimaxi.com/docs/api-reference/errorcode | 2026-07-31 |
| 速率限制 | https://platform.minimaxi.com/docs/guides/rate-limits | 2026-07-31 |
| 获取 API Key（概览） | https://platform.minimaxi.com/docs/api-reference/api-overview | 2026-07-31 |
| 接口概览（语言/视频/语音/图像/音乐/文件） | https://platform.minimaxi.com/docs/api-reference/api-overview | 2026-07-31 |

## 1. 鉴权

### 1.1 API Key 形态

MiniMax 开放平台提供两类互相独立的 API Key，调用同一组 endpoint 时**只能使用一种**，不能跨类互传：

| 类型 | 创建入口 | 调用范围 | 来源 |
| --- | --- | --- | --- |
| 按量付费 API Key | 「账户管理 > 接口密钥 > 创建新的 API Key」 | 支持全部模态（语言、视频、语音、图像、音乐、文件） | https://platform.minimaxi.com/docs/api-reference/api-overview |
| Token Plan 订阅 Key | 「订阅管理 > Token Plan」 | 仅用于 Token Plan 订阅套餐与已购积分 | 同上 |

> 两类 Key 独立计费、独立配额、独立并发；概览页原文："订阅 Key 用于 Token Plan 订阅套餐和已购积分，并与按量计费 API Key 相互独立"。

### 1.2 鉴权头（HTTP / WebSocket）

所有模块（image / video / video-agent / speech-t2a-http / speech-t2a-async / voice-cloning / voice-design / music / files）均使用同一组鉴权头：

| Header | 必填 | 取值 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `Authorization` | 是 | `Bearer <API_key>` | HTTP Bearer，`securityScheme: type=http, scheme=bearer, bearerFormat=JWT` | 各 endpoint 页 OpenAPI `securitySchemes.bearerAuth` |
| `Content-Type` | 是 | `application/json` 或 `multipart/form-data` | JSON 接口固定 `application/json`；文件上传类（file upload、voice clone 上传音频）固定 `multipart/form-data` | 各 endpoint 页 `parameters[0].schema.enum` |
| `MINIMAX_API_KEY` | — | 环境变量示例 | 仅供服务端参考；客户端不直接持有 | https://platform.minimaxi.com/docs/guides/image-generation Python 示例 |

WebSocket 握手：在 `wss://api.minimaxi.com/ws/v1/t2a_v2` 连接时携带 `headers = {"Authorization": f"Bearer {api_key}"}`（来源：https://platform.minimaxi.com/docs/guides/speech-t2a-websocket.md）。

### 1.3 Base URL

| 用途 | URL | 来源 |
| --- | --- | --- |
| 国内站（默认） | `https://api.minimaxi.com` | 已抓取的全部 endpoint 页 OpenAPI `servers[0].url` 均为该值 |
| 国际站 | `https://api.minimax.io/v1` | **未在官方文档中找到出处**：video-agent-create.md 与 api-overview.md 均无此 URL；官方页面出现的 `minimax.io` 仅为产物 CDN 域名（`video-product.cdn.minimax.io`，见 video-generation-v2-query.md）。本行沿用本工程 video-templates.md 的旧记录，**待核实** |

> 接入本轮统一使用国内站 `https://api.minimaxi.com`；国际站暂不在本期范围。

### 1.4 trace_id

`trace_id` 由**响应 Header** 返回，官方建议在咨询/反馈时附带该 ID：errorcode.md 原文"如需反馈问题，请提供 Header 中的 trace\_id"，speech-t2a-http.md 亦写明"您可在 header 中获取本次会话的 trace_id"。**并非所有响应体都带 `trace_id` 字段**——仅 T2A HTTP、音乐生成（含 music-cover-preprocess）、T2A WebSocket 的响应 schema 中定义了该字段；image / video / video-agent / file 系列的 OpenAPI 响应体均无 `trace_id`。（来源：https://platform.minimaxi.com/docs/api-reference/errorcode.md 、speech-t2a-http.md）

## 2. 错误响应模型

### 2.1 通用约定

MiniMax API 的错误响应**始终走 HTTP 200**，业务状态码封装在响应体的 `base_resp.status_code` 中：

```jsonc
{
  "base_resp": {
    "status_code": 0,           // 0 = 成功；非 0 业务错误
    "status_msg": "success"     // 人类可读描述
  }
}
```

> 文件下载接口 `GET /v1/files/retrieve_content` 例外：按 OpenAPI 标注返回二进制流（`format: binary`），不携带 `base_resp`；如需错误处理应观察 HTTP 状态码（来源：https://platform.minimaxi.com/docs/api-reference/file-management-retrieve-content.md）。

### 2.2 平台级错误码全表（官方 24 条枚举 + 成功码 `0`，跨模块共用）

> 来源：https://platform.minimaxi.com/docs/api-reference/errorcode.md。该页为唯一权威表。

| `status_code` | 含义（官方原文） | 典型触发场景 |
| --- | --- | --- |
| `0` | 请求成功 / 正常 | 全部模块 |
| `1000` | 未知错误 / 系统默认错误 | 视频 Agent / 语音 / 音乐 / 复刻 / 设计 / 文件 |
| `1001` | 请求超时 | 同上 |
| `1002` | 请求频率超限 / 触发 RPM 限流 | 全部模块 |
| `1004` | 未授权 / Token 不匹配 / Cookie 缺失 / 账号鉴权失败 | 全部模块 |
| `1008` | 余额不足 | 视频 / 图像 / 视频 Agent / 音乐 / 文件 / 音色设计 |
| `1024` | 内部错误 | 视频 Agent / 平台级 |
| `1026` | 输入内容涉敏 / 图片描述涉及敏感内容 / 视频描述涉及敏感内容 | 视频生成 / 视频 Agent / 图像 / 音乐 / 文件 |
| `1027` | 输出内容涉敏 / 生成视频涉及敏感内容 | 视频生成 / 视频 Agent / 文件 / 音色设计 |
| `1033` | 系统错误 / 下游服务错误 | 平台级 |
| `1039` | Token 限制 / 触发 TPM 限流 | 语音 T2A / 异步 T2A / 音色设计 / 文件 |
| `1041` | 连接数限制 | 平台级（需联系官方） |
| `1042` | 不可见字符比例超限 / 非法字符超过 10% | 语音 T2A / 异步 T2A |
| `1043` | ASR 相似度检查失败 | 音色快速复刻（`text_validation`/`accuracy` 校验未通过） |
| `1044` | 克隆提示词相似度检查失败 | 音色快速复刻（`clone_prompt` 校验未通过） |
| `2013` | 参数错误 / 输入参数异常 | 全部模块（参数缺失、类型错误、枚举越界） |
| `20132` | 语音克隆样本或 voice_id 参数错误 | 音色快速复刻（file_id 或 T2A 用的 voice_id 异常） |
| `2037` | 语音时长不符合要求（太长或太短） | 音色快速复刻（file_id 时长需 ≥10 秒且 ≤5 分钟） |
| `2038` | 用户语音克隆功能被禁用 / 无复刻权限 | 音色快速复刻（需完成个人或企业认证） |
| `2039` | 语音克隆 voice_id 重复 | 音色快速复刻（voice_id 已存在） |
| `2042` | 无权访问该 voice_id | T2A 调用非本人创建的 voice_id |
| `2045` | 请求频率增长超限 | 视频 Agent / 平台级 |
| `2048` | 语音克隆提示音频太长 | 音色快速复刻（`prompt_audio` 过长；官方要求调整至 ＜ 8s） |
| `2049` | 无效的 API Key | 视频生成 / 视频 Agent / 图像 / 音乐 / 文件 |
| `2056` | 超出 Token Plan 资源限制 | 平台级（订阅用户） |

> 上表除 `0`（成功码，未列入官方表）外的 24 条均来自 `errorcode.md` 全表，已穷举；剩余 N/A 0 条。注意 `1013`（服务内部错误）**不在** `errorcode.md` 全表中，但在 voice_clone / voice_design / files 系列的内联清单中出现。下文 §2.3 给出**每个 endpoint 实际内联**的 `base_resp.status_code` 子集，可能与全表不完全相同——以 endpoint 实际内联清单为准，全表为参考。

### 2.3 各 endpoint 内联的 status_code 子集（不是全表）

各 endpoint 的 `BaseResp.status_code.description` 仅列出与该接口相关的子集，下表逐 endpoint 列出。

| endpoint | 内联 status_code | 来源 |
| --- | --- | --- |
| `POST /v1/image_generation` | 0, 1002, 1004, 1008, 1026, 2013, 2049 | https://platform.minimaxi.com/docs/api-reference/image-generation-t2i.md |
| `POST /v1/video_generation`（t2v/i2v/fl2v/s2v） | 0, 1002, 1004, 1008, 1026, 2013, 2049 | https://platform.minimaxi.com/docs/api-reference/video-generation-t2v.md |
| `GET /v1/query/video_generation` | 0, 1002, 1004, **1026, 1027**（**无 1008/2013/2049**） | https://platform.minimaxi.com/docs/api-reference/video-generation-query.md |
| `POST /v1/video_template_generation` | 0, 1002, 1004, 1008, 1026, 2013, 2049 | https://platform.minimaxi.com/docs/api-reference/video-agent-create.md |
| `GET /v1/query/video_template_generation` | 0, 1002, 1004, **1026, 1027**（**无 1008/2013/2049**） | https://platform.minimaxi.com/docs/api-reference/video-agent-query.md |
| `POST /v1/t2a_v2` | 0, **1000, 1001**, 1002, 1004, **1039, 1042, 2013**（**无 1008/1026/2049**） | https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md |
| `POST /v1/t2a_async_v2` | 0, 1002, 1004, 1039, 1042, 2013 | https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-create.md |
| `GET /v1/query/t2a_async_query_v2` | 0, 1002, 1004, 1039, 1042, 2013 | https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-query.md |
| `POST /v1/voice_clone` | 0, 1000, 1001, 1002, 1004, **1013**, 2013, **2038**（**无 1008**） | https://platform.minimaxi.com/docs/api-reference/voice-cloning-clone.md |
| `POST /v1/voice_design` | 0, 1000, 1001, 1002, 1004, 1008, **1013**, **1027**, 1039, 2013（**无 1026**） | https://platform.minimaxi.com/docs/api-reference/voice-design-design.md |
| `POST /v1/music_generation` | 0, 1002, 1004, 1008, 1026, 2013, 2049 | https://platform.minimaxi.com/docs/api-reference/music-generation.md |
| `POST /v1/files/upload` | 1000, 1001, 1002, 1004, 1008, 1013, 1026, 1027, 1039, 2013（**内联清单未含 `0`**，但示例响应为 `status_code: 0`） | https://platform.minimaxi.com/docs/api-reference/file-management-upload.md |
| `GET /v1/files/list` | 同 upload | https://platform.minimaxi.com/docs/api-reference/file-management-list.md |
| `GET /v1/files/retrieve` | 同 upload | https://platform.minimaxi.com/docs/api-reference/file-management-retrieve.md |
| `POST /v1/files/delete` | 同 upload | https://platform.minimaxi.com/docs/api-reference/file-management-delete.md |

**WebSocket 专属 status_code**（未在 `errorcode.md` 全表，只在 `speech-t2a-websocket.md` 出现）：

| `status_code` | 含义 | 出现位置 |
| --- | --- | --- |
| `2201` | 超时断开连接 | WebSocket 120s 无新事件后自动断开 |
| `2202` | 非法事件 | WebSocket 收到未知 event 名 |
| `2203` | 空文本跳过 | WebSocket task_continue 文本为空 |
| `2204` | 超出字符限制跳过 | WebSocket 单次 task_continue 字符超限 |
| `2205` | 请求超限 | WebSocket 并发超限 |

（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-websocket.md）

### 2.4 速率限制

来源：https://platform.minimaxi.com/docs/guides/rate-limits

| 模态 | 模型/接口 | 免费用户 RPM | 充值用户 RPM | 备注 |
| --- | --- | --- | --- | --- |
| 语言（MiniMax-M3） | — | 20 | 200 | TPM：免费 1,000,000 / 充值 10,000,000 |
| 语言（M2.7/M2.5/M2.1/M2 系列） | — | 20 | 500 | TPM：免费 1,000,000 / 充值 20,000,000 |
| 视频 Video Generation | Hailuo 系列 | 5 | 20 | 仅 RPM，**视频 Agent 未单列配额** |
| 视频 Video Generation V2 | MiniMax-H3 | 2 | 15 | 限制类型为 **CONN（最大并行运行任务数）**，不是 RPM |
| 语音 T2A v2 | speech-2.8-hd/turbo、speech-2.6-hd/turbo、speech-02-hd/turbo | 10 | 20 | — |
| 语音 Voice Cloning | — | 60 | 60 | — |
| 语音 Voice Design | — | 20 | 20 | — |
| 图像 | Image Generation（rate-limits 页未列模型名；模型 image-01 / image-01-live 见概览页） | 10 | 10 | TPM：免费 60 / 充值 60 |
| 音乐 | music-2.6 / music-cover / music-2.0（rate-limits 页原文） | 3 | 120 | 额外 CONN 并行任务数：免费 3 / 充值 20 |
| T2A Async 查询 | — | 每秒最多 10 次 | — | https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-query.md |

> 视频 Agent 通道**没有专列的速率限制**（rate-limits 页面没有 video-agent 行），按"视频生成"行估算；Music-CONN 是**并行任务数**不是 RPM/分钟。
>
> **音乐模型口径冲突**：rate-limits 页仍写 `music-2.6 / music-cover / music-2.0`，而概览页与 `music-generation.md` 的 `model` 枚举已是 `music-3.0` / `music-2.6` / `music-cover` 及三个 `-free` 变体（无 `music-2.0`）。`music-generation.md` 逐模型标注：付费三款 RPM 120，`-free` 三款 RPM 3——与 rate-limits 的"免费 3 / 充值 120"是同一套数值的两种表述。

## 3. 异步任务约定

MiniMax 多模态 API 大量采用"创建任务 → 轮询状态 → 下载产物"三段异步流程；各通道独立，状态枚举、轮询 endpoint、URL 有效期、`task_id` 类型均不同。

### 3.1 异步通道对照表

| 通道 | 创建 endpoint | 查询 endpoint | 状态枚举 | 任务 ID 类型（创建响应） | 任务 ID 类型（查询参数） | 产物 / 有效时长 | 来源 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 视频生成（t2v / i2v / fl2v / s2v） | `POST https://api.minimaxi.com/v1/video_generation` | `GET https://api.minimaxi.com/v1/query/video_generation?task_id=<id>` | `Preparing` / `Queueing` / `Processing` / `Success` / `Fail` | `task_id: string` | `task_id: string`（query） | `file_id: string` → Files `retrieve` 取 `download_url`（**有效期 1 小时**）或 `retrieve_content` 拉二进制流 | video-models.md、files-api.md、video-generation-query.md、video-generation-download.md |
| 视频 Agent（模板） | `POST https://api.minimaxi.com/v1/video_template_generation` | `GET https://api.minimaxi.com/v1/query/video_template_generation?task_id=<id>` | `Preparing` / `Processing` / `Success` / `Fail` | `task_id: string` | `task_id: string`（query） | 响应直接返回 `video_url`（HTTPS）；9 小时有效 | video-templates.md、video-agent-query.md |
| 语音 T2A Async | `POST https://api.minimaxi.com/v1/t2a_async_v2` | `GET https://api.minimaxi.com/v1/query/t2a_async_query_v2?task_id=<id>` | OpenAPI `enum`: `success` / `failed` / `expired` / `processing`；**描述与示例使用首字母大写** Processing/Success/Failed/Expired | `task_id: string`（resp） | **`task_id: integer(int64)`（query 参数，JS 端必须按字符串透传防精度丢失）** | `file_id: integer(int64)` → Files `retrieve_content` 拉产物；下载 URL 9 小时有效 | speech-music.md、speech-t2a-async-create.md、speech-t2a-async-query.md |
| 图像生成（同步） | `POST https://api.minimaxi.com/v1/image_generation` | 无独立 query endpoint（响应同步返回 `data.image_urls`） | — | `id: string`（仅作记录用途） | — | `data.image_urls[]`（HTTPS URL），24 小时有效；或 `data.image_base64[]` | image-models.md、image-edit-models.md |
| 音乐生成（同步） | `POST https://api.minimaxi.com/v1/music_generation` | 无独立 query endpoint | — | 无 `task_id` | — | `data.audio`（hex）；`output_format=url` 时同一字段为 URL 字符串，24 小时有效 | speech-music.md、music-generation.md |

### 3.2 状态字段大小写约定

| 通道 | 接口响应 / 状态枚举 | 官方回调 webhook `status` 字段 | 备注 |
| --- | --- | --- | --- |
| 视频生成 | `Preparing` / `Queueing` / `Processing` / `Success` / `Fail`（首字母大写） | `processing` / `success` / `failed`（小写） | adapter 中需分别映射 |
| 视频 Agent | `Preparing` / `Processing` / `Success` / `Fail`（首字母大写；**无 Queueing，失败用 Fail**） | `processing` / `success` / `failed`（小写） | adapter 中需分别映射 |
| T2A Async | OpenAPI `enum` 小写 `success` / `failed` / `expired` / `processing`；描述与示例首字母大写 `Processing` / `Success` / `Failed` / `Expired` | — | adapter 需做大小写不敏感匹配 |

### 3.3 产物地址约定

| 通道 | 产物字段 | 获取方式 | 有效时长 |
| --- | --- | --- | --- |
| 视频生成 | `file_id: string` | Files `GET /v1/files/retrieve?file_id=<id>` 取 `download_url`，或 `retrieve_content` 拉二进制流 | **1 小时**（`download_url` 描述原文"有效期1小时"） |
| 视频 Agent | `video_url: string`（HTTPS） | 轮询成功响应中直接返回 | 9 小时 |
| T2A Async | `file_id: integer(int64)` | Files `GET /v1/files/retrieve_content?file_id=<int64>` 拉二进制流 | 9 小时 |
| 图像生成 | `data.image_urls[]`（HTTPS URL） | 同步响应 | 24 小时 |
| 音乐生成 | `data.audio`（hex 或 URL 字符串） | 同步响应 | 24 小时（url 模式） |

> **官方口径冲突（下载 URL 有效期）**：同一个 Files `retrieve` 接口，视频侧文档（video-generation-download.md）标注 `download_url`「有效期1小时」，而语音异步侧（api-overview.md、speech-t2a-async-create/query.md）明确写「自 url 返回开始的 9 个小时（即 32400 秒）」。本表按各自模态的官方原文分别记录；工程实现应按**较短的 1 小时**为视频侧兜底，拿到 URL 后尽快下载。
> 另注：Files `upload` 上传的文件本身有效期为 **7 天**（过期后发起生成返回 `file expired`，需重新上传）；T2A HTTP 同步接口返回的 `audio` url 有效期为 **24 小时**。

### 3.4 轮询策略建议（非官方，本工程内部约定）

- 默认间隔：视频/视频 Agent 5s，T2A Async 3s；
- 最大重试：120 次（约 10 分钟），超出后放弃并上报用户；
- 状态机：
  - `Preparing / Queueing / Processing / processing` → 继续轮询；
  - `Success / success` → 立即下载产物；
  - `Failed / Fail / failed / Expired / expired` → 中断并返回错误；
- `base_resp.status_code != 0` 时整体视为请求失败，轮询中止。

> 上述策略为本工程内部默认值；如官方后续在 `guides/rate-limits` 中给出推荐值，回写本表第 2.4 节。

## 4. 明确未在文档中列出的项

- 视频 Agent 通道的专属 RPM/TPM 数值（rate-limits 页面无 video-agent 行，按视频生成行估算）。
- T2A Async `task_token` 字段的具体用途与有效期（仅说明"完成当前任务使用的密钥信息"）。
- T2A Async 响应中 `analysis_info` 字段的字段语义（仅在音乐生成 example 中出现且为 `null`）。
- 各通道推荐的官方轮询间隔与最大重试次数（官方未声明，本工程自定）。
- 国际站（`api.minimax.io`）：**本轮全站检索未在官方文档中找到 `https://api.minimax.io/v1` 这一 API Base URL**（llms.txt 索引内所有 endpoint 页 `servers[0].url` 均为 `https://api.minimaxi.com`）；其鉴权是否与国内站相同同样无从核对。
