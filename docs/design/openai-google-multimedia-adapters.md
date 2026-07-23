# OpenAI 与 Google 官方多媒体适配设计

> 状态: 已落地 | 最后核对: 2026-07-24

OpenAI 官方多媒体统一使用 `openai-images` Provider，Google 官方多媒体统一使用 `google-generative-ai` Provider。Manifest 全局键固定为 `<providerKind>:<完整 modelId>`；完整 ID（包括 snapshot 后缀）逐个保存。其他 Provider 即使存在同名 `modelId`，也拥有独立 manifest、凭据、endpoint 和 adapter，不能跨渠道去重、覆盖或复用配置。

## 已实施范围

- OpenAI 图片：GPT Image 2、1.5、1、1 Mini、ChatGPT Image Latest 及已确认的 snapshot，共 7 个模型；支持同步文生图和 multipart 多图编辑，单次编辑最多 16 张图。
- OpenAI 视频：Sora 2 / Sora 2 Pro 及 snapshot，共 5 个模型；支持文生视频、参考图生视频、异步轮询和 `/videos/{id}/content` 下载。
- Google 图片：4 个 Nano Banana 模型通过 Interactions API 调用；3 个 Imagen 4 模型通过 `models/{model}:predict` 调用。
- Google 视频：3 个 Veo 3.1 模型通过 `predictLongRunning` 调用；Gemini Omni Flash 独立通过 Interactions API 调用。
- Google 音乐：Lyria 3 Clip / Pro 通过 Interactions API 调用，并新增统一能力 `audio.music`。
- Provider 配置页：OpenAI / Google 官方适配器已从图片与视频白名单中解除隐藏；OpenAI 图片与 Sora 作为两个独立预设展示，Lyria 在语音类型中展示“音乐生成”能力。
- 目录升级：旧版 `openai:*` / `google:*` 内置别名只在确认为 `built_in=1` 时标记为 disabled，避免配置页出现同渠道、同 model ID 的重复项；用户自定义 manifest 不受影响。

已关停的 DALL-E 2/3、旧 Gemini 图片 preview、Veo 3.0/2.0 不录入。尚未关停但已 deprecated 的模型继续保留，实际渠道错误按结构化错误契约回显。

## 运行时分层

- `packages/protocol/src/openai-media-model-manifests.ts`：仅维护 OpenAI 官方完整 model ID、能力、参数、请求元数据和资料链接。
- `packages/protocol/src/google-media-model-manifests.ts`：仅维护 Google 官方完整 model ID、能力、参数、请求元数据和资料链接。
- `OpenAiOfficialMediaAdapter`：处理 OpenAI Bearer 鉴权、同步图片、multipart 图片编辑和 Sora 任务取件。
- `GoogleGenerativeAiMediaAdapter`：处理 Google API Key 鉴权，并按 Nano Banana、Imagen、Veo、Omni、Lyria 的真实协议分支组装请求和解析响应。
- `spark_media` 子进程同步识别 `audio.music`，并按 Google/OpenAI 官方协议处理鉴权、参数嵌套、multipart 编辑和 Sora 内容下载。
- Provider 的 `mediaDefaults.timeoutMs` 统一约束同步图片、异步任务提交、轮询和产物下载；历史 `mediaDefaults.polling.timeoutMs` 只作为兼容回退，`polling.intervalMs` 继续仅控制轮询间隔。

画布的 `text_to_audio` 会优先匹配 `audio.music`，模型未提供音乐能力时再回落 `audio.speech`。`spark_media` 未显式指定模型时，会在配置顺序内选择首个支持目标能力的 manifest，不会把图片默认模型错误用于视频或音乐请求。

Gemini Omni Flash 使用 `delivery="uri"` 时，桌面适配器与 `spark_media` 都会先通过 Files API 轮询文件到 `ACTIVE`，再携带该 Google Provider 的凭据下载。独立的历史 `omni` Provider manifest 与预设保持原样；`google-generative-ai:gemini-omni-flash-preview` 与 `omni:gemini-omni-flash-preview` 同名并存，不共享配置或凭据。

OpenAI 图片默认使用常规同步响应。本次未增加 SSE `stream` / `partial_images` 协议，因为现有媒体产物契约没有流式 chunk 生命周期；后续若实现，应作为独立协议扩展，不改变当前默认行为。

## 官方资料

- OpenAI 图片指南：https://developers.openai.com/api/docs/guides/image-generation
- OpenAI Images API：https://developers.openai.com/api/reference/resources/images
- OpenAI 视频指南：https://developers.openai.com/api/docs/guides/video-generation
- OpenAI Videos API：https://developers.openai.com/api/reference/resources/videos
- OpenAI 模型弃用：https://developers.openai.com/api/docs/deprecations
- Gemini 图片生成：https://ai.google.dev/gemini-api/docs/image-generation
- Google Interactions API：https://ai.google.dev/gemini-api/docs/interactions-overview
- Imagen：https://ai.google.dev/gemini-api/docs/imagen
- Veo：https://ai.google.dev/gemini-api/docs/veo
- Gemini Omni Flash：https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash
- Lyria 音乐生成：https://ai.google.dev/gemini-api/docs/music-generation
- Google 模型弃用：https://ai.google.dev/gemini-api/docs/deprecations
