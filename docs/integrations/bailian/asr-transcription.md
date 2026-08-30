# 阿里云百炼 · 语音识别 / 转写（ASR）

> 抓取日期: 2026-08-11 | 来源: https://help.aliyun.com/zh/model-studio/asr-model（及其链接的子文档）| 渠道: 阿里云百炼 Bailian

本文档原文摘录自阿里云百炼官方文档，覆盖 ASR 模型清单、音频规格、HTTP（非实时/录音文件识别）与 WebSocket（实时识别）接口、参数表、返回字段、说话人分离（diarization）能力。所有参数名、枚举值、字段名均保持官方原文。

百炼 ASR 没有独立的「说话人分离」接口 —— `diarization_enabled` 是录音文件识别接口的请求参数（仅特定模型支持），见 §3 / §4。本文不单独建立 `speaker-diarization.md`。

---

## 1. 模型清单与能力矩阵

### 1.1 推荐模型

| 模型 ID | 模式 | API | 精度增强 | 情感识别 | 说话人分离 | 支持语言 | 音频最大时长/大小 |
|---|---|---|---|---|---|---|---|
| qwen-audio-3.0-asr-flash-streaming | 实时 | WebSocket | 热词、Prompt 上下文 | 不支持 | 不支持 | 多语种及方言 | 无限制 |
| qwen-audio-3.0-asr-flash-filetrans | 非实时 | HTTP | 热词、Prompt 上下文 | 不支持 | 支持 | 多语种及方言 | 12 小时 / 2GB |

### 1.2 选型决策维度

#### 实时还是非实时？

- **实时（实时语音识别）**：基于 WebSocket 协议，音频流式输入，文本流式输出。适用于实时字幕、语音助手和会议转写。推荐 `qwen-audio-3.0-asr-flash-streaming`。
- **非实时（录音文件识别）**：基于 HTTP 协议，提交音频文件获取识别结果。适用于呼叫中心录音、播客和访谈等场景。推荐 `qwen-audio-3.0-asr-flash-filetrans`。

#### 处理专业术语

- **Prompt 上下文注入**：在系统提示词中描述领域背景。推荐 Qwen-Audio-3.0-ASR-Flash-Streaming / Filetrans / Flash 系列。
- **热词**：提供带权重的词汇表。推荐同上。

#### 说话人分离

- Qwen-Audio-3.0-ASR-Flash-Filetrans（`qwen-audio-3.0-asr-flash-filetrans`）
- Fun-ASR 系列非实时模型（`fun-asr`、`fun-asr-mtl`）

#### 情感识别

- Qwen-ASR 系列模型在转写的同时支持情感识别。推荐 `qwen3-asr-flash-realtime`（实时）或 `qwen3-asr-flash-filetrans`（非实时）。

### 1.3 所有模型

#### Qwen-Audio-3.0-ASR-Flash-Streaming

| 模型 ID | 模式 | API | 精度增强 | 情感识别 | 说话人分离 | 支持语言 | 最大时长 |
|---|---|---|---|---|---|---|---|
| qwen-audio-3.0-asr-flash-streaming | 实时 | WebSocket | 热词、Prompt 上下文 | 不支持 | 不支持 | 多语种及方言 | 无限制 |

#### Qwen-Audio-3.0-ASR-Flash-Filetrans

| 模型 ID | 模式 | API | 精度增强 | 情感识别 | 说话人分离 | 支持语言 | 最大时长 |
|---|---|---|---|---|---|---|---|
| qwen-audio-3.0-asr-flash-filetrans | 非实时 | HTTP | 热词、Prompt 上下文 | 不支持 | 支持 | 多语种及方言 | 12 小时 / 2GB |

#### Qwen-Audio-3.0-ASR-Flash

| 模型 ID | 模式 | API | 精度增强 | 情感识别 | 说话人分离 | 支持语言 | 最大时长 |
|---|---|---|---|---|---|---|---|
| qwen-audio-3.0-asr-flash | 非实时 | HTTP | 热词、Prompt 上下文 | 不支持 | 不支持 | 多语种及方言 | 5 分钟 / 2GB |

#### Fun-ASR

| 模型 ID | 模式 | API | 精度增强 | 情感识别 | 说话人分离 | 支持语言 | 最大时长 |
|---|---|---|---|---|---|---|---|
| fun-asr-realtime | 实时 | WebSocket | 热词 | 不支持 | 不支持 | 多语种及方言 | 无限制 |
| fun-asr-realtime-2026-02-28 | 实时 | WebSocket | 热词 | 不支持 | 不支持 | 中、英、日及方言 | 无限制 |
| fun-asr-realtime-2025-11-07 | 实时 | WebSocket | 热词 | 不支持 | 不支持 | 多语种及方言 | 无限制 |
| fun-asr-realtime-2025-09-15 | 实时 | WebSocket | 热词 | 不支持 | 不支持 | 中、英 | 无限制 |
| fun-asr-flash-8k-realtime | 实时 | WebSocket | 热词 | 不支持 | 不支持 | 中文 | 无限制 |
| fun-asr-flash-8k-realtime-2026-01-28 | 实时 | WebSocket | 热词 | 不支持 | 不支持 | 中文 | 无限制 |
| fun-asr | 非实时 | HTTP | 热词 | 不支持 | 支持 | 多语种及方言 | 12 小时 / 2GB |
| fun-asr-flash-2026-06-15 | 非实时 | HTTP | Prompt 上下文 | 不支持 | 不支持 | 多语种及方言 | 5 分钟 / 2GB |
| fun-asr-2025-11-07 | 非实时 | HTTP | 热词 | 不支持 | 支持 | 多语种及方言 | 12 小时 / 2GB |
| fun-asr-2025-08-25 | 非实时 | HTTP | 热词 | 不支持 | 支持 | 中、英 | 12 小时 / 2GB |
| fun-asr-mtl | 非实时 | HTTP | 热词 | 不支持 | 支持 | 多语种及方言 | 12 小时 / 2GB |
| fun-asr-mtl-2025-08-25 | 非实时 | HTTP | 热词 | 不支持 | 支持 | 多语种及方言 | 12 小时 / 2GB |

#### Qwen-ASR

| 模型 ID | 模式 | API | 精度增强 | 情感识别 | 说话人分离 | 支持语言 | 最大时长 |
|---|---|---|---|---|---|---|---|
| qwen3-asr-flash-realtime | 实时 | WebSocket | 不支持 | 支持 | 不支持 | 多语种及方言 | 无限制 |
| qwen3-asr-flash-realtime-2026-02-10 | 实时 | WebSocket | 不支持 | 支持 | 不支持 | 多语种及方言 | 无限制 |
| qwen3-asr-flash-realtime-2025-10-27 | 实时 | WebSocket | 不支持 | 支持 | 不支持 | 多语种及方言 | 无限制 |
| qwen3-asr-flash-filetrans | 非实时 | HTTP | 不支持 | 支持 | 不支持 | 多语种及方言 | 12 小时 / 2GB |
| qwen3-asr-flash-filetrans-2025-11-17 | 非实时 | HTTP | 不支持 | 支持 | 不支持 | 多语种及方言 | 12 小时 / 2GB |
| qwen3-asr-flash | 非实时 | HTTP（OpenAI 兼容） | 不支持 | 支持 | 不支持 | 多语种及方言 | 5 分钟 / 10MB |
| qwen3-asr-flash-2026-02-10 | 非实时 | HTTP（OpenAI 兼容） | 不支持 | 支持 | 不支持 | 多语种及方言 | 5 分钟 / 10MB |
| qwen3-asr-flash-2025-09-08 | 非实时 | HTTP（OpenAI 兼容） | 不支持 | 支持 | 不支持 | 多语种及方言 | 5 分钟 / 10MB |

