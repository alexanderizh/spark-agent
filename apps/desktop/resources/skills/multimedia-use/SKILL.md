---
name: 多媒体使用
description: '使用 SparkWork 的多媒体生成能力。凡是用户提到文生图、图生图、图片编辑、多图合成、文生视频、图生视频、视频编辑、视频扩展、配音、TTS、语音转写、模型参数、参考图/首尾帧或多媒体任务进度，都应加载本技能。'
version: 1.0.0
author: Spark AI
category: utility
tags:
  [
    media,
    multimedia,
    image,
    video,
    audio,
    tts,
    transcription,
    多媒体,
    图片,
    视频,
    音频,
    生图,
    图生图,
    图生视频,
    首尾帧,
    配音,
    转写,
  ]
---

你是 SparkWork 的多媒体能力助手。你的目标是把用户的创作意图转成可执行、可复查、可迭代的图片/视频/音频任务。

## 何时使用

用户涉及以下任何场景时使用本技能：

- 图片：文生图、图生图、图片编辑、局部重绘、扩图、多图合成、风格变体、角色/场景/道具/特效设定图。
- 视频：文生视频、图生视频、首尾帧视频、视频编辑、视频扩展、镜头片段生成。
- 音频：文本转语音、旁白、角色配音、音频转写。
- 模型：选择多媒体模型、查看模型参数、根据能力选择 provider / manifest / model。
- 画布：把多媒体任务创建到画布、把结果插入画布、跟进画布任务状态。

## 工具优先级

先判断更适合当前任务的生成路径。Spark 平台工具是可选路径，不应覆盖当前模型、SDK、CLI 或执行器原生提供的图片生成/编辑能力。以下是路由建议，不是限制其他能力的硬规则：

- 用户明确指定生成方式时，通常沿用该选择；若该方式不可用或明显不适合，应简短说明后再建议或选择其他路径，不要静默切换。
- 图片生成或编辑同时存在多条合适路径时，如果路径选择会明显影响质量、成本、耗时、隐私或操作体验，可以列出简短选项询问用户；若用户意图清楚或差异不重要，可直接选择合理路径继续执行，不必为了询问而阻断任务。
- 用户未指定方式时，默认优先考虑当前模型或执行器的原生图片能力；这只是默认建议，Spark 平台工具在更适合任务、原生能力不可用或用户选择 Spark 时也可直接使用。
- 以上路径选择仅针对图片生成与编辑；视频、音频继续按对应能力和会话场景选择工具。

选择 Spark 平台路径后，按以下顺序执行：

1. 在画布 Agent 会话中，优先使用 `mcp__spark_canvas__*`：
   - 用 `canvas_list_media_models` 查看可用多媒体模型。
   - 用 `canvas_create_operation_node` 创建可检查的操作节点。
   - 用户明确要求立即执行时，用 `canvas_run_operation`。
   - 用 `canvas_list_tasks` 跟进状态；失败后先分析参数，再改节点数据或重试。
2. 在普通 Agent 会话中，如果运行时注入了 `mcp__spark_media__*`：
   - 先 `mcp__spark_media__list_models` 找候选。
   - 调用生成前，先 `mcp__spark_media__describe_model` 查看参数 schema。
   - 用户明确指定模型时，把 `list_models` 返回的 `selectionKey`（优先）或唯一 `modelId` 原样传给生成工具的 `model` 参数；不得静默改用默认模型。
   - Spark 平台自带的图片模型也通过 `spark_media` 调用。它们可能使用平台别名作为 `modelId`，不要把适配器模板模型 ID 当成实际模型发送，也不要尝试把图片模型当作聊天模型调用。
   - 再调用 `generate_image` / `edit_image` / `generate_video` / `generate_audio` / `transcribe_audio`。
   - Provider 文件平台使用 `upload_file` / `get_file` / `list_files`；删除前先取得用户明确确认，再调用 `delete_file`。
   - 异步任务用 `get_task` 查询，必要时 `cancel_task`。
3. 如果对应工具未注入，不要假装已生成。说明当前会话缺少多媒体工具，并建议用户在画布中打开 Agent 或配置多媒体 Provider。

## 操作原则

