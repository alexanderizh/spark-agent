# MiniMax 图像生成（文生图）官方对接信息

> 状态: 已落地 | 最后核对: 2026-07-31

本文件记录 MiniMax（minimaxi）开放平台"图像生成（Image Generation）"模块下**文生图（text-to-image）**接口的官方对接信息，所有字段、枚举与限制均按 `https://platform.minimaxi.com/docs/api-reference/image-generation-t2i` 与配套 OpenAPI spec `https://platform.minimaxi.com/docs/api-reference/image/generation/api/text-to-image.json` 原文记录。涉及图生图（subject_reference、style）的字段在 `image-edit-models.md` 内单独说明，本文件不重复列出 `subject_reference` 字段。

## 0. 入口与官方文档基线

| 用途 | URL | 抓取日期 | 备注 |
| --- | --- | --- | --- |
| 总览根 | https://platform.minimaxi.com/docs/api-reference/api-overview | 2026-07-31 | 列示图像生成（Image Generation）模块与支持的模型 |
| 模型家族 | https://platform.minimaxi.com/docs/guides/models-intro | 2026-07-31 | 图片模型家族：`image-01`、`image-01-live` |
| 模块指南 | https://platform.minimaxi.com/docs/guides/image-generation | 2026-07-31 | 含文生图/图生图 Python 调用样例 |
| 文生图接口文档 | https://platform.minimaxi.com/docs/api-reference/image-generation-t2i | 2026-07-31 | 本文件主要内容来源 |
| 文生图 OpenAPI JSON | https://platform.minimaxi.com/docs/api-reference/image/generation/api/text-to-image.json | 2026-07-31 | schema 字段定义（`ImageGenerationReq` / `ImageGenerationResp` / `StyleObject` / `DataObject` / `BaseResp`） |
| 错误码汇总 | https://platform.minimaxi.com/docs/api-reference/errorcode | 2026-07-31 | `base_resp.status_code` 含义 |
| 速率限制 | https://platform.minimaxi.com/docs/guides/rate-limits | 2026-07-31 | 图片接口 RPM/TPM 配额 |
| 文档全量索引 | https://platform.minimaxi.com/docs/llms.txt | 2026-07-31 | 爬站时使用的入口（页面已确认可访问） |

## 1. model id 与 endpoint 对应关系

文档对图像生成接口（文生图 / 图生图）仅给出 **一个 endpoint**，通过请求体内的 `model` 与是否传 `subject_reference` 来区分能力。

| Model ID | 是否出现在官方枚举 | 端点 URL | HTTP 方法 | 来源 |
| --- | --- | --- | --- | --- |
| `image-01` | 是 | `https://api.minimaxi.com/v1/image_generation` | `POST` | 来源：https://platform.minimaxi.com/docs/api-reference/image-generation-t2i 与 https://platform.minimaxi.com/docs/api-reference/image/generation/api/text-to-image.json |
| `image-01-live` | 是 | `https://api.minimaxi.com/v1/image_generation` | `POST` | 来源：同上（`enum` 含 `image-01`, `image-01-live`） |

> **官方明确不支持的项**
>
> - `style` 仅当 `model` 为 `image-01-live` 时生效，传给 `image-01` 会被忽略（来源：https://platform.minimaxi.com/docs/api-reference/image-generation-t2i 中 "style ... 仅当 model 为 image-01-live 时生效"）。
> - 任何非 `image-01` / `image-01-live` 的 model id（如文生视频模型 `MiniMax-Hailuo-2.3`）在该 endpoint 上**未被官方枚举支持**，应直接拒绝请求。
> - 没有列出 "Stream / 流式输出" 选项，所有响应都是同步返回 JSON。

## 2. 鉴权

| Header | 必填 | 取值 | 来源 |
| --- | --- | --- | --- |
| `Authorization` | 是 | `Bearer <API_key>`（HTTP Bearer，Security Scheme Type `http`, Scheme `bearer`, `bearerFormat: JWT`） | 来源：https://platform.minimaxi.com/docs/api-reference/image-generation-t2i — `授权` 段；OpenAPI 同 |
| `Content-Type` | 是 | `application/json`（枚举仅含 `application/json`） | 来源：同上 — `请求头` 段；OpenAPI `parameters` |
| `MINIMAX_API_KEY` | — | 环境变量示例，建议服务端持有 | 来源：https://platform.minimaxi.com/docs/guides/image-generation 内 Python 示例使用 `os.environ.get("MINIMAX_API_KEY")` |

> API Key 在「账户管理 > 接口密钥」创建；按量付费与 Token Plan 订阅 Key 互相独立（来源：https://platform.minimaxi.com/docs/api-reference/api-overview — 获取 API Key 段）。