所有 Qwen-ASR 系列模型支持相同的语言列表：中文（普通话、四川话、闽南语、吴语、粤语）、英语、日语、德语、韩语、俄语、法语、葡萄牙语、阿拉伯语、意大利语、西班牙语、印地语、印尼语、泰语、土耳其语、乌克兰语、越南语、捷克语、丹麦语、菲律宾语、芬兰语、冰岛语、马来语、挪威语、波兰语、瑞典语。

#### Paraformer（较早一代 ASR 模型）

百炼建议迁移到 Fun-ASR 或 Qwen-ASR。

| 模型 ID | API | 说明 |
|---|---|---|
| paraformer-realtime-v2 | WebSocket | 实时识别，中、英、日、韩、德、法、俄 |
| paraformer-realtime-v1 | WebSocket | 实时识别，中、英、日、韩、德、法、俄 |
| paraformer-realtime-8k-v2 | WebSocket | 实时识别，8kHz 电话场景，中文 |
| paraformer-realtime-8k-v1 | WebSocket | 实时识别，8kHz 电话场景，中文 |
| paraformer-v2 | HTTP | 录音文件识别，支持说话人分离，中、英、日、韩、德、法、俄 |
| paraformer-8k-v2 | HTTP | 录音文件识别，8kHz 电话场景，中文 |
| paraformer-v1 | HTTP | 录音文件识别，支持说话人分离，中、英、日、韩、德、法、俄 |
| paraformer-8k-v1 | HTTP | 录音文件识别，8kHz 电话场景，中文 |
| paraformer-mtl-v1 | HTTP | 录音文件识别，支持说话人分离，多语种 |

#### 其他（即将下线）

| 模型 ID | API | 说明 |
|---|---|---|
| gummy-realtime-v1 | WebSocket | 实时识别，中、英及方言 |
| gummy-chat-v1 | WebSocket | 短音频实时识别（1 分钟限制），多语种 |
| sensevoice-v1 | HTTP | 录音文件识别，多语种 |

---

## 2. 音频规格

### 2.1 实时（输入）

| 模型 | 输入方式 | 音频格式 | 采样率 | 大小/时长 |
|---|---|---|---|---|
| Qwen-Audio-3.0-ASR-Flash-Streaming | 二进制（Binary）流 | pcm、wav、mp3、opus、speex、aac、amr | 任意 | 不限 |
| Fun-ASR-Realtime（fun-asr-realtime 系列） | 二进制（Binary）流 | pcm、wav、mp3、opus、speex、aac、amr | 任意 | 不限 |
| Fun-ASR-Flash-8K-Realtime | 二进制（Binary）流 | 同 Fun-ASR-Realtime | 8 kHz | 不限 |
| Qwen-ASR-Realtime（qwen3-asr-flash-realtime 系列） | 二进制（Binary）流 | pcm、opus | 8 kHz、16 kHz | 不限 |
| Paraformer-Realtime（v2/v1、8k-v2/v1） | 二进制（Binary）流 | 同 Fun-ASR-Realtime | paraformer-realtime-v2 任意；v1 16 kHz；8k-* 8 kHz | 不限 |

所有实时模型均为**单声道**输入。

### 2.2 非实时（输入）

| 模型 | 输入方式 | 音频格式 | 采样率 | 文件大小/时长 |
|---|---|---|---|---|
| Qwen-Audio-3.0-ASR-Flash-Filetrans | 公网可访问的文件 URL，单次 1 个 | aac、amr、avi、flac、flv、m4a、mkv、mov、mp3、mp4、mpeg、ogg、opus、wav、webm、wma、wmv | 任意 | ≤2 GB；≤12 小时（启用说话人分离建议 ≤2 小时） |
| Qwen-Audio-3.0-ASR-Flash | URL / Base64，单次 1 个 | 同上 | 任意 | ≤2 GB；≤5 分钟 |
| Fun-ASR（fun-asr、fun-asr-mtl 系列） | 公网可访问的文件 URL，单次 1 个 | 同上 | 任意 | ≤2 GB；≤12 小时（启用说话人分离建议 ≤2 小时） |
| Fun-ASR-Flash（fun-asr-flash-2026-06-15） | URL / Base64，单次 1 个 | 同上 | 任意 | ≤2 GB；≤5 分钟 |
| Fun-ASR-Realtime（作为非实时调用时） | URL / Base64，单次 1 个 | 同上 | 任意 | ≤2 GB；≤5 分钟 |
| Paraformer（v2/v1、mtl-v1、8k-v2/v1） | 同 Fun-ASR | 同 Fun-ASR | v2/v1 任意；8k-* 仅 8 kHz；mtl-v1 16 kHz 及以上 | 同 Fun-ASR |
| Qwen3-ASR-Flash-Filetrans | 公网可访问的文件 URL，单次 1 个 | 同上 | pcm 必须 16 kHz；其他格式任意（服务端会重采样为 16 kHz） | ≤2 GB；≤12 小时 |
| Qwen3-ASR-Flash | URL / Base64 / 本地文件绝对路径，单次 1 个 | aac、amr、avi、aiff、flac、flv、mkv、mp3、mpeg、ogg、opus、wav、webm、wma、wmv | pcm 必须 16 kHz；其他格式任意 | ≤10 MB；≤5 分钟 |

### 2.3 支持的语言（按版本）

#### qwen-audio-3.0-asr-flash-streaming / filetrans / flash

中文（普通话、粤语、吴语、闽南语、客家话、赣语、湘语、晋语；并支持中原、西南、冀鲁、江淮、兰银、胶辽、东北、北京、港台等，包括河南、陕西、湖北、四川、重庆、云南、贵州、广东、广西、河北、天津、山东、安徽、南京、江苏、杭州、甘肃、宁夏等地区官话口音）、英语、日语、韩语、越南语、泰语、印尼语、马来语、菲律宾语、印地语、阿拉伯语、法语、德语、西班牙语、葡萄牙语、俄语、意大利语、荷兰语、瑞典语、丹麦语、芬兰语、挪威语、希腊语、波兰语、捷克语、匈牙利语、罗马尼亚语、保加利亚语、克罗地亚语、斯洛伐克语。

#### fun-asr-realtime / fun-asr-2025-11-07 / fun-asr / fun-asr-mtl

同 Qwen-Audio-3.0-ASR-Flash 列表。

#### fun-asr-realtime-2026-02-28 / fun-asr-2025-08-25

中、英、日（及方言）。

#### fun-asr-realtime-2025-09-15

中（普通话）、英。

#### fun-asr-mtl / fun-asr-mtl-2025-08-25

中文（普通话、粤语）、英语、日语、韩语、越南语、泰语、印尼语、马来语、菲律宾语、印地语、阿拉伯语、法语、德语、西班牙语、葡萄牙语、俄语、意大利语、荷兰语、瑞典语、丹麦语、芬兰语、挪威语、希腊语、波兰语、捷克语、匈牙利语、罗马尼亚语、保加利亚语、克罗地亚语、斯洛伐克语。

