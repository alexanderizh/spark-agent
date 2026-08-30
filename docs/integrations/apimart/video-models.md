# APIMart 内置视频模型

> 状态: 已落地 | 最后核对: 2026-08-12

本文记录 Spark 内置 APIMart 视频适配器对近期模型的支持边界。APIMart 统一使用异步 `POST /v1/videos/generations` 创建任务，并通过任务接口轮询结果；模型差异集中在 Manifest 和输入契约中。

## 近期模型支持矩阵

| 模型                  | APIMart                                                   | 百炼原生渠道                              | MiniMax 原生渠道                       | 火山方舟原生渠道                                    |
| --------------------- | --------------------------------------------------------- | ----------------------------------------- | -------------------------------------- | --------------------------------------------------- |
| `wan3.0-video`        | 已内置：T2V、首帧/首尾帧、参考图/视频/音频、文件/网页参考 | 官方模型总览未列出                        | 不属于 MiniMax 官方模型                | 不属于火山方舟官方模型                              |
| `doubao-seedance-2.5` | 已内置：T2V、首尾帧、多模态参考、编辑/扩展                | 官方模型总览未列出                        | 不属于 MiniMax 官方模型                | 已内置，原生模型 ID 为 `doubao-seedance-2-5-260628` |
| `flux-3-video`        | 已内置：T2V、I2V、视频续写、草稿参数                      | 官方模型总览未列出                        | 不属于 MiniMax 官方模型                | 不属于火山方舟官方模型                              |
| `MiniMax-H3`          | 已内置：T2V、I2V、参考图/视频/音频                        | 官方模型总览未列出                        | 已内置，原生 V2 `/v2/video_generation` | 不属于火山方舟官方模型                              |
| `kling-3.0-turbo`     | 已内置：T2V、首帧 I2V                                     | 官方页面只作为迁移对照，不是该渠道模型 ID | 不属于 MiniMax 官方模型                | 不属于火山方舟官方模型                              |

“官方模型总览未列出”表示截至本次核对没有可依据的官方公开 API 契约，因此没有在对应原生渠道伪造模型 ID 或请求协议。APIMart 的转售模型只在 APIMart Profile 下启用，不会写入百炼、MiniMax 或火山方舟的原生 Profile。

## 参数和输入要点

- Wan 3.0 使用 `size`、`duration`、`resolution`、`audio`，并支持 `image_urls`、`image_with_roles`、`video_urls`、`audio_urls`、`file_url` 和 `link_url`；通过统一入口自动区分参考/首尾帧模式，不单独暴露普通 `video.edit` / `video.extend` 能力。
- Seedance 2.5 使用 `size`、`duration`、`resolution`、`generate_audio`、`output_format`；分辨率仅 `480p/720p`，时长支持 `4–30` 秒或 `-1`，输出支持 `mp4/mov`。
- FLUX 3 Video 使用 `aspect_ratio`、`duration`、`resolution`、`audio`，支持 1–10 张有序关键帧、视频续写和 `draft` / `draft_from_task_id`；续写映射为 `video.extend`，不暴露普通 `video.edit`。
- MiniMax-H3 使用 `aspect_ratio`、`duration`、`resolution`，并支持首尾帧和最多 9 张参考图、3 段参考视频、3 段参考音频。
- Kling 3.0 Turbo 使用 `aspect_ratio`、`resolution`、`duration`，只支持首帧图生视频，不应按 Kling v3 Omni 的多模态规则发送参考素材。

## 官方来源

- [APIMart 文档索引](https://docs.apimart.ai/llms.txt)
- [Wan3.0 Video](https://docs.apimart.ai/en/api-reference/videos/wan3.0-video/generation)
- [Seedance 2.5](https://docs.apimart.ai/en/api-reference/videos/doubao-seedance-2-5/generation)
- [FLUX 3 Video](https://docs.apimart.ai/en/api-reference/videos/flux-3-video/generation)
- [MiniMax-H3](https://docs.apimart.ai/en/api-reference/videos/minimax-h3/generation)
- [Kling 3.0 Turbo](https://docs.apimart.ai/en/api-reference/videos/kling-3.0-turbo/generation)
- [百炼视频生成与编辑模型总览](https://help.aliyun.com/zh/model-studio/video-generate-edit-model)
- [MiniMax 视频生成 API 总览](https://platform.minimaxi.com/docs/api-reference/api-overview)
- [MiniMax H3 V2 创建接口](https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create)
- [火山方舟 Seedance 2.5 视频接口](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2607688?lang=zh)
