# xAI 多媒体对接完整对齐计划

> 状态: 待开发 | 最后核对: 2026-07-16

## 0. 本轮复核结论与已确认决策

本计划经过三轮只读代码审查、画布/Skill 调用链核对，以及对 `docs.x.ai` 相关页面的再次抓取后更新。实施前仍以官方文档页面的当前内容为唯一协议依据；任何官方页面未出现的字段、枚举、别名或限制，不得凭经验补写。

### 0.1 用户已确认的决策

1. **xAI 产物持久化默认开启**：生成请求默认使用 `storage_options.public_url: true`。
2. **回退链路**：支持渠道官方文件服务时，优先使用渠道官方文件服务；不支持或渠道上传失败时，按 `base64 → Spark 平台文件上传 → 明确警告/报错` 回退。
3. **视频产物特殊约束**：视频必须保留 xAI 官方 CDN 产物链接；不能把视频成功结果降级成 base64 或 Spark CDN 结果。xAI 官方 CDN 产物不可得时，任务应明确失败并保留诊断信息。
4. **公用上传抽象尽量完成**：本期新增可切换的 `MediaUploader` 契约，并完成 xAI 官方 Files API 与 Spark 平台上传桥接；不得把其他 vendor 的请求格式改成 xAI 格式。
5. **画布参考图视频节点已存在**：本期只负责把 xAI 模型接入既有画布节点和转换链路，不重复设计一个平行节点。
6. **STT 只收集文档和差异，列 TODO**：本期不新增 xAI `audio.transcription` capability，不把 STT 半成品接入画布或 Skill。
7. **retry/backoff、自定义 headers / `forwardUserIp` 本期不实现**：保留为后续 TODO。
8. **xAI Files API 列表 + 删除管理 UI 本期要做**：扩展 P5 并新增 P9；放置位置已拍板 **D = ProvidersView Provider Drawer 内新增"文件管理"区块**（详见 P9）。
9. **xAI Files UI 涉及的全部语义都遵循官方页面**：list 用 `GET /v1/files` 的 `data: FileObject[]` + `pagination_token`；delete 用 `DELETE /v1/files/{file_id}` 返回 `{deleted, id}`；FileObject 字段为 `id/filename/bytes/created_at/expires_at/object/purpose`。文件 size 客户端展示按官方 48 MiB 安全上限判断"已接近上限/已超限"，不再纠结 48/50 MB 文档冲突——该说法在 `managing-files` 页面已统一为 48 MB。

### 0.2 代码核对后必须纠正的事实

- 当前仓库代码中没有找到名为 `reference_to_video` 的独立 `CanvasOperationType`、视频菜单项或 `capabilityForOperation` 分支；但 MCP/Skill 已有 `video.reference_to_video` 能力入口。用户确认画布节点已存在，因此实施第一步必须定位该节点实际使用的 operation/数据字段，并把 xAI 能力接入**既有节点**；若当前分支确实缺少桥接枚举，只补最小映射，不新建重复 UI。
- xAI `generateVideo` 当前继承公共基类，基类会发送 xAI 官方没有的通用字段（如 `quality`、`fps`、`seed`、`edit_strength`、`last_frame_image`），不能继续静默透传。
- xAI 当前 `editVideo` 没有 `storage_options`，输入仅能走 URL/base64，尚未使用 `file_id`。
- xAI TTS 当前继承基类，实际请求路径是 `/audio/speech`，请求体是 OpenAI 兼容字段 `input/voice/response_format`；xAI 官方 REST 文档是 `POST /v1/tts`，字段为 `text/voice_id/language/output_format/...`，这是高优先级缺陷。
- xAI 图片 schema 已经包含官方图片比例 14 个值和 `1k/2k` 分辨率；不能把它误列为“枚举完全缺失”，本期重点是验证 UI/编译器/adapter 端到端不丢失，并修复不受支持字段的透传。
- xAI 官方 R2V 确认最多 7 张参考图、R2V 最大时长 10 秒；当前 manifest/MCP 仍按 4 张截断，需要修复。
- xAI 官方只支持参考**图片**视频，不支持参考视频；`reference_video` 进入 xAI 必须明确报 `invalid_input`，不能静默丢弃。
- xAI 官方 REST 不要求把 AI SDK 的 `mode: "reference-to-video"` 放进 JSON；MCP xAI 分支当前已显式删除 `mode`，保持该行为，不向 REST 请求增加未经文档确认的字段。
- 当前仓库已有 Spark 平台上传链路：`auth:upload-file` → `AuthService.uploadFile` → `EduServerClient.uploadFile`，带登录 token 和 401 续期；此前计划“完全没有平台上传”不准确。本期要把它接入公共上传契约，而不是重新造一套 `/api/upload`。

## 1. 目标与边界

### 1.1 目标

让 xAI 原生模型在以下两个入口都能正确使用：

- 无限画布的图像、视频、音频节点；
- `spark_media` 多媒体 Skill/MCP 入口。

目标不是“尽量把字段发出去”，而是：

- 每个发往 xAI 的字段都能在官方文档找到来源；
- 每个枚举按端点、模型和模式区分，不能用图片枚举污染视频；
- 首帧、参考图、输入视频、文件 ID、产物 CDN URL 等不同语义不混淆；
- 不支持的字段/组合在编译期或 adapter 入口明确报错或产生可见 warning；
- 失败回退遵守用户确认的顺序，并区分图片与视频产物规则；
- 画布与 Skill 共用同一套 xAI 转换逻辑；
- 其他渠道商的行为、参数和错误契约保持不变。

### 1.2 本期覆盖的 xAI 能力

| 能力 | 本期策略 |
|---|---|
| Image generation | 对齐 `/v1/images/generations`，补全模型/参数/产物存储 |
| Image edit / multi-image edit | 对齐 `/v1/images/edits`，单图/最多 3 张多图、URL/base64/file_id |
| Video T2V | `grok-imagine-video` 支持；1.5 明确拒绝 |
| Video I2V | `grok-imagine-video` 与 `grok-imagine-video-1.5`，1.5 支持 1080p |
| Video R2V | `grok-imagine-video`，最多 7 张参考图，最多 10 秒；1.5 明确拒绝 |
| Video edit | `/v1/videos/edits`，仅传官方支持字段，继承输入视频属性 |
| Video extend | `/v1/videos/extensions`，扩展段 2–10 秒，默认 6 秒 |
| TTS | 对齐 `/v1/tts`，只发送官方 REST 字段；支持 raw bytes 与 timestamps 响应 |
| xAI Files input | 上传图片/视频，生成 `file_id`，用于 image/video/reference_images |
| xAI Files output | `storage_options.filename + public_url: true`，读取 `file_output.public_url/file_id` |
| xAI Files 管理 UI | 桌面端侧面板/抽屉新增 list + delete 入口（详见 P9） |
| Spark 文件回退 | 通过现有登录态上传桥接接入公共上传契约 |

