# 阿里云百炼 · 语音合成（TTS）

> 抓取日期: 2026-08-11 | 来源: https://help.aliyun.com/zh/model-studio/tts-model（及其链接的子文档）| 渠道: 阿里云百炼 Bailian

本文档原文摘录自阿里云百炼官方文档，覆盖模型清单、HTTP/WebSocket 接入、参数表、返回字段。所有参数名、枚举值、字段名均保持官方原文。

百炼 TTS 不提供单独的「音乐生成」能力；声音复刻/声音设计接口在 `voice-clone.md` 中单独维护。

---

## 1. 模型清单与能力矩阵

### 1.1 推荐模型

| 模型 ID | 系列 | API | 声音复刻 | 声音设计 | 指令控制 |
|---|---|---|---|---|---|
| qwen-audio-3.0-tts-plus | Qwen-Audio-TTS | WebSocket / HTTP | 支持 | 支持 | 支持 |
| cosyvoice-v3.5-plus | CosyVoice | WebSocket / HTTP | 支持 | 支持 | 支持 |
| cosyvoice-v3-plus | CosyVoice | WebSocket / HTTP | 支持 | 支持 | 不支持 |
| MiniMax/speech-2.8-hd | MiniMax | HTTP | 支持 | 不支持 | 不支持 |

### 1.2 所有模型

#### Qwen-Audio-TTS

| 模型 ID | API | 声音复刻 | 声音设计 | 指令控制 |
|---|---|---|---|---|
| qwen-audio-3.0-tts-plus | WebSocket / HTTP | 支持 | 支持 | 支持 |
| qwen-audio-3.0-tts-flash | WebSocket / HTTP | 支持 | 支持 | 支持 |

#### CosyVoice

| 模型 ID | API | 声音复刻 | 声音设计 | 指令控制 |
|---|---|---|---|---|
| cosyvoice-v3.5-plus | WebSocket / HTTP | 支持 | 支持 | 支持 |
| cosyvoice-v3.5-flash | WebSocket / HTTP | 支持 | 支持 | 支持 |
| cosyvoice-v3-plus | WebSocket / HTTP | 支持 | 支持 | 不支持 |
| cosyvoice-v3-flash | WebSocket / HTTP | 支持 | 支持 | 支持 |
| cosyvoice-v2 | WebSocket / HTTP | 支持 | 不支持 | 不支持 |
| cosyvoice-v1 | WebSocket | 支持 | 不支持 | 不支持 |

部分 CosyVoice 模型支持 SSML 标记和 LaTeX 公式朗读。

#### Qwen3-TTS

| 模型 ID | API | 声音复刻 | 声音设计 | 指令控制 |
|---|---|---|---|---|
| qwen3-tts-flash | HTTP | 不支持 | 不支持 | 不支持 |
| qwen3-tts-flash-2025-11-27 | HTTP | 不支持 | 不支持 | 不支持 |
| qwen3-tts-flash-2025-09-18 | HTTP | 不支持 | 不支持 | 不支持 |
| qwen3-tts-flash-realtime | WebSocket | 不支持 | 不支持 | 不支持 |
| qwen3-tts-flash-realtime-2025-11-27 | WebSocket | 不支持 | 不支持 | 不支持 |
| qwen3-tts-flash-realtime-2025-09-18 | WebSocket | 不支持 | 不支持 | 不支持 |
| qwen3-tts-instruct-flash | HTTP | 不支持 | 不支持 | 支持 |
| qwen3-tts-instruct-flash-2026-01-26 | HTTP | 不支持 | 不支持 | 支持 |
| qwen3-tts-instruct-flash-realtime | WebSocket | 不支持 | 不支持 | 支持 |
| qwen3-tts-instruct-flash-realtime-2026-01-22 | WebSocket | 不支持 | 不支持 | 支持 |
| qwen3-tts-vc-2026-01-22 | HTTP | 支持 | 不支持 | 不支持 |
| qwen3-tts-vc-realtime-2026-01-15 | WebSocket | 支持 | 不支持 | 不支持 |
| qwen3-tts-vc-realtime-2025-11-27 | WebSocket | 支持 | 不支持 | 不支持 |
| qwen3-tts-vd-2026-01-26 | HTTP | 不支持 | 支持 | 不支持 |
| qwen3-tts-vd-realtime-2026-01-15 | WebSocket | 不支持 | 支持 | 不支持 |
| qwen3-tts-vd-realtime-2025-12-16 | WebSocket | 不支持 | 支持 | 不支持 |

