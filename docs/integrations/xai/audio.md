# xAI 语音 / 音频能力对接说明

> 抓取日期: 2026-08-11 | 来源: https://docs.x.ai/developers/model-capabilities/audio/voice | 渠道: xAI

> 状态: 待开发 | 最后核对: 2026-08-11

本文件汇总 SpaceXAI（xAI）官方 Voice API 的对接信息，覆盖 **文本转语音（TTS）**、**语音转文字（STT）**、**实时语音对话（Speech-to-Speech / Realtime）**、**自定义音色（Custom Voices）**，以及 **视频生成附带音频（grok-imagine-video-1.5）** 的官方口径。

**采集方式**：从 `https://docs.x.ai/sitemap.xml` 入手定位到 `developers/model-capabilities/audio/*` 与 `developers/rest-api-reference/inference/voice` 两组页面，使用 fetch_url 抓取官方正文。所有 endpoint、参数名、枚举值、计费规则均逐字摘自官方文档，未做推断。文档未提供错误码全文，仅给出"大多数错误可恢复，会话保持打开"的语义。

## 0. 总览（来源：https://docs.x.ai/developers/model-capabilities/audio/voice ）

xAI Voice API 由 Grok 模型家族提供，企业级可靠性、亚秒级延迟。所有音频数据**实时处理且不存储、不参与训练**。合规资质：SOC 2 Type II / HIPAA Eligible（可签 BAA）/ GDPR / 多区域 Data Residency / HA / SSO & RBAC。

| 能力 | 模型 / Endpoint | 价格 | 备注 |
| --- | --- | --- | --- |
| Speech to Speech（实时语音对话） | `grok-voice-latest`<br/>`wss://api.x.ai/v1/realtime` | 起步 $0.05 / min | WebSocket；支持工具调用、VAD/SIP/WebRTC |
| Text to Speech（文本转语音） | `POST https://api.x.ai/v1/tts`<br/>`WSS wss://api.x.ai/v1/tts` | $15.00 / 1M chars | 同步 REST + 双向流式 WebSocket |
| Speech to Text（语音转文字） | `POST https://api.x.ai/v1/stt`<br/>`WSS wss://api.x.ai/v1/stt` | Batch $0.10 / hour<br/>Streaming $0.20 / hour | 25 种语言、12 种容器格式 |
| Custom Voices（自定义音色） | `POST https://api.x.ai/v1/custom-voices` | Console 免费 ≤30 个；API 仅 Enterprise | 仅美国（除 Illinois 外）可用 |
| 视频生成附带音频 | `grok-imagine-video-1.5`<br/>`POST /v1/videos/generations` | 见视频定价 | 默认包含音频轨道；reference-to-video 可带 preset voice |

**重要前置结论（项目应用层）**：
- xAI **确有独立的 TTS 接口**（不是"仅视频生成时附带音频"）。`audio.speech` 能力是合法配置，但项目里 `XAI_TTS_PARAM_SCHEMA` 的部分枚举与官方不一致，需要修正（详见 §6）。
- xAI **没有"音乐生成"接口**。`audio.music` 不适用。
- xAI **有 STT 接口**，可作为 `audio.transcription` 能力对接（项目当前未配）。

## 1. 文本转语音 TTS

### 1.1 同步 REST：`POST /v1/tts`

来源：https://docs.x.ai/developers/model-capabilities/audio/text-to-speech 与 https://docs.x.ai/developers/rest-api-reference/inference/voice

- 鉴权：`Authorization: Bearer $XAI_API_KEY`（服务端调用，禁止暴露到浏览器/客户端）
- Content-Type：`application/json`
- 响应：默认返回**原始音频字节**（直接写文件或管道到播放器）；当 `with_timestamps=true` 时返回 JSON 信封（`Content-Type: application/json`），内含 base64 音频与逐字符时间戳