### 1.3 明确不在本期

- 其他 vendor（apimart、openai、google、bailian、volcengine、midjourney 等）的协议或默认行为；
- xAI Responses/Text API、Realtime Voice WSS；它们不是当前媒体 adapter 的图像/视频/同步 TTS 路径；
- xAI STT REST/WSS 接入（只保留文档事实和 TODO）；
- retry/backoff、`forwardUserIp`、自定义 headers；
- xAI Files API 列表 + 删除管理 UI 的放置位置（详见 P9，已拍板 D = ProvidersView Provider Drawer 内新增"文件管理"区块）；
- xAI 之外的渠道官方 CDN 适配。

## 2. 官方文档证据清单

抓取日期：2026-07-16。以下页面是参数和模型的证据源；代码实现只允许使用这些页面能确认的字段。页面内容若后续变化，需重新核对，不以旧代码注释为准。

### 2.1 模型

- 模型总表：https://docs.x.ai/developers/models
- `grok-imagine-video-1.5`：https://docs.x.ai/developers/models/grok-imagine-video-1.5
  - 官方确认 `grok-imagine-video-1.5`；aliases 为 `grok-imagine-video-1.5-preview`、`grok-imagine-video-1.5-2026-05-30`。
  - 官方明确不支持 text-to-video；本期按 I2V-only 处理。
  - 官方确认 1080p I2V 能力与分辨率价格档，不把价格作为 adapter 参数。
- `grok-imagine-image-quality`：https://docs.x.ai/developers/models/grok-imagine-image-quality
- xAI Imagine 总览：https://docs.x.ai/developers/model-capabilities/imagine

### 2.2 图片

- 图片生成：https://docs.x.ai/developers/model-capabilities/images/generation
- 图片编辑：https://docs.x.ai/developers/model-capabilities/images/editing
- 多图编辑：https://docs.x.ai/developers/model-capabilities/images/multi-image-editing
- 图片 REST schema：https://docs.x.ai/developers/rest-api-reference/inference/images

已确认的图片事实：

- 端点：`POST /v1/images/generations`、`POST /v1/images/edits`；xAI 图片编辑使用 JSON，不使用 OpenAI `multipart/form-data`。
- 图片比例：`1:1 / 3:4 / 4:3 / 9:16 / 16:9 / 2:3 / 3:2 / 9:19.5 / 19.5:9 / 9:20 / 20:9 / 1:2 / 2:1 / auto`。
- 图片分辨率：`1k / 2k`。
- 批量生成使用 `n`；官方示例使用 `n: 4`，当前抓取页面没有给出可据此硬编码的最大值，因此不能继续把 `n` 强行 clamp 到 4 或 10，除非 REST schema 明确给出上限。
- 多图编辑最多 3 张；每张输入可为公开 URL、base64 data URI 或 Files API `file_id`，可以混用。
- 图片输出可用 `response_format: url | b64_json`；xAI 官方页面还展示 SDK 的 `image_format: base64`，直连 REST 统一按 `response_format` 处理，不把 SDK 字段直接发给 REST。
- 图片编辑单图输入是 `image: {url | file_id, type?: "image_url"}`；多图输入是 `images: [{url | file_id, type?: "image_url"}]`。
- 产物持久化使用 `storage_options`，并支持 image generation/edit。

### 2.3 视频

- 视频生成：https://docs.x.ai/developers/model-capabilities/video/generation
- 图生视频：https://docs.x.ai/developers/model-capabilities/video/image-to-video
- 参考图生视频：https://docs.x.ai/developers/model-capabilities/video/reference-to-video
- 视频编辑：https://docs.x.ai/developers/model-capabilities/video/editing
- 视频扩展：https://docs.x.ai/developers/model-capabilities/video/extension
- 视频 REST schema：https://docs.x.ai/developers/rest-api-reference/inference/videos

已确认的视频事实：

- 端点：`POST /v1/videos/generations`、`POST /v1/videos/edits`、`POST /v1/videos/extensions`；异步响应返回 `request_id`，通过 `GET /v1/videos/{request_id}` 轮询。
- 生成模式：
  - T2V：`prompt`；
  - I2V：`prompt + image`，`image` 可是 URL、base64 data URI 或 `file_id`；
  - R2V：`prompt + reference_images`，最多 7 张参考图；
  - `image` 与 `reference_images` 不能同时存在，官方明确会返回 400；
  - R2V 非空 prompt 必须存在，最大时长 10 秒；
  - `grok-imagine-video-1.5` 不支持 T2V/R2V，只允许 I2V。
- 生成参数：`duration` 1–15 秒；`aspect_ratio` 仅 `1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3`；`resolution` 为 `480p / 720p / 1080p`，1080p 仅 `grok-imagine-video-1.5` I2V 支持。
- 视频编辑不支持自定义 `duration/aspect_ratio/resolution`，输出继承输入视频属性且上限 720p；官方生成页说明输入/输出编辑时长上限 8.7 秒，实施时按编辑页面和 REST schema再次核对。
- 视频扩展输入必须是 MP4，输入时长 2–15 秒；扩展段 `duration` 为 2–10 秒，默认 6 秒；`aspect_ratio/resolution` 不支持，继承输入且上限 720p。
- R2V 只有参考图片语义，官方没有 reference video 字段。`reference_video` 不能转换为 xAI `reference_images`。
- 首帧 I2V 使用 `image`；官方 REST 文档没有 `last_frame_image` 首尾帧字段，因此 xAI 不能承诺“尾帧输入”能力。
- REST 请求中不增加 AI SDK 专用 `mode`；`mode: "reference-to-video"` 只用于 AI SDK providerOptions。当前 MCP xAI 分支删除该字段的行为应保留。

### 2.4 Files API 与 CDN

- Files 管理：https://docs.x.ai/developers/files/managing-files
- Imagine 输入文件：https://docs.x.ai/developers/model-capabilities/imagine/files/inputs
- Imagine 输出持久化：https://docs.x.ai/developers/model-capabilities/imagine/files/outputs
- Files REST upload：https://docs.x.ai/developers/rest-api-reference/files/upload

已确认的 Files 事实：

- `POST /v1/files` 为 multipart；`expires_after` 必须出现在 `file` 字段之前，否则 400。
- 文件上传可返回 `id/filename/bytes/created_at/expires_at/object/purpose`；输入端通过 `{file_id: "..."}` 引用。
- 图片 `image`、图片 `images[]`、视频 `image`、视频 `video`、视频 `reference_images[]` 都允许使用 `file_id`。
- `storage_options.filename` 必填；`storage_options.public_url: true` 请求公开 CDN URL；可选 `storage_options.expires_after` 与 `public_url.expires_after`。
- 生成图片/编辑图片/生成视频/编辑视频/扩展视频都支持 `storage_options`；异步视频要在轮询完成响应的 `video.file_output.public_url` 中取结果。
- `file_output.file_id` 是稳定 Files ID；`file_output.public_url` 是公开 CDN URL；`public_url_error` 表示文件已经保存但公开 URL 创建失败，不能把它当成整个生成失败。
- 官方同一 `managing-files` 页面同时出现“Maximum file size: 50 MB”和“Limitations: Maximum file size: 48 MB”两处表述。计划不把其中一项伪装成唯一事实：客户端实现按 **48 MiB 安全上限**拦截并在错误中注明官方页面存在 48/50 MB 文档冲突；实现前若官方 REST schema已统一，则按更新后的正式限制调整。

