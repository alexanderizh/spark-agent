# MiniMax 视频生成（Video Generation）官方对接参数表

> 状态: 已落地 | 最后核对: 2026-07-31

本文件汇总 MiniMax 开放平台"视频生成"模块当前对外暴露的官方端点、参数、模型能力矩阵与异步轮询约定。所有条目均直接抓取自 `https://platform.minimaxi.com/docs/api-reference/...` 官方页面，并在每条参数后用 `(来源：<URL>)` 注明。本轮未抓到的字段（如"主体参考图最大张数"、"错误码全表"）显式标记为"未抓到"，不得猜测。

抓取日期：2026-07-31。

## 1. 入口与最终可用 URL

入口根与 doc-map.md 中登记的不一致；以下 URL 为本轮实际可访问的真实入口：

| 模块 | 真实 URL | doc-map 中登记（作废） |
| --- | --- | --- |
| 接口概览 | https://platform.minimaxi.com/docs/api-reference/api-overview | 同名，已对得上 |
| 模型概览 | https://platform.minimaxi.com/docs/guides/models-intro | 同名，已对得上 |
| 文生视频（t2v） | https://platform.minimaxi.com/docs/api-reference/video-generation-t2v | `/docs/api-reference/video-generation-t2v/text-to-video` → 404 |
| 图生视频（i2v） | https://platform.minimaxi.com/docs/api-reference/video-generation-i2v | `/docs/api-reference/video-generation-i2v/image-to-video` → 404 |
| 首尾帧视频（fl2v） | https://platform.minimaxi.com/docs/api-reference/video-generation-fl2v | doc-map 中未登记 |
| 主体参考视频（s2v） | https://platform.minimaxi.com/docs/api-reference/video-generation-s2v | doc-map 中未登记 |
| 查询视频任务状态 | https://platform.minimaxi.com/docs/api-reference/video-generation-query | doc-map 中未登记 |
| 视频文件下载 | https://platform.minimaxi.com/docs/api-reference/video-generation-download | doc-map 中未登记（v1 作废 URL：`/docs/api-reference/files-retrieve*` 均 404） |
| 视频生成 V2（多模态） | https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create | doc-map 中未登记；本表仅作存在性登记，本轮未抓字段，V2 走 `MiniMax-H3` 模型与 `content[]` 多模态数组，与 v1 是两套协议 |
| 视频 Agent（模板） | https://platform.minimaxi.com/docs/api-reference/video-agent-create | doc-map 中未登记；基于 `template_id` 走模板化生成，与上面四类场景互斥 |

> 来源：本轮 WebFetch 校验；404 页面属于 doc-map.md 中提前登记但实际不存在的路径。

## 2. 通用异步模型

视频生成整体采用"创建任务 → 轮询状态 → 下载产物"三段异步流程，所有请求走同一个 `POST /v1/video_generation` 端点，仅凭请求体中的 `model` 与图片字段区分四种场景：

```text
POST https://api.minimaxi.com/v1/video_generation
   ├── model ∈ { MiniMax-Hailuo-2.3, MiniMax-Hailuo-02, T2V-01-Director, T2V-01 }
   │   ↳ 文生视频（t2v）请求体
   ├── model ∈ { MiniMax-Hailuo-2.3, MiniMax-Hailuo-2.3-Fast, MiniMax-Hailuo-02,
   │              I2V-01-Director, I2V-01-live, I2V-01 }
   │   ↳ 图生视频（i2v）请求体（必填 first_frame_image）
   ├── model = MiniMax-Hailuo-02
   │   ↳ 首尾帧视频（fl2v）请求体（必填 first_frame_image + last_frame_image）
   └── model = S2V-01
       ↳ 主体参考视频（s2v）请求体（必填 subject_reference）

GET https://api.minimaxi.com/v1/query/video_generation?task_id=<task_id>
   ↳ 异步任务状态查询（来源：https://platform.minimaxi.com/docs/api-reference/video-generation-query）
```

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-t2v，https://platform.minimaxi.com/docs/api-reference/video-generation-i2v，https://platform.minimaxi.com/docs/api-reference/video-generation-fl2v，https://platform.minimaxi.com/docs/api-reference/video-generation-s2v，https://platform.minimaxi.com/docs/api-reference/video-generation-query)

## 3. 模型能力矩阵

