# MiniMax 图像生成（图生图 / 风格）官方对接信息

> 状态: 已落地 | 最后核对: 2026-07-31

本文件记录 MiniMax（minimaxi）开放平台"图像生成（Image Generation）"模块下**图生图（image-to-image）**接口的官方对接信息，特别是 `subject_reference` 人物主体参考与 `style` 画风设置两个文生图基线之外的字段。所有字段、枚举与限制均按 `https://platform.minimaxi.com/docs/api-reference/image-generation-i2i` 与配套 OpenAPI spec `https://platform.minimaxi.com/docs/api-reference/image/generation/api/image-to-image.json` 原文记录。

> **重要：图生图与文生图共用同一个 endpoint**（`POST https://api.minimaxi.com/v1/image_generation`），差异完全在请求体：图生图必传 `subject_reference`，其余字段（`prompt`、`aspect_ratio`、`width`、`height`、`response_format`、`seed`、`n`、`prompt_optimizer`、`aigc_watermark`、`style`）均与文生图 endpoint 一致。基础字段表请优先查阅 `image-models.md`，本文件只补充 `subject_reference` / `style` / 模块级行为差异。

## 0. 入口与官方文档基线

| 用途 | URL | 抓取日期 | 备注 |
| --- | --- | --- | --- |
| 总览根 | https://platform.minimaxi.com/docs/api-reference/api-overview | 2026-07-31 | 图像生成（Image Generation）段：列出文生图 / 图生图两个子项 |
| 模型家族 | https://platform.minimaxi.com/docs/guides/models-intro | 2026-07-31 | 图片模型家族：`image-01`、`image-01-live`（原文：image-01 "画面表现细腻，支持文生图、图生图"；image-01-live "手绘、卡通等画风增强，支持文生图并进行画风设置"） |
| 模块指南 | https://platform.minimaxi.com/docs/guides/image-generation | 2026-07-31 | "结合参考图生成图片"段 Python 样例 |
| 图生图接口文档 | https://platform.minimaxi.com/docs/api-reference/image-generation-i2i | 2026-07-31 | 本文件主要内容来源 |
| 图生图 OpenAPI JSON | https://platform.minimaxi.com/docs/api-reference/image/generation/api/image-to-image.json | 2026-07-31 | schema 字段定义（`ImageGenerationReq` / `ImageGenerationResp` / `ImageSubjectReference` / `StyleObject` / `DataObject` / `BaseResp`） |
| 错误码汇总 | https://platform.minimaxi.com/docs/api-reference/errorcode | 2026-07-31 | `base_resp.status_code` 含义 |
| 速率限制 | https://platform.minimaxi.com/docs/guides/rate-limits | 2026-07-31 | 图片接口 RPM/TPM 配额 |
| 文生图基线 | `../minimax/image-models.md` | 2026-07-31 | 公共字段（`model`/`prompt`/`aspect_ratio`/`width`/`height`/`response_format`/`seed`/`n`/`prompt_optimizer`/`aigc_watermark`）一览 |

## 1. model id 与 endpoint 对应关系

| Model ID | 是否支持图生图（subject_reference） | 端点 URL | HTTP 方法 | 来源 |
| --- | --- | --- | --- | --- |
| `image-01` | 是（接口总览写"支持文生图、图生图（人物主体参考）"） | `https://api.minimaxi.com/v1/image_generation` | `POST` | 来源：https://platform.minimaxi.com/docs/api-reference/api-overview — `image-01` 简介；endpoint 见 https://platform.minimaxi.com/docs/api-reference/image-generation-i2i |
| `image-01-live` | 端点未排除（OpenAPI 未禁用），但 `image-01-live` 官方描述仅强调"画风设置"，`subject_reference` 当前文档未给出与 `image-01-live` 的互斥关系 → 标注"未在文档中列出"。 | `https://api.minimaxi.com/v1/image_generation` | `POST` | 来源：同上 endpoint；image-01-live 画风设置见 https://platform.minimaxi.com/docs/api-reference/api-overview |

> **官方明确不支持的项**
> - `subject_reference.type` **当前枚举仅支持 `character`（人像）**（来源：OpenAPI `ImageSubjectReference.type` 描述："主体类型，当前仅支持 `character` (人像)"）。
> - 模块指南描述 "当前每次请求仅支持传入一张参考图"（来源：https://platform.minimaxi.com/docs/guides/image-generation 中 "结合参考图生成图片" 段首段）。即虽然 `subject_reference` 是数组类型，但官方当前只声明单张参考图可用，多张行为未在文档中列出。

## 2. 鉴权

| Header | 必填 | 取值 | 来源 |
| --- | --- | --- | --- |
| `Authorization` | 是 | `Bearer <API_key>`（HTTP Bearer，Security Scheme Type `http`, Scheme `bearer`, `bearerFormat: JWT`） | 来源：https://platform.minimaxi.com/docs/api-reference/image-generation-i2i `授权` 段；OpenAPI `securitySchemes.bearerAuth` |
| `Content-Type` | 是 | `application/json`（枚举仅含 `application/json`） | 来源：同上 `请求头` 段；OpenAPI `parameters` |

## 3. 增量字段表（图生图相较文生图）

> 基础字段（`model`、`prompt`、`aspect_ratio`、`width`、`height`、`response_format`、`seed`、`n`、`prompt_optimizer`、`aigc_watermark`、`style`）字段定义与默认值均与文生图 endpoint 一致，详见 `image-models.md` 第 3 节。下表仅列出图生图 endpoint 独有 / 文生图 endpoint 不存在的字段。

### 3.1 `subject_reference`（`ImageSubjectReference[]`）