### 2.5 TTS 与 STT

- TTS：https://docs.x.ai/developers/model-capabilities/audio/text-to-speech
- Voice REST：https://docs.x.ai/developers/rest-api-reference/inference/voice
- STT：https://docs.x.ai/developers/model-capabilities/audio/speech-to-text

TTS 本期必须按官方 REST `/v1/tts` 对齐：

- 必填：`text`（最多 15,000 字符）、`language`（BCP-47 或 `auto`）。
- 可选：`voice_id`（默认 `eve`）、`output_format` 对象（`codec/sample_rate/bit_rate`）、`speed`（0.7–1.5）、`optimize_streaming_latency`、`text_normalization`、`with_timestamps`。
- 普通响应是音频 bytes；`with_timestamps: true` 时是 JSON envelope，含 base64 `audio` 与 `audio_timestamps`，不能继续无条件按二进制写文件。
- 当前 `grok-tts` model ID 和 `/audio/speech` 兼容字段不能因为旧 preset 存在就视为官方事实；实施前必须以模型表/REST 页面确认。若官方 REST 不要求 model，则不要把未确认的 model 字段继续发给 `/v1/tts`。

STT 官方确实存在 `/v1/stt`，multipart 字段包括 `file|url`、`audio_format`、`sample_rate`、`language`、`format`、`multichannel`、`channels`、`diarize`、`keyterm`、`filler_words`；但按用户确认，本期只记录，不接入 capability。

## 3. 当前仓库实现审查结果

### 3.1 关键调用链

| 环节 | 当前文件 | 当前事实 |
|---|---|---|
| Canvas operation → capability | `packages/protocol/src/media-config.ts:267-301` | 当前显式列有 text/image/video edit/extend，没有名为 `reference_to_video` 的 operation 分支 |
| Canvas role policy | `packages/protocol/src/media-config.ts:335-397` | `video.reference_to_video` 已按参考图推断；`video.generate` 在某些 manifest 下会推断 `reference_video`，xAI 不能直接复用 |
| Canvas input role 编译 | `apps/desktop/src/renderer/design/views/canvas/canvasTaskInputFiles.ts:7-44` | 默认按首帧/尾帧/参考图分配，需核对 xAI 1.5 与 R2V 的模型约束 |
| Media router | `packages/agent-runtime/src/services/media/media-router.service.ts:109-115` | capability → adapter 分发 |
| xAI adapter | `packages/agent-runtime/src/services/media/adapters/xai-media.adapter.ts:32-48` | capability 集合含 image/video/TTS，不含 STT |
| OpenAI-compatible 基类 | `packages/agent-runtime/src/services/media/adapters/openai-compatible-media.adapter.ts:115-551` | 共享 image/video/TTS/转写路径；其中多处字段不是 xAI REST 字段 |
| MCP xAI native 分支 | `packages/agent-runtime/src/tools/media-generation-mcp-server.mjs:1263-1364` | 已有 R2V 入口，但当前参考图截断为 4；当前会删除 REST 不需要的 mode |
| 画布文件上传入口 | `apps/desktop/src/renderer/design/views/canvas/canvasWorkspaceTaskInput.ts:38-115`、`CanvasWorkspaceView.tsx:953-971` | 已有 base64 与 `auth:upload-file` 逻辑，但当前未统一注入 runtime uploader |
| Spark 上传实现 | `apps/desktop/src/main/services/Auth/registerAuthIpc.ts:180-187`、`AuthService.ts:332-340`、`EduServerClient.ts:173-203` | 已有登录 token、上传和 401 续期能力 |

### 3.2 xAI adapter 当前差异

1. `xai-media.adapter.ts:37-46` capabilities 不含 `audio.transcription`，本期保持不含。
2. `image.edit` 当前按 `image`/`images` JSON 发送并 `slice(0, 3)`，与官方多图编辑上限一致；但没有 `file_id` 和 `storage_options`。
3. `video.generate` 没有 xAI 专属 override，继承基类 `openai-compatible-media.adapter.ts:418-551`：
   - `image` 对 xAI 使用 `{url}`，尚未支持 `{file_id}`；
   - `reference_images` 使用 `{url}`，尚未支持 `{file_id}`；
   - 无条件加入 `last_frame_image`；
   - 还可能透传 `quality/fps/seed/edit_strength/video_url` 等 xAI 官方生成 schema 未确认/不支持字段；
   - 未执行 1.5 I2V-only、R2V 10 秒上限、image/reference_images 互斥校验。
4. `video.edit/video.extend` 在 `xai-media.adapter.ts:132-226` 使用独立端点是正确方向，但请求只含 URL，未支持 file_id，也未加入 `storage_options`。
5. 图片生成基类 `openai-compatible-media.adapter.ts:115-205` 仍有 `quality/output_format/negative_prompt` 等公共字段拼装；xAI 只能发送官方文档确认的 `response_format` 等字段。
6. TTS 基类 `openai-compatible-media.adapter.ts:281-327` 当前发 `/audio/speech` 和 `{model,input,voice,response_format,speed}`，与 xAI `/v1/tts` 不匹配。
7. `mediaInputRef` 位于 `openai-compatible-media.adapter.ts:569-577`，遇到本地 path 会直接返回本地路径；第三方 xAI 无法读取 `safe-file://` 或本机路径，需要在 adapter/uploader 层先物化成 URL、base64 或 file_id。
8. xAI adapter 当前没有 `MediaUploader` 依赖注入，也没有 Files API 客户端。

### 3.3 manifest / preset 当前差异

- `packages/protocol/src/provider-presets.ts:1257-1282` 的 `xai-imagine-video.modelIds` 只有 `grok-imagine-video`，缺 1.5 和官方 aliases。
- `packages/protocol/src/provider-presets.ts:1480-1497` 的 `xai-tts` 缺少 `mediaModelRefs`，默认值仍是 `voice: alloy/format: mp3`，与 xAI REST TTS 字段不一致。
- `packages/protocol/src/media-model-manifest.ts:1106-1117` 的 xAI 视频 schema 全局允许 1080p，未按 1.5 I2V 限制；同时仍声明 `useLastFrame`，会误导 xAI 用户。
- `packages/protocol/src/media-model-manifest.ts:1146-1156` 的 xAI 图片比例/分辨率枚举已经是官方值，本期只做调用链验证和不支持字段清理。
- `packages/protocol/src/media-model-manifest.ts:2351` 的 `video.reference_to_video.maxImages` 当前为 4，应改为 7；R2V 还应增加 duration 最大 10 的端点/模式约束。
- `packages/protocol/src/media-model-manifest.ts:1194-1206` 的 xAI error contract 缺少对轮询失败、存储失败、public URL 部分失败和请求 ID 的完整展示约定。

