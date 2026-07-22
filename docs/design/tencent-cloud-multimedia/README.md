# 腾讯云大模型多媒体对接资料

> 状态: 实施中 | 最后核对: 2026-07-22

本目录汇总腾讯云大模型平台的多媒体（图像/视频/3D）模型对接资料，采集自腾讯云官方文档，作为后续在 Spark-Agent 平台中按现有 `渠道 + 模型 manifest` 方式新增腾讯云多媒体支持的依据。

## 涉及产品入口

| 产品 ID | 产品名 | 用途 |
| --- | --- | --- |
| `product/1823` | 大模型服务平台 TokenHub | 统一 API 入口，OpenAI/Anthropic 兼容；提供图像、视频、3D、多模态理解、向量、文本生成 |
| `product/1668` | 腾讯混元生图 | 旧版混元生图（极速版/2.0/3.0、图像风格化、AI 写真、模特换装、商品背景生成、线稿生图、图像编辑） |
| `product/1616` | 腾讯混元生视频 | 混元生视频旧入口，新版已并入 TokenHub 视频生成 |

## TokenHub 入口域

- 境内：https://tokenhub.tencentmaas.com  →  资源调度范围：中国大陆
- 新加坡：https://tokenhub-intl.tencentmaas.com  →  资源调度范围：全球
- 备用境内：https://tokenhub.tencentmaas.cn
- 备用新加坡：https://tokenhub-intl.tencentmaas.cn
- 旧混元生图：aiart.tencentcloudapi.com（就近地域）或 aiart.ap-guangzhou.tencentcloudapi.com 等
- 鉴权：`Authorization: Bearer <API_KEY>`

## 子文档索引

| 子文档 | 路径 |
| --- | --- |
| 模型清单与能力 | `model-list.md` |
| 图像生成 API（TokenHub） | `image-generation.md` |
| 视频生成 API（TokenHub） | `video-generation.md` |
| 3D 生成 API（TokenHub） | `3d-generation.md` |
| 多模态理解 API（TokenHub） | `multimodal-understanding.md` |
| 错误码（OpenAI/Responses/Anthropic 兼容协议） | `error-codes.md` |
| 旧混元生图接口（1668） | `legacy-hunyuan-image.md` |
| 旧混元生视频接口（1616） | `legacy-hunyuan-video.md` |
| 视频特效与人像驱动 | `video-effects.md` |
| 第三方生视频（Kling / Vidu） | `third-party-video.md` |
| 采集原始页列表 | `source-pages.md` |

## 关键事实

- 接入协议：OpenAI Chat Completions (`/v1/chat/completions`)、OpenAI Responses (`/v1/responses`)、Anthropic Messages (`/v1/messages`)。
- 多媒体特殊端点：`/v1/api/image/{lite|submit|query}`、`/v1/api/video/{submit|query}`、`/v1/api/3d/{submit|query}`（OpenAI 兼容语义）。
- 提交任务异步返回 `id`，用对应 query 端点轮询，状态字段 `status`：`queued` / `in_progress` / `completed` / 失败。
- 错误结构包含 `error.code`、`error.type`、`error.message`、`error.message_zh`，可中英双语对照。
- 国内 model 标识使用全小写下划线（`hy-image-v3.0`），但部分 API 文档显示驼峰 (`HY-Image-V3.0`)；以实际模型清单 + 模型 `model` 参数为准。

## 多媒体模型一览（基于腾讯云大模型服务平台）

### 图像生成
- 混元 HY-Image-V3.0（异步）
- 混元 HY-Image-Lite（同步）

### 视频生成
- 混元 HY-Video-1.5
- 优图 YT-Video-2.0（通用图生视频）
- 优图 YT-Video-FX（视频特效）
- 优图 YT-Video-HumanActor（人像驱动）
- 可灵 Kling 全系列（v1 / v1.5 / v1.6 / v2-master / v2.1 / v2.1-master / v2.5-turbo / v2.6 / v3）
- Vidu 全系列（q2 / q2-turbo / q2-pro / q2-pro-fast / q3-pro / q3-turbo）

### 3D 生成
- 混元 HY-3D-3.0 / HY-3D-3.1（专业版）
- 混元 HY-3D-Express（极速版）

### 多模态理解（图片/视频理解）
- 优图 YT-VITA
- 混元 HY-Vision-2.0-Instruct（快思考）
- 混元 HY-Vision-1.5-Thinking（深度思考）
- 混元 HY-Vision-Video（视频理解）

## 后续开发提示

- 后续基于此目录的资料，按现有 `渠道 + 模型 manifest` 方式新增 Provider/Manifest（参考 `packages/protocol/src/openai-media-model-manifests.ts` 与 `packages/protocol/src/google-media-model-manifests.ts` 的分层结构）。
- TokenHub 视频 `/v1/api/video/submit|query` 与 1616 旧版 `vclm.tencentcloudapi.com` 是一一对应关系，submit 用同一组 `model` id。
- 错误结构建议：优先识别 OpenAI 兼容错误结构（`error.code` / `error.type` / `error.message` / `error.message_zh`），再回退到 1668 旧版 `FailedOperation.*` / `InvalidParameter.*` 等业务码。
- 国内 model 标识统一以小写下划线为准（API 兼容层转换规则）。