#### MiniMax

| 模型 ID | API | 声音复刻 | 声音设计 | 指令控制 |
|---|---|---|---|---|
| MiniMax/speech-2.8-hd | HTTP | 支持 | 不支持 | 不支持 |
| MiniMax/speech-02-hd | HTTP | 支持 | 不支持 | 不支持 |
| MiniMax/speech-2.8-turbo | HTTP | 支持 | 不支持 | 不支持 |
| MiniMax/speech-02-turbo | HTTP | 支持 | 不支持 | 不支持 |

#### Qwen-TTS（旧版，按 Token 计费）

| 模型 ID | API | 说明 |
|---|---|---|
| qwen-tts | HTTP | 非流式合成，按 Token 计费 |
| qwen-tts-latest | HTTP | 非流式合成，按 Token 计费 |
| qwen-tts-2025-05-22 | HTTP | 快照版本，按 Token 计费 |
| qwen-tts-2025-04-10 | HTTP | 快照版本，按 Token 计费 |
| qwen-tts-realtime | WebSocket | 流式合成，按 Token 计费 |
| qwen-tts-realtime-latest | WebSocket | 流式合成，按 Token 计费 |
| qwen-tts-realtime-2025-07-15 | WebSocket | 快照版本，流式合成，按 Token 计费 |

### 1.3 接入方式说明

- **WebSocket**：双向流式通信，支持流式输入和流式输出，音频边合成边返回，延迟最低。适用于智能客服、语音助手、呼叫中心等实时交互场景。
- **HTTP**：发送完整文本，支持流式返回音频（逐段输出）。适用于有声阅读、音频内容制作等场景。
- Qwen-Audio-TTS/CosyVoice 系列模型使用**同一模型名称**同时支持 WebSocket 和 HTTP 两种接入方式；Qwen 系列模型通过模型名称区分，带 `-realtime` 后缀的为 WebSocket 接入，不带后缀的为 HTTP 接入。
- Qwen-Audio-TTS/CosyVoice 和 Qwen 系列的 WebSocket 模型支持通过 DashScope SDK（Java、Python）接入。Qwen-Audio-TTS/CosyVoice 的 WebSocket 模型还支持 Android、iOS SDK 接入。其他模型需根据对应的 WebSocket 或 HTTP 协议直接调用。
- CosyVoice 系列模型还支持通过 **AOQ 协议**接入。

---

## 2. 非实时语音合成（Qwen-TTS）HTTP API

来源：<https://help.aliyun.com/zh/model-studio/qwen-tts-api>

### 2.1 接口地址

```
POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
```

适用于 qwen-tts、qwen-tts-latest、qwen-tts-2025-05-22、qwen-tts-2025-04-10、qwen3-tts-flash、qwen3-tts-instruct-flash 及其快照版（HTTP 接入的 Qwen-TTS 系列）。

### 2.2 请求头

| 参数 | 类型 | 是否必选 | 说明 |
|---|---|---|---|
| Authorization | string | 是 | `Bearer <your_api_key>` |
| Content-Type | string | 是 | `application/json` |
| X-DashScope-SSE | string | 否 | 流式返回时设为 `enable` |

### 2.3 请求体（curl 示例）

非流式：

```bash
curl -X POST 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation' \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H 'Content-Type: application/json' \
-d '{
"model": "qwen3-tts-flash",
"input": {
  "text": "那我来给大家推荐一款 T 恤……",
  "voice": "Cherry",
  "language_type": "Chinese"
}
}'
```

流式：增加 `-H 'X-DashScope-SSE: enable'`。

### 2.4 请求参数

#### model `string`（必选）

模型名称。

#### input `object`（必选）

