# 旧混元生视频（product/1616）

> 状态: 实施中 | 最后核对: 2026-07-22
> 来源: https://cloud.tencent.com/document/product/1616

## 说明

为进一步提升大模型服务体验，腾讯混元大模型相关功能将逐步迁移至 TokenHub。迁移后，原平台不再新增模型能力，并停止支持新购模型服务。已购买的可继续使用。

## 服务域名

`vclm.tencentcloudapi.com`（就近地域）或带地域的 `vclm.ap-guangzhou.tencentcloudapi.com` 等。鉴权方式：API 3.0 TC3-HMAC-SHA256 v3 签名 + SecretId/SecretKey。

## 接口总览

### 混元生视频相关接口

| 接口名 | 功能 | 频率限制 |
| --- | --- | --- |
| DescribeImageToVideoGeneralJob | 查询图生视频通用能力任务 | 20 次/秒 |
| SubmitImageToVideoGeneralJob | 提交图生视频通用能力任务 | 20 次/秒 |
| SubmitVideoFaceFusionJob | 提交人脸融合大模型任务 | 20 次/秒 |
| DescribeVideoFaceFusionJob | 查询人脸融合大模型任务 | 20 次/秒 |
| DescribeHunyuanToVideoJob | 查询混元生视频任务 | 20 次/秒 |
| SubmitHunyuanToVideoJob | 提交混元生视频任务 | 30 次/秒 |

### 视频特效相关接口

| 接口名 | 功能 | 频率限制 |
| --- | --- | --- |
| SubmitTemplateToVideoJob | 提交视频特效任务 | - |
| DescribeTemplateToVideoJob | 查询视频特效任务 | - |

### 人像驱动相关接口

| 接口名 | 功能 | 频率限制 |
| --- | --- | --- |
| DescribeHumanActorJob | 查询人像驱动任务 | 20 次/秒 |
| SubmitHumanActorJob | 提交人像驱动任务 | 20 次/秒 |

### 图片唱演相关接口

| 接口名 | 功能 | 频率限制 |
| --- | --- | --- |
| DescribePortraitSingJob | 查询图片唱演任务 | - |
| SubmitPortraitSingJob | 提交图片唱演任务 | - |

### 第三方生视频相关接口（Kling / Vidu）

| 接口名 | 功能 | 频率限制 |
| --- | --- | --- |
| SubmitTextToVideoViduJob | 提交 Vidu 文生视频任务 | 20 次/秒 |
| DescribeTextToVideoViduJob | 查询 Vidu 文生视频任务 | 20 次/秒 |
| SubmitImageToVideoViduJob | 提交 Vidu 图生视频任务 | 20 次/秒 |
| DescribeImageToVideoViduJob | 查询 Vidu 图生视频任务 | 20 次/秒 |
| SubmitReferenceToVideoViduJob | 提交 Vidu 参考生视频任务 | 20 次/秒 |
| DescribeReferenceToVideoViduJob | 查询 Vidu 参考生视频任务 | 20 次/秒 |
| SubmitTextToVideoJob | 提交 Kling 文生视频任务 | 20 次/秒 |
| DescribeTextToVideoJob | 查询 Kling 文生视频任务 | 20 次/秒 |
| CreateAigcElement | 创建主体 | 20 次/秒 |
| DescribeAigcElement | 查询主体 | 20 次/秒 |
| SubmitImageToVideoJob | 提交 Kling 图生视频任务 | 20 次/秒 |
| DescribeImageToVideoJob | 查询 Kling 图生视频任务 | 20 次/秒 |
| SubmitMotionControlKlingJob | 提交 Kling 动作控制任务 | 20 次/秒 |
| SubmitVideoEditKlingJob | 提交 Kling-Omni-Video 任务 | 20 次/秒 |
| DescribeMotionControlKlingJob | 查询 Kling 动作控制任务 | 20 次/秒 |
| DescribeVideoEditKlingJob | 查询 Kling-Omni-Video 任务 | 20 次/秒 |
| SubmitVideoExtendKlingJob | 提交视频延长任务接口 | 20 次/秒 |
| DeleteAigcElement | 删除主体库 | 20 次/秒 |
| DescribeVideoExtendKlingJob | 查询视频延长任务 | 20 次/秒 |

## SubmitHunyuanToVideoJob（混元生视频 提交）

文档：https://cloud.tencent.com/document/product/1616/126160

### 输入参数

| 参数 | 必选 | 类型 | 描述 |
| --- | --- | --- | --- |
| Action | 是 | String | `SubmitHunyuanToVideoJob` |
| Version | 是 | String | `2024-05-23` |
| Region | 是 | String | - |
| Prompt | 是 | String | 中文正向提示词；最多 200 utf-8 字符（首尾空格不计入） |
| Image | 否 | Image | 输入图片；URL ≤10M、Base64 ≤8M；jpg/png/jpeg/webp/bmp/tiff；单边 50~5000；长宽 1:4 ~ 4:1 |
| Resolution | 否 | String | 目前仅支持 720p，默认 720p |
| LogoAdd | 否 | Integer | 0=不添加（需控制台开启）/ 1=添加 / 其他按 1，默认 1 |
| LogoParam | 否 | LogoParam | 默认"AI 生成"；可替换（需控制台开启） |