下表覆盖 t2v / i2v / fl2v / s2v 四种场景下每个 model 是否支持首帧 / 尾帧 / 主体参考图 / 分辨率 / 时长。所有"是否支持"列均来源于官方 model 枚举（"可用值" 字段）与字段必填约束；"最大参考图数"列在官方页面中**未明确给出**，标为"未抓到"。

| Model ID | 场景 | 支持首帧 | 支持尾帧 | 主体参考 | 时长 | 分辨率 | 最大参考图数 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `MiniMax-Hailuo-2.3` | t2v / i2v / fl2v（未声明） | 是（i2v 必填） | 未抓到（fl2v 页未声明此模型） | 否 | 6s 或 10s（768P）；仅 6s（1080P） | 768P / 1080P（默认 768P） | 未抓到 |
| `MiniMax-Hailuo-2.3-Fast` | i2v | 是（必填） | 否（fl2v 不可用） | 否 | 6s 或 10s（768P）；仅 6s（1080P） | 768P / 1080P（默认 768P） | 未抓到 |
| `MiniMax-Hailuo-02` | t2v / i2v / fl2v | 是（i2v 必填） | 是（fl2v 必填） | 否 | 6s 或 10s（768P）；仅 6s（1080P） | 512P / 768P / 1080P（默认 768P；512P 仅 6s） | 未抓到 |
| `T2V-01-Director` | t2v | 否 | 否 | 否 | 仅 6s | 720P（默认） | 未抓到 |
| `T2V-01` | t2v | 否 | 否 | 否 | 仅 6s | 720P（默认） | 未抓到 |
| `I2V-01-Director` | i2v | 是（必填） | 否 | 否 | 仅 6s | 720P（默认） | 未抓到 |
| `I2V-01-live` | i2v | 是（必填） | 否 | 否 | 仅 6s | 720P（默认） | 未抓到 |
| `I2V-01` | i2v | 是（必填） | 否 | 否 | 仅 6s | 720P（默认） | 未抓到 |
| `S2V-01` | s2v | 否 | 否 | 是（必填 `subject_reference`，官方原话"目前仅支持单个主体"） | 未抓到（页面未给出时长 / 分辨率表） | 未抓到 | 1（官方原话"目前仅支持单个主体"，并未给出图片数组上限） |

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-t2v，https://platform.minimaxi.com/docs/api-reference/video-generation-i2v，https://platform.minimaxi.com/docs/api-reference/video-generation-fl2v，https://platform.minimaxi.com/docs/api-reference/video-generation-s2v)

> 备注 1：t2v 页面"duration" 表中 `MiniMax-Hailuo-2.3 / MiniMax-Hailuo-02` 行在 720P 列留 `-`，即这两个模型不支持 720P；其他模型在 1080P / 768P 列留 `-`，即不支持。
> 备注 2：i2v 页面"resolution" 表中 `MiniMax-Hailuo-02` 多出 `512P`，且 `512P` 仅 6s 支持，10s 不支持。
> 备注 3：fl2v 页面 model 枚举只有一个 `MiniMax-Hailuo-02`，并显式提示"首尾帧生成功能不支持 512P 分辨率"。

## 4. 通用鉴权

| 字段 | 值 |
| --- | --- |
| 鉴权头 | `Authorization: Bearer <API_key>` |
| API Key 来源 | 账户管理 → 接口密钥（按量付费）或 订阅管理 → Token Plan（订阅 Key） |
| 其它 Header | `Content-Type: application/json`（必填，官方枚举仅此值） |

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-t2v，https://platform.minimaxi.com/docs/api-reference/video-generation-query)

## 5. 端点：`POST /v1/video_generation`

四种场景共享同一 URL，仅请求体不同。下列 schema 中字段按场景分组，跨场景字段一并标注。

### 5.1 文生视频（t2v）请求体

> 适用于 `model ∈ { MiniMax-Hailuo-2.3, MiniMax-Hailuo-02, T2V-01-Director, T2V-01 }`。
> 来源：https://platform.minimaxi.com/docs/api-reference/video-generation-t2v