| 属性 | 类型 | 必选 | 说明 |
|---|---|---|---|
| text | string | 是 | 要合成的文本，支持多语种混合输入。**最大输入长度**：千问-TTS 模型为 512 Token，其他模型为 600 字符 |
| voice | string | 是 | 使用的音色，参见「支持的系统音色」 |
| language_type | string | 否 | 合成音频的语种。默认 `Auto`。可选：`Auto` / `Chinese` / `English` / `German` / `Italian` / `Portuguese` / `Spanish` / `Japanese` / `Korean` / `French` / `Russian` |
| instructions | string | 否 | 设置指令。默认无。最大长度 1600 Token。支持语言：仅中文和英文。**仅适用于 qwen3-tts-instruct-flash 系列** |
| optimize_instructions | boolean | 否 | 对 instructions 进行语义优化。默认 `false`。依赖 instructions 参数。**仅适用于 qwen3-tts-instruct-flash 系列** |

language_type 各值含义：
- `Auto`：适用于文本包含多种语言或语种不确定的场景。模型自动为不同语言片段匹配发音，但无法保证完全精准。
- 指定语种：适用于单一语种文本。指定具体语种能显著提升合成质量。

### 2.5 返回对象（流式与非流式输出格式一致）

千问 3-TTS-Flash：

```json
{
  "status_code": 200,
  "request_id": "5c63c65c-cad8-4bf4-959d-xxxxxxxxxxxx",
  "code": "",
  "message": "",
  "output": {
    "text": null,
    "finish_reason": "stop",
    "choices": null,
    "audio": {
      "data": "",
      "url": "http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/.../xxx.wav?Expires=...&Signature=...",
      "id": "audio_5c63c65c-cad8-4bf4-959d-xxxxxxxxxxxx",
      "expires_at": 1766113409
    }
  },
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "characters": 195
  }
}
```

千问-TTS（旧版，按 Token 计费）额外返回 `total_tokens` 与 tokens 详情：

```json
"usage": {
  "input_tokens": 76,
  "output_tokens": 1045,
  "characters": 0,
  "input_tokens_details": { "text_tokens": 76 },
  "output_tokens_details": { "audio_tokens": 1045, "text_tokens": 0 },
  "total_tokens": 1121
}
```

### 2.6 返回字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| status_code | integer | HTTP 状态码（RFC 9110）。200 成功；400 参数错误；401 未授权；404 资源未找到；500 服务器内部错误 |
| request_id | string | 本次请求的唯一标识 |
| code | string | 请求失败时展示错误码 |
| message | string | 请求失败时展示错误信息 |
| output.text | string | 始终为 null |
| output.choices | string | 始终为 null |
| output.finish_reason | string | 正在生成时 `"null"`；自然结束或触发停止条件时 `"stop"` |
| output.audio.url | string | 完整音频文件 URL，**有效期 24 小时** |
| output.audio.data | string | Base64 编码的音频数据。流式中间 chunk 中包含音频片段，最后一个 chunk 为空字符串 |
| output.audio.id | string | 音频唯一标识 |
| output.audio.expires_at | integer | URL 过期时间的 UNIX 时间戳 |
| usage.input_tokens | integer | 输入文本 Token 消耗（qwen3-tts-flash 固定为 0） |
| usage.output_tokens | integer | 输出音频 Token 消耗（qwen3-tts-flash 固定为 0） |
| usage.characters | integer | 输入文本字符数（仅 qwen3-tts-flash 返回） |
| usage.total_tokens | integer | 本次请求总共消耗的 Token 量（仅千问-TTS 模型返回） |
| usage.input_tokens_details.text_tokens | integer | 输入文本 Token 消耗量（仅千问-TTS 返回） |
| usage.output_tokens_details.audio_tokens | integer | 输出音频 Token 消耗量（仅千问-TTS 返回） |
| usage.output_tokens_details.text_tokens | integer | 输出文本 Token 消耗量（仅千问-TTS 返回，固定为 0） |

**流式输出说明**：流式模式下 API 返回多个 chunk。中间 chunk 的 `audio.data` 包含 Base64 编码的音频片段，`audio.url` 为空；最后一个 chunk 的 `audio.data` 为空字符串，`audio.url` 包含完整音频文件的 OSS 地址。

---

## 3. 非实时语音合成（Qwen-Audio-TTS / CosyVoice）HTTP API

来源：<https://help.aliyun.com/zh/model-studio/cosyvoice-tts-http-api>

