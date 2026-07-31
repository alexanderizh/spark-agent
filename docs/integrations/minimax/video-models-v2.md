# MiniMax 视频生成 V2（Hailuo-03 / MiniMax-H3）官方对接参数表

> 状态: 已落地 | 最后核对: 2026-07-31

本文件汇总 MiniMax 开放平台"视频生成 V2"模块（Hailuo-03 / `MiniMax-H3`）的官方端点、参数、能力矩阵与异步轮询约定。**V2 与 v1（`/v1/video_generation`）是两套完全独立的协议**：endpoint 路径、请求体形态（`content[]` 数组 vs 平铺字段）、轮询响应结构、状态枚举（V2 全小写 vs v1 首字母大写）、错误码归一方式（V2 是 OAI 风格 + 真实 HTTP 码）均不同。已有 v1 详情见 `video-models.md`，本文件只覆盖 V2。

抓取日期：2026-07-31。所有条目均直接抓取自官方页面，每条参数后用 `(来源：<URL>)` 注明。

## 1. 入口与最终可用 URL

| 模块 | 真实可访问 URL | 备注 |
| --- | --- | --- |
| 创建视频生成任务（V2） | https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create | 本文件主要来源 |
| 查询单个任务（V2） | https://platform.minimaxi.com/docs/api-reference/video-generation-v2-query | path 参数 |
| 查询任务列表（V2） | https://platform.minimaxi.com/docs/api-reference/video-generation-v2-list | 分页 + 过滤 |
| 取消 / 删除任务（V2） | https://platform.minimaxi.com/docs/api-reference/video-generation-v2-delete | 单一 endpoint，按状态自动 action |
| 视频文件下载 | https://platform.minimaxi.com/docs/api-reference/video-generation-download | 实际是 `GET /v1/files/retrieve?file_id=`（与 v1 共享 Files API） |
| V2 完整 OpenAPI | https://platform.minimaxi.com/docs/api-reference/video/generation/api/v2-video-generation.json | 一份 spec 含上述 4 endpoint |
| V2 指南 | https://platform.minimaxi.com/docs/guides/video-generation | 概念说明 |
| V2 Prompt 技巧 | https://platform.minimaxi.com/docs/guides/video-prompt | prompt 编写建议 |

(来源：https://platform.minimaxi.com/docs/llms.txt；上述 `.md` 路径均实测 HTTP 200)

## 2. 模型支持

V2 当前**仅支持 `MiniMax-H3` 一个模型**。

| Model ID | 状态 | 来源 |
| --- | --- | --- |
| `MiniMax-H3` | 主推 | https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create 中 `VideoGenerationV2Req.model.enum` |

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create)

> 备注：原 doc-map 登记的 H3 描述 "2K 分辨率、5–15s 时长" 与官方实际 `duration` 范围 `[4, 15]`、`resolution` 仅 `2K` 一致，但 `duration` 下界官方明确为 `4`（不是 `5`），下界 `5` 是 doc-map 描述不精确；以本表 §4.2 为准。

## 3. 通用鉴权与请求头

| Header | 必填 | 取值 | 来源 |
| --- | --- | --- | --- |
| `Authorization` | 是 | `Bearer <API_key>`（`securitySchemes.bearerAuth`） | https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create |
| `Content-Type` | 是 | `application/json`（官方 enum 仅此值） | 同上 `parameters[0]` |

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create)

## 4. 端点：`POST /v2/video_generation`

### 4.1 请求体顶层字段

| 字段 | 类型 | 必填 | 取值 / 范围 | 来源 |
| --- | --- | --- | --- | --- |
| `model` | enum<string> | 是 | 仅 `MiniMax-H3` | `VideoGenerationV2Req.model.enum` |
| `content` | `ContentItem[]` | 是 | **多模态输入数组**；每个元素 `type` ∈ `text` / `image_url` / `video_url` / `audio_url`；通过 `role` 标注用途。**每次请求必须包含至少一个非空 `text` 项**。 | `VideoGenerationV2Req.content` |
| `resolution` | enum<string> | 是 | 仅 `2K`（V2 当前只支持 2K） | `VideoGenerationV2Req.resolution.enum` |
| `duration` | enum<integer> | 是 | `[4, 15]` 整数（4/5/6/7/8/9/10/11/12/13/14/15） | `VideoGenerationV2Req.duration.enum` |
| `ratio` | enum<string> | 否 | `adaptive` / `21:9` / `16:9` / `4:3` / `1:1` / `3:4` / `9:16`；不同场景下必填与可用值不同（见 §4.3） | `VideoGenerationV2Req.ratio.enum` |
| `callback_url` | string | 否 | 任务状态变更回调地址；先发 `challenge` 验证（3 秒内原样返回） | `VideoGenerationV2Req.callback_url` |
| `aigc_watermark` | boolean | 否 | 默认 `false` | `VideoGenerationV2Req.aigc_watermark` |

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create)