#### paraformer-realtime-v2 / paraformer-v2

中文（普通话、粤语、吴语、闽南语、东北话、甘肃话、贵州话、河南话、湖北话、湖南话、宁夏话、山西话、陕西话、山东话、四川话、天津话、江西话、云南话、上海话）、英文、日语、韩语、德语、法语、俄语。

#### paraformer-realtime-v1 / paraformer-realtime-8k-v2 / paraformer-realtime-8k-v1 / paraformer-8k-v2 / paraformer-8k-v1

中文普通话。

#### paraformer-v1

中文普通话、英文。

#### paraformer-mtl-v1

中文（普通话、粤语、吴语、闽南语、东北话、甘肃话、贵州话、河南话、湖北话、湖南话、宁夏话、山西话、陕西话、山东话、四川话、天津话）、英文、日语、韩语、西班牙语、印尼语、法语、德语、意大利语、马来语。

---

## 3. Paraformer 录音文件识别（HTTP API）

来源：<https://help.aliyun.com/zh/model-studio/paraformer-recorded-speech-recognition-restful-api>

异步流程：提交任务 → 轮询查询结果。

### 3.1 提交任务接口

#### 接口地址

```
POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/asr/transcription
```

#### 请求头

```
Authorization: Bearer {api-key}
Content-Type: application/json
X-DashScope-Async: enable   # 请勿遗漏，否则无法提交任务
```

#### 请求体示例

```json
{
  "model": "paraformer-v2",
  "input": {
    "file_urls": ["{YOUR_AUDIO_URL}"]
  },
  "parameters": {
    "channel_id": [0],
    "disfluency_removal_enabled": false,
    "timestamp_alignment_enabled": false,
    "special_word_filter": "xxx",
    "language_hints": ["zh", "en"],
    "diarization_enabled": false,
    "speaker_count": 2
  }
}
```

#### 请求参数

| 参数 | 类型 | 默认值 | 是否必须 | 说明 |
|---|---|---|---|---|
| model | string | — | 是 | 指定用于音视频文件转写的 Paraformer 模型名 |
| file_urls | array[string] | — | 是 | 音视频文件转写的 URL 列表，支持 HTTP / HTTPS 协议，单次请求仅支持 1 个 URL。URL 中如包含空格、中文或其他特殊字符，必须先进行 URL 编码（如空格替换为 `%20`）。若录音文件存储在阿里云 OSS，RESTful API 方式支持 `oss://` 前缀的临时 URL |
| vocabulary_id | string | — | 否 | 最新热词 ID，支持最新 v2 系列模型并配置语种信息 |
| resource_id | string | — | 否 | 热词 ID（对应 SDK 中的 `phrase_id` 字段，v1 版本模型热词方案，不支持 v2 及后续系列模型） |
| resource_type | string | — | 否 | 固定字符串 `"asr_phrase"`，与 `resource_id` 同时使用 |
| channel_id | array[integer] | `[0]` | 否 | 多音轨音频文件中需要识别的音轨索引，从 0 开始。每一个音轨独立计费 |
| disfluency_removal_enabled | boolean | false | 否 | 过滤语气词 |
| timestamp_alignment_enabled | boolean | false | 否 | 是否启用时间戳校准功能 |
| special_word_filter | string | — | 否 | 敏感词处理策略（JSON 字符串）。支持 `filter_with_signed`（替换为 `*`）、`filter_with_empty`（直接过滤）、`system_reserved_filter`（默认 true，启用系统预置敏感词规则） |
| language_hints | array[string] | `["zh", "en"]` | 否 | 待识别语音的语言代码。**仅适用于 paraformer-v2 模型**。取值：`zh`、`en`、`ja`、`yue`、`ko`、`de`、`fr`、`ru` |
| diarization_enabled | boolean | false | 否 | 自动说话人分离。仅适用于单声道音频。启用后识别结果中显示 `speaker_id` 字段。建议音频时长不超过 2 小时 |
| speaker_count | integer | — | 否 | 说话人数量参考值，取值范围 `[2, 100]`。开启 diarization_enabled 后生效 |

#### 响应示例

```json
{
  "output": {
    "task_status": "PENDING",
    "task_id": "c2e5d63b-96e1-4607-bb91-************"
  },
  "request_id": "77ae55ae-be17-97b8-9942--************"
}
```

### 3.2 查询任务接口

#### 接口地址

```
POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/tasks/{task_id}
```

> **注意**：Paraformer 文档中查询接口的方法为 `POST`；Fun-ASR / Qwen-ASR 中为 `GET`。差异以官方文档为准。

#### 请求头

```
Authorization: Bearer {api-key}
```

消息体：无。

#### 响应（正常）

```json
{
  "request_id": "f9e1afad-94d3-997e-a83b-************",
  "output": {
    "task_id": "f86ec806-4d73-485f-a24f-************",
    "task_status": "SUCCEEDED",
    "submit_time": "2024-09-12 15:11:40.041",
    "scheduled_time": "2024-09-12 15:11:40.071",
    "end_time": "2024-09-12 15:11:40.903",
    "results": [
      {
        "file_url": "{YOUR_AUDIO_URL}",
        "transcription_url": "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/.../xxx.json?Expires=...&Signature=...",
        "subtask_status": "SUCCEEDED"
      }
    ],
    "task_metrics": { "TOTAL": 1, "SUCCEEDED": 1, "FAILED": 0 }
  },
  "usage": { "duration": 9 }
}
```

#### 响应（异常）

```json
{
  "task_id": "7bac899c-06ec-4a79-8875-xxxxxxxxxxxx",
  "task_status": "SUCCEEDED",
  "submit_time": "2024-12-16 16:30:59.170",
  "scheduled_time": "2024-12-16 16:30:59.204",
  "end_time": "2024-12-16 16:31:02.375",
  "results": [
    {
      "file_url": "{YOUR_AUDIO_URL}",
      "code": "InvalidFile.DownloadFailed",
      "message": "The audio file cannot be downloaded.",
      "subtask_status": "FAILED"
    }
  ],
  "task_metrics": { "TOTAL": 1, "SUCCEEDED": 0, "FAILED": 1 }
}
```

> 当任务包含多个子任务时，只要存在任一子任务成功，整个任务状态将标记为 `SUCCEEDED`，需通过 `subtask_status` 字段判断具体子任务结果。

### 3.3 识别结果 JSON 字段说明

识别结果保存为 JSON 文件，通过 `transcription_url` 下载（**有效期 24 小时**）。