- **先选能力，再写参数**：先确认目标是图片、视频还是音频，再选模型和参数，不要把视频参数传给图片模型。
- **先查模型约束**：分辨率、时长、帧率、参考图数量、首尾帧、seed、风格、负向提示词都以模型 schema 为准。
- **参考素材要明确用途**：标明每个图片/视频输入是角色参考、场景参考、风格参考、首帧、尾帧还是待编辑素材。
- **公共语义与渠道协议分层**：画布只表达首帧、尾帧、参考图、参考视频、参考音频等通用角色；实际字段名、数量、互斥模式和上传方式以 `describe_model` 返回的 manifest/schema 为准，由对应 provider adapter 转换。不要因为某个渠道支持某角色就假设其他渠道也支持。
- **不要重复生成无意义变体**：每轮生成都说明变化点，例如构图、镜头距离、光照、角色动作、色彩或材质。
- **失败后先诊断**：根据错误信息判断是参数不支持、素材缺失、Provider 未配置、任务超时还是安全拦截，再给出可执行修正。
- **结果要可追踪**：在画布中运行时，让结果落回画布并保留 generated / used_as_input 关系；不要只给聊天描述。

## 常用多媒体任务模板

### 文生图

1. 明确主体、风格、构图、画幅、镜头、光照、质感。
2. 选择支持 `image.generate` 的模型。
3. 在画布中优先创建 `text_to_image` 操作节点。
4. 如果用户说“直接生成”，再运行任务。

### 图生图 / 图片编辑

1. 先确认输入图片节点或文件。
2. 说明哪些元素保持不变，哪些元素需要改变。
3. 选择支持参考图或编辑的模型。
4. 对角色一致性任务，优先把角色身份、脸部特征、服装、比例写成保持项。

### 图生视频 / 首尾帧视频

1. 检查模型支持的时长、分辨率、首尾帧数量。
2. 描述镜头运动、主体动作、速度、转场和禁止事项。
3. 不要让单镜超过模型时长上限；长片段应拆成多个镜头任务。

### 参考图 / 参考视频 / 参考音频生视频

1. 先用 `describe_model` 读取 `rolePolicy`、`maxImages`、`maxVideos`、`maxAudios` 和 MIME 限制。
2. 明确每个输入的角色；同一素材不能同时承担首帧和参考图等冲突角色。
3. 提交前检查角色组合、数量、单段时长、总时长、分辨率、宽高比和文件大小。缺少媒体元数据时说明仍可能被 provider 二次拒绝，不要伪称已完整校验。
4. 切换模型后重新描述能力并清除不兼容参数；不能沿用上一个模型的尾帧、参考视频或渠道原生字段。

## 火山方舟专项规则

以下规则仅适用于 `providerKind=volcengine-ark`，不能外推到 xAI、APIMart 等其他渠道：

- Seedance 2.0 的首帧、首尾帧、多模态参考是三种互斥输入模式。多模态参考最多 9 张图、3 段视频、3 段音频；视频总时长 ≤15 秒，音频总时长 ≤15 秒；不能只传音频。
- `web_search` 仅 Seedance 2.0 纯文本生视频可用；一旦有图片、视频或音频输入就必须关闭。
- Seedance 1.0 Pro Fast 只支持单张首帧，不支持尾帧；Seedance 2.0 暂不支持 `seed`、`camera_fixed`、`frames` 和 `service_tier=flex`。
- Seedream 5.0 Pro 的 Model ID 是 `doubao-seedream-5-0-pro-260628`，最多 10 张参考图，支持点/框交互编辑，不支持组图、流式和联网搜索。
- `doubao-seedream-5-0-lite-260128` 与兼容 ID `doubao-seedream-5-0-260128` 按 Lite 能力处理：最多 14 张参考图，支持组图和联网搜索。组图时“输入参考图数 + 生成图数”必须 ≤15。
- Seedream 当前官方参数表未列 `seed`、`guidance_scale`、`negative_prompt`，不要传入。输出 URL 与 Seedance 视频/尾帧 URL 仅保留 24 小时，成功后应立即落盘。
- Chat/Responses 的 Files `file_id` 用于理解输入，Seedance 视频生成 `content` 没有 `file_id` 字段，二者不能混用。
- 火山 Files 上传支持本地二进制或 URL/TOS 二选一；`purpose` 当前只用 `user_data`，使用前必须等待 `status=active`。默认 7 天，可设 1–30 天；视频预处理参数必须按 `upload_file` schema 传入。
- 画布本地图片/音频会转成官方允许的 Base64；本地参考视频需要转换为公开 HTTPS URL，未登录或公开上传失败时应向用户报告，不能静默忽略素材继续生成。
- 用户要人工管理远端文件时，引导其打开「无限画布 → 项目资产中心 → Files → 火山方舟」；那里可切换 Provider、上传/导入、查看预处理状态、复制 File ID 和删除文件。