> **重要**：本文描述的功能仅在华北 2（北京）地域可用。

### 3.1 接口地址

```
POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer
```

`{WorkspaceId}` 需替换为真实业务空间 ID。现有域名 `dashscope.aliyuncs.com` 仍可正常使用。

阿里云百炼建议从 `dashscope.aliyuncs.com` 迁移至 `{WorkspaceId}.cn-beijing.maas.aliyuncs.com` 业务空间专属域名以获得更高性能和稳定性。

### 3.2 请求头

| 参数 | 类型 | 是否必选 | 说明 |
|---|---|---|---|
| Authorization | string | 是 | `Bearer <your_api_key>` |
| Content-Type | string | 是 | `application/json` |
| X-DashScope-SSE | string | 否 | 流式返回时设为 `enable` |

### 3.3 请求体

```bash
curl -X POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
-d '{
"model": "qwen-audio-3.0-tts-flash",
"input": {
  "text": "我家的后面有一个很大的花园。",
  "voice": "longanhuan_v3.6",
  "format": "wav",
  "sample_rate": 24000
}
}'
```

### 3.4 请求参数

#### model `string`（必选）

语音合成模型。取值范围：
- `qwen-audio-3.0-tts-plus`
- `qwen-audio-3.0-tts-flash`
- `cosyvoice-v3.5-plus`
- `cosyvoice-v3.5-flash`
- `cosyvoice-v3-plus`
- `cosyvoice-v3-flash`
- `cosyvoice-v2`

#### input `object`（必选）

| 属性 | 类型 | 必选 | 默认 | 说明 |
|---|---|---|---|---|
| text | string | 是 | — | 待合成文本。支持 SSML（需同时将 enable_ssml 设置为 true）和 LaTeX 格式输入 |
| voice | string | 是 | — | 音色。系统音色 / 声音复刻音色 / 声音设计音色 |
| format | string | 否 | `mp3` | 音频编码格式。可选 `mp3` / `pcm` / `wav` / `opus` |
| sample_rate | integer | 否 | 22050 | 音频采样率（Hz）。取值：`8000, 16000, 22050, 24000, 44100, 48000` |
| volume | integer | 否 | 50 | 音量。取值范围 `[0, 100]` |
| rate | float | 否 | 1.0 | 语速。取值范围 `[0.5, 2.0]` |
| bit_rate | integer | 否 | 32 | 音频码率（kbps）。取值范围 `[6, 510]`。**仅在 format 为 opus 时支持** |
| pitch | float | 否 | 1.0 | 音调。取值范围 `[0.5, 2.0]` |
| enable_ssml | boolean | 否 | — | 是否开启 SSML 功能 |
| word_timestamp_enabled | boolean | 否 | false | 是否开启字级别时间戳。仅在流式输出模式下可用。支持 cosyvoice-v3.5-plus / v3.5-flash / v3-flash / v3-plus / v2 模型的复刻音色，以及 Qwen-Audio-TTS / CosyVoice 音色列表中标记为支持的系统音色 |
| seed | integer | 否 | 0 | 生成随机数种子。取值 `[0, 65535]` |
| language_hints | array[string] | 否 | — | 数组当前版本仅处理第一个元素。指定语音合成的目标语言。取值：`zh` / `en` / `fr` / `de` / `ja` / `ko` / `ru` / `pt` / `th` / `id` / `vi` / `es` / `it` / `ms` / `fil` / `ar` |
| instruction | string | 否 | — | 设置指令，控制方言、情感或角色等合成效果 |
| enable_aigc_tag | boolean | 否 | false | 是否在音频中添加 AIGC 隐性标识。仅 qwen-audio-3.0-tts-plus / qwen-audio-3.0-tts-flash / cosyvoice-v3-flash / cosyvoice-v3-plus / cosyvoice-v2 支持该功能 |
| aigc_propagator | string | 否 | 阿里云 UID | AIGC 隐性标识中的 ContentPropagator 字段。仅在 enable_aigc_tag 为 true 时生效 |
| aigc_propagate_id | string | 否 | 本次合成 Request ID | AIGC 隐性标识中的 PropagateID 字段。仅在 enable_aigc_tag 为 true 时生效 |
| hot_fix | object | 否 | — | 文本热修复配置。cosyvoice-v2 不支持。包含 `pronunciation`（自定义发音）和 `replace`（文本替换） |
| enable_markdown_filter | boolean | 否 | false | **仅 cosyvoice-v3-flash 复刻音色支持**。是否启用 Markdown 过滤 |