```json
{
  "file_url": "{YOUR_AUDIO_URL}",
  "properties": {
    "audio_format": "pcm_s16le",
    "channels": [0],
    "original_sampling_rate": 16000,
    "original_duration_in_milliseconds": 3834
  },
  "transcripts": [
    {
      "channel_id": 0,
      "content_duration_in_milliseconds": 3720,
      "text": "Hello world, 这里是阿里巴巴语音实验室。",
      "sentences": [
        {
          "begin_time": 100,
          "end_time": 3820,
          "text": "Hello world, 这里是阿里巴巴语音实验室。",
          "sentence_id": 1,
          "speaker_id": 0,
          "words": [
            { "begin_time": 100, "end_time": 596, "text": "Hello ", "punctuation": "" },
            { "begin_time": 596, "end_time": 844, "text": "world", "punctuation": ", " }
          ]
        }
      ]
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| audio_format | string | 源文件中音频的格式 |
| channels | array[integer] | 源文件中音频的音轨索引信息，单轨返回 `[0]`，双轨返回 `[0, 1]` |
| original_sampling_rate | integer | 源文件中音频的采样率（Hz） |
| original_duration_in_milliseconds | integer | 源文件中的原始音频时长（ms） |
| channel_id | integer | 转写结果的音轨索引，以 0 为起始 |
| content_duration_in_milliseconds | integer | 音轨中被判定为语音内容的时长（ms）。仅对语音内容计费 |
| transcript / text | string | 段落级别的语音转写结果 |
| sentences | array | 句子级别的语音转写结果 |
| words | array | 词级别的语音转写结果 |
| begin_time | integer | 开始时间戳（ms） |
| end_time | integer | 结束时间戳（ms） |
| speaker_id | integer | 当前说话人的索引，以 0 为起始。**仅在启用说话人分离功能时显示** |
| punctuation | string | 预测出的词之后的标点符号（如有） |

---

## 4. Qwen-Audio-3.0-ASR-Flash-Filetrans / Fun-ASR 录音文件识别（HTTP API）

来源：<https://help.aliyun.com/zh/model-studio/fun-asr-recorded-speech-recognition-http-api>

### 4.1 接口地址

| 地域 | 提交任务 | 查询任务 |
|---|---|---|
| 华北 2（北京） | `POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/asr/transcription` | `GET https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/tasks/{task_id}` |
| 新加坡 | `POST https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/audio/asr/transcription` | `GET https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/tasks/{task_id}` |

> **重要**：使用新版域名（ap-southeast-1）提交任务时，请求参数中必须包含 `parameters` 对象。即使无需设置任何参数，也必须传入空对象 `{}`，否则任务可正常提交但识别将失败。

### 4.2 请求头

| 参数 | 类型 | 是否必选 | 说明 |
|---|---|---|---|
| Authorization | string | 是 | `Bearer <your_api_key>` |
| Content-Type | string | 是 | `application/json`（仅提交任务） |
| X-DashScope-Async | string | 是 | `enable`（仅提交任务） |

### 4.3 提交任务接口

#### 普通调用

```bash
curl --location 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/asr/transcription' \
--header "Authorization: Bearer $DASHSCOPE_API_KEY" \
--header "Content-Type: application/json" \
--header "X-DashScope-Async: enable" \
--data '{
"model": "qwen-audio-3.0-asr-flash-filetrans",
"input": {
  "file_urls": ["{YOUR_AUDIO_URL}"]
},
"parameters": {
  "channel_id": [0]
}
}'
```

#### 即时热词

```json
{
  "model": "qwen-audio-3.0-asr-flash-filetrans",
  "input": { "file_urls": ["{YOUR_AUDIO_URL}"] },
  "parameters": { "vocabulary": {"张三": 5, "李四": 5} }
}
```

#### 上下文（context）

```json
{
  "model": "qwen-audio-3.0-asr-flash-filetrans",
  "input": {
    "file_urls": ["{YOUR_AUDIO_URL}"],
    "context": [
      { "role": "user", "content": [{"type": "input_text", "text": "你好啊"}] },
      { "role": "assistant", "content": [{"type": "text", "text": "你好啊，我是通义千问，有什么可以帮助你的？"}] }
    ]
  },
  "parameters": { "vocabulary": {"张三": 5, "李四": 5} }
}
```

#### 请求参数

##### model `string`（必选）

支持 Qwen-Audio-3.0-ASR-Flash-Filetrans 和 Fun-ASR 系列模型。

##### input `object`（必选）

| 属性 | 类型 | 必选 | 说明 |
|---|---|---|---|
| file_urls | array[string] | 是 | 音视频文件转写的 URL 列表，支持 HTTP/HTTPS 协议，单次请求仅支持 1 个 URL。OSS 临时 URL 支持仅 RESTful API 方式（SDK 不支持），有效期 48 小时，限流 100 QPS |
| context | array(object) | 否 | 消息列表，包含可选的对话上下文。SDK 暂不支持 |

###### context 子字段

| 属性 | 类型 | 必选 | 说明 |
|---|---|---|---|
| role | string | 是 | `user`（前几轮识别结果或领域词表） / `assistant`（前几轮大语言模型回复） |
| content | array(object) | 是 | 消息内容列表 |
| content[].type | string | 是 | `input_text`（user 角色，需配合 text） / `text`（assistant 角色，需配合 text） |
| content[].text | string | 条件必选 | 文本内容。按字符数计算，每字符计 1。每轮上下文中所有 text 字段长度之和不超过 400 字符，超出从末尾截断 |

上下文约束：消息（input_text 和 text 类型）各最多 5 条；user 必须在对应 assistant 之前。

##### parameters `object`（可选）

> 使用新版域名时为必填，即使无参数也必须传入 `{}`。

| 属性 | 类型 | 默认 | 说明 |
|---|---|---|---|
| vocabulary_id | string | — | 预编译热词列表 ID |
| vocabulary | object | — | 即时热词。键为热词文本，值为权重（integer）。权重取值 `[1, 5]` 或 `50`（超级热词，最多 50 个）。与预编译热词同时配置时仅即时热词生效。**仅 qwen-audio-3.0-asr-flash-filetrans 支持即时热词** |
| channel_id | array[integer] | `[0]` | 多音轨音轨索引，从 0 开始。每音轨独立计费 |
| special_word_filter | string | — | 敏感词处理策略 |
| diarization_enabled | boolean | false | 是否启用说话人分离。仅适用于单声道音频。启用后显示 speaker_id 字段。建议音频时长不超过 2 小时 |
| speaker_count | integer | — | 说话人数量参考值，范围 `[2, 100]`。仅在 diarization_enabled 为 true 时生效 |
| language_hints | array[string] | — | 待识别语言代码。Qwen-Audio-3.0-ASR-Flash-Filetrans 最多 4 个值；Fun-ASR 仅支持 1 个值 |

###### language_hints 取值（qwen-audio-3.0-asr-flash-filetrans、fun-asr、fun-asr-2025-11-07、fun-asr-mtl、fun-asr-mtl-2025-08-25）

`zh`、`en`、`ja`、`ko`、`vi`、`th`、`id`、`ms`、`tl`、`hi`、`ar`、`fr`、`de`、`es`、`pt`、`ru`、`it`、`nl`、`sv`、`da`、`fi`、`no`、`el`、`pl`、`cs`、`hu`、`ro`、`bg`、`hr`、`sk`

`fun-asr-2025-08-25`：`zh`、`en`

#### 响应参数

```json
{
  "output": {
    "task_status": "PENDING",
    "task_id": "c2e5d63b-96e1-4607-bb91-************"
  },
  "request_id": "77ae55ae-be17-97b8-9942--************"
}
```

### 4.4 查询任务接口

```
GET https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/tasks/{task_id}
Authorization: Bearer $DASHSCOPE_API_KEY
```

`task_id` 为 URL 路径参数。

#### 响应（正常）

```json
{
  "request_id": "f9e1afad-94d3-997e-a83b-************",
  "output": {
    "task_id": "f86ec806-4d73-485f-a24f-************",
    "task_status": "SUCCEEDED",
    "submit_time": "2024-09-12 15:11:40.041",
    "scheduled_time": "2024-09-12 15:11:40.071",
    "end_time": "2024-09-12 15:11:40.903",
    "results": [
      {
        "file_url": "{YOUR_AUDIO_URL}",
        "transcription_url": "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/.../xxx.json?...",
        "subtask_status": "SUCCEEDED"
      }
    ],
    "task_metrics": { "TOTAL": 1, "SUCCEEDED": 1, "FAILED": 0 }
  },
  "usage": { "duration": 9 }
}
```

#### 响应字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| task_id | string | 被查询任务的 ID |
| task_status | string | 任务状态：`PENDING` / `RUNNING` / `SUCCEEDED` / `FAILED` / `UNKNOWN` |
| submit_time | string | 任务提交时间 |
| scheduled_time | string | 任务调度时间 |
| end_time | string | 任务结束时间 |
| results | array[object] | 子任务结果列表 |
| results[].subtask_status | string | 子任务状态 |
| results[].file_url | string | 处理的文件 URL |
| results[].transcription_url | string | 识别结果 JSON 链接，有效期 24 小时 |
| results[].code | string | 子任务失败错误码（仅失败时） |
| results[].message | string | 子任务失败错误信息（仅失败时） |
| task_metrics.TOTAL | integer | 子任务总数 |
| task_metrics.SUCCEEDED | integer | 成功数 |
| task_metrics.FAILED | integer | 失败数 |
| usage.duration | integer | 计费时长（秒） |

### 4.5 识别结果 JSON 字段

同 §3.3 Paraformer 结果格式（包含 `file_url` / `properties` / `transcripts` / `sentences` / `words` / `speaker_id`）。

---

## 5. Qwen-ASR 非实时语音识别 API

来源：<https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference>

可通过 **OpenAI 兼容**或 **DashScope 协议**调用。

### 5.1 模型接入方式

| 模型 | 接入方式 |
|---|---|
| 千问 3-ASR-Flash-Filetrans | 仅支持 DashScope 异步调用 |
| 千问 3-ASR-Flash | OpenAI 兼容 和 DashScope 同步调用 两种方式 |

### 5.2 OpenAI 兼容模式

#### 接口地址

| 地域 | URL |
|---|---|
| 华北 2（北京） | `POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions` |
| 新加坡 | `POST https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions` |

> 美国地域不支持 OpenAI 兼容模式。

#### 请求体（curl）

```bash
curl -X POST 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions' \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
-d '{
"model": "qwen3-asr-flash",
"messages": [
  {
    "content": [
      { "type": "input_audio", "input_audio": { "data": "{YOUR_AUDIO_URL}" } }
    ],
    "role": "user"
  }
],
"stream": false,
"asr_options": { "enable_itn": false }
}'
```

`input_audio.data` 支持两种输入形式：
- 公网可访问的文件 URL
- Base64 编码的 Data URL：`data:<mediatype>;base64,<data>`，如 `data:audio/wav;base64,SUQzBAAAAAAAI1RTU0U...`

#### 请求参数

##### model `string`（必选）

仅适用于千问 3-ASR-Flash 模型。

##### messages `array`（必选）

消息类型：

- **System Message**（可选）：`role: system`，用于提供上下文（背景文本、实体词表）。不支持设置模型角色等传统系统提示词。放在 messages 列表第一位。
- **User Message**（必选）：
  - `content` `array`（必选）：仅允许设置一组消息。
  - `content[].type` `string`（必选）：固定 `input_audio`。
  - `content[].input_audio` `string`（必选）：待识别音频。支持 Base64 编码的文件和公网可访问 URL。
  - `role` `string`（必选）：固定 `user`。

##### asr_options `object`（可选）

非 OpenAI 标准参数，OpenAI SDK 通过 `extra_body` 传入。

| 属性 | 类型 | 默认 | 说明 |
|---|---|---|---|
| language | string | 无 | 指定语种以提升准确率。只能指定一个。取值范围见下表 |
| enable_itn | boolean | false | 是否启用 ITN（Inverse Text Normalization）。仅适用于中文和英文音频。开启后中文数字「一百二十三」或英文「one hundred」自动转换为「123」 |

###### language 取值

`zh`（中文：普通话、四川话、闽南语、吴语）、`yue`（粤语）、`en`、`ja`、`de`、`ko`、`ru`、`fr`、`pt`、`ar`、`it`、`es`、`hi`、`id`、`th`、`tr`、`uk`、`vi`、`cs`、`da`、`fil`、`fi`、`is`、`ms`、`no`、`pl`、`sv`

##### stream `boolean`（可选，默认 false）

是否流式输出。

##### stream_options.include_usage `boolean`（可选，默认 false）

是否在最后一个数据块包含 Token 消耗信息。仅在 stream 为 true 时生效。

#### 响应（非流式）

```json
{
  "choices": [
    {
      "finish_reason": "stop",
      "index": 0,
      "message": {
        "annotations": [
          { "emotion": "neutral", "language": "zh", "type": "audio_info" }
        ],
        "content": "欢迎使用阿里云。",
        "role": "assistant"
      }
    }
  ],
  "created": 1767683986,
  "id": "chatcmpl-487abe5f-d4f2-9363-a877-xxxxxxx",
  "model": "qwen3-asr-flash",
  "object": "chat.completion",
  "usage": {
    "completion_tokens": 12,
    "completion_tokens_details": { "text_tokens": 12 },
    "prompt_tokens": 42,
    "prompt_tokens_details": { "audio_tokens": 42, "text_tokens": 0 },
    "seconds": 1,
    "total_tokens": 54
  }
}
```

#### 响应字段

| 字段 | 类型 | 说明 |
|---|---|---|
| choices[].finish_reason | string | `null`（生成中）/ `stop`（自然结束或触发 stop）/ `length`（生成长度过长） |
| choices[].message.role | string | 固定 `assistant` |
| choices[].message.content | array | 语音识别结果 |
| choices[].message.annotations[].language | string | 被识别音频的语种 |
| choices[].message.annotations[].type | string | 固定 `audio_info` |
| choices[].message.annotations[].emotion | string | 情感：`surprised` / `neutral` / `happy` / `sad` / `disgusted` / `angry` / `fearful` |
| usage.completion_tokens | integer | 模型输出 Token 数 |
| usage.prompt_tokens | integer | 输入 Token 数 |
| usage.prompt_tokens_details.audio_tokens | integer | 输入音频长度（Token）。每秒音频转换为 25 Token，不足 1 秒按 1 秒计算 |
| usage.seconds | integer | 音频时长（秒） |
| usage.total_tokens | integer | 输入和输出总 Token 数 |

### 5.3 DashScope 同步调用

#### 接口地址

| 地域 | URL |
|---|---|
| 华北 2（北京） | `POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` |
| 新加坡 | `POST https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` |
| 美国（弗吉尼亚） | `POST https://{WorkspaceId}.us-east-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` |