## 3. 请求体字段表（`ImageGenerationReq`，application/json）

> 所有字段定义均来自 OpenAPI spec `ImageGenerationReq`，以下表统一标注原始来源。`subject_reference` 字段写在 `image-edit-models.md`，本表不重复。

| 字段 | 类型 | 必填 | 默认值 | 取值范围 / 枚举 | 说明 | 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| `model` | `string` | **必填** | — | 枚举：`image-01`, `image-01-live` | 模型名称 | 来源：https://platform.minimaxi.com/docs/api-reference/image/generation/api/text-to-image.json `ImageGenerationReq.properties.model` |
| `prompt` | `string` | **必填** | — | 最长 1500 字符 | 图像的文本描述 | 同上 `prompt` |
| `aspect_ratio` | `string` | 否 | `1:1` | 枚举：`1:1` (1024x1024), `16:9` (1280x720), `4:3` (1152x864), `3:2` (1248x832), `2:3` (832x1248), `3:4` (864x1152), `9:16` (720x1280), `21:9` (1344x576) | 图像宽高比；**`21:9` 仅适用于 `image-01`** | 来源：同上 `aspect_ratio`；HTML 页面 https://platform.minimaxi.com/docs/api-reference/image-generation-t2i 同 |
| `width` | `integer` | 否 | — | 取值范围 [512, 2048]，且必须是 8 的倍数 | 生成图片宽度（像素）。**仅当 `model` 为 `image-01` 时生效**。`width` 与 `height` 同时设置；若与 `aspect_ratio` 同时设置则**优先使用 `aspect_ratio`** | 来源：同上 `width` 描述 |
| `height` | `integer` | 否 | — | 取值范围 [512, 2048]，且必须是 8 的倍数 | 生成图片高度（像素）。仅当 `model` 为 `image-01` 时生效，与 `width` 同约束 | 来源：同上 `height` 描述 |
| `response_format` | `string` | 否 | `url` | 枚举：`url`, `base64` | 返回图片形式；`url` 有效期为 24 小时 | 来源：同上 `response_format`；HTML 页面同 |
| `seed` | `integer` (`int64`) | 否 | — | 由算法生成 | 随机种子；相同 `seed` + 相同参数可复现相近结果；若未提供则对 `n` 张图各自生成独立随机种子 | 来源：同上 `seed` |
| `n` | `integer` | 否 | `1` | `1 <= n <= 9` | 单次请求生成的图片数量 | 来源：同上 `n`（`minimum: 1`, `maximum: 9`） |
| `prompt_optimizer` | `boolean` | 否 | `false` | — | 是否开启 prompt 自动优化 | 来源：同上 `prompt_optimizer` |
| `aigc_watermark` | `boolean` | 否 | `false` | — | 是否在生成的图片中添加水印 | 来源：同上 `aigc_watermark` |
| `style` | `object` (`StyleObject`) | 否 | — | 见下表 | 画风设置。**仅当 `model` 为 `image-01-live` 时生效** | 来源：同上 `style`；HTML 页面同 |

### 3.1 `style` 字段（`StyleObject`）

| 子字段 | 类型 | 必填 | 取值 | 说明 | 来源 |
| --- | --- | --- | --- | --- | --- |
| `style_type` | `string` | **必填** | 枚举：`漫画`, `元气`, `中世纪`, `水彩` | 画风风格类型 | 来源：https://platform.minimaxi.com/docs/api-reference/image/generation/api/text-to-image.json `StyleObject.style_type` |
| `style_weight` | `number` (`float`) | 否 | 取值范围 `(0, 1]`，默认 `0.8` | 画风权重 | 来源：同上 `StyleObject.style_weight` |

## 4. 响应体字段表（`ImageGenerationResp`，HTTP 200 / application/json）

| 字段 | 类型 | 说明 | 来源 |
| --- | --- | --- | --- |
| `id` | `string` | 生成任务的 ID，用于后续查询任务状态 | 来源：https://platform.minimaxi.com/docs/api-reference/image/generation/api/text-to-image.json `ImageGenerationResp.id` |
| `data` | `object` (`DataObject`) | 见下表 | 同上 |
| `metadata` | `object` | 见下表 | 同上 |
| `base_resp` | `object` (`BaseResp`) | 见下表 | 同上 |

### 4.1 `data`（`DataObject`）

| 子字段 | 类型 | 出现条件 | 说明 | 来源 |
| --- | --- | --- | --- | --- |
| `image_urls` | `string[]` | 仅当 `response_format=url` 时返回 | 包含图片链接的数组 | 来源：同上 `DataObject.image_urls` |
| `image_base64` | `string[]` | 仅当 `response_format=base64` 时返回 | 包含图片 Base64 编码的数组 | 来源：同上 `DataObject.image_base64` |