**请求体**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `text` | string | 是 | — | 待合成文本，**上限 15000 字符**；支持 [Speech Tags](#12-speech-tags-表现力标签) |
| `voice_id` | string | 否 | `eve` | 内置音色 ID 或自定义音色 ID（大小写不敏感）；枚举见 §1.5 |
| `language` | string | 是 | — | BCP-47（如 `en`、`zh`、`pt-BR`）或 `auto`；大小写不敏感；枚举见 §1.6 |
| `output_format` | object | 否 | MP3 / 24 kHz / 128 kbps | `{ codec, sample_rate, bit_rate }`；枚举见 §1.3 |
| `speed` | number | 否 | `1.0` | 语速倍率，范围 **0.7 ~ 1.5**；<1 放慢、>1 加快 |
| `optimize_streaming_latency` | integer | 否 | `0` | 仅流式有效，`0`/`1`/`2`；同步 REST 文档未列 `2` |
| `text_normalization` | boolean | 否 | `false` | 文本规范化（数字/缩写/符号 → 口语形式） |
| `with_timestamps` | boolean | 否 | `false` | 返回逐字符时间戳（响应改为 JSON） |

**响应体**（默认）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `audio` | string | base64 编码的音频字节（按请求的 codec） |
| `content_type` | string | 解码后的 MIME（如 `audio/mpeg`、`audio/wav`） |
| `duration` | number | 总时长（秒） |
| `audio_timestamps` | object | 仅 `with_timestamps=true` 时出现；`graph_chars` + `graph_times` 平行数组 |

> 注意 REST 默认响应是**原始音频字节**而非 JSON；只有 `with_timestamps=true` 才切换到 JSON 信封。

### 1.2 Speech Tags 表现力标签

来源：https://docs.x.ai/developers/model-capabilities/audio/text-to-speech

**Inline（行内）标签** — 在文本中插入表达：

| 类别 | 标签 |
| --- | --- |
| 停顿 | `[pause]` `[long-pause]` `[hum-tune]` |
| 笑与哭 | `[laugh]` `[chuckle]` `[giggle]` `[cry]` |
| 嘴部音 | `[tsk]` `[tongue-click]` `[lip-smack]` |
| 呼吸 | `[breath]` `[inhale]` `[exhale]` `[sigh]` |

**Wrapping（包裹）标签** — 包裹文本改变演绎风格：

| 类别 | 标签 |
| --- | --- |
| 音量与强度 | `<soft>` `<whisper>` `<loud>` `<build-intensity>` `<decrease-intensity>` |
| 音调与语速 | `<higher-pitch>` `<lower-pitch>` `<slow>` `<fast>` |
| 声乐风格 | `<sing-song>` `<singing>` `<laugh-speak>` `<emphasis>` |

### 1.3 输出格式 `output_format`

**Codec**（来源同上）

| Codec | Content-Type | 适用 |
| --- | --- | --- |
| `mp3` | `audio/mpeg` | 通用 - 兼容性好，压缩比合理（**默认**） |
| `wav` | `audio/wav` | 无损 - 后期剪辑 |
| `pcm` | `audio/pcm` | 原始流 - 实时处理管线 |
| `mulaw` | `audio/basic` | 电话（G.711 μ-law） |
| `alaw` | `audio/alaw` | 电话（G.711 A-law） |

**采样率**

| Hz | 说明 |
| --- | --- |
| 8000 | 窄带 - 电话 |
| 16000 | 宽带 - 语音识别 |
| 22050 | 标准 - 平衡 |
| 24000 | **默认**，推荐通用 |
| 44100 | CD 质量 - 媒体制品 |
| 48000 | 专业 - 录音棚级 |

**比特率**（仅 mp3）

| bps | 质量 |
| --- | --- |
| 32000 | Low - 最小文件 |
| 64000 | Medium - 适合纯语音 |
| 96000 | Standard - 平衡 |
| 128000 | **默认**，推荐 |
| 192000 | Maximum - 最高保真 |

### 1.4 流式 WebSocket：`WSS wss://api.x.ai/v1/tts`

来源：https://docs.x.ai/developers/rest-api-reference/inference/voice

与 `/v1/tts` 同路径，`GET + Upgrade: websocket` 切换为流式。**配置通过 query 参数**完成（连接时一次性传入）。支持 multi-utterance：一次 `audio.done` 后可在同一连接继续发 `text.delta`。

**握手**

| 项 | 值 |
| --- | --- |
| URL | `wss://api.x.ai/v1/tts` |
| Method | `GET` → `101 Switching Protocols` |
| Headers | `Authorization: Bearer $XAI_API_KEY`（必填） |

**Query 参数**

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `voice` | string | `eve` | 内置音色或自定义音色 ID |
| `language` | string | — | **必填**；BCP-47 或 `auto` |
| `codec` | string | `mp3` | `mp3` / `wav` / `pcm` / `mulaw` / `alaw` |
| `sample_rate` | integer | `24000` | `8000` / `16000` / `22050` / `24000` / `44100` / `48000` |
| `bit_rate` | integer | `128000` | 仅 `codec=mp3` 有效；`32000`/`64000`/`96000`/`128000`/`192000` |
| `optimize_streaming_latency` | integer | `0` | `0`（最佳音质）/ `1`（首包更快，分段边界略有质量损失） |
| `speed` | number | `1.0` | 0.7 ~ 1.5 |
| `text_normalization` | boolean | `false` | 同步 REST 同名字段 |
| `with_timestamps` | boolean | `false` | 每个 `audio.delta` 携带 `audio_timestamps` |

**消息流（Client → Server）**：`text.delta`（≤15000 字符 / 单 delta）→ `text.done`

**消息流（Server → Client）**：`audio.delta`（base64 分片）→ `audio.done`（本句结束，连接保持）；`error`（可能断连）

**并发限制**：流式 WebSocket **每个 team 最多 50 个并发会话**（来自"Respect concurrent session limits"段落，来源同 §1.1 文档）。

### 1.5 内置音色清单（26 个）

来源：https://docs.x.ai/developers/model-capabilities/audio/voice 与 https://docs.x.ai/developers/model-capabilities/audio/text-to-speech

| voice_id | 风格 / 适用场景 |
| --- | --- |
| `ara` | Warm and friendly |
| `eve` | **默认**；Energetic and upbeat |
| `leo` | Authoritative and strong |
| `rex` | Confident and clear |
| `sal` | Smooth and balanced |
| `carina` | Soft, empathetic, soothing（Wellness / Support） |
| `zagan` | Powerful, dramatic（Characters / Narration） |
| `helix` | Bold, dynamic（Commentary / Podcast） |
| `orion` | Rich, cinematic, resonant（Narration / Audiobooks） |
| `luna` | Gentle, patient, nurturing（Education / Assistant） |
| `iris` | Friendly, upbeat, charming（Sales / Support） |
| `altair` | Elegant, refined, premium（Advertising / Narration） |
| `zenith` | Sharp, focused, driven（Sales / Advertising） |
| `perseus` | Strong, confident, trustworthy（Advertising / Narration） |
| `helios` | Upbeat, energetic, versatile（Assistant / Wellness） |
| `lux` | Grounded, calm, quietly wise（Wellness / Narration） |
| `kepler` | Inventive, forward-thinking, charismatic（Advertising / Podcast） |
| `rigel` | Precise, professional, calmly confident（Assistant / Support） |
| `cosmo` | Bright, curious, easy to follow（Education / Podcast） |
| `celeste` | Compassionate, confident, reassuring（Support / Assistant） |
| `ursa` | Friendly, warm, steadfast（Assistant / Podcast） |
| `sirius` | Quick-witted, clever, playful（Commentary / Characters） |
| `lumen` | Warm, articulate, engaging（Education / Advertising） |
| `castor` | Charismatic, down-to-earth, easygoing（Sales / Support） |
| `naksh` | Warm, thoughtful, wise（Assistant / Support） |
| `atlas` | Confident, commanding, reassuring（Sales / Assistant） |

`voice_id` 大小写不敏感（`eve` / `Eve` / `EVE` 等价）。可通过 `GET /v1/tts/voices` 编程枚举全部音色，或 `GET /v1/tts/voices/{voice_id}` 取单个音色详情。

### 1.6 TTS 支持语言（20 种 + auto）

来源：https://docs.x.ai/developers/model-capabilities/audio/text-to-speech

| 语言 | 代码 |
| --- | --- |
| Auto-detect | `auto` |
| English | `en` |
| Arabic (Egypt) | `ar-EG` |
| Arabic (Saudi Arabia) | `ar-SA` |
| Arabic (United Arab Emirates) | `ar-AE` |
| Bengali | `bn` |
| Chinese (Simplified) | `zh` |
| French | `fr` |
| German | `de` |
| Hindi | `hi` |
| Indonesian | `id` |
| Italian | `it` |
| Japanese | `ja` |
| Korean | `ko` |
| Portuguese (Brazil) | `pt-BR` |
| Portuguese (Portugal) | `pt-PT` |
| Russian | `ru` |
| Spanish (Mexico) | `es-MX` |
| Spanish (Spain) | `es-ES` |
| Turkish | `tr` |
| Vietnamese | `vi` |

> 文档明确："The model is also capable of generating speech in additional languages beyond those listed above, with varying degrees of accuracy."（即列表外的语言可能可用但精度不等）

## 2. 语音转文字 STT

### 2.1 同步 REST：`POST /v1/stt`

来源：https://docs.x.ai/developers/model-capabilities/audio/speech-to-text 与 https://docs.x.ai/developers/rest-api-reference/inference/voice

- Content-Type：`multipart/form-data`
- 文件大小上限：**500 MB**
- **`file` 必须是 multipart 表单的最后一个字段**（官方原文："The file parameter must be provided after all other parameters in the multipart form."）

**请求体**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `file` | file | 是† | — | 音频文件；必为 multipart 最后字段 |
| `url` | string | 是† | — | 服务端下载并转写的音频 URL |
| `audio_format` | string | 否 | — | 原始音频格式提示：`pcm` / `mulaw` / `alaw`；容器格式（mp3/wav 等）自动探测，**不要填** |
| `sample_rate` | integer | 否 | — | 仅原始音频必填；`8000`/`16000`/`22050`/`24000`/`44100`/`48000` |
| `language` | string | 否 | — | 语种代码；与 `format=true` 联用开启 ITN（数字/货币/单位 → 书面形式） |
| `format` | boolean | 否 | `false` | 启用逆文本规范化（需 `language`） |
| `multichannel` | boolean | 否 | `false` | 多通道独立转写，结果在 `channels` 数组中 |
| `channels` | integer | 否 | — | 通道数（2–8）；仅多通道原始音频必填 |
| `diarize` | boolean | 否 | `false` | 说话人分离；`words` 元素带 `speaker`（整数） |
| `keyterm` | string | 否 | — | 关键词偏置（产品名/专有名词）；可重复，最多 100 个，每个 ≤50 字符 |
| `filler_words` | boolean | 否 | `false` | 是否保留 eh/um/er 等填充词 |
| `vad_threshold` | number | 否 | `0.5`（REST）/ `0.08`（流式 query） | VAD 语音概率阈值（0.0–1.0）；0 关闭 |

† `file` 与 `url` 二选一。

**响应体**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `text` | string | 完整转写文本；多通道时为按时间戳交错的合并文本 |
| `language` | string | 当前为空（语言检测尚未启用） |
| `duration` | number | 音频时长（秒，2 位小数） |
| `words` | array | 词级分段：`{ text, start, end, speaker? }` |
| `channels` | array | 仅 `multichannel=true`；每项 `{ index, text, words }` |

**STT 支持语言（25 种）**：ar, cs, da, nl, en, fil, fr, de, hi, id, it, ja, ko, mk, ms, fa, pl, pt, ro, ru, es, sv, th, tr, vi。

**支持的容器格式**（自动探测）：WAV, MP3, OGG, Opus, FLAC, AAC, MP4, M4A, MKV。
**原始格式**（需 `audio_format` + `sample_rate`）：PCM（16-bit LE）、μ-law、A-law。

### 2.2 流式 WebSocket：`WSS wss://api.x.ai/v1/stt`

来源：https://docs.x.ai/developers/rest-api-reference/inference/voice

- URL：`wss://api.x.ai/v1/stt`
- 鉴权：`Authorization: Bearer $XAI_API_KEY`
- 配置全走 **query 参数**（无 setup 消息），音频以 **binary frame**（无 base64）发送
- 握手后**必须等待 `transcript.created` 才能开始发音频**

**Query 参数（关键）**

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `sample_rate` | integer | `16000` | 同 §2.1 |
| `encoding` | string | `pcm` | `pcm` / `mulaw` / `alaw` |
| `interim_results` | boolean | `false` | `true` 时每 ~500ms 发 `is_final=false` 的部分结果 |
| `endpointing` | integer | `10` | 静音多少毫秒后触发 `speech_final=true`；0–5000；0=任何 VAD 静音边界即触发 |
| `language` | string | — | 启用 ITN |
| `multichannel` | boolean | `false` | 每通道独立转写，需 `channels ≥ 2` |
| `channels` | integer | `1` | 1–8 |
| `diarize` | boolean | `false` | 说话人分离 |
| `keyterm` | string (repeatable) | — | 关键词偏置 |
| `filler_words` | boolean | `false` | — |
| `smart_turn` | number | — | 0.0–1.0；启用 Smart Turn 端点检测 |
| `smart_turn_timeout` | integer | — | 1–5000 ms；强制 speech_final 的兜底静音上限 |
| `vad_threshold` | number | `0.08` | 0.0–1.0 |

**Server → Client 事件**：`transcript.created` / `transcript.partial`（含 `is_final` + `speech_final` 双布尔）/ `transcript.done` / `error`。

`transcript.partial` 的三态：`is_final=false & speech_final=false`（中间结果）、`is_final=true & speech_final=false`（chunk 锁定）、`is_final=true & speech_final=true`（句子结束）。

**Client → Server**：binary frame（原始音频，按 ~100ms 节奏）、`{"type": "finalize"}`（强制立即收尾，可带 `channel`）、`{"type": "audio.done"}`（结束，触发 `transcript.done` 后断连）。

## 3. 实时语音 Speech-to-Speech / Realtime

来源：https://docs.x.ai/developers/rest-api-reference/inference/voice

- WebSocket URL：`wss://api.x.ai/v1/realtime`
- 鉴权：`Authorization: Bearer $XAI_API_KEY`（服务端）或 ephemeral client secret（浏览器侧）
- 模型：`grok-voice-latest`（默认）/ `grok-voice-think-fast-2.0` / `grok-voice-think-fast-1.0`
- `reasoning.effort`：`high`（默认）/ `none`
- 支持工具调用、MCP 调用、`server_vad` 主动检测、`conversation.item.*` 历史 seeding、SIP 电话接续（`call_id`）、Refer/Hangup 子接口、DTMF 事件。
- Ephemeral token：`POST /v1/realtime/client_secrets` 创建，浏览器侧用 `sec-websocket-protocol: xai-client-secret.<TOKEN>` 鉴权。

> 本节能力**不归属 `audio.speech` 能力**，属于 `audio.music`/实时对话范畴，可按需后续单独立项。

## 4. 自定义音色 Custom Voices

来源：https://docs.x.ai/developers/rest-api-reference/inference/voice

- `POST /v1/custom-voices`：从参考音频克隆音色，参考音频 ≤120 秒，支持 WAV/MP3/FLAC/OGG/Opus/M4A/AAC/MKV/MP4。响应 `voice_id` 为 8 位小写字母数字。**API 创建仅 Enterprise 可用；Console 内可免费创建 ≤30 个**；目前仅美国可用（Illinois 除外）。
- `GET /v1/custom-voices`：列表（限 1–1000，默认 100，分页 token）。
- `GET /v1/custom-voices/{voice_id}`：详情。
- `PATCH /v1/custom-voices/{voice_id}`：更新元数据。
- `DELETE /v1/custom-voices/{voice_id}`：删除。
- `GET /v1/custom-voices/{voice_id}/audio`：下载参考音频。

自定义 `voice_id` 可直接用于 `POST /v1/tts`、流式 TTS WebSocket 的 `voice` query、Realtime `session.update` 的 `voice` 字段。

## 5. 视频生成附带音频（grok-imagine-video-1.5）

来源：https://docs.x.ai/developers/model-capabilities/video/generation

- 模型：`grok-imagine-video-1.5`（含 preview、2026-05-30 后缀版本）
- **关键事实**：grok-imagine-video-1.5 的生成视频 **默认包含音频轨道**（官方原文："Generated videos include an audio track by default."）。**未提供**显式 `generateAudio` 开关参数 —— 不能在请求里关闭音频。
- **Reference-to-video** 模式可携带 voice：通过 `reference_audios` 字段，元素 `{ "voice_id": "eve" }` 形式；最多 3 个；同 TTS 内置音色 roster；prompt 用 `<AUDIO_0>` / `<AUDIO_1>` / `<AUDIO_2>` 引用。**自定义音频文件作为 voice reference 当前仅对 trusted partners 开放**（需联系商务）。
- 项目内 `XAI_VIDEO_15_MANIFESTS` 当前在 `packages/protocol/src/xai-media-model-manifests.ts` 中定义；同步视频文档（见 `docs/integrations/xai/video.md` 待补）时建议补 `reference_audios` 字段说明，但不要新增 `generateAudio` 参数。

## 6. 项目内 `XAI_TTS_PARAM_SCHEMA` 校对结果

来源对照：项目内 `packages/protocol/src/xai-media-model-manifests.ts:93` 的 `XAI_TTS_PARAM_SCHEMA` 与官方文档逐字段比对，发现以下偏差（**未在本任务范围内修改代码**，仅记录待后续修复）：

| 字段 | 项目当前 | 官方文档 | 偏差类型 |
| --- | --- | --- | --- |
| `outputFormat` | enum `['mp3','wav','pcm','opus','flac']` | enum `['mp3','wav','pcm','mulaw','alaw']` | **错误**：`opus` / `flac` 不存在；缺 `mulaw` / `alaw`（电话场景） |
| `sampleRate` | `minimum: 8000` | enum `[8000, 16000, 22050, 24000, 44100, 48000]` | 建议改为枚举，避免传非法值 |
| `bitRate` | `minimum: 8000` | enum `[32000, 64000, 96000, 128000, 192000]`，仅 mp3 有效 | 建议改为枚举 |
| `optimizeStreamingLatency` | `type: boolean` | `type: integer`，`0`/`1`（流式）或 `0`/`1`/`2`（同步 REST 文档列了 3 档） | 类型错误 |
| `voiceId` | `string`，仅 default `eve` | enum 26 个内置音色 + 自定义音色 ID（自定义无法枚举） | 保留 string 但建议在 UI 层提供内置音色下拉，自定义 ID 走 free-text |
| `language` | `string`，default `auto` | enum 20 种 + `auto` | 建议改为枚举 + `auto` |
| `outputFormat` 字段名 | 扁平 string | 官方为 object `{ codec, sample_rate, bit_rate }` | 字段结构偏差；项目当前用扁平+`sampleRate`+`bitRate` 三字段拼接，**适配层需在请求时合并为 `output_format` 对象** |

**结论**：`XAI_TTS_PARAM_SCHEMA` 不是误配（xAI 确有独立 TTS 接口），但字段定义与官方有出入。修复优先级：

1. **P0（数据正确性）**：`outputFormat` enum 改为 `['mp3','wav','pcm','mulaw','alaw']`；`optimizeStreamingLatency` 类型由 boolean 改 integer。
2. **P1（参数校验）**：`sampleRate` / `bitRate` 改为枚举。
3. **P2（UI/UX）**：`voiceId` / `language` 在 UI 层加下拉（枚举可从本文件 §1.5 / §1.6 直接复制）。
4. **P2（结构对齐）**：评估是否在 manifest 层就把 `outputFormat` 改成 object，与官方请求体一致；当前扁平结构需 adapter 层组装。

## 7. 不支持 / 待澄清

- **音乐生成**：xAI 未提供 `audio.music` 接口。如项目内 manifest 出现该能力定义，应移除或映射到第三方（如 MiniMax / Suno）。
- **TTS 错误码全文**：官方文档未给完整错误码表，仅 WebSocket 端的 `error` 事件携带 `code` + `message`，且语义是"大多数错误可恢复、连接保持"。需要时只能通过实测收集。
- **`grok-imagine-video-1.5-preview` 与 `2026-05-30` 后缀版本** 是否同样默认带音频：官方文档统一在 grok-imagine-video-1.5 章节描述，未区分后缀；按版本族视为一致。
- **`optimize_streaming_latency=2`** 仅同步 REST 文档列出，流式 WebSocket query 参数只列了 `0` / `1`；同步 REST 是否同样支持 `2` 待实测确认。