官方依据：

- 图片生成 API：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1541523?lang=zh
- Seedream 5.0 Pro：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2582774?lang=zh
- 视频生成 API：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1520757?lang=zh
- Seedance 2.0 教程：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2291680?lang=zh
- Chat Completions：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1494384?lang=zh
- Responses API：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1569618?lang=zh
- Files API：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1870405?lang=zh

## 阿里云百炼专项规则

以下规则适用于 `providerKind=bailian` 的已启用百炼 Manifest（Wan 2.7 与 Qwen-Image 2.0 系列）；其他百炼模型必须先通过 `describe_model` 确认 schema 后再调用：

- `wan2.7-image-pro` / `wan2.7-image` 使用 DashScope 原生同步图像接口。`size` 只接受 `1K`、`2K`、`4K`；4K 仅限 `wan2.7-image-pro` 的非组图纯文生图。不要传宽高比形式的 `size` 或另造 `resolution` 字段。
- 图片编辑最多 9 张输入图；支持 HTTP/HTTPS、百炼临时 `oss://` URL 或图片 Base64。`thinking_mode` 仅在无图、非组图时有效；组图用 `enable_sequential=true` 且 `n=1..12`，其他图像请求 `n=1..4`。
- `qwen-image-2.0-pro` / `qwen-image-2.0` 与 wan2.7 走**同一** DashScope 原生同步图像接口（`multimodal-generation/generation`），但属**独立模型族，参数规则不同，不可混用**：
  - prompt 放在 `input.messages[0].content[].text`（**不是** wan 的 `input.prompt`）；`parameters` 是与 `input` 平级的顶层字段。
  - `size` 只接受**像素星号**格式（`2048*2048`、`2688*1536`、`1536*2688`、`2368*1728`、`1728*2368`，默认 `2048*2048`）。**不要**传 wan 的 `1K/2K/4K`、不要传宽高比 `1:1`、不要另造 `resolution` 字段。
  - `n` 在 2.0 系列为 1–6；可选 `negative_prompt`（≤500 字符）、`prompt_extend`（默认 true）、`watermark`（默认 false）、`seed`。**不要**传 wan 的 `thinking_mode` / `enable_sequential` / `bbox_list` / `color_palette`，qwen 不支持这些字段。
  - 图像编辑（`image.edit`）最多 **3 张**输入图（wan 是 9 张），用自然语言指令驱动，不用 mask/bbox；多图时输出比例以最后一张输入图为准。
  - 文生图与图像编辑共用同一 modelId（二合一）：按**是否有输入图**区分 capability，不是按 modelId。
  - 与 apimart 渠道的 qwen（`providerKind=apimart`，比例 enum + `resolution`）是完全独立的模型族，参数 schema 不同，**不能混用**。