### 4.2 `ContentItem` 字段

| 字段 | 类型 | 必填 | 取值 | 说明 |
| --- | --- | --- | --- | --- |
| `type` | enum<string> | 是 | `text` / `image_url` / `video_url` / `audio_url` | 元素类型 |
| `text` | string | 当 `type=text` 时必填 | 最大 **7000 字符**（官方描述："单个 `text` 最多 7000 个字符"，与 v1 视频 2000 字符上限不同） | 文本 prompt |
| `image_url` | object `{url: string}` | 当 `type=image_url` 时必填 | URL 形式三种：公网 URL / `mm_file://{file_id}` / `data:image/<格式>;base64,...`（`<格式>` 小写） | 图片对象 |
| `video_url` | object `{url: string}` | 当 `type=video_url` 时必填 | URL 形式三种：公网 URL / `mm_file://{file_id}` / `data:video/mp4;base64,...` | 视频对象（仅多模态参考） |
| `audio_url` | object `{url: string}` | 当 `type=audio_url` 时必填 | URL 形式三种：公网 URL / `mm_file://{file_id}` / `data:audio/<格式>;base64,...` | 音频对象（仅多模态参考） |
| `role` | enum<string> | 条件必填 | `first_frame` / `last_frame` / `reference_image` / `reference_video` / `reference_audio` | 用途标注 |

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create `ContentItem`)

### 4.3 场景（content 元素组合）与 `ratio` 规则

| 场景 | content 形态 | `role` 规则 | `ratio` |
| --- | --- | --- | --- |
| **t2v（文生视频）** | 仅一个 `type=text` 元素 | — | **必填且不能为 `adaptive`**；可用 `21:9` / `16:9` / `4:3` / `1:1` / `3:4` / `9:16` |
| **i2v-首帧（图生视频）** | `text` + 1 张 `image_url`（`role=first_frame` 或不填） | `first_frame`；单图不填 role 时默认按 first_frame | 由输入图片决定；传 `adaptive` 即可，传具体值会被忽略按 adaptive 处理 |
| **i2v-尾帧（图生视频）** | `text` + 1 张 `image_url`（`role=last_frame`） | `last_frame` | 同上 |
| **i2v-首尾帧** | `text` + 2 张 `image_url`（`role` 分别为 `first_frame`、`last_frame`） | 两个 role 成对 | 同上 |
| **r2v（多模态参考生视频）** | `text` + `reference_image` + `reference_video` + `reference_audio` 的任意子集 | `reference_*` 系列；**不可仅输入音频，须至少包含 1 个参考视频或图片** | 默认 `adaptive`；可显式指定上述任一具体比例 |

> **关键互斥规则**（官方原话）：`content` 中出现 `reference_image` / `reference_video` / `reference_audio` 任一 role，**就不能再出现** `first_frame` / `last_frame`（反之亦然）。i2v 与 r2v 互斥。

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create `VideoGenerationV2Req.content.description`)

### 4.4 输入媒体限制（按 type）

| 媒体 | 格式 | 单文件大小 | 宽高 | 数量 | 单段时长 | 帧率 |
| --- | --- | --- | --- | --- | --- | --- |
| 图片 `image_url` | JPG / JPEG / PNG / WEBP / HEIC / HEIF | ≤ 30 MB | [256, 5760] px，长宽比 [0.4, 2.5] | 首帧 ≤ 1 / 尾帧 ≤ 1 / 参考图 ≤ 9 | — | — |
| 视频 `video_url`（仅 r2v） | MP4 / MOV（编码 H.264/AVC、H.265/HEVC；音频 AAC、MP3） | ≤ 50 MB | [256, 5760] px，长宽比 [0.4, 2.5] | ≤ 3 | [2, 15] s；总时长 ≤ 15 s | [23.976, 60] |
| 音频 `audio_url`（仅 r2v） | WAV / MP3 | ≤ 15 MB | — | ≤ 3 | [2, 15] s；总时长 ≤ 15 s | — |