hot_fix 示例：

```json
"hot_fix": {
  "pronunciation": [{"天气": "tian1 qi4"}],
  "replace": [{"今天": "金天"}]
}
```

### 3.5 返回体

非流式：

```json
{
  "request_id": "ee88b03d-0457-9286-8c67-xxxxxxxxxxxx",
  "output": {
    "finish_reason": "stop",
    "audio": {
      "data": "",
      "url": "http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/.../xxx.wav?xxxxxxx",
      "id": "audio_ee88b03d-0457-9286-8c67-xxxxxxxxxxxx",
      "expires_at": 1772697707
    }
  },
  "usage": { "characters": 15 }
}
```

流式 — 中间结果（`sentence-begin`）：

```json
{
  "request_id": "8ac1cd04-06af-9a63-b031-xxxxxxxxxxxx",
  "output": {
    "finish_reason": "null",
    "type": "sentence-begin",
    "original_text": "我家的后面有一个很大的花园。",
    "sentence": { "index": 0, "words": [] },
    "audio": {
      "data": "",
      "id": "audio_ee88b03d-0457-9286-8c67-xxxxxxxxxxxx",
      "expires_at": 1772697707
    }
  },
  "usage": { "characters": 15 }
}
```

流式 — 最终结果（`finish_reason: stop`，audio.url 给出完整音频）。

### 3.6 返回字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| request_id | string | 本次调用的唯一标识符 |
| output.finish_reason | string | 任务停止原因。`null`：合成中；`stop`：合成结束 |
| output.type | string | 子事件类型，仅流式合成时返回。`sentence-begin` / `sentence-synthesis` / `sentence-end` |
| output.original_text | string | 对用户输入文本进行分句后的句内容。最后一个句子可能没有此字段 |
| output.sentence.index | integer | 句子编号，从 0 开始 |
| output.sentence.words | array | 每句话对应的字信息（含 `text` / `begin_index` / `end_index` / `begin_time` / `end_time`，时间戳单位为毫秒） |
| output.audio.data | string | 流式合成时输出 Base64 格式音频数据。非流式合成时为空 |
| output.audio.url | string | 模型输出的完整音频文件 URL，有效期 24 小时 |
| output.audio.id | string | 模型输出的音频信息对应的 ID |
| output.audio.expires_at | integer | URL 过期时间戳 |
| usage.characters | integer | 本次请求中计费的有效字符数 |

sentence-synthesis 事件说明：
- 一个句子的合成过程中会产生多个 `sentence-synthesis` 事件，每个对应一个音频数据块
- 客户端需要按顺序接收这些音频数据块并以追加模式写入同一文件
- `sentence-synthesis` 事件与其后的音频数据帧是一一对应的关系，不会出现错位

---

## 4. Qwen-Audio-TTS / CosyVoice 实时语音合成 WebSocket API

来源：<https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api>

### 4.1 接口地址

| 地域 | WebSocket URL |
|---|---|
| 华北 2（北京） | `wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference` |
| 新加坡 | `wss://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/inference` |

URL 必须使用 `wss://` 协议。Authorization 在请求头中设置。

### 4.2 请求头

| 参数 | 类型 | 是否必选 | 说明 |
|---|---|---|---|
| Authorization | string | 是 | `Bearer <your_api_key>` |
| user-agent | string | 否 | 客户端标识 |
| X-DashScope-WorkSpace | string | 否 | 业务空间 ID |
| X-DashScope-DataInspection | string | 否 | 是否启用数据合规检测功能。默认不传或 `enable` |

Authorization 鉴权在 WebSocket 握手阶段验证。如果 API Key 无效或缺失，握手将失败并返回 HTTP 401/403 错误。

### 4.3 交互流程