> 美国地域使用模型时需在模型后面加上 `-us` 后缀，例如 `qwen3-asr-flash-us`。

#### 请求体

通过 HTTP 调用时，`messages` 放入 `input` 对象中。

```bash
curl -X POST "https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation" \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
-d '{
"model": "qwen3-asr-flash",
"input": {
  "messages": [
    { "content": [{"audio": "{YOUR_AUDIO_URL}"}], "role": "user" }
  ]
},
"parameters": {
  "asr_options": { "enable_itn": false }
}
}'
```

DashScope 同步调用支持三种输入形式：Base64 编码的文件、本地文件绝对路径、公网可访问的文件 URL。

#### 请求参数

##### model `string`（必选）

仅适用于千问 3-ASR-Flash 模型。

##### messages `array`（必选）

- **System Message**（可选，仅千问 3-ASR-Flash 支持）：`role: system`。
- **User Message**（必选）：
  - `content[].audio` `string`（必选）：待识别音频。
  - `role` `string`（必选）：固定 `user`。

##### parameters.asr_options `object`（可选，仅千问 3-ASR-Flash 支持）

字段同 OpenAI 兼容模式的 `asr_options`（language / enable_itn）。

#### 响应

```json
{
  "output": {
    "choices": [
      {
        "finish_reason": "stop",
        "message": {
          "annotations": [
            { "language": "zh", "type": "audio_info", "emotion": "neutral" }
          ],
          "content": [{"text": "欢迎使用阿里云。"}],
          "role": "assistant"
        }
      }
    ]
  },
  "usage": {
    "input_tokens_details": {"text_tokens": 0},
    "output_tokens_details": {"text_tokens": 6},
    "seconds": 1
  },
  "request_id": "568e2bf0-d6f2-97f8-9f15-a57b11dc6977"
}
```

