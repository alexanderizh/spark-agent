# 第三方生视频（Kling / Vidu）

> 状态: 已落地 | 最后核对: 2026-07-23
> 来源: https://cloud.tencent.com/document/product/1616/107795

## 说明与实现边界

旧混元生视频（product/1616）也提供对**可灵 Kling** 与 **Vidu** 视频模型的转发接入；新接入推荐使用 TokenHub 视频生成端点 `/v1/api/video/{submit|query}`。模型 ID 与 manifest 完全等价。

TokenHub 当前模型清单把下列 9 个 Kling 和 6 个 Vidu 模型都声明为“文生视频 / 图生视频”。Spark-Agent 已全部录入这两类能力。1616 目录中的 Kling Omni、动作控制、视频延长和主体库仍是独立 VCLM 签名 API，TokenHub 未声明等价能力，本次不把它们错误映射到通用 submit 端点。

## Kling 文生视频（SubmitTextToVideoJob）

文档：https://cloud.tencent.com/document/product/1616/130564

### 输入参数

| 参数                | 必选 | 类型                 | 描述                                                        |
| ------------------- | ---- | -------------------- | ----------------------------------------------------------- |
| Prompt              | 否   | String               | 正向提示词，≤2500 字符                                      |
| Model               | 否   | String               | 见下表                                                      |
| NegativePrompt      | 否   | String               | 负向提示词，≤2500 字符                                      |
| Duration            | 否   | String               | 视频时长（秒）；默认 5                                      |
| Mode                | 否   | String               | std / pro                                                   |
| CfgScale            | 否   | Float                | 自由度 [0, 1]，默认 0.5；v2.0/v2.5/v2.6 不支持              |
| AspectRatio         | 否   | String               | 16:9 / 9:16 / 1:1，默认 16:9                                |
| Sound               | 否   | String               | on / off；仅 V2.6 及以后模型支持；v2.6 std 只能生成无声视频 |
| LogoAdd / LogoParam | 否   | Integer / Object     | 水印                                                        |
| MultiShot           | 否   | Boolean              | 是否多镜头；true 时 Prompt 无效                             |
| ShotType            | 否   | String               | customize / intelligence；MultiShot=true 时必填             |
| MultiPrompt.N       | 否   | Array of MultiPrompt | 最多 6 个分镜，每个 Prompt ≤512，时长合计等于 Duration      |
| CameraControl       | 否   | CameraControl        | 摄像机运动协议                                              |
| CallbackUrl         | 否   | String               | 任务状态变更回调地址                                        |
| ExternalTaskId      | 否   | String               | 透传业务侧 ID                                               |

### Model 取值

| Model 值 | 对应模型          |
| -------- | ----------------- |
| v1.0     | Kling-V1          |
| v1.5     | Kling-V1-5        |
| v1.6     | Kling-V1-6        |
| v2.0     | Kling-V2-Master   |
| v2.1m    | Kling-V2-1-master |
| v2.5     | Kling-V2-5-Turbo  |
| v2.6     | Kling-V2-6        |
| v3.0     | kling-v3          |

### TokenHub Kling 模型参数矩阵

| TokenHub model         | Duration        | 文生 Mode | 图生 Mode               | CfgScale | Sound  | VoiceList |
| ---------------------- | --------------- | --------- | ----------------------- | -------- | ------ | --------- |
| `kl-video-v3`          | 3–15 的每个整数 | 不配置    | 不配置                  | 支持     | 支持   | 不支持    |
| `kl-video-v2-6`        | 5 / 10          | pro       | pro                     | 不支持   | 支持   | 支持      |
| `kl-video-v2-5-turbo`  | 5 / 10          | 不配置    | pro                     | 不支持   | 不支持 | 支持      |
| `kl-video-v2-1-master` | 5 / 10          | 不配置    | 不配置                  | 支持     | 不支持 | 支持      |
| `kl-video-v2-1`        | 5 / 10          | std / pro | std / pro；尾帧时仅 pro | 支持     | 不支持 | 支持      |
| `kl-video-v2-master`   | 5 / 10          | 不配置    | 不配置                  | 不支持   | 不支持 | 支持      |
| `kl-video-v1-6`        | 5 / 10          | std / pro | pro                     | 支持     | 不支持 | 支持      |
| `kl-video-v1-5`        | 5 / 10          | pro       | pro                     | 支持     | 不支持 | 支持      |
| `kl-video-v1`          | 5 / 10          | pro       | pro                     | 支持     | 不支持 | 支持      |

`LogoAdd` 按官方 Integer 0/1 录入，不再使用 boolean；复杂参数 `LogoParam`、`MultiPrompt`、`CameraControl`、`ElementList`、`DynamicMasks`、`VoiceList` 作为对象/数组保留，Adapter 会递归转换为小写下划线字段。

## Kling 图生视频（SubmitImageToVideoJob）

文档：https://cloud.tencent.com/document/product/1616/130567

### 输入参数（关键）