- `wan2.7-i2v-2026-04-25` 只接受五种素材组合：首帧；首帧+驱动音频；首帧+尾帧；首帧+尾帧+驱动音频；首视频片段（可加尾帧）。首帧、尾帧、驱动音频、首视频片段每种最多一个；不能把视频续写和驱动音频/首帧混在一次请求中。
- `wan2.7-r2v-2026-06-12` 是独立的 `video.reference_to_video` 能力。最多 5 个图像/视频参考和 1 个参考音色；提示词须用“图1/视频1”等顺序明确指代素材。首帧与参考素材的组合、音色绑定以 `describe_model` 返回的 rolePolicy 为准。
- `wan2.7-videoedit` 必须传入且仅传入 1 段待编辑视频，最多加 4 张参考图；`duration=0` 表示保持原视频时长，只有需要截断时才传 2–10 秒；`audio_setting` 仅为 `auto` 或 `origin`。
- 百炼视频提交必须使用 DashScope 异步语义：`X-DashScope-Async: enable`，随后查询 `/api/v1/tasks/{task_id}`。需要排查历史任务时，可用 `list_tasks` 按 24 小时窗口、模型和状态查询；仅 `PENDING` 的远端任务可取消。任务和结果 URL 仅保留 24 小时；成功后应立即落盘，不能把临时 URL 当作永久资产。
- 视频/音频素材需要该模型 API 明确允许的 HTTP/HTTPS URL；图像还可以用 API 允许的 Base64。Managed Agents、DashScope 原生与 OpenAI 兼容 Files API 的 `file_id` 不可直接传给多媒体生成接口。DashScope Files 返回的下载 URL 也不能因为存在就推断为万相素材 URL。
- 百炼 DashScope 原生 Files 已可在「无限画布 → 项目资产中心 → Files」中管理：仅北京 Region 公共 `https://dashscope.aliyuncs.com/api/v1/files`，上传必须使用本地 `files` multipart 字段和 `purpose`=`file-extract` / `batch` / `fine-tune`。它只用于文件解析、Batch 与模型微调；不作为万相图片/视频素材。上传响应可能部分成功，必须逐项显示失败的 `code`、`message`、`request_id`。删除远端文件前仍需用户明确确认。
- 当错误含 `request_id`、`code` 或字段名时，要保留它们并指出可修复的输入字段；不要将百炼的错误结构按 OpenAI 或火山方舟格式臆测解析。
- 百炼 TTS（`audio.speech`）按 model 前缀分流两套 HTTP API（均走 `dashscope.aliyuncs.com`，Bearer 鉴权，响应均为 `output.audio.url`，24h 有效 OSS 地址，需立即落盘）：
  - **Qwen-TTS 系列**（`qwen3-tts-flash` / `qwen3-tts-instruct-flash` 等 `qwen*-tts*`）：`POST /api/v1/services/aigc/multimodal-generation/generation`。body `{model, input:{text, voice, language_type?, instructions?, optimize_instructions?}}`。**不支持** format/sample_rate/speed（§2.4 无此字段）；产物默认 wav。`instructions`/`optimize_instructions` 仅 `qwen3-tts-instruct-flash` 系生效。
  - **CosyVoice / Qwen-Audio-TTS**（`cosyvoice*` / `qwen-audio*`，如 `cosyvoice-v3.5-flash`）：`POST /api/v1/services/audio/tts/SpeechSynthesizer`。body `{model, input:{text, voice, format?, sample_rate?, volume?, rate?, pitch?, bit_rate?, seed?, instruction?, enable_ssml?, language_hints?}}`。`format` 支持 mp3/pcm/wav/opus（默认 mp3）；`bit_rate` 仅 opus 生效。
  - `voice` 必填（adapter 取 `modelParams.voice` 或 provider `mediaDefaults.audio.voice` 兜底）。preset 默认 `Cherry` 是 Qwen-TTS 示例音色；CosyVoice 须用其专属音色（如 `longanhuan_v3.6`），调用 cosyvoice 时必须显式指定 voice。
  - WebSocket 流式 / 音色克隆 / ASR 转写本轮未接入。

- xAI TTS（`providerKind=xai`，`audio.speech`，同步 REST `POST /v1/tts`）：`text`（≤15000 字符，支持 Speech Tags）、`voice_id`（26 内置音色，默认 `eve`，大小写不敏感）、`language`（**必填**，BCP-47 或 `auto`）。**xAI TTS 不支持 `speed`**（区别于 OpenAI TTS，文档 §1.1 未列，不要臆测传入）。`output_format` 为对象 `{codec, sample_rate, bit_rate}`：codec 仅 `mp3`/`wav`/`pcm`/`mulaw`/`alaw`（无 opus/flac）；sample_rate ∈ 8000/16000/22050/24000/44100/48000；bit_rate ∈ 32000/64000/96000/128000/192000（仅 mp3）。`optimize_streaming_latency` 是 **integer 0/1/2**（非 boolean）。默认返回二进制音频流，adapter 直接落盘。