## 4. 需要实施的任务

### P0：官方契约冻结与代码入口核对

**目标**：先把文档字段和实际调用入口对齐，避免边改边猜。

1. 为本计划保留官方 URL、抓取日期、已确认字段和未确认字段清单。
2. 在代码中定位用户所说的画布参考图视频节点实际 operation/data 字段；确认它最终是否走 `video.reference_to_video`，还是通过已有通用视频 operation 携带 R2V 参数。
3. 只在确认现有桥接缺失时，补最小 operation → capability 映射；不新建第二套参考图视频节点。
4. 核对 `MediaInputFile.role` 当前类型（`packages/agent-runtime/src/services/media/media-adapter.types.ts:50-57`）与画布实际 role 表示，决定是否需要增加 `reference_video` 类型；若增加，必须确保非 xAI vendor 行为不变。

**验收**：画布节点、Canvas 编译结果、MCP/Skill inputFiles、router capability 和 xAI adapter 入口的实际字段链路有一张测试覆盖的映射表；没有“用户选了节点但 capability 走错”的静默情况。

### P1：模型注册与模型级能力约束

**涉及**：`packages/protocol/src/provider-presets.ts`、`packages/protocol/src/media-model-manifest.ts`、模型解析/目录相关服务。

1. 在 xAI 视频 preset 增加官方确认的：
   - `grok-imagine-video-1.5`；
   - `grok-imagine-video-1.5-preview`；
   - `grok-imagine-video-1.5-2026-05-30`。
2. 为 1.5 建立独立 manifest/capability 约束：
   - 只允许 `video.image_to_video`；
   - 必须有一张首帧 image；
   - 禁止 T2V、R2V、edit、extend；
   - 允许 `480p/720p/1080p`；
   - aspect ratio 仍只允许视频 7 个值；
   - R2V 最大 10 秒、标准 I2V 最大 15 秒的约束按模式分别表达，不用一个全局 schema 混淆。
3. `grok-imagine-video` 保持 T2V/I2V/R2V/edit/extend，1080p 按官方限制只在 1.5 I2V 允许。
4. `grok-imagine-image-pro` 只作为官方 alias 处理，不创建虚假的独立模型 manifest。
5. xAI TTS 的 `grok-tts` 必须先从官方模型/REST 证据确认；若 REST TTS 不接受 model，则不在 UI 伪造一个可选模型参数，preset 改为与实际 `/v1/tts` 契约一致。
6. xAI 1.5 在画布和 Skill 选择器中标为推荐项，但不允许因为推荐而显示它不支持的 T2V/R2V 操作。

**验收**：模型选择、manifest resolver、画布 capability 过滤和 MCP capability 参数校验均能区分 `grok-imagine-video` 与 1.5；不存在把 1.5 选择后静默路由到 apimart 的回退。

### P2：xAI 视频 adapter 原生参数映射

**涉及**：`packages/agent-runtime/src/services/media/adapters/xai-media.adapter.ts`；必要时只修改公共基类的 xAI 守卫段；MCP 只改 xAI native 分支。

1. 为 xAI `video.generate` 增加 provider-specific 入口，不再直接接受公共基类的所有字段。
2. 生成请求只允许官方已确认字段：`model`、`prompt`、`image`、`reference_images`、`duration`、`aspect_ratio`、`resolution`、`storage_options`、`user`；是否保留 `output` 仅在官方 REST 页面再次确认后决定，本期不实现自托管 upload URL。
3. 输入引用统一为：
   - 首帧：`image: {url}` 或 `image: {file_id}`；
   - 参考图：`reference_images: [{url|file_id}]`；
   - 不把本地 path 或 `safe-file://` 直接发给 xAI。
4. R2V：最多 7 张，prompt 非空，duration 最大 10；`image + reference_images` 组合明确报错或按统一策略在进入 provider 前拒绝，不能让 xAI 400 后才显示模糊错误。
5. 1.5：缺首帧、存在 reference_images、或从 T2V 节点调用时返回明确 `invalid_input`，错误中指出“grok-imagine-video-1.5 仅支持图生视频”。
6. 明确处理画布首尾帧：xAI 官方只确认首帧 `image`，不能发 `last_frame_image`；如果用户提供尾帧，返回可见 warning/错误，不得静默丢弃。
7. 明确处理 `reference_video`：xAI 官方无此字段，返回可见 `invalid_input: xAI reference-to-video only accepts reference images`。
8. xAI REST 不发送 AI SDK 的 `mode`；MCP xAI 分支保留现有 `delete body.mode`，但应把 provider option 到 REST body 的转换写成测试。
9. `video.edit` 只发送 prompt/model/video/storage_options/user；不发送 duration/aspect_ratio/resolution。
10. `video.extend` 只增加官方 `duration`，校验 2–10 秒；不发送 aspect_ratio/resolution；输入视频必须按官方 MP4/时长约束报错。
11. 移除或按官方契约拒绝 `quality/fps/seed/edit_strength/first_frame_image/last_frame_image/video_url` 等不属于 xAI REST 视频请求的字段，并通过 `droppedParams`/warning 告知调用方。

**验收**：每个视频模式都有快照级请求体测试；xAI 请求不含其他 vendor 的私有字段；同一请求不会同时发送 I2V 和 R2V；非 xAI adapter 测试与行为不变。

### P3：xAI 图片 adapter 与图片参数完整性

**涉及**：`xai-media.adapter.ts`、`openai-compatible-media.adapter.ts` 的 xAI 守卫段、图片 manifest/编译器。

1. 保持官方图片比例 14 个值和 `1k/2k`，验证画布面板、Skill schema、request compiler、adapter 四层均能传到 REST `aspect_ratio/resolution`。
2. 图片生成 `n` 使用官方 `n` 语义；保留默认 1，但移除没有官方依据的最大值 clamp，除非 REST schema明确给出上限。多产物必须分别落盘/保存 `file_output`。
3. 图片多图编辑最多 3 张；单图使用 `image`，多图使用 `images`；每个输入支持 URL/base64/file_id。
4. `response_format` 只发送官方 `url/b64_json`；SDK-only 的 `image_format`、OpenAI 兼容的 `output_format/quality/negative_prompt` 不得未经文档确认发给 xAI REST。
5. `size` 只允许按现有 Contract V2 的比例转换为 `aspect_ratio`；非比例 size 要产生明确 dropped warning，而不是直接 400。
6. 图片生成和编辑均接入 `storage_options`，默认 `filename + public_url: true`。