| 参数                               | 必选 | 类型                 | 描述                                                                                         |
| ---------------------------------- | ---- | -------------------- | -------------------------------------------------------------------------------------------- |
| Model                              | 否   | String               | v1.6 / v2.0 / v2.1 / v2.5 / v2.6 / V3.0                                                      |
| Image                              | 否   | Image                | 参考图；Base64 或 URL；≤10MB；≥300×300；宽高比 1:2.5 ~ 2.5:1；.jpg/.jpeg/.png                |
| ImageTail                          | 否   | Image                | 尾帧图；与 Image 二选一；不能与 DynamicMasks/StaticMask/CameraControl 同时使用               |
| Prompt / NegativePrompt            | 否   | String               | ≤2500 字符                                                                                   |
| Duration                           | 否   | String               | 5/10（v3.0 支持 3~15）                                                                       |
| Mode                               | 否   | String               | std / pro；v1.6 首尾帧/仅首帧只支持 pro；v2.1/v2.5/v2.6 首尾帧只支持 pro；v2.0/v3.0 无需配置 |
| CfgScale                           | 否   | Float                | [0, 1]；v2.0/v2.5/v2.6 不支持                                                                |
| Sound                              | 否   | String               | on / off                                                                                     |
| MultiShot / ShotType / MultiPrompt | 否   | 同文生视频           |
| ElementList.N                      | 否   | Array of Element     | 参考主体，最多 3 个；详见 可灵「主体库 3.0」使用指南                                         |
| StaticMask                         | 否   | String               | 静态笔刷涂抹区域；与 Image 长宽比必须一致                                                    |
| DynamicMasks.N                     | 否   | Array of DynamicMask | 动态笔刷配置列表；最多 6 组                                                                  |
| CameraControl                      | 否   | CameraControl        | 与 ImageTail/StaticMask/DynamicMasks 互斥                                                    |
| VoiceList.N                        | 否   | Array of Voice       | 音色列表；至多 2 个；与 ElementList 互斥；v3 不支持                                          |
| CallbackUrl / ExternalTaskId       | 否   | String               | 同文生视频                                                                                   |

## Kling-Omni-Video（SubmitVideoEditKlingJob）

文档：https://cloud.tencent.com/document/product/1616/130562

已确认独立接口为 `SubmitVideoEditKlingJob`。该能力未出现在 TokenHub 模型清单的任务类型中，本次不注册为 `video.edit`；后续应作为 VCLM 签名 Provider 单独接入。

## Kling 动作控制（SubmitMotionControlKlingJob）

文档：https://cloud.tencent.com/document/product/1616/130566

已确认独立接口为 `SubmitMotionControlKlingJob`。同上，不复用 TokenHub 通用 submit 端点。

## 视频延长（SubmitVideoExtendKlingJob）

文档：https://cloud.tencent.com/document/product/1616/130561

已确认独立接口为 `SubmitVideoExtendKlingJob`。同上，不复用 TokenHub 通用 submit 端点。

## 主体库（CreateAigcElement / DescribeAigcElement / DeleteAigcElement）

文档：

- https://cloud.tencent.com/document/product/1616/130628（创建主体）
- https://cloud.tencent.com/document/product/1616/130626（查询主体）
- https://cloud.tencent.com/document/product/1616/130627（删除主体库）

用于 Kling 参考主体管理；图生视频 ElementList 中通过 ElementId 引用。

## Vidu 文生视频（SubmitTextToVideoViduJob）

文档：https://cloud.tencent.com/document/product/1616/130563

### 输入参数

| 参数                | 必选 | 类型             | 描述                                                                                |
| ------------------- | ---- | ---------------- | ----------------------------------------------------------------------------------- |
| Prompt              | 是   | String           | 提示词 ≤2000 字符                                                                   |
| Model               | 否   | String           | viduq2（默认） / viduq3-turbo / viduq3-pro                                          |
| Duration            | 否   | Integer          | viduq3: 1-16（默认 5）；viduq2: 1-10（默认 5）                                      |
| Bgm                 | 否   | Boolean          | 添加背景音乐；q2 的 9/10 秒不生效；q3 不生效                                        |
| AspectRatio         | 否   | String           | 16:9 / 9:16 / 4:3 / 3:4 / 1:1，默认 16:9                                            |
| Resolution          | 否   | String           | 540p / 720p / 1080p，默认 720p                                                      |
| Style               | 否   | String           | general / anime；q2、q3 不生效                                                      |
| MovementAmplitude   | 否   | String           | auto / small / medium / large；q2、q3 不生效                                        |
| Audio               | 否   | Boolean          | 是否音视频直出；**仅 q3 支持**                                                      |
| MetaData            | 否   | String           | 元数据，JSON 字符串                                                                 |
| CallbackUrl         | 否   | String           | 回调地址，POST；回调内容结构与查询 API 返回体一致；`status` 含 `success` / `failed` |
| Payload             | 否   | String           | 透传，≤1MB                                                                          |
| OffPeak             | 否   | Boolean          | 错峰模式；true 时积分更低，48 小时内生成；超时自动取消并返还积分                    |
| LogoAdd / LogoParam | 否   | Integer / Object | 水印                                                                                |

## Vidu 图生视频（SubmitImageToVideoViduJob）

文档：https://cloud.tencent.com/document/product/1616/130530