### 5.4 DashScope 异步调用（千问 3-ASR-Flash-Filetrans）

#### 提交任务

```
POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/asr/transcription
Authorization: Bearer $DASHSCOPE_API_KEY
Content-Type: application/json
X-DashScope-Async: enable
```

请求体：

```json
{
  "model": "qwen3-asr-flash-filetrans",
  "input": { "file_url": "{YOUR_AUDIO_URL}" },
  "parameters": {
    "channel_id": [0],
    "enable_itn": false
  }
}
```

| 参数 | 类型 | 必选 | 说明 |
|---|---|---|---|
| model | string | 是 | 仅适用于千问 3-ASR-Flash-Filetrans |
| input.file_url | string | 是 | 待识别音频文件 URL，必须公网可访问 |
| parameters.language | string | 否 | 同步调用同名参数 |
| parameters.enable_itn | boolean | 否 | 默认 false |
| parameters.enable_words | boolean | 否 | 默认 false。控制是否返回字级别时间戳：false 返回句级；true 返回字级。字级仅支持中、英、日、韩、德、法、西、意、葡、俄。还影响断句规则：false 基于 VAD；true 基于 VAD + 标点 |
| parameters.channel_id | array | 否 | 默认 `[0]`。每音轨独立计费 |

#### 提交任务响应

```json
{
  "request_id": "92e3decd-0c69-47a8-************",
  "output": {
    "task_id": "8fab76d0-0eed-4d20-************",
    "task_status": "PENDING"
  }
}
```

#### 获取任务执行结果

```
GET https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/tasks/{task_id}
Authorization: Bearer $DASHSCOPE_API_KEY
Content-Type: application/json
```

#### RUNNING 响应

```json
{
  "request_id": "6769df07-2768-4fb0-ad59-************",
  "output": {
    "task_id": "9be1700a-0f8e-4778-be74-************",
    "task_status": "RUNNING",
    "submit_time": "2025-10-27 14:19:31.150",
    "scheduled_time": "2025-10-27 14:19:31.233",
    "task_metrics": { "TOTAL": 1, "SUCCEEDED": 0, "FAILED": 0 }
  }
}
```

#### SUCCEEDED 响应

```json
{
  "request_id": "1dca6c0a-0ed1-4662-aa39-************",
  "output": {
    "task_id": "8fab76d0-0eed-4d20-929f-************",
    "task_status": "SUCCEEDED",
    "submit_time": "2025-10-27 13:57:45.948",
    "scheduled_time": "2025-10-27 13:57:46.018",
    "end_time": "2025-10-27 13:57:47.079",
    "result": {
      "transcription_url": "http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/.../xxx.json?..."
    }
  },
  "usage": { "seconds": 3 }
}
```

#### FAILED 响应

```json
{
  "request_id": "3d141841-858a-466a-9ff9-************",
  "output": {
    "task_id": "c58c7951-7789-4557-9ea3-************",
    "task_status": "FAILED",
    "submit_time": "2025-10-27 15:06:06.915",
    "scheduled_time": "2025-10-27 15:06:06.967",
    "end_time": "2025-10-27 15:06:07.584",
    "code": "FILE_403_FORBIDDEN",
    "message": "FILE_403_FORBIDDEN"
  }
}
```

#### 异步调用识别结果 JSON

```json
{
  "file_url": "https://***.mp3",
  "audio_info": {
    "format": "mp3",
    "sample_rate": 22050
  },
  "transcripts": [
    {
      "channel_id": 0,
      "text": "欢迎使用阿里云。",
      "sentences": [
        {
          "sentence_id": 0,
          "begin_time": 0,
          "end_time": 1440,
          "language": "zh",
          "emotion": "neutral",
          "text": "欢迎使用阿里云。",
          "words": [
            { "begin_time": 0,   "end_time": 160,  "text": "欢", "punctuation": "" },
            { "begin_time": 160, "end_time": 320,  "text": "迎", "punctuation": "" },
            { "begin_time": 320, "end_time": 640,  "text": "使", "punctuation": "" },
            { "begin_time": 640, "end_time": 720,  "text": "用", "punctuation": "" },
            { "begin_time": 880, "end_time": 960,  "text": "阿", "punctuation": "" },
            { "begin_time": 1040,"end_time": 1120, "text": "里", "punctuation": "" },
            { "begin_time": 1120,"end_time": 1440, "text": "云", "punctuation": "。" }
          ]
        }
      ]
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| file_url | string | 被识别的音频文件 URL |
| audio_info.format | string | 音频格式 |
| audio_info.sample_rate | integer | 音频采样率 |
| transcripts[].channel_id | integer | 音轨索引，从 0 起 |
| transcripts[].text | string | 识别结果文本 |
| sentences[].begin_time | integer | 句子开始时间戳（毫秒） |
| sentences[].end_time | integer | 句子结束时间戳（毫秒） |
| sentences[].text | string | 识别结果文本 |
| sentences[].sentence_id | integer | 句子索引，从 0 起 |
| sentences[].language | string | 同请求参数 language 取值 |
| sentences[].emotion | string | `surprised` / `neutral` / `happy` / `sad` / `disgusted` / `angry` / `fearful` |
| words[].begin_time | integer | 开始时间戳（毫秒） |
| words[].end_time | integer | 结束时间戳（毫秒） |
| words[].text | string | 识别结果文本 |
| words[].punctuation | string | 标点符号 |

---

## 6. Paraformer 实时语音识别（WebSocket API）

来源：<https://help.aliyun.com/zh/model-studio/websocket-for-paraformer-real-time-service>

### 6.1 接口地址

Paraformer 仅支持在华北 2（北京）地域使用：

```
wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference
```

URL 必须使用 `wss://` 协议，且固定不变。