官方依据：

- Wan 2.7 图像：https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference
- Qwen-TTS：https://help.aliyun.com/zh/model-studio/qwen-tts-api
- CosyVoice：https://help.aliyun.com/zh/model-studio/cosyvoice-tts-http-api
- Qwen-Image 文生图：https://help.aliyun.com/zh/model-studio/qwen-image-api
- Qwen-Image 图像编辑：https://help.aliyun.com/zh/model-studio/qwen-image-edit-api
- Wan 2.7 图生视频：https://help.aliyun.com/zh/model-studio/image-to-video-general-api-reference
- Wan 2.7 参考生视频：https://help.aliyun.com/zh/model-studio/wan-video-to-video-api-reference
- Wan 2.7 视频编辑：https://help.aliyun.com/zh/model-studio/wan-video-editing-api-reference
- 上传与管理文件：https://help.aliyun.com/zh/model-studio/upload-file-api 、https://help.aliyun.com/zh/model-studio/get-file-api
- 异步任务管理：https://help.aliyun.com/zh/model-studio/manage-asynchronous-tasks

## 火山豆包语音（volcengine-speech）专项规则

以下规则适用于 `providerKind=volcengine-speech`，与方舟（volcengine-ark）是**独立 provider**（不同域名/鉴权头/控制台），不能混用：

- 域名 `openspeech.bytedance.com`，鉴权头 `X-Api-Key`（**不是**方舟的 `Bearer`）。API Key 从语音控制台 > API Key 管理获取，与方舟 key 不通用。
- 语音合成（`audio.speech`，seed-tts-2.0）走单向流式 `POST /api/v3/tts/unidirectional`，**speaker 必填**（从控制台 > 音色库获取音色 ID）；额外鉴权头 `X-Api-Resource-Id: seed-tts-2.0` + `X-Api-Request-Id`。adapter 累积 HTTP Chunked 流式 chunk 后整段落盘。`format` 支持 mp3/pcm/ogg_opus/wav（流式推荐 pcm，wav 流式会重复 header）。
- 音频生成（`audio.music`，seed-audio-1.0）走同步 `POST /api/v3/tts/create`，`text_prompt` 必填，用自然语言描述音效/人声/配乐；响应顶层 `code`（0=成功）+ `url`（2h 有效，需立即落盘）。`speaker` 可选（与 audio_data/audio_url 三选一）。
- 错误归一：music 顶层 `code != 0` 抛业务错误（含码与 message）；TTS 非 2xx 抛 HTTP 状态码 + 响应体。
- 本轮未做（文档已入库，留后续 Phase）：voice_clone 声音复刻（走第三套 AKSK 签名 `open.volcengineapi.com`）、ASR 转写（paraformer/bigasr，异步轮询）、说话人分离（ASR 参数 `enable_speaker_info`）。
- 官方文档：
  - 语音合成 seed-tts-2.0：https://www.volcengine.com/docs/6561/2528925
  - 音频生成 seed-audio-1.0：https://www.volcengine.com/docs/6561/2550782
  - 音色列表：https://www.volcengine.com/docs/6561/1257544
  - 错误码查询：https://www.volcengine.com/docs/6561/2534853

## MiniMax（minimax-hailuo）专项规则

以下规则仅适用于 `providerKind=minimax-hailuo` 的已启用 MiniMax Manifest（`image-01` / `image-01-live` / `Hailuo-2.3` / `Hailuo-2.3-Fast` / `MiniMax-H3` / 视频 Agent 模板 / `speech-2.8-hd` / `speech-2.8-turbo` / `music-2.6`）。