2026-07-23 已重新打开页面补采。请求使用 `Images.N` 字符串数组：1 张为首帧，2 张依次为首帧/尾帧；支持 URL 或 Base64。

| 参数                                       | 约束                                                         |
| ------------------------------------------ | ------------------------------------------------------------ |
| Images                                     | 1–2 张；png/jpeg/jpg/webp；≤50M；首尾帧分辨率比例 0.8–1.25   |
| IsRec                                      | 是否使用系统推荐提示词；启用后忽略 Prompt                    |
| Audio / VoiceId                            | 音视频直出与音色；q3 默认开启 Audio                          |
| Duration                                   | q3 1–16；q2 pro/turbo 首帧 1–10、首尾帧 1–8；q2 基础模型 2–8 |
| Resolution                                 | q3 540p/720p/1080p；q2 pro/turbo 首帧 720p/1080p             |
| AudioType                                  | all / speech_only / sound_effect_only；q2 音频拆分           |
| MetaData / CallbackUrl / Payload / OffPeak | 元数据、回调、≤1MB 透传、48h 错峰                            |
| LogoAdd / LogoParam                        | Integer 0/1 与自定义标识对象                                 |

`MovementAmplitude` 在官方页面明确注明 q2/q3 不生效，已从这些 Manifest 删除；文生的 `Style` 同样不对 q2/q3 暴露。

## Vidu 参考生视频（SubmitReferenceToVideoViduJob）

文档：https://cloud.tencent.com/document/product/1616/130565

### 输入参数（关键）

| 参数                                       | 必选 | 类型                               | 描述                                                                                          |
| ------------------------------------------ | ---- | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| Prompt                                     | 是   | String                             | 提示词 ≤2000 字符；支持 `@主体id`（如 `@1 和 @2 在一起吃火锅`）                               |
| Images.N                                   | 否   | Array of String                    | 非主体调用时；支持 1-7 张图片；png/jpeg/jpg/webp；≥128×128；宽高比 <1:4 或 <4:1；≤50M         |
| Subjects.N                                 | 否   | Array of ReferenceSubject          | 主体调用时；支持 1-7 个主体，主体图片 1-7 张                                                  |
| Videos.N                                   | 否   | Array of String                    | 视频参考；1-2 个视频；**仅 viduq2-pro 支持**；最多 1×8s 或 2×5s；mp4/avi/mov；≥128×128；≤100M |
| Model                                      | 否   | String                             | viduq2（默认且当前唯一）                                                                      |
| Audio                                      | 否   | Boolean                            | 音视频直出；仅上传主体时支持                                                                  |
| AudioType                                  | 否   | String                             | all / speech_only / sound_effect_only；audio=true 时必填                                      |
| Bgm                                        | 否   | Boolean                            | 背景音乐；非主体调用生效；q2 9/10 秒不生效                                                    |
| Duration                                   | 否   | Integer                            | 1-10，默认 5                                                                                  |
| AspectRatio                                | 否   | String                             | 非主体：16:9/9:16/4:3/3:4/1:1；主体：16:9/9:16/1:1；q2 支持任意宽高比                         |
| Resolution                                 | 否   | String                             | 540p / 720p / 1080p，默认 720p                                                                |
| MovementAmplitude                          | 否   | String                             | auto / small / medium / large                                                                 |
| MetaData / CallbackUrl / Payload / OffPeak | 否   | String / String / String / Boolean | 同 Vidu 文生视频                                                                              |
| LogoAdd / LogoParam                        | 否   | Integer / Object                   | 水印                                                                                          |

## 频率限制

所有第三方接口默认 20 次/秒。

## 通用响应

提交响应：`{ Response: { JobId, RequestId, ExternalTaskId? } }`

查询响应（除 Vidu 参考）：`{ Status: WAIT/RUN/FAIL/DONE, ResultVideoUrl, ErrorCode, ErrorMessage, RequestId }`，URL 24 小时有效。

## 在 TokenHub 上的等价接入

- base_url：`https://tokenhub.tencentmaas.com`
- 提交：`POST /v1/api/video/submit`
- 查询：`POST /v1/api/video/query`
- model 参数使用同 Kling/Vidu 在 1823 上的 model id，例如：
  - `kl-video-v3` / `kl-video-v2-6` / `kl-video-v1-6` / `kl-video-v1` 等
  - `vd-video-q3-pro` / `vd-video-q2-pro` / `vd-video-q2` 等
- 字段名以小写下划线为准（如 `logo_add` / `external_task_id`）

## Spark-Agent 实现位置

- 模型清单：`packages/protocol/src/tencent-tokenhub-media-model-manifests.ts`
- 请求编译与模型族组装：`packages/agent-runtime/src/services/media/tencent-tokenhub-media-request.ts`
- 异步提交/查询与产物下载：`packages/agent-runtime/src/services/media/adapters/tencent-tokenhub-media.adapter.ts`
- 组合约束：`packages/agent-runtime/src/services/media/validators/tencent-tokenhub-media.validator.ts`
- 契约测试：`packages/agent-runtime/src/__tests__/services/media/tencent-tokenhub-media.adapter.test.ts`