默认并发 1。

### 输出参数

- `JobId`
- `RequestId`

## SubmitImageToVideoGeneralJob（图生视频通用 提交）

文档：https://cloud.tencent.com/document/product/1616/124465

| 参数 | 必选 | 类型 | 描述 |
| --- | --- | --- | --- |
| Action | 是 | String | `SubmitImageToVideoGeneralJob` |
| Version | 是 | String | `2024-05-23` |
| Region | 是 | String | - |
| Image | 是 | Image | 同上 |
| Prompt | 否 | String | 最多 200 utf-8 字符 |
| Resolution | 否 | String | 480p / 720p / 1080p |
| Fps | 否 | Integer | 16/24/30，默认 30 |
| LogoAdd | 否 | Integer | 同上 |
| LogoParam | 否 | LogoParam | 同上 |

## SubmitTemplateToVideoJob（视频特效 提交）

文档：https://cloud.tencent.com/document/product/1616/119001

| 参数 | 必选 | 类型 | 描述 |
| --- | --- | --- | --- |
| Action | 是 | String | `SubmitTemplateToVideoJob` |
| Version | 是 | String | `2024-05-23` |
| Region | 是 | String | - |
| Template | 是 | String | 视频特效模板名，见 `video-effects.md` |
| Images.N | 是 | Array of Image | 参考图，Base64 或 URL；png/jpg/jpeg/webp/bmp/tiff；≤10MB；300~4096px；宽高比 1:4 ~ 4:1 |
| LogoAdd | 否 | Integer | 默认 1；0 需控制台申请开启 |
| LogoParam | 否 | LogoParam | - |
| Resolution | 否 | String | 默认 `360p`；具体模板支持的清晰度见 `video-effects.md` |
| BGM | 否 | Boolean | 是否添加背景音乐；默认 false；true 时系统自动从预设 BGM 库挑选 |
| ExtraParam | 否 | ExtraParam | 扩展字段 |

## SubmitHumanActorJob（人像驱动 提交）

文档：https://cloud.tencent.com/document/product/1616/125458

| 参数 | 必选 | 类型 | 描述 |
| --- | --- | --- | --- |
| Action | 是 | String | `SubmitHumanActorJob` |
| Version | 是 | String | `2024-05-23` |
| Region | 是 | String | - |
| Prompt | 是 | String | 文本提示词 ≤5000 字符；支持 `##` 局部时间控制（如 `#3#` 表示第 3 秒） |
| AudioUrl | 是 | String | 音频 URL；时长 2-60 秒；mp3/wav；≤10M |
| ImageUrl | 否 | String | 图片 URL；jpg/jpeg/png/bmp/webp；192-4096；≤10M；宽高 1:4 ~ 4:1 |
| ImageBase64 | 否 | String | Base64 编码；编码后 ≤10M；与 ImageUrl 二选一，URL 优先 |
| Resolution | 否 | String | 720p / 1080p，默认 1080p |
| FrameRate | 否 | Integer | 25 / 50 fps，默认 50 |
| LogoAdd | 否 | Integer | 同上 |
| LogoParam | 否 | LogoParam | - |

## 任务状态（旧版 API 查询响应）

- `Status`：WAIT / RUN / FAIL / DONE
- `ErrorCode` / `ErrorMessage`：仅 FAIL 时有值
- `ResultVideoUrl`：结果视频 URL，有效期 **24 小时**
- `RequestId`

## 错误码

详见 https://cloud.tencent.com/document/product/1616/107794（参考 `error-codes.md`）。

部分业务错误码示例：

| 错误码 | 描述 |
| --- | --- |
| FailedOperation.JobNotExist / JobNotFound | 任务不存在 |
| FailedOperation.DriverFailed | 驱动失败 |
| FailedOperation.ModerationFailed | 内容审核不通过 |
| FailedOperation.ImageDecodeFailed / ImageDownloadError / ImageSizeExceed | 图片相关 |
| FailedOperation.InnerError / RequestTimeout / ServerError | 服务端错误 |
| InvalidParameter.InvalidParameter | 参数不合法 |
| InvalidParameterValue.UrlIllegal | URL 不合法 |
| MissingParameter | 缺少参数 |
| RequestLimitExceeded.JobNumExceed | 任务数超过最大并发 |
| ResourceUnavailable.IsOpening | 服务开通中 |
| ResourceUnavailable.NotExist | 计费状态未知 |
| ResourcesSoldOut.ChargeStatusException | 账号欠费 |
| UnauthorizedOperation | 未授权 |