| 子字段 | 类型 | 必填 | 取值 | 说明 | 来源 |
| --- | --- | --- | --- | --- | --- |
| `type` | `string` | **必填** | 仅 `character`（人像） | 主体类型（OpenAPI 标注"当前仅支持 `character` (人像)"） | 来源：https://platform.minimaxi.com/docs/api-reference/image/generation/api/image-to-image.json `ImageSubjectReference.type` |
| `image_file` | `string` | **必填** | 公网 URL 或 Base64 Data URL（`data:image/jpeg;base64,...`） | 参考图文件。官方要求："为获得最佳效果，请上传单人正面照片"。图片要求：JPG / JPEG / PNG；大小 < 10MB | 来源：同上 `ImageSubjectReference.image_file` |

补充规则（来源：https://platform.minimaxi.com/docs/guides/image-generation "结合参考图生成图片" 段原文）：

- "此功能允许提供一张包含清晰主体的参考图（支持网络图片链接），并结合 prompt 描述，生成一张保留了主体特征的新图片"。
- "当前每次请求仅支持传入一张参考图"。
- 适用范围："尤其适用于需要保持人物形象一致性的场景，例如为同一个虚拟角色生成不同情境下的图片"。

### 3.2 `style`（`StyleObject`，仅当 `model=image-01-live` 生效）

> `style` 字段虽然也出现在文生图 endpoint，但仅在 `image-01-live` 模型下生效，且图生图 endpoint 同样保留该字段。这里重新贴一份，避免读者在两文件间交叉查找。

| 子字段 | 类型 | 必填 | 取值 | 说明 | 来源 |
| --- | --- | --- | --- | --- | --- |
| `style_type` | `string` | **必填** | 枚举：`漫画`, `元气`, `中世纪`, `水彩` | 画风风格类型 | 来源：https://platform.minimaxi.com/docs/api-reference/image/generation/api/image-to-image.json `StyleObject.style_type` |
| `style_weight` | `number` (`float`) | 否 | 取值范围 `(0, 1]`，默认 `0.8` | 画风权重 | 来源：同上 `StyleObject.style_weight` |

## 4. 响应体字段表（`ImageGenerationResp`）

图生图与文生图 endpoint 响应字段完全一致。详见 `image-models.md` 第 4 节。OpenAPI spec 中 `ImageGenerationResp` 是同一份字段集：

- `id: string`
- `data: DataObject` → `image_urls: string[]`（响应字段为 `url` 模式时）或 `image_base64: string[]`（`base64` 模式时）
- `metadata: object` → `success_count: integer`、`failed_count: integer`（HTML 描述为"因内容安全检查失败而未返回的图片数量"）
- `base_resp: BaseResp` → `status_code: integer`、`status_msg: string`

`status_code` 文档枚举（OpenAPI 描述原文）：

- `0`：请求成功
- `1002`：触发限流，请稍后再试
- `1004`：账号鉴权失败，请检查 API-Key 是否填写正确
- `1008`：账号余额不足
- `1026`：图片描述涉及敏感内容
- `2013`：传入参数异常，请检查入参是否按要求填写
- `2049`：无效的 API Key

来源：https://platform.minimaxi.com/docs/api-reference/image/generation/api/image-to-image.json `BaseResp.status_code.description`；完整错误码汇总见 https://platform.minimaxi.com/docs/api-reference/errorcode 。

## 5. 同步 / 异步

- 该 endpoint 是 **同步请求**：HTTP 200 直接返回 `ImageGenerationResp` JSON。
- 响应体中含 `id` 字段，官方描述 "生成任务的 ID，用于后续查询任务状态"，但本页未提供独立的"查询任务状态"endpoint → 当前不在本文件范围外推（未在文档中列出）。
- `image_urls` 中 url 有效期 **24 小时**（来源：https://platform.minimaxi.com/docs/api-reference/image-generation-i2i 中 `response_format` 字段描述）。

## 6. 速率限制

图片接口（Image Generation）：免费 / 充值用户 RPM = 10，TPM = 60（来源：https://platform.minimaxi.com/docs/guides/rate-limits — 图片段）。

## 7. 官方示例（图生图）

来源：https://platform.minimaxi.com/docs/api-reference/image-generation-i2i（"试一试"段）以及 https://platform.minimaxi.com/docs/api-reference/image/generation/api/image-to-image.json `ImageGenerationReq.example`。

```json
{
  "model": "image-01",
  "prompt": "A girl looking into the distance from a library window",
  "aspect_ratio": "16:9",
  "subject_reference": [
    {
      "type": "character",
      "image_file": "https://cdn.hailuoai.com/prod/2025-08-12-17/video_cover/1754990600020238321-411603868533342214-cover.jpg"
    }
  ],
  "n": 2
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

- 流式 / SSE 输出：未在该 endpoint 中列出。
- 异步任务查询路径：未在该 endpoint 中列出（响应内提到 `id` 用于"查询任务状态"，但独立 query endpoint 路径未在文生图 / 图生图页面给出）。
- `image-01-live` 与 `subject_reference` 的可用性、是否互斥：图生图 endpoint 未将 `subject_reference` 限定到 `image-01`，但 `image-01-live` 简介只强调"画风设置"；实际行为未在文档中列出。
- `subject_reference` 数组长度上限：模块指南只声明"当前每次请求仅支持传入一张参考图"，未给出 API 层的硬上限。
- `style_type` 取值中文化的字符串传递规则：未在文档中说明字符集要求与是否区分大小写。
- 图生图与文生图 endpoint 上的图片持久化（公开托管 URL、文件 API 关联）：官方 `image-01` 简介只写 "支持文生图、图生图（人物主体参考）"，未涉及 Files API 关联。