1. **建立连接**：客户端与服务端建立 WebSocket 连接。
2. **开启任务**：客户端发送 `run-task` 事件。
3. **等待确认**：客户端收到 `task-started` 事件。
4. **发送待合成文本**：客户端按顺序发送一个或多个 `continue-task` 事件；服务端接收到完整语句后返回 `result-generated` 事件和音频流。
5. **接收音频**：通过 binary 通道接收音频流。
6. **通知结束**：客户端发送 `finish-task` 事件。
7. **任务结束**：客户端收到 `task-finished` 事件。
8. **关闭连接**。

服务端接收文本片段后自动进行分句：完整语句立即合成，不完整语句缓存至完整后合成。当发送 `finish-task` 事件时，服务端会强制合成所有缓存内容。

**重要**：同一次合成任务中，`run-task`、所有 `continue-task`、`finish-task` 必须使用相同的 `task_id`。每次发起新任务时生成新的 `task_id`（如使用 UUID）。

---

## 5. Qwen-TTS-Realtime WebSocket API

来源：<https://help.aliyun.com/zh/model-studio/interactive-process-of-qwen-tts-realtime-synthesis>

### 5.1 接口地址

URL 通过查询参数 `model` 指定要调用的模型名称：

| 地域 | WebSocket URL |
|---|---|
| 华北 2（北京） | `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-tts-flash-realtime` |
| 新加坡 | `wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=qwen3-tts-flash-realtime` |

URL 必须使用 `wss://` 协议。模型通过 URL 查询参数 `model` 指定。

### 5.2 请求头

| 参数 | 类型 | 是否必选 | 说明 |
|---|---|---|---|
| Authorization | string | 是 | `Bearer <your_api_key>` |
| user-agent | string | 否 | 客户端标识 |
| X-DashScope-WorkSpace | string | 否 | 业务空间 ID |

### 5.3 交互模式

支持两种使用模式：
- **ServerCommit 模式**：服务端智能判断文本分段与合成时机，开发者无需关心内部状态切分。
- **Commit 模式**：客户端控制每一段文本的提交时间，需显式调用 `input_text_buffer.commit` 触发合成。

模式说明：
- ServerCommit 模式下调用 `input_text_buffer.append` 多次，系统根据内部规则判断合成起点。
- 若在 ServerCommit 模式中主动调用 `input_text_buffer.commit`，表示立即合成当前缓冲内容，后续仍维持 ServerCommit 模式。
- Commit 模式下仅调用 `input_text_buffer.append` 不会触发合成，需明确调用 `input_text_buffer.commit`。

### 5.4 关键流程

1. **连接阶段**：客户端发起 WebSocket 连接，服务端返回 `session.created`。
2. **配置会话**：客户端发送 `session.update` 事件设置音色、格式、模式等参数。
3. **文本输入阶段**：客户端多次发送 `input_text_buffer.append` 添加文本到缓冲区。
4. **触发合成阶段**：ServerCommit 模式中系统自动判断合成时机，或客户端手动调用 `input_text_buffer.commit` 强制触发；Commit 模式中仅 `input_text_buffer.commit` 才会真正触发语音合成流程。
5. **音频生成阶段**：服务端发出 `response.created` 表示任务已启动，随后分片返回音频 `response.audio.delta`（base64 编码），直到 `response.audio.done`。
6. **会话结束阶段**：客户端显式调用 `session.finish` 通知服务端清理状态，服务端返回 `session.finished` 后关闭连接。

### 5.5 session.created 事件示例

```json
{
  "event_id": "event_xxx",
  "type": "session.created",
  "session": {
    "object": "realtime.session",
    "mode": "server_commit",
    "model": "qwen3-tts-flash-realtime",
    "voice": "Cherry",
    "response_format": "pcm",
    "sample_rate": 24000,
    "id": "sess_xxx"
  }
}
```

---

## 6. DashScope Python SDK（CosyVoice / Qwen-Audio-TTS）

来源：<https://help.aliyun.com/zh/model-studio/cosyvoice-python-sdk>

### 6.1 接口地址

```python
dashscope.base_websocket_api_url = 'wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference'
```

### 6.2 SpeechSynthesizer 构造方法