```jsonc
{
  "model": "MiniMax-Hailuo-2.3",               // enum<string> 必填
                                                // 可用值：MiniMax-Hailuo-2.3,
                                                //         MiniMax-Hailuo-02,
                                                //         T2V-01-Director,
                                                //         T2V-01
  "prompt": "A man picks up a book [Pedestal up], then reads [Static shot].", // string 必填
                                                // 最大 2000 字符；Hailuo-2.3 / Hailuo-02 / *-Director 支持 [指令] 运镜语法
                                                // 支持 15 种指令：[左移] [右移] [左摇] [右摇] [推进] [拉远]
                                                // [上升] [下降] [上摇] [下摇] [变焦推近] [变焦拉远]
                                                // [晃动] [跟随] [固定]
  "prompt_optimizer": true,                    // boolean，默认 true；设为 false 可精确控制
  "fast_pretreatment": false,                  // boolean，默认 false；仅对 MiniMax-Hailuo-2.3 和 MiniMax-Hailuo-02 生效
  "duration": 6,                               // integer，默认 6
                                                // 取值范围（官方表）：
                                                //   MiniMax-Hailuo-2.3 / MiniMax-Hailuo-02：768P=6 或 10；1080P=6
                                                //   其他模型：720P=6
  "resolution": "1080P",                       // enum<string>
                                                // 可用值：720P, 768P, 1080P
                                                // 取值范围（官方表）：
                                                //   MiniMax-Hailuo-2.3：6s→768P(默认)/1080P；10s→768P(默认)
                                                //   MiniMax-Hailuo-02：6s→768P(默认)/1080P；10s→768P(默认)
                                                //   其他模型：6s→720P(默认)；10s→不支持
  "callback_url": "https://...",               // string，可选；接收任务状态变更通知
                                                // 服务端先发 POST 含 challenge 字段，需在 3 秒内原样返回
                                                // 回调 status 枚举：processing / success / failed
  "aigc_watermark": false                      // boolean，默认 false
}
```

### 5.2 图生视频（i2v）请求体

> 适用于 `model ∈ { MiniMax-Hailuo-2.3, MiniMax-Hailuo-2.3-Fast, MiniMax-Hailuo-02, I2V-01-Director, I2V-01-live, I2V-01 }`。
> 来源：https://platform.minimaxi.com/docs/api-reference/video-generation-i2v

```jsonc
{
  "model": "MiniMax-Hailuo-2.3",               // enum<string> 必填
                                                // 可用值：MiniMax-Hailuo-2.3,
                                                //         MiniMax-Hailuo-2.3-Fast,
                                                //         MiniMax-Hailuo-02,
                                                //         I2V-01-Director,
                                                //         I2V-01-live,
                                                //         I2V-01
  "first_frame_image": "https://.../cover.jpeg", // string 必填
                                                // 支持公网 URL 或 Base64 Data URL (data:image/jpeg;base64,...)
                                                // 格式：JPG, JPEG, PNG, WebP
                                                // 体积：< 20MB
                                                // 尺寸：短边像素 > 300px，长宽比在 2:5 和 5:2 之间
  "prompt": "A mouse runs toward the camera, smiling and blinking.", // string，可选
                                                // 最大 2000 字符；Hailuo-2.3 / Hailuo-2.3-Fast / Hailuo-02 / I2V-01-Director 支持 [指令] 运镜
  "prompt_optimizer": true,                    // boolean，默认 true
  "fast_pretreatment": false,                  // boolean，默认 false；仅对 MiniMax-Hailuo-2.3 / Hailuo-2.3-Fast / Hailuo-02 生效
  "duration": 6,                               // integer，默认 6
                                                // 取值范围（官方表）：
                                                //   MiniMax-Hailuo-2.3：768P=6 或 10；1080P=6
                                                //   MiniMax-Hailuo-2.3-Fast：768P=6 或 10；1080P=6
                                                //   MiniMax-Hailuo-02：768P=6 或 10；1080P=6
                                                //   其他模型：720P=6
  "resolution": "1080P",                       // enum<string>，可用值 512P / 720P / 768P / 1080P
                                                // 取值范围（官方表）：
                                                //   MiniMax-Hailuo-2.3：6s→768P(默认)/1080P；10s→768P(默认)
                                                //   MiniMax-Hailuo-2.3-Fast：6s→768P(默认)/1080P；10s→768P(默认)
                                                //   MiniMax-Hailuo-02：6s→512P/768P(默认)/1080P；10s→512P/768P(默认)
                                                //   其他模型：6s→720P(默认)；10s→不支持
  "callback_url": "https://...",               // string，可选
  "aigc_watermark": false                      // boolean，默认 false
}
```