> **请求体总大小 ≤ 64 MB**（官方原话）；大文件请用公网 URL 或 `mm_file://{file_id}`，**不要用 Base64**（Base64 会放大约 33%）。

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create `VideoGenerationV2Req.content.description`)

### 4.5 响应

```json
{
  "task_id": "424010985738629"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `task_id` | string | 视频生成任务 ID；用于查询 / 取消 |

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create `VideoGenerationV2Resp`)

### 4.6 错误响应（OAI 风格，HTTP 真实状态码）

V2 的错误响应**与 v1 不同**：HTTP 状态码是真实的（401/400/429/402/422/500），不再统一 200。响应体为 `OaiError` 结构。

```json
{
  "type": "error",
  "error": {
    "type": "unprocessable_entity_error",
    "message": "video description contains sensitive content (1026)",
    "http_code": "422"
  },
  "request_id": "021785229015510a2c883cf675b9804d"
}
```

| HTTP 码 | `error.type` | 内部 code（`message` 末尾括号内） |
| --- | --- | --- |
| 400 | `bad_request_error` | 2013（invalid params） |
| 401 | `authorized_error` | 1004（login fail） |
| 402 | `insufficient_balance_error` | 1008（insufficient balance） |
| 422 | `unprocessable_entity_error` | 1026（sensitive content） |
| 429 | `rate_limit_error` | 1002（rate limit） |
| 500 | `server_error` | 1000（internal error） |
| 529 | `overloaded_error` | — |

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create `OaiError` + `responses.Err*`)

> **与 v1 的关键差异**：
> - v1 错误时 HTTP 仍 200，业务码在 `base_resp.status_code`；
> - v2 错误时 HTTP 是真实状态码（401/402/422 等），业务码在 `error.message` 末尾的括号内。
> adapter 需要按 endpoint 分别写错误归一逻辑（v1 走 `minimaxErrorContract` 的 `codePaths`，v2 走 `httpCode + message` 解析）。

## 5. 端点：`GET /v2/query/video_generation/{task_id}`

按 task_id 查询单个任务。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `task_id`（path） | string | 是 | 创建任务返回的 `task_id` |

> **仅支持查询最近 7 天内的任务**（窗口 `[T-7天, T)`，`T` 为请求发起时刻的 UTC 时间戳，秒级精度）。超出窗口返回 `invalid task_id`。

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-query)

### 5.1 响应

```json
{
  "task": {
    "id": "424010985738629",
    "model": "MiniMax-H3",
    "status": "succeeded",
    "created_at": 1785125529,
    "updated_at": 1785125946,
    "content": {
      "url": "https://video-product.cdn.minimax.io/inference_output/rollout/.../output.mp4"
    },
    "resolution": "2K",
    "duration": 5,
    "usage": {
      "total_seconds": 5,
      "input_seconds": 0,
      "output_seconds": 5,
      "image_count": 0
    },
    "ratio": "16:9",
    "task_type": "generation"
  }
}
```

### 5.2 任务对象字段（`VideoTask`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 任务 ID |
| `model` | string | 使用的模型（如 `MiniMax-H3`） |
| `status` | enum<string> | **V2 状态枚举全小写**：`queued` / `running` / `succeeded` / `failed` / `cancelled` / `expired`（与 v1 首字母大写 `Preparing/Processing/...` 不同） |
| `error` | object | 任务失败时返回；`{code: string, message: string}`（code 是字符串，不是数字） |
| `created_at` | integer (Unix 秒) | 任务创建时间 |
| `updated_at` | integer (Unix 秒) | 任务状态更新时间 |
| `content` | object | 任务成功后返回 `{url: string}`；下载链接有时效，需及时下载或转存 |
| `resolution` | string | 实际生成的分辨率 |
| `duration` | integer | 实际生成的时长（秒） |
| `usage` | object | `{total_seconds, input_seconds, output_seconds, image_count}` 计费用量 |
| `ratio` | string | 实际生成的宽高比 |
| `task_type` | string | 任务类型（当前为 `generation`） |
| `modality` | string | 输出模态：`video` / `audio` |

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-query `VideoTask`)

### 5.3 V2 状态映射（adapter 转换）

| V2 `status` | 内部统一 |
| --- | --- |
| `queued` | `queued` |
| `running` | `running` |
| `succeeded` | `succeeded` |
| `failed` | `failed` |
| `cancelled` | `cancelled` |
| `expired` | `failed`（与 T2A Async 一致） |

> V2 与 v1 statusMap 互不通用；V2 全小写 + 多出 `cancelled` 态；失败态 v1 用 `Fail`、V2 用 `failed`。

(来源：本节由 `VideoTask.status.enum` 归纳)

## 6. 端点：`GET /v2/query/video_generation`

分页查询最近 7 天内任务列表。

| Query 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `page_num` | integer | 否 | 页码，从 1 开始 |
| `page_size` | integer | 否 | 每页数量 |
| `filter.status` | enum<string> | 否 | `queued` / `running` / `succeeded` / `failed` / `cancelled` / `expired` |
| `filter.task_ids` | string[] | 否 | 任务 ID 数组（按 ID 过滤） |
| `filter.model` | string | 否 | 按模型过滤（如 `MiniMax-H3`） |
| `filter.task_type` | string | 否 | 按任务类型过滤 |

响应：`{items: VideoTask[], total: integer}`。

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-list)

## 7. 端点：`DELETE /v2/video_generation/{task_id}`

按状态自动执行取消或删除（**单一 endpoint**）。

| 任务当前状态 | 实际 action | 说明 |
| --- | --- | --- |
| `queued` | `cancel` | 取消任务，未开始生成，无扣费 |
| `succeeded` | `delete` | 删除任务记录 |
| `failed` | `delete` | 删除任务记录 |
| `expired` | `delete` | 删除任务记录 |
| `running` | — | 不可操作，返回错误 |
| `cancelled` | — | 不可操作，返回错误 |

响应：`{task_id, action: 'cancel' | 'delete', status}`。

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-delete)

## 8. 文件下载

V2 任务成功后响应直接含 `content.url`（HTTPS CDN 链接），**无需走 Files API**。下载 URL "有时效，请及时下载或转存；过期后重新查询获取"（来源：video-generation-v2-query `VideoTaskContent.url.description`）。具体有效期官方未给数字；按工程惯例处理为 9 小时（与视频 Agent 通道一致）。

如需 Files API 元信息（如 `bytes` / `created_at` / `purpose`），仍走 `GET /v1/files/retrieve?file_id=<int64>`（与 v1 共享）：

```json
{
  "file": {
    "file_id": 176844028768320,
    "bytes": 0,
    "created_at": 1700469398,
    "filename": "output_aigc.mp4",
    "purpose": "video_generation",
    "download_url": "www.downloadurl.com"
  },
  "base_resp": { "status_code": 0, "status_msg": "success" }
}
```

**注意 `download_url` 有效期 1 小时**（来源：`FileObject.download_url.description` 原文）。

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-download)

## 9. 速率限制

官方 `https://platform.minimaxi.com/docs/guides/rate-limits` 仅列 V1 视频生成（免费 5 RPM / 充值 20 RPM）；**V2 速率限制未单独列**。按 V2 OAI 错误响应 `429 rate_limit_error`，触发时返 `1002`（RPM）或对应内部码。