```python
SpeechSynthesizer(
    model: str,
    voice: str,
    format: AudioFormat = AudioFormat.MP3_22050HZ_MONO_256KBPS,
    volume: int = 50,
    speech_rate: float = 1.0,
    pitch_rate: float = 1.0,
    callback: ResultCallback = None
)
```

### 6.3 构造参数

| 参数 | 类型 | 是否必须 | 说明 |
|---|---|---|---|
| model | str | 是 | 模型名称 |
| voice | str | 是 | 音色（系统音色 / 复刻音色 / 声音设计音色） |
| format | enum | 否 | 默认 `AudioFormat.MP3_22050HZ_MONO_256KBPS`。cosyvoice-v1 不支持 opus |
| volume | int | 否 | 默认 50，范围 `[0, 100]` |
| speech_rate | float | 否 | 默认 1.0，范围 `[0.5, 2.0]` |
| pitch_rate | float | 否 | 默认 1.0，范围 `[0.5, 2.0]` |
| bit_rate | int | 否 | 默认 32，范围 `[6, 510]`。仅 mp3 / opus 支持调整。cosyvoice-v1 不支持 |
| word_timestamp_enabled | bool | 否 | 默认 false。需通过 additional_params 设置 |
| seed | int | 否 | 默认 0，范围 `[0, 65535]`。cosyvoice-v1 不支持 |
| language_hints | list[str] | 否 | 当前版本仅处理第一个元素。cosyvoice-v1 不支持 |
| instruction | str | 否 | 控制方言、情感或角色 |
| enable_aigc_tag | bool | 否 | 默认 false |
| aigc_propagator | str | 否 | 默认 阿里云 UID |
| aigc_propagate_id | str | 否 | 默认 本次合成 Request ID |
| hot_fix | dict | 否 | cosyvoice-v2 / v1 不支持 |
| enable_markdown_filter | bool | 否 | 仅 cosyvoice-v3-flash 复刻音色支持 |
| callback | ResultCallback | 否 | 异步回调。设置时 call() 以流式模式运行 |

### 6.4 方法

- `call(text)` — 非流式调用。`text` 最大 20000 字符。返回 bytes（完整音频）。
- `streaming_call(text)` — 流式调用，可多次追加文本，单次不超过 20000 字符，累计不超过 20 万字符。
- `streaming_complete()` — 结束流式合成。
- `streaming_cancel(complete_timeout_millis=10000)` — 取消流式合成。
- `get_last_request_id()` — 获取请求 ID。
- `get_first_package_delay()` — 获取首包延迟（毫秒）。
- `get_response()` — 获取响应消息。

### 6.5 流式输入约束

- 单次发送文本长度不得超过 20000 字符。
- 累计发送文本总长度不得超过 20 万字符。
- 发送文本片段的间隔不得超过 **23 秒**，否则触发 `request timeout after 23 seconds` 异常。
- 服务端强制设定 23 秒超时机制，客户端无法修改该配置。

### 6.6 ResultCallback

| 回调 | 触发时机 |
|---|---|
| on_open() | WebSocket 连接成功建立 |
| on_event(message) | 接收到服务端回复（JSON 字符串，含 `payload.output`） |
| on_complete() | 所有文本合成完成且音频数据已全部通过 on_data 返回 |
| on_data(data: bytes) | 每接收到一块音频数据 |
| on_error(message: str) | 合成过程中发生错误 |
| on_close() | WebSocket 连接关闭 |

### 6.7 on_event 消息中的 output 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| type | str | 事件类型：`sentence-begin` / `sentence-synthesis` / `sentence-end` |
| original_text | str | 当前句子的原始文本。`sentence-begin` 和 `sentence-end` 事件返回 |
| sentence | dict | 句子信息，含 `index`（句子序号）和 `words`（开启 word_timestamp_enabled 时返回时间戳信息） |

消息示例：

```json
{
  "header": { "task_id": "xxx", "event": "result-generated", "attributes": {} },
  "payload": {
    "output": {
      "type": "sentence-begin",
      "original_text": "今天天气怎么样？",
      "sentence": { "index": 0, "words": [] }
    }
  }
}
```

---

## 7. 指令控制（instructions / instruction）