### 6.2 请求头

| 参数 | 类型 | 是否必选 | 说明 |
|---|---|---|---|
| Authorization | string | 是 | `Bearer <your_api_key>` |
| user-agent | string | 否 | 客户端标识 |
| X-DashScope-WorkSpace | string | 否 | 业务空间 ID |
| X-DashScope-DataInspection | string | 否 | 是否启用数据合规检测功能。默认不传或 `enable` |

### 6.3 交互流程

1. 建立连接
2. 客户端发送 `run-task` → 接收 `task-started`
3. 客户端发送二进制音频（须单声道），同时接收 `result-generated`
4. 客户端发送 `finish-task` → 继续接收 `result-generated`
5. 接收 `task-finished`
6. 关闭连接

> 客户端事件与 Fun-ASR 共用结构（参见 §7），主要差异：Paraformer Realtime 仅支持华北 2（北京），且 `run-task` payload 中 model 替换为 Paraformer 模型名（如 `paraformer-realtime-v2`）。

---

## 7. Qwen-Audio-3.0-ASR-Flash-Streaming / Fun-ASR-Realtime 实时语音识别（WebSocket API）

来源：
- <https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api>
- <https://help.aliyun.com/zh/model-studio/fun-asr-client-events>
- <https://help.aliyun.com/zh/model-studio/fun-asr-server-events>

### 7.1 接口地址

| 地域 | WebSocket URL |
|---|---|
| 华北 2（北京） | `wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference` |
| 新加坡 | `wss://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/inference` |

URL 必须使用 `wss://` 协议。

### 7.2 请求头

| 参数 | 类型 | 是否必选 | 说明 |
|---|---|---|---|
| Authorization | string | 是 | `Bearer <your_api_key>` |
| user-agent | string | 否 | 客户端标识 |
| X-DashScope-WorkSpace | string | 否 | 业务空间 ID |
| X-DashScope-DataInspection | string | 否 | 是否启用数据合规检测功能。默认不传或 `enable` |

### 7.3 客户端事件

#### run-task（启动任务）

建立 WebSocket 连接后立即发送。服务端返回 `task-started` 事件后才能发送音频。

```json
{
  "header": {
    "action": "run-task",
    "task_id": "2bf83b9a-baeb-4fda-8d9a-xxxxxxxxxxxx",
    "streaming": "duplex"
  },
  "payload": {
    "task_group": "audio",
    "task": "asr",
    "function": "recognition",
    "model": "qwen-audio-3.0-asr-flash-streaming",
    "parameters": {
      "format": "pcm",
      "sample_rate": 16000
    },
    "input": {}
  }
}
```

携带上下文：

```json
"input": {
  "context": [
    {"role": "user", "content": [{"type": "input_text", "text": "你好啊"}]},
    {"role": "assistant", "content": [{"type": "text", "text": "你好啊，我是通义千问，有什么可以帮助你的？"}]}
  ]
}
```

即时热词：

```json
"parameters": {
  "format": "pcm",
  "sample_rate": 16000,
  "vocabulary": {"张三": 5, "李四": 5}
}
```

##### header 字段

| 属性 | 类型 | 必选 | 说明 |
|---|---|---|---|
| action | string | 是 | 固定 `run-task` |
| task_id | string | 是 | 客户端生成的任务 ID（UUID 格式） |
| streaming | string | 是 | 固定 `duplex` |

##### payload 字段

| 属性 | 类型 | 必选 | 说明 |
|---|---|---|---|
| task_group | string | 是 | 固定 `audio` |
| task | string | 是 | 固定 `asr` |
| function | string | 是 | 固定 `recognition` |
| model | string | 是 | 模型名。支持 Qwen-Audio-3.0-ASR-Flash-Streaming 和 Fun-ASR-Realtime 系列 |
| input | object | 是 | 输入对象。不携带上下文时传入 `{}` |
| input.context | array(object) | 否 | 对话上下文。仅 qwen-audio-3.0-asr-flash-streaming / fun-asr-realtime / fun-asr-realtime-2025-11-07 支持 |
| parameters | object | 是 | 语音识别参数 |

###### input.context 字段

| 属性 | 类型 | 必选 | 说明 |
|---|---|---|---|
| role | string | 是 | `user` / `assistant` |
| content | array(object) | 是 | 消息内容列表 |
| content[].type | string | 是 | `input_text`（user）/ `text`（assistant） |
| content[].text | string | 是 | 文本内容 |

约束：input_text 和 text 各最多 5 条；每轮上下文 text 字段长度之和不超过 400 字符；user 必须在对应 assistant 之前。

###### parameters 字段

| 属性 | 类型 | 必选 | 说明 |
|---|---|---|---|
| format | string | 是 | 音频格式。取值：`pcm` / `wav` / `mp3` / `opus` / `speex` / `aac` / `amr`。opus/speex 必须用 Ogg 封装；wav 必须为 PCM 编码；amr 仅支持 AMR-NB |
| sample_rate | integer | 是 | 采样率（Hz）。8k 模型仅支持 8000 Hz，其他模型支持任意采样率 |
| vocabulary_id | string | 否 | 预编译热词列表 ID |
| vocabulary | object | 否 | 即时热词。键为热词文本，值为权重 `[1, 5]` 或 `50`。与预编译热词同时配置时仅即时热词生效。**仅 qwen-audio-3.0-asr-flash-streaming 支持** |
| language_hints | array[string] | 否 | 待识别音频语种。Qwen-Audio-3.0-ASR-Flash-Streaming 最多 4 个值；Fun-ASR-Realtime 仅支持 1 个值 |
| semantic_punctuation_enabled | boolean | 否 | 默认 false。true 开启语义断句，关闭 VAD；false（默认）开启 VAD 断句 |
| max_sentence_silence | integer | 否 | VAD 断句静音阈值（ms）。默认 1300。取值 `[200, 6000]` |
| multi_threshold_mode_enabled | boolean | 否 | 默认 false。仅在 semantic_punctuation_enabled 为 false 时生效 |
| heartbeat | boolean | 否 | 默认 false。true 在持续发送静音音频情况下保持连接不中断；false 即使持续发送静音音频，连接也将在 60 秒后超时断开 |
| speech_noise_threshold | float | 否 | 语音与噪音判定阈值。取值 `[-1.0, 1.0]` |
| special_word_filter | string | 否 | 敏感词处理策略 |

language_hints 取值（qwen-audio-3.0-asr-flash-streaming / fun-asr-realtime / fun-asr-realtime-2025-11-07）：

`zh`、`en`、`ja`、`ko`、`vi`、`th`、`id`、`ms`、`tl`、`hi`、`ar`、`fr`、`de`、`es`、`pt`、`ru`、`it`、`nl`、`sv`、`da`、`fi`、`no`、`el`、`pl`、`cs`、`hu`、`ro`、`bg`、`hr`、`sk`

`fun-asr-realtime-2026-02-28`：`zh`、`en`、`ja`

`fun-asr-realtime-2025-09-15`：`zh`、`en`

`fun-asr-flash-8k-realtime`、`fun-asr-flash-8k-realtime-2026-01-28`：`zh`

#### continue-task（更新上下文）