**验收**：14 个图片比例逐项测试；1k/2k 与 response_format 测试；多图 3 张、混合 URL/base64/file_id 测试；`n > 1` 时每个产物的 file_id/public URL 独立。

### P4：TTS 改为 xAI 官方 REST 协议

**涉及**：`xai-media.adapter.ts`（新增 xAI TTS override）、`provider-presets.ts`、`media-model-manifest.ts`。

1. 将 xAI endpoint 从 `/audio/speech` 改为官方 `/tts`。
2. 请求体只发送官方确认字段：`text`、`voice_id`、`language`、`output_format`、`speed`、`optimize_streaming_latency`、`text_normalization`、`with_timestamps`；不再发送未经确认的 `input/voice/response_format`。
3. `output_format` 使用对象结构：`{codec, sample_rate, bit_rate}`；枚举和默认值按 TTS 官方页面，不能平铺成 `codec/sample_rate/bit_rate`。
4. 普通响应按 raw audio bytes 写入；`with_timestamps=true` 时解析 JSON envelope，base64 解码 `audio`，保留 `audio_timestamps` 元数据。
5. 修正 xAI TTS 默认 voice/language；默认 voice 使用官方 `eve`，不能继续使用 `alloy`。
6. 将 `xai-tts` preset/manifest 与实际 REST 协议绑定；`model` 字段只有在官方 REST schema确认需要时才发送。

**验收**：TTS 请求路径和 body 快照测试；每个 output_format 枚举/数值范围测试；普通 bytes 与 timestamps JSON 两种响应都能生成正确音频；错误能区分未知 voice、语言、格式和鉴权失败。

### P5：公共 `MediaUploader` 与 xAI Files API

**涉及**：

- 新增公共契约：`packages/agent-runtime/src/services/media/media-uploader.ts`；
- xAI 实现：`packages/agent-runtime/src/services/media/adapters/xai-files-uploader.ts` 或同等 xAI adapter 模块；
- Spark bridge 注入点：由桌面主进程注入，不让 `agent-runtime` 反向依赖 `apps/desktop`。

公共契约至少表达：

```ts
interface MediaUploader {
  canHandle(provider: MediaProviderKind): boolean
  upload(input: {
    buffer: Buffer
    filename: string
    mimeType?: string
    purpose?: string
    expiresAfter?: number
  }): Promise<{
    fileId?: string
    url?: string
    publicUrl?: string
    expiresAt?: string
    provider: MediaProviderKind
  }>
}
```

实施要求：

1. xAI uploader 使用 `POST /v1/files` multipart；`expires_after` 必须排在 `file` 之前；TTL 仅允许官方 3600–2592000 秒，永久文件不发送 TTL。
2. 客户端采用 48 MiB 安全上限，并在错误中说明官方页面 48/50 MB 冲突；不能把超大本地文件转成无限大的 JSON base64。
3. 本地文件、`safe-file://`、data URL 必须先读取为 Buffer；不能把本地路径直接当作 xAI URL。
4. 对 xAI 输入建立以下顺序：
   - 已有可用 xAI `file_id` / 官方 URL：直接引用；
   - 本地/data URL 且 xAI Files 可用：优先调用 xAI Files 获取 `file_id`；
   - xAI Files 上传失败时，图片输入回退到 base64；视频输入不把 base64 作为首选，优先尝试 Spark 上传桥接获取 xAI 可访问的公开 URL；
   - 若 xAI 没有可用官方文件服务（仅适用于未来其他 provider 的同一抽象）：图片按 `base64 → Spark`，视频按 `Spark`；
   - Spark 上传只有拿到 xAI 可访问的公开 URL 才能继续；所有通道失败时输出明确错误，不返回“看似成功”的任务。
5. 用户未登录 Spark 时不得静默上传：返回结构化 `auth_required` 提示，并引导登录/注册；已登录但上传失败时显示准确原因和下一步。
6. 只在 xAI adapter/公共抽象调用链使用该策略；不得改变其他 vendor 原有 inputRef 顺序或上传方式。

**验收**：multipart 字段顺序测试、TTL 边界测试、48 MiB guard、safe-file 本地路径测试、登录态缺失引导测试、xAI file_id 注入测试、Spark fallback mock 测试。

### P6：xAI 产物持久化与回退策略

1. Image generate/edit、Video generate/edit/extend 默认添加：

```json
{
  "storage_options": {
    "filename": "...",
    "public_url": true
  }
}
```

2. 图片：
   - 优先读取 `file_output.public_url`；
   - public URL 创建失败但 `file_output.file_id` 存在时，保留 file_id 并优先使用 xAI 临时 URL/`b64_json` 物化；
   - 仍无法得到可用图片时，按 `base64 → Spark 平台文件服务` 回退并给 warning；
   - `public_url_error` 不能把已成功生成的图片误判成 provider 生成失败。
3. 视频：
   - 轮询完成后必须优先取 `video.file_output.public_url`；
   - `public_url_error` 或 storage failure 时，明确区分“视频已生成但官方 CDN 持久化失败”；
   - 不把视频成功结果改成 base64 或 Spark CDN 作为最终成功产物；按用户约束返回 error/需重试提示。
4. 默认 filename 必须有合法扩展名（图片按实际格式、视频 `.mp4`、音频按 codec），避免官方 CDN URL 生成错误。
5. `n > 1` 时每个图片结果独立读取各自的 `file_output`，不能复用第一个 URL/file_id。

**验收**：图片 public URL 成功、图片 public_url_error、视频 public URL 成功、视频 CDN 失败、n>1 独立 file_output 五类集成测试。

### P7：画布与 Skill/MCP 接入

#### 画布

1. 找到用户确认的参考图视频节点实际入口，确保 capability 最终为 `video.reference_to_video`，而不是误走只能 1 张首帧的 `video.image_to_video`。
2. R2V 画布最多允许 7 张参考图片；1.5 只显示 I2V 首帧，不能显示 R2V。
3. 画布 input role 映射必须保留 first frame/reference image/input video 的语义；xAI 对 last frame/reference video 给明确 warning/error。
4. 所有画布参数（aspect ratio、duration、resolution、response format、storage options、文件引用）通过同一个 `MediaGenerateInput` 到 xAI adapter，不在 Canvas 单独拼另一套 xAI body。
5. 画布选择 xAI 1.5 时动态过滤不支持的 operation/参数；不能选择后才由 provider 400。
6. 现有 `auth:upload-file` 作为 Spark fallback 时，显示登录态和上传失败提示；不绕开现有 token/401 续期。

#### Skill/MCP