### 4.2 `metadata`

| 子字段 | 类型 | 说明 | 来源 |
| --- | --- | --- | --- |
| `success_count` | `integer` | 成功生成的图片数量（OpenAPI 中文描述包含"N成功生成的图片数量"，疑似中文笔误，原文如此） | 来源：https://platform.minimaxi.com/docs/api-reference/image/generation/api/text-to-image.json `ImageGenerationResp.metadata.success_count` |
| `failed_count` | `integer` (string in example) | 因内容安全检查失败而未返回的图片数量 | 来源：同上 `metadata.failed_count`；HTML `metadata.description` 文案 |

### 4.3 `base_resp`（`BaseResp`）

| 子字段 | 类型 | 说明 | 来源 |
| --- | --- | --- | --- |
| `status_code` | `integer` | 状态码；详见下方状态码表 | 来源：同上 `BaseResp.status_code` |
| `status_msg` | `string` | 具体错误详情 | 来源：同上 `BaseResp.status_msg` |

`status_code` 文档枚举（OpenAPI 描述原文）：

- `0`：请求成功
- `1002`：触发限流，请稍后再试
- `1004`：账号鉴权失败，请检查 API-Key 是否填写正确
- `1008`：账号余额不足
- `1026`：图片描述涉及敏感内容
- `2013`：传入参数异常，请检查入参是否按要求填写
- `2049`：无效的 API Key

来源：https://platform.minimaxi.com/docs/api-reference/image/generation/api/text-to-image.json `BaseResp.status_code.description`。完整错误码汇总见 https://platform.minimaxi.com/docs/api-reference/errorcode 。

## 5. 同步 / 异步

- 该 endpoint 是 **同步请求**：HTTP 200 直接返回 `ImageGenerationResp` JSON。
- 响应体中含 `id` 字段，官方描述 "生成任务的 ID，用于后续查询任务状态"，但本页未提供独立的"查询任务状态"endpoint；当前不在本文件范围外推（未在文档中列出 → 标注为"未在文档中列出"）。
- 返回的 `data.image_urls` 中 url 有效期 **24 小时**（来源：https://platform.minimaxi.com/docs/api-reference/image-generation-t2i `response_format` 字段描述）。

## 6. 速率限制

图片接口（Image Generation）：

| 账户类型 | RPM | TPM | 来源 |
| --- | --- | --- | --- |
| 免费用户 | 10 | 60 | https://platform.minimaxi.com/docs/guides/rate-limits（图片段） |
| 充值用户 | 10 | 60 | 同上 |

> 文档将免费用户与充值用户并列同表，未显示其他细分账号等级的具体限额；如需更细化数值应向 `api@minimaxi.com` 申请提额。

## 7. 官方示例（文生图）

来源：https://platform.minimaxi.com/docs/api-reference/image-generation-t2i（"试一试"段）以及 https://platform.minimaxi.com/docs/api-reference/image/generation/api/text-to-image.json `ImageGenerationReq.example`。

```json
{
  "model": "image-01",
  "prompt": "A man in a white t-shirt, full-body, standing front view, outdoors, with the Venice Beach sign in the background, Los Angeles. Fashion photography in 90s documentary style, film grain, photorealistic.",
  "aspect_ratio": "16:9",
  "response_format": "url",
  "n": 3,
  "prompt_optimizer": true
}
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": "03ff3cd0820949eb8a410056b5f21d38",
  "data": {
    "image_urls": ["XXX", "XXX", "XXX"]
  },
  "metadata": {
    "failed_count": "0",
    "success_count": "3"
  },
  "base_resp": {
    "status_code": 0,
    "status_msg": "success"
  }
}
```

> OpenAPI 示例响应与 HTML 页面示例响应一致；上文中 `XXX` 为官方文档保留占位符。

## 8. 明确未在文档中列出的项

- 流式 / SSE 输出：未在文生图 endpoint 中列出。
- 异步轮询 query endpoint：未在文生图 endpoint 中列出（响应内提到 `id` 用于"查询任务状态"，但接口路径未给出）。
- `style` 在 `image-01` 模型上的使用：明确写为"仅当 `model` 为 `image-01-live` 时生效"。
- `subject_reference`（人物主体参考）：见 `image-edit-models.md`，文生图 endpoint 中不作为可用字段，但仍使用相同 URL。
- 任何 `seed` 范围、prompt 字符上限以外的字符限制（如 emoji / Unicode）、`prompt_optimizer` 的实现细节（是否计费、是否调整模型）：未在文档中说明。