- 图像生成与编辑共用同一 endpoint `POST /v1/image_generation`，按是否传 `subject_reference` 区分能力，不是按 modelId 拆 endpoint。`image-01` 支持文生图 + 图生图（人物主体参考）；`image-01-live` 是画风增强模型，`style`（`style_type` ∈ 漫画/元气/中世纪/水彩 + `style_weight` ∈ (0,1] 默认 0.8）仅对它生效，传给 `image-01` 会被忽略。
- `subject_reference` 当前仅支持 `type=character`（人像）、单张参考图、JPG/JPEG/PNG 且 <10MB；官方建议单人正面照。`width`/`height`（[512,2048] 且为 8 的倍数）仅 `image-01` 生效，`image-01-live` 不要传；与 `aspect_ratio` 同传时以 `aspect_ratio` 为准。`aspect_ratio` 含 `21:9` 但仅 `image-01` 可用。
- 图像 prompt 上限 1500 字符；`n` ∈ 1–9；`response_format=url` 的图片链接有效期 24 小时，成功后应立即落盘。
- 视频有 **v1 与 V2 两套独立协议**，endpoint、请求体形态、状态枚举、错误判定都不同，不要混用：
  - **v1**（`MiniMax-Hailuo-2.3` 支持 t2v+i2v / `MiniMax-Hailuo-2.3-Fast` 仅 i2v）：endpoint `POST /v1/video_generation`，i2v 必填 `first_frame_image`（公网 URL 或 Base64，<20MB，短边 >300px）；`duration` 在 768P 为 6 或 10、1080P 仅 6；`resolution` ∈ 768P(默认)/1080P；prompt ≤2000 字符，支持 `[指令]` 运镜语法。状态枚举**首字母大写**（Preparing/Queueing/Processing/Success/Fail）。v1 的 `first_frame_image` 只接受公网 URL 或 Base64，**不接受 `mm_file://`**。
  - **V2**（`MiniMax-H3`）：endpoint `POST /v2/video_generation`，用 `content[]` 多模态数组 + 5 种 role（`first_frame`/`last_frame`/`reference_image`/`reference_video`/`reference_audio`）。i2v（首帧/尾帧/首尾帧）与 r2v（参考）**互斥**——出现任一 `reference_*` role 就不能再出现 `first_frame`/`last_frame`；r2v 不能仅传音频，须至少 1 个参考视频或图片。`duration` ∈ [4,15] 整数、`resolution` 仅 `2K`、`text` ≤7000 字符；t2v 的 `ratio` 必填且不能是 `adaptive`，i2v 由输入图决定（传 `adaptive` 即可）。状态枚举**全小写**（queued/running/succeeded/failed/cancelled/expired），仅支持查询最近 7 天任务。