1. `media-generation-mcp-server.mjs` 的 xAI native R2V 参考图上限由 4 改为 7，不改其他 provider。
2. MCP inputFiles 中 URL/base64/file_id 统一进入 xAI uploader/引用解析；不把本地路径直接发出。
3. MCP 的 `mode` 只作为内部/AI SDK 选项使用，发送 REST 前删除；加入快照测试。
4. Skill 返回的错误必须带 provider、model、capability、参数名、request_id（若有）和回退阶段，避免“未知错误”。

### P8：错误归一、warning 与隔离

1. xAI error contract 增加并测试：HTTP 401/403、400 参数错误、429 限流、503 服务不可用、轮询 `failed/expired`、Files 上传失败、`public_url_error`、storage failure。
2. 轮询失败时保留 `request_id`；错误消息带 xAI 原始 code/message 的安全截断。
3. 不支持参数不静默丢弃：通过 `droppedParams`/`contractWarnings` 告知参数名和原因；强约束组合直接 `invalid_input`。
4. 明确文案至少覆盖：
   - 1.5 只支持 I2V；
   - R2V 只支持参考图片；
   - R2V 最多 7 张、最多 10 秒；
   - xAI 不支持尾帧字段；
   - xAI Files 上传失败，当前正在尝试哪一层回退；
   - Spark 上传需要登录；
   - 视频官方 CDN 持久化失败。
5. 所有 xAI 特化逻辑由 `mediaProvider === 'xai'` / xAI manifest 守卫包住；其他 vendor 不进入这些分支。

### P9：xAI Files API 列表 + 删除管理 UI

**目标**：在桌面端某个侧面板/抽屉/列表视图中提供 xAI Files 的"列表 + 删除"管理能力，方便用户清理过期/无效文件、追踪上传结果，并作为后续（分块上传、生命周期清理）的前置 UI 脚手架。

**范围**：

| 项目 | 本期 |
|---|---|
| 列出文件 | ✅ `GET /v1/files`，按 `purpose/order/sort_by` 过滤，分页走 `pagination_token` |
| 删除文件 | ✅ `DELETE /v1/files/{file_id}`，单删 + 多选批量删除 |
| 文件详情 | ✅ filename / bytes / created_at / expires_at / purpose，悬浮卡或行展开 |
| 上传 | ⛔ 不在本 UI 重做，已由 P5 `MediaUploader` 承担；上传仍走画布任务输入 / Skills |
| 分块上传 / 续传 | ⛔ 列后续 TODO |
| 生命周期 / TTL 自动清理 | ⛔ 列后续 TODO |
| 其他 provider 的同类 UI | ⛔ 仅建立可复用 list 容器，契约由 `MediaUploader` 决定；本期只接 xAI |

**位置（已拍板 D）**：

经用户评审，xAI Files 管理 UI 放在 **ProvidersView Provider Drawer 内新增"文件管理"区块**（候选 D）。

- 触发方式：在 ProvidersView 编辑 xAI Provider 时，Drawer 内新增一个 `pv_section` 区块，区块内放列表/过滤/删除/分页控件。
- 范畴归属：xAI Files 严格按 `profileId`（即当前编辑的 Provider）作用域加载与操作；切换 Provider 编辑时重新加载该 Provider 名下的 Files。
- 与现有 Provider Drawer 风格一致：复用 `pv_section` 堆叠分区骨架（参考 `ProvidersView.tsx:3238-3244`）；区块标题"xAI Files" + 右上角刷新/批量删除按钮。
- 视觉规范：复用 `CanvasAssetManagerPanel` 的多选/虚拟化/Popconfirm 交互；`formatBytes` 借用 `SettingsView.tsx:5131`；过期时间展示借用 `PlatformModelAccountPanel.tsx:170`；空状态用 antd `<Empty>`（参考 `CanvasFilmAssetCenter.tsx:668-676`）。
- 仅在编辑 xAI Provider 时显示该区块；其他 vendor Provider Drawer 不显示；其他 vendor 的 Files API（如未来 apimart/openai 提供同类）后续再扩展，本期不接入。
- 用户决策原文："Files API 的列表、删除的管理 UI，就做在侧面板中找个地方放吧"（按 profileId 语义归属选择 D）。

**约束（无论哪个位置都必须满足）**：

1. 只读 xAI Files API，**不动其他 vendor**；其他 vendor 出现 Files API 时复用同一容器契约，但本期只接 xAI。
2. UI 容器组件可复用：列表/网格切换、多选、虚拟滚动（参考 `CanvasAssetManagerPanel:4, 26, 656`）、`Popconfirm` 删除确认、`formatBytes`（参考 `SettingsView.tsx:5131`）、过期时间展示（参考 `PlatformModelAccountPanel.tsx:170`）。
3. 必须有完整的 loading / empty / error / partial / unauthorized 状态：
   - **unauthorized**：未配置 xAI API Key / Provider 缺失 → 显示"去配置"CTA，跳转 ProvidersView；
   - **forbidden**：xAI API Key 无 Files 权限 → 提示检查 API Key 范围；
   - **rate_limit**：列表/删除遇到 429 → 指数退避 + 顶部 toast；
   - **network_error**：保留上次列表 + 提示重试，不清空列表；
   - **partial**：单条删除失败时不影响其余。
4. 默认过滤 `purpose=user_data` + `purpose=input`（按官方语义区分），但允许用户切换过滤；`purpose=assistants` 等其他 purpose 可不显示但要在过滤下拉中保留可见。
5. 列表展示字段至少：`filename`、`bytes`（人类可读 KB/MB，含 48 MiB 安全上限高亮）、`created_at`（相对时间 + 悬停绝对时间）、`expires_at`（剩余时长徽章；已过期红、24h 内黄、>24h 灰）、`purpose`、`object`。
6. 删除走两段式：第一次点击 → 行高亮 + "确认删除"按钮；二次点击 / Popconfirm OK → 调用 `DELETE /v1/files/{id}`；删除中行内 spinner；失败行回到原状态并红框。
7. 批量选择：受 `CanvasAssetManagerPanel.MAX_SELECTION=30` 启发，本 UI 默认单批 ≤30；可调。
8. 数据流（D 路径）：
   - 主进程新增 IPC：`provider:files:list`、`provider:files:delete`（按 `profileId` 作用域，从 Drawer 当前编辑的 Provider 上下文读取）；
   - renderer 封装：`apps/desktop/src/renderer/design/views/providers/providerFiles.api.ts`（独立文件，不混入 `canvas.api.ts`，因为 scope 是 Provider 而非画布）；
   - Drawer 打开时初始化：根据当前 `profile.kind === 'xai'` 决定是否挂载 `XaiFilesPanel` 子组件；非 xAI 不挂载；
   - agent-runtime 复用：xAI Files 客户端由 P5 阶段实现，本 P9 复用其 GET/DELETE（不再造并行客户端）；
   - 调用：`window.spark.invoke('provider:files:list', { profileId, purpose, limit, order, sortBy, paginationToken })` 与 `window.spark.invoke('provider:files:delete', { profileId, fileId })`。