支持的模型：
- Qwen-Audio-TTS 系列：qwen-audio-3.0-tts-plus / qwen-audio-3.0-tts-flash
- CosyVoice 系列：cosyvoice-v3.5-plus / cosyvoice-v3.5-flash / cosyvoice-v3-flash
- Qwen-TTS 系列：qwen3-tts-instruct-flash-realtime / qwen3-tts-instruct-flash-realtime-2026-01-22 / qwen3-tts-instruct-flash / qwen3-tts-instruct-flash-2026-01-26

用自然语言描述期望的表达方式，可按请求动态控制语速、情绪和风格。例如「用温柔的语气，语速稍慢」或「用激动的播报风格」。

---

## 8. 支持的语言（按系列）

### Qwen3-TTS-Flash 系列（系统音色）

中文（普通话、北京话、上海话、四川话、南京话、陕西话、闽南话、天津话、粤语，因音色而异）、英文、德语、意大利语、葡萄牙语、西班牙语、日语、韩语、法语、俄语。

### Qwen3-TTS-Instruct-Flash 系列（系统音色）

中文（普通话）、英文、德语、意大利语、葡萄牙语、西班牙语、日语、韩语、法语、俄语。

### Qwen3-TTS-VC 系列（声音复刻）

中文（普通话）、英文、德语、意大利语、葡萄牙语、西班牙语、日语、韩语、法语、俄语。

### Qwen3-TTS-VD 系列（声音设计）

中文（普通话）、英文、德语、意大利语、葡萄牙语、西班牙语、日语、韩语、法语、俄语。

### Qwen-Audio-TTS（系统音色）

中文（普通话）、英文。

### Qwen-Audio-TTS（声音复刻音色，方言通过指令控制功能设置）

中文（普通话、广东话、重庆话、东北话、甘肃话、贵州话、浙江话、河北话、河南话、湖北话、湖南话、江西话、宁波话、宁夏话、青岛话、陕西话、山西话、山东话、上海话、四川话、云南话）、英语、日语、韩语、俄语、法语、德语、葡萄牙语、泰语、印尼语、越南语、西班牙语、意大利语、马来西亚语、菲律宾语、阿拉伯语。

### CosyVoice v3.5-plus / v3.5-flash（不支持系统音色）

声音复刻音色：中文（普通话、广东话、东北话、甘肃话、贵州话、河南话、湖北话、江西话、闽南话、宁夏话、山西话、陕西话、山东话、上海话、四川话、天津话、云南话）、英文、法语、德语、日语、韩语、俄语、葡萄牙语、泰语、印尼语、越南语。
声音设计音色：中文（普通话）、英文。

### Qwen-TTS 系列（旧版，按 Token 计费）

中文（普通话、北京话、上海话、四川话，因音色而异）、英文、德语、意大利语、葡萄牙语、西班牙语、日语、韩语、法语、俄语。

---

## 9. 关键限制与注意

- TTS 文本最大输入长度：千问-TTS 模型 512 Token，其他模型 600 字符。
- 音频 URL 有效期 **24 小时**。
- HTTP CosyVoice API 仅在华北 2（北京）地域可用。
- Qwen-Audio-TTS/CosyVoice 同一模型名称同时支持 WebSocket 和 HTTP；Qwen-TTS 系列通过 `-realtime` 后缀区分。
- CosyVoice 系列额外支持 AOQ 协议接入。

---

## 10. 文档原始 URL

| 子主题 | URL |
|---|---|
| 语音合成（模型清单） | <https://help.aliyun.com/zh/model-studio/tts-model> |
| Qwen-TTS HTTP API | <https://help.aliyun.com/zh/model-studio/qwen-tts-api> |
| CosyVoice/Qwen-Audio-TTS HTTP API | <https://help.aliyun.com/zh/model-studio/cosyvoice-tts-http-api> |
| CosyVoice/Qwen-Audio-TTS WebSocket API | <https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api> |
| Qwen-TTS-Realtime WebSocket API | <https://help.aliyun.com/zh/model-studio/interactive-process-of-qwen-tts-realtime-synthesis> |
| CosyVoice Python SDK | <https://help.aliyun.com/zh/model-studio/cosyvoice-python-sdk> |
| 实时语音合成用户指南 | <https://help.aliyun.com/zh/model-studio/realtime-tts-user-guide> |