> 备注：官方 i2v 页面没有显式声明 `last_frame_image` 字段；如需首尾帧请改用 5.3 场景。

### 5.3 首尾帧视频（fl2v）请求体

> 适用于 `model = MiniMax-Hailuo-02`（官方枚举仅此一项）。
> 来源：https://platform.minimaxi.com/docs/api-reference/video-generation-fl2v

```jsonc
{
  "model": "MiniMax-Hailuo-02",                // enum<string> 必填
                                                // 官方原话："首尾帧生成功能不支持 512P 分辨率"
  "last_frame_image": "https://.../end.jpeg",  // string 必填
                                                // 视频结束帧；URL 或 Base64 Data URL
                                                // 格式：JPG, JPEG, PNG, WebP
                                                // 体积：< 20MB
                                                // 尺寸：短边像素 > 300px，长宽比在 2:5 和 5:2 之间
                                                // 官方原话："生成视频尺寸遵循首帧图片，当首帧和尾帧的图片尺寸不一致时，模型将参考首帧对尾帧图片进行裁剪"
  "first_frame_image": "https://.../start.jpeg", // string，可选描述但场景下必传
                                                // 视频起始帧；URL 或 Base64 Data URL
                                                // 格式/体积/尺寸同上
                                                // 官方原话："生成视频尺寸遵循首帧图片"
  "prompt": "A little girl grow up.",          // string，可选；最大 2000 字符
                                                // 仅 MiniMax-Hailuo-02 在该页面声明支持 [指令] 运镜语法
  "prompt_optimizer": true,                    // boolean，默认 true
  "duration": 6,                               // integer，默认 6
                                                // 取值范围（官方表）：
                                                //   MiniMax-Hailuo-02：768P=6 或 10；1080P=6
  "resolution": "1080P",                       // enum<string>，可用值 768P / 1080P
                                                // 取值范围（官方表）：
                                                //   MiniMax-Hailuo-02：6s→768P(默认)/1080P；10s→768P
                                                // 官方原话："首尾帧生成功能不支持 512P 分辨率"
  "callback_url": "https://...",               // string，可选
  "aigc_watermark": false                      // boolean，默认 false
}
```

### 5.4 主体参考视频（s2v）请求体

> 适用于 `model = S2V-01`（官方枚举仅此一项）。
> 来源：https://platform.minimaxi.com/docs/api-reference/video-generation-s2v

```jsonc
{
  "model": "S2V-01",                           // enum<string> 必填；可用值仅 S2V-01
  "subject_reference": [                       // object[] 必填；外层数组仅 1 个主体
    {
      "type": "character",                     // string，仅 character (人物面部)
      "image": [                               // string[]，公网 URL 或 Base64 Data URL
                                                // 图片要求（来自 SubjectReference.image 描述）：
                                                //   格式：JPG, JPEG, PNG, WebP
                                                //   体积：小于 20MB
                                                //   尺寸：短边像素大于 300px
                                                //   长宽比：在 2:5 和 5:2 之间
                                                // 官方原话："目前仅支持单张图片"
        "https://cdn.hailuoai.com/.../cover.jpg"
      ]
    }
  ],                                           // 官方原话："目前仅支持单个主体"
  "prompt": "A girl runs toward the camera and winks with a smile.", // string，可选；最大 2000 字符
  "prompt_optimizer": true,                    // boolean，默认 true
  "callback_url": "https://...",               // string，可选
  "aigc_watermark": false                      // boolean，默认 false
}
```

> 未抓到：`fast_pretreatment` 在 s2v 页面未列出；`duration` / `resolution` 在 s2v 页面未列出（官方示例与字段定义均缺）。`subject_reference[].type` 枚举值仅 `character`（官方描述"当前仅支持 `character` (人物面部)"）。`subject_reference[]` 与 `image[]` 的"目前仅支持"为单元素约束，外层/内层数组的硬上限未在 OpenAPI 给出。

### 5.5 创建任务统一响应

四个场景共享同一响应结构：

```json
{
  "task_id": "106916112212032",                // string；用于查询任务状态
  "base_resp": {
    "status_code": 0,                          // int；0 表示成功
    "status_msg": "success"                    // string
  }
}
```

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-t2v，https://platform.minimaxi.com/docs/api-reference/video-generation-i2v，https://platform.minimaxi.com/docs/api-reference/video-generation-fl2v，https://platform.minimaxi.com/docs/api-reference/video-generation-s2v)