9. 不在 renderer 直接持有 xAI API Key；所有请求经主进程 IPC，token 在主进程侧注入。
10. 测试覆盖：
    - 列表空 / 单条 / 多条 / 分页 / 排序；
    - 单删成功 / 单删失败 / 批量删除混合结果；
    - 过期 / 即将过期 / 永久 文件三种 UI 表现；
    - 未配置 Provider → 引导跳转；
    - 48 MiB 接近 / 超限标记；
    - 401/403/429/500 错误态。

**验收**：在拍板的位置出现新的"xAI Files"区/tab/list，可正常 list + delete 单/多文件，错误态完备，登录态/权限态清晰，与现有视觉规范一致；不影响其他 vendor 任何行为。

## 5. 实施顺序

### 阶段 A：协议与入口核对

- P0：锁定画布参考图视频节点实际桥接；核对 role 类型、MCP 参数、resolver。
- P1：补 1.5 模型/alias、模型级能力和 TTS preset 事实；清理错误的全局 1080p/尾帧声明。
- P2/P3：先完成官方参数 allowlist 和请求体快照，避免 Files/产物逻辑建立在错误 body 上。

### 阶段 B：xAI adapter 核心对齐

- P2：视频 T2V/I2V/R2V/edit/extend。
- P3：图片 generation/edit/multi-image。
- P4：TTS `/v1/tts`。
- 阶段 B 不修改其他 vendor 的基类语义；若必须触碰公共基类，只能添加 xAI provider guard，并补非 xAI 回归测试。

### 阶段 C：上传与产物

- P5：公共 `MediaUploader`、xAI Files、Spark 上传注入与登录态。
- P6：storage_options、public URL、图片/视频不同回退规则。
- P7：画布与 Skill/MCP 两个入口统一验证。

### 阶段 D：错误和交付验证

- P8：错误归一、warning、request_id、回退阶段展示。
- 全量运行 xAI 聚焦测试；有并行改动时不擅自覆盖他人文件，只运行与本计划改动相关的只读验证。

### 阶段 E：Files 管理 UI（P9）

- P9：在 ProvidersView xAI Provider Drawer 内新增"xAI Files"区块，挂载 list + delete 控件；复用 P5 阶段的 xAI Files 客户端（GET/DELETE）与 401/403/429 错误归一，不重复造接口；
- 阶段 E 仅在阶段 C 的 Files 客户端落地之后开始，避免 UI 调不通底层；
- 阶段 E 不修改非 xAI Provider 的 Drawer、不修改 `CanvasFilmAssetCenter`、不修改 `CanvasAssetManagerPanel` 既有画布资产逻辑。

## 6. 测试与验收矩阵

### 6.1 协议/manifest

- 1.5 三个官方 model ID/alias 均可解析；非官方别名不能进入 xAI preset。
- 1.5 capability 仅 I2V，T2V/R2V/edit/extend 在编译期被拦截。
- `grok-imagine-video` 与 1.5 的 resolution/model 组合正确区分。
- 图片 14 个 aspect ratio、`1k/2k`、视频 7 个 aspect ratio 全部逐项通过 schema 测试。
- R2V `maxImages=7`；R2V duration 上限 10；扩展 duration 2–10；视频生成 duration 1–15。
- image edit 多图 1–3 张；不得出现无官方依据的 n 最大值。

### 6.2 Adapter 请求体

- image generate：prompt/model/n/aspect_ratio/resolution/response_format/storage_options/user。
- image edit：单图 `image`、多图 `images`、URL/base64/file_id 混用、storage_options。
- video T2V：仅 prompt + 官方生成字段。
- video I2V：`image` 只出现一次，支持 URL/base64/file_id。
- video R2V：最多 7 个 `reference_images`，不能同时有 image，1.5 拒绝。
- video edit/extend：正确端点、字段 allowlist、轮询 request_id。
- TTS：`/tts`、`text/voice_id/language/output_format`，raw bytes/timestamps 两种响应。
- 所有本地 path/safe-file 输入都会在发请求前转成 base64、官方 file_id 或可访问 URL。

### 6.3 上传与回退

- xAI Files multipart `expires_after` 在 file 之前。
- TTL 3600、2592000 边界通过，越界明确报错。
- 48 MiB 安全上限行为稳定（与 `managing-files` 页面 48 MB 表述一致）。
- xAI uploader 失败后小文件走 base64；超限/不适合 base64 时走 Spark uploader；未登录显示登录/注册引导。
- 图片允许按约定回退；视频没有官方 CDN 时任务失败，不伪造成功。

### 6.4 画布与 Skill E2E

- 画布文生图、图生图、文生视频、首帧图生视频、参考图生视频、视频编辑、视频扩展、TTS 各跑一条 xAI 链路。
- 画布参考图视频节点确实命中 `video.reference_to_video`，7 张参考图不被截断为 4。
- 画布 xAI 1.5 只展示/允许 I2V；尾帧和参考视频给明确提示。
- Skill/MCP 与画布生成同一类请求体，不出现一边支持 file_id、一边只支持 base64 的分叉。
- 至少验证一次登录态缺失、xAI key 无效、参数不支持、R2V 超限、视频 CDN 持久化失败。

### 6.5 Files 管理 UI（P9）

- 拍板位置首次打开时显示空态 / 引导"去配置 xAI Provider"CTA（未配置时）。
- 列表加载：空 / 单条 / 多条 / 分页（`pagination_token`）/ 三种排序（`created_at` desc/asc、`bytes` desc/asc、`expires_at` asc）。
- 字段展示：filename、bytes（人类可读）、created_at（相对 + 绝对）、expires_at（剩余时长徽章：已过期红 / <24h 黄 / >24h 灰 / 永久绿）、purpose、object。
- 单删成功 / 单删失败 / 多选批量删除（默认 ≤30）混合结果；行级 spinner + 失败红框。
- 错误态：401 → 跳转 Provider 配置；403 → 提示检查 API Key 范围；429 → 指数退避；500 → 保留旧列表 + 重试 CTA。
- 48 MiB 接近（≥40 MiB）/ 超限（>48 MiB）视觉高亮。
- 不直接出现在画布项目资产中、不动其他 vendor UI；本 UI 只接 xAI。

## 7. 允许修改范围与隔离约束

### 7.1 预期可修改文件

