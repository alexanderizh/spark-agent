# 多模态理解（TokenHub）

> 状态: 实施中 | 最后核对: 2026-07-22
> 来源: https://cloud.tencent.com/document/product/1823/130988

## 端点

- BaseURL：境内 `https://tokenhub.tencentmaas.com/v1`、新加坡 `https://tokenhub-intl.tencentmaas.com/v1`
- 协议：OpenAI Chat Completions (`/v1/chat/completions`)

## 支持模型

| model | 视频理解 | 图片理解 |
| --- | --- | --- |
| `youtu-vita` | 支持（画面+音频） | 支持 |
| `hy-vision-2.0-instruct` | 不支持 | 支持 |
| `hunyuan-t1-vision-20250916` | 不支持 | 支持 |
| `hunyuan-turbos-vision-video-20250728` | 支持（仅画面） | 不支持 |

## 请求参数

| 参数 | 必选 | 类型 | 描述 |
| --- | --- | --- | --- |
| model | 是 | String | 服务 ID（默认服务时与模型名称相同） |
| messages | 是 | Array | 上下文消息；详见 `messages` 说明 |
| stream | 否 | Boolean | 是否流式输出，默认 false |
| temperature | 否 | Float | 采样温度 [0.0, 2.0] |
| top_p | 否 | Float | 核采样 [0.0, 1.0] |
| max_tokens | 否 | Integer | 最大输出 token |
| stop | 否 | Array of String | 停止序列，最多 4 个 |

### messages

- role：user
- content：Array，包含以下字段
  - type：`text` / `image_url` / `video_url`
  - text：理解指令，例如 "请描述视频的内容"
  - image_url：`{ url }`，JPG/JPEG/PNG/WebP，单图 ≤10 MB，单请求 ≤20 张
  - video_url：`{ url }`，MP4/MOV/AVI/WebM，H.264/H.265，时长 ≤10 分钟，大小 ≤100 MB，单请求 1 个

## 返回参数

| 字段 | 类型 | 描述 |
| --- | --- | --- |
| id | String | 请求唯一标识 |
| object | String | `chat.completion` |
| created | Integer | Unix 时间戳 |
| model | String | 实际模型名 |
| choices | Array | 候选结果列表 |
| usage | Object | prompt_tokens / completion_tokens / total_tokens |

`choices[].message`：含 `role` + `content`。
`choices[].finish_reason`：`stop` / `length` / `tool_calls`。
`usage`：
- `prompt_tokens`（含缓存）
- `prompt_tokens_details.cached_tokens`
- `completion_tokens`
- `completion_tokens_details.reasoning_tokens`
- `total_tokens`

## 调用示例（视频输入）

```http
POST /v1/chat/completions
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "model": "youtu-vita",
  "messages": [{"role": "user", "content": [
    {"type": "video_url", "video_url": {"url": "<video url>"}},
    {"type": "text", "text": "请描述视频的内容"}
  ]}],
  "stream": false
}
```

## 调用示例（图片输入）

```http
POST /v1/chat/completions
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "model": "youtu-vita",
  "messages": [{"role": "user", "content": [
    {"type": "image_url", "image_url": {"url": "<image url 1>"}},
    {"type": "image_url", "image_url": {"url": "<image url 2>"}},
    {"type": "text", "text": "请描述图片的内容"}
  ]}],
  "stream": false
}
```

**图片输入限制**：`TY-VITA` 支持一次传入多张；`HY-Vision` 系列一次仅可传入单张。