(来源：https://platform.minimaxi.com/docs/guides/rate-limits)

## 10. 官方示例（节选）

### 10.1 文生视频

```json
{
  "model": "MiniMax-H3",
  "content": [
    { "type": "text", "text": "一个男孩在海边打篮球" }
  ],
  "resolution": "2K",
  "duration": 5,
  "ratio": "16:9"
}
```

### 10.2 图生视频（首帧）

```json
{
  "model": "MiniMax-H3",
  "content": [
    { "type": "text", "text": "Pull focus to the people in the background and add more steam to the ramen bowl." },
    {
      "type": "image_url",
      "image_url": { "url": "https://cdn.hailuoai.com/.../cover.png" },
      "role": "first_frame"
    }
  ],
  "resolution": "2K",
  "duration": 5,
  "ratio": "adaptive"
}
```

### 10.3 多模态参考生视频

```json
{
  "model": "MiniMax-H3",
  "content": [
    { "type": "text", "text": "角色说话：Follow the wind, live free..." },
    {
      "type": "video_url",
      "video_url": { "url": "https://cdn.hailuoai.com/.../reference.mp4" },
      "role": "reference_video"
    },
    {
      "type": "audio_url",
      "audio_url": { "url": "https://cdn.hailuoai.com/.../reference.mp3" },
      "role": "reference_audio"
    }
  ],
  "resolution": "2K",
  "duration": 5,
  "ratio": "adaptive"
}
```

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create `examples`)