- `packages/agent-runtime/src/services/media/adapters/xai-media.adapter.ts`
- `packages/agent-runtime/src/services/media/adapters/xai-files-uploader.ts`（新建或等价 xAI 模块）
- `packages/agent-runtime/src/services/media/media-uploader.ts`（新建公共契约）
- `packages/agent-runtime/src/services/media/media-adapter.types.ts`（只有 role/依赖注入确有必要时）
- `packages/agent-runtime/src/services/media/adapters/openai-compatible-media.adapter.ts`（只改 xAI 守卫或抽取不改变其他 vendor 的公共逻辑）
- `packages/protocol/src/media-model-manifest.ts`（只改 xAI manifest/schema/error contract）
- `packages/protocol/src/provider-presets.ts`（只改 xAI image/video/TTS preset）
- `packages/protocol/src/media-config.ts`（只有 P0 核实确实需要补既有画布节点映射时）
- `packages/agent-runtime/src/tools/media-generation-mcp-server.mjs`（只改 xAI native 分支）
- 画布实际节点/编译文件（仅 P0 核实到的 xAI 接入点；不重做其他节点）
- Spark 上传 bridge 的最小依赖注入文件（复用现有 AuthService/EduServerClient，不修改其他 vendor 上传逻辑）
- **P9（已拍板 D）具体可修改文件**：
  - `apps/desktop/src/renderer/design/views/providers/ProvidersView.tsx`：在 xAI Provider Drawer 内新增 `pv_section` 区块"xAI Files"；非 xAI Provider 不渲染该区块。
  - `apps/desktop/src/main/ipc/provider-files.ts`（新建）：注册 `provider:files:list` / `provider:files:delete` IPC，参数 `profileId` 必填；调用 agent-runtime 的 xAI Files 客户端；处理 401/403/429/5xx 并返回结构化错误。
  - `apps/desktop/src/main/ipc/index.ts`：注册 `registerProviderFilesIpc`（按现有 `register*Ipc` 风格）。
  - `apps/desktop/src/renderer/design/views/providers/providerFiles.api.ts`（新建）：封装 `window.spark.invoke('provider:files:list' | 'provider:files:delete', ...)`；前端只持有类型，不直接持有 token。
  - 复用 `CanvasAssetManagerPanel` 的多选/Popconfirm 交互、`SettingsView.tsx:5131 formatBytes`、`PlatformModelAccountPanel.tsx:170` 过期时间展示、`CanvasFilmAssetCenter.tsx:668-676` 空态样式；不修改这些原文件的行为，只按需抽出可复用辅助组件（必要时）。
  - agent-runtime 侧：复用 P5 阶段的 xAI Files 客户端（multipart 上传 + GET/DELETE）；不新建并行 Files 客户端。
  - **不修改**：`CanvasFilmAssetCenter.tsx` 任何影视资产 tab 与其数据流；其他 vendor Provider Drawer；`CanvasAssetManagerPanel.tsx` 既有画布资产逻辑（仅借用交互模式，不嵌入 xAI Files）。

### 7.2 禁止越界

- 不修改其他 vendor adapter 的字段、默认值和回退链。
- 不把 xAI 7 张参考图、xAI CDN、xAI file_id 规则写成所有 provider 的全局默认。
- 不把 STT、retry、headers、Responses API 混入本期实现。
- 不用 find-and-replace 重命名公共 symbol；若需要公共 API 变更，先做调用方影响审查并补兼容分支。

## 8. 后续 TODO

- xAI STT REST/WSS capability 和画布语音转写接入。
- xAI TTS/STT streaming WSS。
- retry/backoff 和 provider-specific rate-limit 策略。
- 自定义 headers / `forwardUserIp`。
- Files API 分块上传、生命周期 / TTL 自动清理、按 `purpose` 的批量管理操作。
- 其他 vendor 的 `MediaUploader` 实现；本期只建立可切换契约并完成 xAI/Spark 所需实现。
- 官方文档后续若变更图片 n 上限、TTS model 语义、产物持久化策略或 R2V 限制，重新刷新本计划和 manifest。

## 9. 官方参考链接汇总

- https://docs.x.ai/developers/models
- https://docs.x.ai/developers/models/grok-imagine-video-1.5
- https://docs.x.ai/developers/model-capabilities/images/generation
- https://docs.x.ai/developers/model-capabilities/images/editing
- https://docs.x.ai/developers/model-capabilities/images/multi-image-editing
- https://docs.x.ai/developers/rest-api-reference/inference/images
- https://docs.x.ai/developers/model-capabilities/video/generation
- https://docs.x.ai/developers/model-capabilities/video/image-to-video
- https://docs.x.ai/developers/model-capabilities/video/reference-to-video
- https://docs.x.ai/developers/model-capabilities/video/editing
- https://docs.x.ai/developers/model-capabilities/video/extension
- https://docs.x.ai/developers/rest-api-reference/inference/videos
- https://docs.x.ai/developers/files/managing-files
- https://docs.x.ai/developers/model-capabilities/imagine/files/inputs
- https://docs.x.ai/developers/model-capabilities/imagine/files/outputs
- https://docs.x.ai/developers/rest-api-reference/files/upload
- https://docs.x.ai/developers/model-capabilities/audio/text-to-speech
- https://docs.x.ai/developers/rest-api-reference/inference/voice
- https://docs.x.ai/developers/model-capabilities/audio/speech-to-text

## 10. 本次审查后的关键差异摘要

相较旧版计划，本版新增或修正了以下内容：

1. 修正了 `media-config.ts` 实际位于 `packages/protocol/src/` 的路径错误，并补充 router、compiler、artifact、Auth 上传链路。
2. 把“xAI 显式不发尾帧”修正为“公共基类当前会发 `last_frame_image`，必须由 xAI 分支阻止并给用户提示”。
3. 把 `grok-imagine-video-1.5` 的官方 alias 固化为文档已确认的三个 ID，同时加入模型级 capability 过滤。
4. 将 R2V 的官方上限修正为 7 张、最大 10 秒；MCP 当前 4 张截断列为缺陷。
5. 移除了旧计划中没有官方依据的图片 n 最大值、STT `model/response_format`、48 MB/50 MB 单一结论和 TTS `voice/input/response_format` 兼容字段表述。
6. 新增 xAI TTS `/v1/tts` 协议修复，覆盖 `voice_id`、`output_format` 和 timestamps JSON 响应。
7. 新增公共上传契约与现有 Spark `auth:upload-file` 登录态桥接，明确 xAI 输入回退和视频产物不允许降级 CDN 的差异。
8. 将“画布 reference_to_video 已存在”作为用户确认事实执行，同时把当前代码未发现独立 operation 的冲突写入 P0，避免重复造节点或误接到 I2V。
9. 将 STT、retry、headers 明确留在 TODO，不再把它们混进本期实施验收。
10. **新增 P9（xAI Files API 列表 + 删除管理 UI）**：本期范围扩张项，明确基于官方 `GET /v1/files` + `DELETE /v1/files/{id}` 协议；放置位置已拍板 **D = ProvidersView xAI Provider Drawer 内新增"文件管理"区块**（按 profileId/API Key 归属最自然），具体文件清单见 7.1；同步移除旧计划中"Files 列表删除管理 UI 不在本期"的限制。
11. **修正 Files 上限文档冲突表述**：`managing-files` 页面已统一为 48 MB，移除旧计划"48/50 MB 文档冲突"的兜底说法；客户端统一按 48 MiB 安全上限拦截。