任务运行中更新对话上下文。仅 qwen-audio-3.0-asr-flash-streaming / fun-asr-realtime / fun-asr-realtime-2025-11-07 支持。

```json
{
  "header": {
    "action": "continue-task",
    "task_id": "2bf83b9a-baeb-4fda-8d9a-xxxxxxxxxxxx",
    "streaming": "duplex"
  },
  "payload": {
    "input": {
      "context": [
        {"role": "user", "content": [{"type": "input_text", "text": "你好啊"}]},
        {"role": "assistant", "content": [{"type": "text", "text": "你好啊，我是通义千问，有什么可以帮助你的？"}]}
      ]
    }
  }
}
```

#### finish-task（结束任务）

```json
{
  "header": {
    "action": "finish-task",
    "task_id": "2bf83b9a-baeb-4fda-8d9a-xxxxxxxxxxxx",
    "streaming": "duplex"
  },
  "payload": { "input": {} }
}
```

### 7.4 服务端事件

#### task-started

```json
{
  "header": {
    "task_id": "2bf83b9a-baeb-4fda-8d9a-xxxxxxxxxxxx",
    "event": "task-started",
    "attributes": {}
  },
  "payload": {}
}
```

#### result-generated

```json
{
  "header": {
    "task_id": "2bf83b9a-baeb-4fda-8d9a-xxxxxxxxxxxx",
    "event": "result-generated",
    "attributes": {}
  },
  "payload": {
    "output": {
      "sentence": {
        "begin_time": 170,
        "end_time": 920,
        "text": "好，我知道了",
        "heartbeat": false,
        "sentence_end": true,
        "sentence_id": 1,
        "words": [
          {"begin_time": 170, "end_time": 295, "text": "好", "punctuation": "，"},
          {"begin_time": 295, "end_time": 503, "text": "我", "punctuation": ""},
          {"begin_time": 503, "end_time": 711, "text": "知道", "punctuation": ""},
          {"begin_time": 711, "end_time": 920, "text": "了", "punctuation": ""}
        ]
      }
    },
    "usage": { "duration": 3 }
  }
}
```

##### payload.output.sentence 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| begin_time | integer | 句子开始时间（ms） |
| end_time | integer | 句子结束时间（ms） |
| text | string | 识别文本 |
| heartbeat | boolean | 若为 true 可跳过该结果（心跳包） |
| sentence_end | boolean | 是否句子结束（true=最终结果，false=中间结果） |
| sentence_id | integer | 句子序号。正常从 1 开始递增；心跳包时固定为 0 |
| words | array[object] | 字时间戳信息，含 `begin_time` / `end_time` / `text` / `punctuation` |

##### payload.usage

当 `sentence.sentence_end` 为 false 时 `usage` 为 `null`；当 `sentence_end` 为 true 时 `usage.duration` 为当前任务计费时长（秒）。

#### task-finished

```json
{
  "header": {
    "task_id": "2bf83b9a-baeb-4fda-8d9a-xxxxxxxxxxxx",
    "event": "task-finished",
    "attributes": {}
  },
  "payload": { "output": {}, "usage": null }
}
```

#### task-failed

```json
{
  "header": {
    "task_id": "2bf83b9a-baeb-4fda-8d9a-xxxxxxxxxxxx",
    "event": "task-failed",
    "error_code": "CLIENT_ERROR",
    "error_message": "request timeout after 23 seconds.",
    "attributes": {}
  },
  "payload": {}
}
```

任务失败后连接会被关闭，无法复用。

---

## 8. 关于「独立的说话人分离能力」

百炼官方文档中**没有**提供独立的说话人分离（speaker diarization）API 接口。说话人分离作为录音文件识别接口的请求参数 `diarization_enabled`（默认 false）：

| 支持说话人分离的模型 | 接口 | 关键参数 |
|---|---|---|
| qwen-audio-3.0-asr-flash-filetrans | HTTP（异步） | `diarization_enabled: true`，`speaker_count: [2, 100]` |
| fun-asr、fun-asr-mtl 系列 | HTTP（异步） | 同上 |
| paraformer-v2、paraformer-v1、paraformer-mtl-v1 | HTTP（异步） | 同上 |

启用后识别结果中显示 `speaker_id` 字段（参见 §3.3 / §4.5）。仅适用于单声道音频，建议音频时长不超过 2 小时。

---

## 9. 错误码（Paraformer 文档示例）

错误码字段：`code`（错误码）+ `message`（错误信息）。识别失败示例：

```json
{
  "results": [
    {
      "file_url": "{YOUR_AUDIO_URL}",
      "code": "InvalidFile.DownloadFailed",
      "message": "The audio file cannot be downloaded.",
      "subtask_status": "FAILED"
    }
  ]
}
```

Fun-ASR 失败示例：

```json
{
  "results": [
    {
      "file_url": "{YOUR_AUDIO_URL}",
      "code": "FILE_DOWNLOAD_FAILED",
      "message": "FILE_DOWNLOAD_FAILED",
      "subtask_status": "FAILED"
    }
  ]
}
```

Qwen-ASR 异步任务失败示例：`code: FILE_403_FORBIDDEN`。

完整错误码参考百炼官方「错误码」专页（文档未在本文抓取页面中给出完整列表）。

---

## 10. 关键限制与注意

- 非实时 ASR 单次请求仅支持 1 个 URL。
- URL 中包含空格、中文等特殊字符必须先 URL 编码，否则返回 `InvalidFile.DownloadFailed`。
- 阿里云 OSS 临时 URL 有效期 48 小时，文件上传凭证接口限流 100 QPS，不支持扩容。生产环境建议使用 OSS 等稳定存储。
- 使用新版域名（ap-southeast-1）提交任务时，`parameters` 为必填，即使无参数也必须传入 `{}`。
- 启用说话人分离建议音频时长不超过 2 小时。
- 启用说话人分离功能时仅适用于单声道音频，多声道音频不支持。
- 任务包含多个子任务时，只要任一子任务成功，整个任务状态将标记为 `SUCCEEDED`，需通过 `subtask_status` 判断具体子任务结果。
- `transcription_url` 有效期 24 小时。

---

## 11. 文档原始 URL

| 子主题 | URL |
|---|---|
| 语音识别（模型清单 + 音频规格） | <https://help.aliyun.com/zh/model-studio/asr-model> |
| Paraformer 录音文件识别 HTTP API | <https://help.aliyun.com/zh/model-studio/paraformer-recorded-speech-recognition-restful-api> |
| Fun-ASR / Qwen-Audio-3.0-ASR-Flash-Filetrans HTTP API | <https://help.aliyun.com/zh/model-studio/fun-asr-recorded-speech-recognition-http-api> |
| Qwen-ASR API 参考 | <https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference> |
| Paraformer Realtime WebSocket API | <https://help.aliyun.com/zh/model-studio/websocket-for-paraformer-real-time-service> |
| Fun-ASR-Realtime WebSocket API | <https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api> |
| Fun-ASR 客户端事件 | <https://help.aliyun.com/zh/model-studio/fun-asr-client-events> |
| Fun-ASR 服务端事件 | <https://help.aliyun.com/zh/model-studio/fun-asr-server-events> |
| 实时语音识别用户指南 | <https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide> |
| 非实时语音识别用户指南 | <https://help.aliyun.com/zh/model-studio/non-realtime-speech-recognition-user-guide> |