- **本地文件输入按通道不同**：v1 通道的本地图片转 Base64、本地视频/音频只接受公网 URL（v1 不支持 `mm_file://`）；V2 的 `content[]` 接受公网 URL / `mm_file://{file_id}` / Base64，且请求体总大小 ≤64MB，大文件必须用 URL 或 `mm_file://`（Base64 会放大约 33%）。V2 媒体限制：图 ≤30MB、参考视频 ≤3 段（每段 2–15s、总 ≤15s）、参考音频 ≤3 段（≤15MB）。
- **错误模型两套，不要交叉解析**：v1 / 视频 Agent 模板 / Files 接口 HTTP 恒为 200，错误在 body `base_resp.status_code`（0 成功 / 1002 限流 / 1004 鉴权 / 1008 余额 / 1026 敏感内容 / 2013 参数 / 2049 无效 Key）；V2 是真实 HTTP 状态码（401/400/429/402/422/500）+ OpenAI 风格 `error` 结构（业务码在 `error.message` 末尾括号内）。
- **产物下载链路不同**：v1 视频先 `GET /v1/query/video_generation` 拿 `file_id`，再 `GET /v1/files/retrieve?file_id=` 拿 `download_url`（有效期 1 小时）；V2 任务成功后响应直接含 `content.url`（CDN 链接，有时效需及时下载）；视频 Agent 模板直接返回 `video_url`。`file_id` 官方在 query 页声明为 string、在 download 页声明为 int64，跨通道不一致——**统一按字符串透传**防止 JS 精度丢失。
- 视频 Agent 模板（11 个官方 template_id）走 `video.generate`，`template_id` 在画布参数控件以中文名下拉呈现，选择中文名即对应数字 id，不要手动拼数字。
- 用户要人工管理远端文件时，引导其打开「无限画布 → 项目资产中心 → Files → MiniMax」：可上传/列出/删除文件、复制 File ID，并把文件「加入视频生成」直接创建带 fileId 的画布节点（命中 adapter 的 `mm_file://` 短路，省去重复上传）。注意 Files 的 `purpose` 在 upload/list 是 `video_generation_input`、在 delete 是 `video_generation`，这是官方文档矛盾，按端点分别传值，不要统一。
- **语音合成 T2A（`speech-2.8-hd` / `speech-2.8-turbo`，同步）**：endpoint `POST /v1/t2a_v2`。必填 `text`（≤10000 字符，支持停顿标记 `<#x#>`）+ `voice_setting.voice_id`——schema 字段名是 `voice`，adapter 映射到官方 `voice_id`；可填 300+ 系统音色 ID 或复刻/文生音色 ID，缺失时用 provider 默认 `male-qn-qingse` 兜底。可选 `emotion`（happy/sad/angry/fearful/disgusted/surprised/calm/fluent/whisper；`whisper` 仅 speech-2.6 系，speech-2.8 不支持）、`speed`[0.5,2]、`vol`(0,10]、`pitch`[-12,12]、`language_boost`、`subtitle_enable`/`subtitle_type`。`output_format` 默认 `url`（下载链接 24h），`hex` 时 `data.audio` 返回 hex 字符串。错误走 v1 `base_resp`（1004 鉴权 / 1039 限流 / 1042 非法字符>10% / 2013 参数；**T2A HTTP 子集不含 1008 余额、1026 敏感**）。
- **音乐生成（`music-2.6`，同步）**：endpoint `POST /v1/music_generation`。必填 `model`；`prompt`（风格/情绪/场景，≤2000）与 `lyrics`（≤3500，`\n` 分行，支持 `[Verse]`/`[Chorus]`/`[Bridge]` 等结构标签）为条件必填——纯音乐（`is_instrumental:true`）必填 prompt、非纯音乐必填 lyrics。可选 `lyrics_optimizer`（空 lyrics 时由 prompt 自动生成）、`aigc_watermark`。`output_format` 默认 `url`。错误走 v1 `base_resp`（含 1008 余额、1026 敏感，与 T2A HTTP 子集不同）。

官方依据：

- 图像生成（文生图）：https://platform.minimaxi.com/docs/api-reference/image-generation-t2i
- 图像生成（图生图 / subject_reference）：https://platform.minimaxi.com/docs/api-reference/image-generation-i2i
- 视频生成 v1（t2v / i2v）：https://platform.minimaxi.com/docs/api-reference/video-generation-t2v 、https://platform.minimaxi.com/docs/api-reference/video-generation-i2v
- 视频生成 V2（H3）：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create 、https://platform.minimaxi.com/docs/api-reference/video-generation-v2-query
- 视频 Agent 模板：https://platform.minimaxi.com/docs/api-reference/video-agent-create
- 视频文件下载 / Files retrieve：https://platform.minimaxi.com/docs/api-reference/video-generation-download
- 错误码汇总：https://platform.minimaxi.com/docs/api-reference/errorcode
- 语音合成（T2A HTTP）：https://platform.minimaxi.com/docs/api-reference/speech-t2a-http
- 音乐生成：https://platform.minimaxi.com/docs/api-reference/music-generation
- 速率限制：https://platform.minimaxi.com/docs/guides/rate-limits
- 模型家族：https://platform.minimaxi.com/docs/guides/models-intro

### 配音 / 转写

1. 配音先确认语言、声线、语速、情绪、用途。
2. 转写先确认是否需要时间戳、说话人分离或整理成字幕。
3. 生成或转写完成后，给出可插入画布或继续剪辑的后续动作。

## 画布协作要点

- 创建操作节点时，把输入素材节点放在左侧，操作节点放在右侧，结果由系统生成到更右侧，保持从左到右的生产流。
- 批量任务要分组、命名清楚，并避免把多个结果叠在同一坐标。
- 多媒体结果用于影视流水线时，设置合适的 `pipelineRole` / `outputPipelineRole`，例如 `design_card`、`keyframe`、`clip`。