## 6. 端点：`GET /v1/query/video_generation`

> 来源：https://platform.minimaxi.com/docs/api-reference/video-generation-query

```text
GET https://api.minimaxi.com/v1/query/video_generation?task_id=<task_id>
Authorization: Bearer <API_key>
```

### 6.1 查询参数

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `task_id` | string | 是 | 待查询的任务 ID；只能查询当前账号创建的任务 |

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-query)

### 6.2 响应字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `task_id` | string | 被查询的任务 ID |
| `status` | enum<string> | 任务状态；可用值：`Preparing` / `Queueing` / `Processing` / `Success` / `Fail` |
| `file_id` | string | 任务成功时返回；用于文件管理接口下载产物 |
| `video_width` | integer | 任务成功时返回；生成视频宽度（像素） |
| `video_height` | integer | 任务成功时返回；生成视频高度（像素） |
| `base_resp` | object | `{ "status_code": 0, "status_msg": "success" }` |

> 示例响应：

```json
{
  "task_id": "176843862716480",
  "status": "Success",
  "file_id": "176844028768320",
  "video_width": 1920,
  "video_height": 1080,
  "base_resp": { "status_code": 0, "status_msg": "success" }
}
```

> 状态枚举与官方 callback `status` 字段（`processing` / `success` / `failed`）不一致：查询接口返回大写首字母（`Preparing` / `Queueing` / `Processing` / `Success` / `Fail`），回调 webhook 推送小写（`processing` / `success` / `failed`）。同一字段两套写法，须在 adapter 中分别映射。