## 11. 与 v1 的对照

| 维度 | V1（Hailuo 系列） | V2（H3） |
| --- | --- | --- |
| Endpoint 创建 | `POST /v1/video_generation` | `POST /v2/video_generation` |
| Endpoint 查询 | `GET /v1/query/video_generation?task_id=` | `GET /v2/query/video_generation/{task_id}` |
| Endpoint 列表 | 无 | `GET /v2/query/video_generation` |
| Endpoint 取消/删除 | 无 | `DELETE /v2/video_generation/{task_id}` |
| 请求体形态 | 平铺字段（`prompt` / `first_frame_image` 等） | `content[]` 多模态数组 + `ratio` 统一比例 |
| 支持模型 | 9 个（Hailuo-2.3 / -Fast / -02 / T2V-01 / I2V-01 / S2V-01 等） | 1 个（H3） |
| `duration` 范围 | 6s 或 10s（720P/768P/1080P 不同） | 4–15s 整数 |
| `resolution` 范围 | 512P / 720P / 768P / 1080P（与 model 强相关） | 仅 `2K` |
| `ratio` 字段 | 无（由 `first_frame_image` 决定） | 显式 `ratio` 字段（`adaptive` / 6 种固定比例） |
| `text` 上限 | 2000 字符 | **7000 字符** |
| 状态枚举 | 首字母大写：`Preparing/Queueing/Processing/Success/Fail` | 全小写：`queued/running/succeeded/failed/cancelled/expired` |
| 错误归一 | HTTP 200 + `base_resp.status_code` | HTTP 真实状态码 + OAI `error` 结构 + message 末尾 `(code)` |
| 任务产物 | `file_id` + Files API 拉二进制 | `content.url` 直接 CDN 链接，**不需 Files** |
| 7 天保留 | 未声明 | 明确：仅支持最近 7 天内查询 |
| 视频参考 | 不支持 | 支持（`reference_video`，≤ 3 段，每段 2–15s，2–60fps） |
| 音频参考 | 不支持 | 支持（`reference_audio`，≤ 3 段） |

(来源：本表由 `video-models.md` v1 内容与本文件 V2 内容对照归纳)

## 12. 未抓到 / 待补全

下列条目在抓取页面中未明确给出，必须显式标记为"未抓到"，不得在本轮实现中猜测：

1. **V2 速率限制（RPM / TPM）** —— `rate-limits` 页面未单列。
2. **V2 错误码全表** —— V2 改用 OAI 风格 + message 末尾括号内部码；OpenAPI `responses.Err*` 仅列 6 类常见错误（`bad_request_error/authorized_error/insufficient_balance_error/unprocessable_entity_error/rate_limit_error/server_error`），其它内部码（1000/1001/1013/1027/1039 等）需通过实测补充。
3. **V2 `content.url` 下载 URL 有效期** —— 描述"有时效，请及时下载或转存"，未给具体小时数。
4. **V2 `modality` 字段实际值** —— schema 注明 `video` / `audio`，但 V2 文档未说明哪些场景会输出 audio 模态。
5. **`task_type` 实际值** —— schema 注明 string，未列枚举（仅 example 给出 `generation`）。
6. **V2 prompt 运镜 `[指令]` 语法** —— V2 文档未列出 15 种 `[指令]` 是否仍可用；以官方原文为准，本轮不假设。