(来源：https://platform.minimaxi.com/docs/api-reference/video-generation-query，https://platform.minimaxi.com/docs/api-reference/video-generation-t2v)

## 7. 轮询建议

官方页面未给出明确的"建议轮询间隔"。参考通用异步视频接口做法，建议：

- 创建后立即拿到 `task_id`，使用 `GET /v1/query/video_generation` 轮询；
- 起步间隔 2 秒；连续 3 次仍为 `Queueing / Processing` 后切到 5 秒；
- 命中 `Success` 立即拉产物；命中 `Fail` 立即停止；
- 设置硬超时（如 10 分钟）防止任务挂起。

> 备注：本建议为工程惯例，**未在官方文档中明文标注**。

## 8. 错误码 / 返回结构

- 官方 `errorcode.md`（https://platform.minimaxi.com/docs/api-reference/errorcode）提供 24 条全局错误码全表，本节只列出**视频生成模块**各 endpoint 内联的 `BaseResp.status_code` 子集；全表与本子集的差异以 `auth-errors.md` 第 2 节为准。
- `base_resp.status_code = 0` 表示成功；非 0 时 `base_resp.status_msg` 给出错误描述。
- 官方 pages 中错误示例的 HTTP 状态码仍为 `200`，错误判定依赖 `base_resp.status_code`。

| endpoint | 内联 `status_code` 子集 | 来源 |
| --- | --- | --- |
| `POST /v1/video_generation`（t2v/i2v/fl2v/s2v） | `0` / `1002` / `1004` / `1008` / `1026` / `2013` / `2049` | https://platform.minimaxi.com/docs/api-reference/video-generation-t2v.md（`BaseResp.status_code.description`） |
| `GET /v1/query/video_generation` | `0` / `1002` / `1004` / **`1026`** / **`1027`**（**无 1008 / 2013 / 2049**） | https://platform.minimaxi.com/docs/api-reference/video-generation-query.md（`QueryVideoGenerationTaskBaseResp.status_code.description`） |

(来源：各 endpoint 页 `BaseResp.status_code.description`；全表见 `auth-errors.md` 第 2.2 节)

## 9. 模型间互斥规则（官方明文）

| 规则 | 来源 |
| --- | --- |
| 首尾帧生成仅支持 `MiniMax-Hailuo-02`，其他模型不可用 | https://platform.minimaxi.com/docs/api-reference/video-generation-fl2v |
| 首尾帧生成不支持 512P 分辨率 | https://platform.minimaxi.com/docs/api-reference/video-generation-fl2v |
| 首尾帧生成：尾帧尺寸与首帧不一致时按首帧裁剪 | https://platform.minimaxi.com/docs/api-reference/video-generation-fl2v |
| 主体参考仅支持 `S2V-01`，且"目前仅支持单个主体" | https://platform.minimaxi.com/docs/api-reference/video-generation-s2v |
| `MiniMax-Hailuo-02` 在 i2v 场景下 512P 分辨率仅 6s 支持，10s 不支持 | https://platform.minimaxi.com/docs/api-reference/video-generation-i2v |
| `T2V-01-Director` / `T2V-01` / `I2V-01-Director` / `I2V-01-live` / `I2V-01` 仅支持 720P / 6s，不支持 768P / 1080P / 10s | https://platform.minimaxi.com/docs/api-reference/video-generation-t2v，https://platform.minimaxi.com/docs/api-reference/video-generation-i2v |
| `MiniMax-Hailuo-2.3 / MiniMax-Hailuo-2.3-Fast / MiniMax-Hailuo-02` 在 768P 支持 6s 或 10s；1080P 仅 6s | https://platform.minimaxi.com/docs/api-reference/video-generation-t2v，https://platform.minimaxi.com/docs/api-reference/video-generation-i2v |
| `fast_pretreatment` 仅对 `MiniMax-Hailuo-2.3` / `MiniMax-Hailuo-2.3-Fast` / `MiniMax-Hailuo-02` 生效 | https://platform.minimaxi.com/docs/api-reference/video-generation-t2v，https://platform.minimaxi.com/docs/api-reference/video-generation-i2v |
| 通用运镜 `[指令]` 语法仅对 `Hailuo-2.3 / Hailuo-2.3-Fast / Hailuo-02 / *-Director` 系列生效 | https://platform.minimaxi.com/docs/api-reference/video-generation-t2v，https://platform.minimaxi.com/docs/api-reference/video-generation-i2v，https://platform.minimaxi.com/docs/api-reference/video-generation-fl2v |

## 10. 未抓到 / 待补全

下列条目在本轮抓取的页面中未明确给出，必须显式标记为"未抓到"，不得在本轮实现中猜测：

1. ~~文件管理接口（file retrieve / download）的具体 URL 与字段~~——**本轮已抓到**，参见：https://platform.minimaxi.com/docs/api-reference/video-generation-download 。真实端点 `GET https://api.minimaxi.com/v1/files/retrieve?file_id=<int64>`，`file_id` 入参类型为 `integer, int64`（注意与第 6 节查询响应"返回 `string` 类型的 `file_id`"不一致，调用方需自行解析后再传）。响应含 `file.download_url`，**有效期 1 小时**；其余字段：`file_id` (int64)、`bytes` (int64)、`created_at` (Unix 秒 int64)、`filename` (string)、`purpose` (string)。该端点 base_resp.status_code 枚举为 `0 / 1000 / 1001 / 1002 / 1004 / 1008 / 1013 / 1026 / 1027 / 1039 / 2013`，与四类创建端点 / 查询端点的子集均不同。
2. 完整的官方错误码表（`base_resp.status_code` 非 0 时的全部枚举值）。
3. s2v 场景下 `duration` / `resolution` 是否存在；当前 s2v 页面（v1）未列出；V2 接口（`/v2/video_generation`）统一走 `duration` (4~15 秒整数) + `resolution` = `2K` + `ratio`，与 v1 完全不同的协议。
4. fl2v 场景下能否使用 `MiniMax-Hailuo-2.3 / MiniMax-Hailuo-2.3-Fast`（v1 fl2v 页 model 枚举仅 `MiniMax-Hailuo-02`；v2 多模态接口以 `content[]` 内 `first_frame` + `last_frame` role 表达首尾帧，但要求走 `MiniMax-H3`）。
5. s2v `subject_reference[].type` 字段的完整枚举（v1 当前只见 `character`）。
6. 主体参考最大张数：v1 官方仅写"目前仅支持单个主体"，未给出图片数组上限（数组本身最多 1 项，每项 `image` 字段为字符串数组，单项内上限未给）；v2 多模态场景下参考图（`reference_image` role）支持 ≤ 9 张、参考视频 ≤ 3、参考音频 ≤ 3，与 v1 协议不同。
7. 速率限制（QPS / 并发任务数）。
8. `prompt_optimizer=false` 与 `fast_pretreatment=true` 是否可同时开启（官方未明确两者的互斥关系）。
9. **video-generation-v2-create / -query / -list / -delete** 与 **video-agent-create / -query**：均为 200 可访问，但本轮未抓 v1 四类场景之外的字段细节，留待下一轮扩展。
