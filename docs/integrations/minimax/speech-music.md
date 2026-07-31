# MiniMax 语音合成与音乐生成 对接说明

> 状态: 待开发 | 最后核对: 2026-07-31

本文件记录 MiniMax 开放平台（`platform.minimaxi.com`）语音与音乐相关接口的官方对接信息，覆盖同步语音合成（T2A HTTP / WebSocket）、异步长文本语音合成（T2A Async）、音色快速复刻（Voice Cloning）、音色设计（Voice Design）、音乐生成（Music Generation）五个模块。

**采集方式**：官方文档站为 Mintlify 结构，在任意文档 URL 后追加 `.md` 可获得该页原始 Markdown（内嵌完整 OpenAPI / AsyncAPI 定义）。文档全量索引位于 `https://platform.minimaxi.com/docs/llms.txt`。本文件所有字段均摘自这些原始定义，未作推断。

**通用约定**

| 项 | 值 | 来源 |
| --- | --- | --- |
| API 根地址 | `https://api.minimaxi.com` | https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md |
| T2A HTTP 备用地址 | `https://api-bj.minimaxi.com/v1/t2a_v2` | https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md |
| 鉴权 | `Authorization: Bearer <API_key>`（securityScheme：`type: http` / `scheme: bearer` / `bearerFormat: JWT`） | https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md |
| API Key 获取 | 按量付费：接口密钥 > 创建新的 API Key；Token Plan：订阅管理 > Token Plan（订阅 Key 与按量付费 Key 相互独立） | https://platform.minimaxi.com/docs/api-reference/api-overview |
| Content-Type | JSON 接口必填 `application/json`；文件上传必填 `multipart/form-data` | https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md 、 https://platform.minimaxi.com/docs/api-reference/voice-cloning-uploadcloneaudio.md |
| 问题定位 | 响应 Header 中的 `trace_id` | https://platform.minimaxi.com/docs/api-reference/errorcode.md |

**语音模型清单**（T2A / T2A Async / Cloning / Design 的 `model` 枚举一致）

`speech-2.8-hd`、`speech-2.8-turbo`、`speech-2.6-hd`、`speech-2.6-turbo`、`speech-02-hd`、`speech-02-turbo`、`speech-01-hd`、`speech-01-turbo`（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md）

> 注意：`api-overview` 概览页只列出 speech-2.8 / 2.6 / 02 共 6 个模型，但各接口的 OpenAPI `enum` 中额外包含 `speech-01-hd`、`speech-01-turbo`（来源：https://platform.minimaxi.com/docs/api-reference/api-overview 与 https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md）。

---

## 1. 同步语音合成 T2A（HTTP）

- **方法 / URL**：`POST https://api.minimaxi.com/v1/t2a_v2`（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md）
- **单次文本上限**：10,000 字符；超过 3,000 字符推荐使用流式输出（来源：同上）
- **能力**：300+ 系统音色、复刻音色；音量/语调/语速/输出格式调整；按比例混音；固定间隔时间控制；mp3/pcm/flac/wav；流式输出（来源：https://platform.minimaxi.com/docs/api-reference/api-overview）
- **支持语言**：40 种（来源：https://platform.minimaxi.com/docs/api-reference/api-overview）

### 1.1 请求体 `T2aV2Req`

必填：`model`、`text`（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 枚举见上方模型清单 |
| `text` | string | 是 | <10000 字符。支持停顿标记 `<#x#>`（x 单位秒，范围 [0.01, 99.99]，最多两位小数，不可连续使用）；行内发音替换（拼音带声调 1–5 / IPA / 粤拼带声调 1–6，英文小括号包裹）；语气词标签（仅 `speech-2.8-hd` / `speech-2.8-turbo`） |
| `stream` | boolean | 否 | 默认 `false` |
| `stream_options.exclude_aggregated_audio` | boolean | 否 | 默认 `False`，即最后一个 chunk 包含拼接后的完整语音 hex |
| `voice_setting` | object | 否 | 见 1.2 |
| `audio_setting` | object | 否 | 见 1.3 |
| `pronunciation_dict.tone` | string[] | 否 | 格式 `原文/替换内容`；中文声调 1=一声 2=二声 3=三声 4=四声 5=轻声 |
| `timbre_weights` | array | 否 | 混音；元素必填 `voice_id` + `weight`，`weight` 范围 [1,100]，最多 4 种音色混合 |
| `language_boost` | string | 否 | 默认 `null`，可设 `auto`；**OpenAPI `enum` 含 40 语种 + `auto`（共 41 项）**，完整列表：Chinese, Chinese,Yue, English, Arabic, Russian, Spanish, French, Portuguese, German, Turkish, Dutch, Ukrainian, Vietnamese, Indonesian, Japanese, Italian, Korean, Thai, Polish, Romanian, Greek, Czech, Finnish, Hindi, Bulgarian, Danish, Hebrew, Malay, Persian, Slovak, Swedish, Croatian, Filipino, Hungarian, Norwegian, Slovenian, Catalan, Nynorsk, Tamil, Afrikaans, auto。speech-01/02 系列暂不支持 Persian、Filipino、Tamil。`api-overview` 概览页语种表列 40 种（缺 Chinese,Yue / Nynorsk 与 auto 字符串值），与 OpenAPI `enum` 不完全一致 → **以 OpenAPI `enum` 为准**。 |
| `voice_modify` | object | 否 | 见 1.4 |
| `subtitle_enable` | boolean | 否 | 默认 `false` |
| `subtitle_type` | string | 否 | `sentence`（默认）/ `word` / `word_streaming`（仅 `stream=true` 有效） |
| `output_format` | string | 否 | `url` / `hex`，默认 `hex`；仅非流式生效，流式仅支持 hex；返回的 url 有效期 24 小时 |
| `aigc_watermark` | boolean | 否 | 默认 `False`，仅非流式生效 |

（本表全部字段来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md）

### 1.2 `voice_setting`（`T2AVoiceSetting`，必填 `voice_id`）

| 字段 | 类型 | 必填 | 范围 / 默认 |
| --- | --- | --- | --- |
| `voice_id` | string | 是 | 支持系统音色、复刻音色、文生音色三种类型；设置混合音色时本参数置空并改用 `timbre_weights` |
| `speed` | number(float) | 否 | [0.5, 2]，默认 1.0 |
| `vol` | number(float) | 否 | (0, 10]，默认 1.0 |
| `pitch` | integer | 否 | [-12, 12]，默认 0（0 为原音色） |
| `emotion` | string | 否 | `happy`/`sad`/`angry`/`fearful`/`disgusted`/`surprised`/`calm`/`fluent`/`whisper`；`fluent`、`whisper` 仅对 speech-2.6-turbo / speech-2.6-hd 生效，speech-2.8 系列不支持 `whisper` |
| `text_normalization` | boolean | 否 | 中英文本规范化，默认 false |
| `latex_read` | boolean | 否 | 默认 false；仅支持中文，开启后 `language_boost` 被设为 `Chinese`，公式需 `$$` 包裹、`\` 转义为 `\\` |

（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md）

### 1.3 `audio_setting`（`T2AAudioSetting`）

| 字段 | 类型 | 范围 / 默认 |
| --- | --- | --- |
| `sample_rate` | integer | [8000, 16000, 22050, 24000, 32000, 44100]，默认 `32000` |
| `bitrate` | integer | [32000, 64000, 128000, 256000]，默认 `128000`，仅对 `mp3` 生效 |
| `format` | string | `mp3`（默认）/ `pcm` / `flac` / `wav` / `pcmu_raw` / `pcmu_wav` / `opus`。`pcmu_raw`、`pcmu_wav` 为 G.711 μ-law（8 kHz，前者无文件头裸数据，后者 WAV 容器）；`opus` 为 Ogg/Opus |
| `channel` | integer | [1, 2]，1=单声道，2=双声道，默认 1 |
| `force_cbr` | boolean | 默认 false；仅在**流式**且格式为 `mp3` 时生效 |

（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md）

### 1.4 `voice_modify`（声音效果器）

支持格式：非流式 `mp3`/`wav`/`flac`；流式 `mp3`（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md）

| 字段 | 类型 | 范围 |
| --- | --- | --- |
| `pitch` | integer | [-100, 100]，-100 更低沉，100 更明亮 |
| `intensity` | integer | [-100, 100]，-100 更刚劲，100 更轻柔 |
| `timbre` | integer | [-100, 100]，-100 更浑厚，100 更清脆 |
| `sound_effects` | string | 单选：`spacious_echo`（空旷回音）/ `auditorium_echo`（礼堂广播）/ `lofi_telephone`（电话失真）/ `robotic`（电音） |

### 1.5 响应 `T2aV2Resp`

```jsonc
{
  "data": {
    "audio": "<hex 编码音频，格式与请求指定输出格式一致>",
    "subtitle_file": "<字幕下载链接，精确到句(不超过50字)，单位毫秒，json 格式>",
    "status": 2                    // 1=合成中，2=合成结束
  },
  "extra_info": {
    "audio_length": 9900,          // 毫秒
    "audio_sample_rate": 32000,
    "audio_size": 160323,          // 字节
    "bitrate": 128000,
    "audio_format": "mp3",         // 取值范围 [mp3, pcm, flac]
    "audio_channel": 1,            // 1=单声道 2=双声道
    "invisible_character_ratio": 0,// 非法字符占比，>10% 报错
    "usage_characters": 26,        // 计费字符数
    "word_count": 52               // 已发音字数，含汉字/数字/字母，不含标点
  },
  "trace_id": "01b8bf9bb7433cc75c18eee6cfa8fe21",
  "base_resp": { "status_code": 0, "status_msg": "success" }
}
```

（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md）

- **流式响应**：`Content-Type: text/event-stream`，逐块返回 `data.audio`（hex）且 `status=1`，末块 `status=2` 并携带 `extra_info`（来源：同上）
- **`base_resp.status_code`**（T2A HTTP 内联子集）：`0` 正常、`1000` 未知错误、`1001` 超时、`1002` 触发限流、`1004` 鉴权失败、`1039` 触发 TPM 限流、`1042` 非法字符超过 10%、`2013` 输入参数信息不正常（**注意：T2A HTTP 子集不含 `1008` 余额不足**，与 T2A Async / Music / Image 不同；来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md `BaseResp.status_code.description`）

---

## 2. 同步语音合成 T2A（WebSocket）

- **连接地址**：`wss://api.minimaxi.com/ws/v1/t2a_v2`（AsyncAPI：`protocol: wss` / `host: api.minimaxi.com` / `address: /ws/v1/t2a_v2`）（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-websocket.md）
- **握手鉴权**：连接时携带 `headers = {"Authorization": f"Bearer {api_key}"}`（来源：https://platform.minimaxi.com/docs/guides/speech-t2a-websocket.md）
- **消息格式**：`contentType: application/json`，每帧为一个 JSON 对象，靠 `event` 字段区分（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-websocket.md）

### 2.1 事件流程

| 方向 | event | 说明 |
| --- | --- | --- |
| 服务端→客户端 | `connected_success` | 成功建立连接后返回 |
| 客户端→服务端 | `task_start` | 正式开始合成任务 |
| 服务端→客户端 | `task_started` | 任务已成功开始；只有收到该事件后才能发送 `task_continue` 或 `task_finish` |
| 客户端→服务端 | `task_continue` | 发送待合成文本，支持顺序发送多个 |
| 服务端→客户端 | `task_continued` | 返回音频数据 |
| 客户端→服务端 | `task_finish` | 服务端等待队列内合成任务完成后关闭连接并结束任务 |
| 服务端→客户端 | `task_finished` | 任务已成功结束 |
| 服务端→客户端 | `task_failed` | 任务失败，需关闭连接并处理错误 |

（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-websocket.md）

- **超时**：最后一次收到服务端返回结果后超过 **120s** 未发送新事件，WebSocket 连接自动断开（来源：同上）

### 2.2 `task_start` 请求帧

必填：`event`、`model`、`voice_setting`（其中 `voice_setting.voice_id` 必填）（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-websocket.md）

```jsonc
{
  "event": "task_start",
  "model": "speech-2.8-turbo",
  "language_boost": "Chinese",
  "voice_setting": { "voice_id": "male-qn-qingse", "speed": 1, "vol": 1, "pitch": 0 },
  "pronunciation_dict": { "tone": ["处理/(chu3)(li3)", "危险/dangerous"] },
  "audio_setting": { "sample_rate": 32000, "bitrate": 128000, "format": "mp3", "channel": 1 }
}
```

可选顶层字段：`audio_setting`、`pronunciation_dict`、`timbre_weights`、`language_boost`、`voice_modify`、`subtitle_enable`、`subtitle_type`、`continuous_sound`（来源：同上）

- `voice_setting` 子字段与 HTTP 一致，另含 `english_normalization`（boolean，默认 `false`）与 `latex_read`（boolean，默认 `false`）；WebSocket 版 `voice_setting` 中为 `english_normalization` 而非 HTTP 的 `text_normalization`（来源：同上）
- `audio_setting.format` 枚举：`mp3`/`pcm`/`flac`/`wav`/`pcmu_raw`/`pcmu_wav`/`opus`；流式模式下音频 chunk 需按到达顺序拼接后再解码（来源：同上）
- `continuous_sound`（boolean，默认 `false`）：控制模型侧文本切分策略，仅对 `speech-2.8-hd`、`speech-2.8-turbo` 有效。`true`=不切分、连续推理（长文本韵律更自然）；`false`=切分并发推理（延迟更低）（来源：同上）
- `subtitle_type` 枚举：`sentence`（默认）/`word`/`word_streaming`（来源：同上）

### 2.3 `task_continue` / `task_finish` 请求帧

```jsonc
{ "event": "task_continue", "text": "真正的危险不是计算机开始像人一样思考(sighs)……" }
{ "event": "task_finish" }
```

`task_continue` 必填 `event` + `text`；`text` 长度限制小于 10,000 字符，支持 `<#x#>` 停顿标记与语气词标签（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-websocket.md）

### 2.4 服务端事件帧

```jsonc
// connected_success / task_started / task_finished / task_failed 结构一致
{ "session_id": "xxxx", "event": "task_started", "trace_id": "0303a288...", "base_resp": { "status_code": 0, "status_msg": "success" } }

// task_continued
{
  "data": { "audio": "xxx" },
  "extra_info": {
    "audio_channel": 1, "audio_format": "mp3", "audio_length": 9914,
    "audio_sample_rate": 32000, "audio_size": 157869, "bitrate": 128000,
    "invisible_character_ratio": 0, "usage_characters": 158, "word_count": 158
  },
  "is_final": true,
  "session_id": "301871346491491",
  "trace_id": "04ee3794e2c9e4a6d5f99e77742f06fd",
  "base_resp": { "status_code": 0, "status_msg": "success" }
}
```

（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-websocket.md）

- **`task_continued` 专属 status_code**：`0`、`1000`、`1001`、`1002`、`1004`、`1039`、`1042`、`2013`，以及 `2201` 超时断开连接、`2202` 非法事件、`2203` 空文本跳过、`2204` 超出字符限制跳过、`2205` 请求超限（来源：同上）
- **`task_failed` status_code**：`1000`、`1001`、`1002`、`1004`、`1039`、`1042`、`2013`、`2201`（来源：同上）
- **`2201`–`2205` 触发场景**：`2201` 仅在"最后一次收到服务端返回结果后超过 120s 没有发送新事件"时触发（WebSocket 自动断开）；`2202`–`2205` 与协议事件流配套。

---

## 3. 异步长文本语音生成（T2A Async）

### 3.1 创建任务

- **方法 / URL**：`POST https://api.minimaxi.com/v1/t2a_async_v2`（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-create.md）
- **字符上限**：`text` 字段限制最长 **5 万字符**；`text_file_id` 指向的**单个文件长度限制小于 100 万字符**（api-overview 概览描述为「单次文本生成传输最大支持 100 万字符」）（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-create.md 与 https://platform.minimaxi.com/docs/api-reference/api-overview）
- **URL 有效期**：返回的下载 URL 自生成起 **9 小时（32,400 秒）** 内有效，过期后文件失效（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-create.md）

OpenAPI `required` 声明为 `model`、`text`、`text_file_id`、`voice_setting`；字段描述中明确 `text` 与 `text_file_id` 为**二选一必填**（来源：同上）。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 枚举同模型清单 |
| `text` | string | 二选一 | 最长 5 万字符；语气词标签仅 speech-2.8 系列支持（该页语气词列表额外含 `(whistles)`、`(crying)`、`(applause)`） |
| `text_file_id` | integer(int64) | 二选一 | 文本文件 id，支持 `txt`、`zip`。txt <1,000,000 字符，支持 `<#x#>` 停顿标记；zip 内需为同一格式 txt 或 json，json 支持 `title`/`content`/`extra` 三字段，三者齐全时产出 3 组共 9 个文件 |
| `voice_setting` | object | 是 | 见下 |
| `audio_setting` | object | 否 | 见下 |
| `pronunciation_dict.tone` | string[] | 否 | 例：`["燕少飞/(yan4)(shao3)(fei1)", "omg/oh my god"]` |
| `language_boost` | string | 否 | 枚举同 T2A HTTP，默认 `null` |
| `voice_modify` | object | 否 | `pitch`/`intensity`/`timbre`（均 [-100,100]）、`sound_effects`；支持格式 `mp3`/`wav`/`flac`，传入 `pcm`/`pcmu_raw`/`pcmu_wav`/`opus` 会返回参数错误 |
| `aigc_watermark` | boolean | 否 | 默认 `False` |

`voice_setting`（`T2AAsyncV2VoiceSetting`，必填 `voice_id`）：`voice_id`、`speed`([0.5,2]，默认1.0)、`vol`((0,10]，默认1.0)、`pitch`([-12,12]，默认0)、`emotion`（枚举同 T2A）、`english_normalization`（boolean，默认 false）（来源：同上）

`audio_setting`（`T2AAsyncV2AudioSetting`）—— 注意字段名与同步接口不同：

| 字段 | 范围 / 默认 |
| --- | --- |
| `audio_sample_rate` | [8000, 16000, 22050, 24000, 32000, 44100]，默认 `32000`；`opus` 时仅支持 [8000, 12000, 16000, 24000, 48000] |
| `bitrate` | [32000, 64000, 128000, 256000]，默认 `128000`，仅 `mp3` 生效 |
| `format` | `mp3`（默认）/`pcm`/`flac`/`wav`/`pcmu_raw`/`pcmu_wav`/`opus` |
| `channel` | [1, 2]，**默认 2**（与同步接口默认 1 不同） |

（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-create.md）

**响应 `T2AAsyncV2Resp`**：

```jsonc
{
  "task_id": "95157322514444",   // string (OpenAPI `type: string`)，当前任务 ID —— 创建响应里 task_id 是 STRING，不是 int64
  "task_token": "eyJhbGciOiJSUz", // 完成当前任务使用的密钥信息
  "file_id": 95157322514444,      // int64，音频文件 ID，出错时不返回
  "usage_characters": 101,        // 计费字符数
  "base_resp": { "status_code": 0, "status_msg": "success" }
}
```

> ⚠️ **`task_id` 在 T2A Async 通道里的类型在不同 endpoint 不同**：
> - 创建响应 `T2AAsyncV2Resp.task_id` → **string**（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-create.md）
> - 查询参数 `t2a_async_v2_query.task_id` 与查询响应 `task_id` → **integer(int64)**（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-query.md `task_id: type: integer, format: int64`）
>
> 与视频生成（全程 string）、视频 Agent（全程 string）的 `task_id` 不一致。JS 客户端在创建响应后必须把 string `task_id` 转 int64 数字或保留为 string 再透传；查询时按 int64 数字传，避免精度丢失。

**输出文件**：txt 输入产出「音频文件 + 字幕文件（精确到句） + 额外信息 JSON 文件」；json 输入按 `title` / `content` / `extra` 各产出一组，字段为空则不输出对应文件（来源：同上）

### 3.2 查询任务状态

- **方法 / URL**：`GET https://api.minimaxi.com/v1/query/t2a_async_query_v2`（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-query.md）
- **Query 参数**：`task_id`（**integer (int64)**，必填，提交任务时返回的信息；`task_id` 本身在 create 响应里是 string，这里查询时按 int64 解析）（来源：同上）
- **限频**：该 API 限制每秒最多查询 10 次（来源：同上）

**状态枚举**：OpenAPI `enum` 为 `success` / `failed` / `expired` / `processing`；字段描述与示例使用首字母大写形式 **Processing**（处理中）、**Success**（已完成）、**Failed**（失败）、**Expired**（已过期）（来源：同上）

```jsonc
{
  "task_id": 95157322514444,    // int64 (与查询参数一致)
  "status": "Processing",       // 描述使用首字母大写形式
  "file_id": 95157322514496,    // int64，任务成功时返回；完成后经文件检索接口下载；下载 URL 9 小时(32400 秒)有效
  "base_resp": { "status_code": 0, "status_msg": "success" }
}
```

（来源：同上）

**`base_resp.status_code`**（T2A Async 创建与查询共用子集）：`0` 正常、`1002` 限流、`1004` 鉴权失败、`1039` 触发 TPM 限流、`1042` 非法字符超 10%、`2013` 参数错误（**无 1000 / 1001 / 1008 / 1026**；来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-create.md `BaseResp.status_code.description` 与 https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-query.md）

---

## 4. 音色快速复刻（Voice Cloning）

**认证要求**：使用本接口需完成**个人认证及企业认证**后方可调用，在「账户管理 -> 账户信息」中完成（来源：https://platform.minimaxi.com/docs/api-reference/api-overview）；接口页表述为「调用本接口前，请先完成个人或企业认证」（来源：https://platform.minimaxi.com/docs/api-reference/voice-cloning-clone.md）。无权限时返回 `2038`（来源：同上）

**临时音色时效**：复刻产出为临时音色，若 **168 小时（7 天）** 内未在任意 T2A 合成接口中正式调用（不含本接口内试听），音色会被删除（来源：https://platform.minimaxi.com/docs/api-reference/api-overview 、 https://platform.minimaxi.com/docs/api-reference/voice-cloning-clone.md）

**计费时点**：调用复刻接口时不立即收取复刻费用，费用在首次使用该复刻音色进行语音合成时收取（不含本接口内试听）（来源：https://platform.minimaxi.com/docs/api-reference/api-overview）

### 4.1 上传复刻音频

- **方法 / URL**：`POST https://api.minimaxi.com/v1/files/upload`（来源：https://platform.minimaxi.com/docs/api-reference/voice-cloning-uploadcloneaudio.md）
- **`file_id` 类型**：`integer (int64)`（来源：`voice-cloning-clone.md` `VoiceCloneReq.file_id` schema 标注 `type: integer, format: int64`）。与 video generation 的 `file_id: string` 不同。
- **请求头**：`Content-Type: multipart/form-data`（必填）（来源：同上）
- **表单字段**（均必填）：
  - `purpose`：枚举仅 `voice_clone`（来源：同上）
  - `file`：binary。格式 mp3/m4a/wav；时长不低于 10 秒、不超过 5 分钟；大小不超过 20 MB（来源：同上）

```jsonc
{
  "file": { "file_id": "${file_id}", "bytes": 5896337, "created_at": 1700469398, "filename": "复刻音频", "purpose": "voice_clone" },
  "base_resp": { "status_code": 0, "status_msg": "success" }
}
```

（来源：同上）

上传接口 `status_code`：`0` 成功、`1002` 触发限流、`1004` 账号鉴权失败、`1008` 账号余额不足、`1026` 图片描述涉及敏感内容、`2013` 传入参数异常、`2049` 无效的 api key（来源：同上）

### 4.2 上传示例音频（可选，用于增强相似度与稳定性）

- **方法 / URL**：`POST https://api.minimaxi.com/v1/files/upload`（同一 endpoint，`purpose` 不同）（来源：https://platform.minimaxi.com/docs/api-reference/voice-cloning-uploadprompt.md）
- **请求头**：`Content-Type: multipart/form-data`（必填）（来源：同上）
- **表单字段**（均必填）：`purpose` 枚举仅 `prompt_audio`；`file` 为 binary，格式 mp3/m4a/wav，**时长小于 8 秒**，大小不超过 20 MB（来源：同上）
- 返回结构与 4.1 一致，`purpose` 为 `prompt_audio`（来源：同上）

### 4.3 执行复刻

- **方法 / URL**：`POST https://api.minimaxi.com/v1/voice_clone`（来源：https://platform.minimaxi.com/docs/api-reference/voice-cloning-clone.md）
- **必填**：`file_id`、`voice_id`（来源：同上）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file_id` | integer(int64) | 是 | 待复刻音频的 file_id，经文件上传接口（`POST /v1/files/upload`，`purpose=voice_clone`）获得。音频规范：mp3/m4a/wav，时长 ≥10 秒且 ≤5 分钟，大小 ≤20 MB |
| `voice_id` | string | 是 | 自定义克隆音色 ID，如 `"MiniMax001"`。长度 [8,256]；首字符必须为英文字母；允许数字、字母、`-`、`_`；末位不可为 `-`、`_`；不可与已有 id 重复（来源：`voice-cloning-clone.md` `VoiceCloneReq.voice_id`） |
| `clone_prompt` | object | 否 | 示例音频。子字段 `prompt_audio`（integer int64，示例音频 file_id）与 `prompt_text`（string，需与音频内容一致，句末须有标点）。示例音频规范：mp3/m4a/wav，时长 <8 秒，大小 ≤20 MB |
| `text` | string | 否 | 复刻试听文本，限 1000 字符以内；试听按字符数正常收取语音合成费用，定价与 T2A 一致 |
| `model` | string | 否 | 试听所用语音模型；**提供 `text` 时必传**。枚举同模型清单 |
| `language_boost` | string | 否 | 默认 null，可设 `auto`，枚举同 T2A |
| `text_validation` | string | 否 | 样本音频的预期文本，上限 200 字符。服务对音频做 ASR 并与本字段比对相似度，低于 `accuracy` 时拒绝并返回 `1043`（`The asr similarity check failed`） |
| `accuracy` | number(double) | 否 | ASR 相似度阈值 [0,1]；未传或传 `0` 时取默认 `0.7` |
| `need_noise_reduction` | boolean | 否 | 是否开启降噪，默认 false |
| `need_volume_normalization` | boolean | 否 | 是否开启音量归一化，默认 false |
| `aigc_watermark` | boolean | 否 | 试听音频末尾添加音频节奏标识，默认 false |

（来源：https://platform.minimaxi.com/docs/api-reference/voice-cloning-clone.md）

> 关于 `prompt_audio` 是否必填：`clone_prompt` 本身为**可选**参数；`file_id` 字段描述注明「若使用该参数，则两个子属性（prompt_audio、prompt_text）都为必填项」。即一旦使用 `clone_prompt`，其两个子字段均必填（来源：同上）

**响应 `VoiceCloneResp`**：

```jsonc
{
  "input_sensitive": { "type": 0 },  // 0正常 1严重违规 2色情 3广告 4违禁 5谩骂 6暴恐 7其他
  "demo_audio": "",                  // 传了 text + model 时以链接形式返回试听音频，否则为空
  "extra_info": {                    // 仅当请求带 text（触发试听合成、有计费）时返回
    "audio_length": 11124, "audio_sample_rate": 32000, "audio_size": 179926,
    "bitrate": 128000, "word_count": 18, "usage_characters": 18
  },
  "base_resp": { "status_code": 0, "status_msg": "success" }
}
```

（来源：同上）

**`base_resp.status_code`**（Voice Cloning 内联子集）：`0` 正常、`1000` 未知错误、`1001` 超时、`1002` 触发限流、`1004` 鉴权失败、`1013` 服务内部错误、`2013` 输入格式信息不正常、`2038` 无复刻权限（请检查账号认证状态）（**无 1008 余额不足**；来源：`voice-cloning-clone.md` `VoiceCloneBaseResponse.status_code.description`）

---

## 5. 音色设计（Voice Design）

- **方法 / URL**：`POST https://api.minimaxi.com/v1/voice_design`（来源：https://platform.minimaxi.com/docs/api-reference/voice-design-design.md）
- **请求头**：`Content-Type: application/json`（必填）（来源：同上）
- **必填**：`prompt`、`preview_text`（来源：同上）
- **临时音色**：产出为临时音色，需在 168 小时（7 天）内于任意语音合成接口中调用，否则自动删除；费用在首次用于语音合成时收取（来源：https://platform.minimaxi.com/docs/api-reference/api-overview）
- **推荐模型**：概览页注明「推荐使用 speech-02-hd 以获得最佳效果」；但本接口请求体中**无 `model` 字段**（来源：https://platform.minimaxi.com/docs/api-reference/api-overview 与 https://platform.minimaxi.com/docs/api-reference/voice-design-design.md）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `prompt` | string | 是 | 音色描述 |
| `preview_text` | string | 是 | 试听音频文本，`maxLength: 500`；试听合成收取 2 元/万字符 |
| `voice_id` | string | 否 | 自定义生成音色的 voice_id；不传时自动生成并返回唯一 `voice_id` |
| `aigc_watermark` | boolean | 否 | 试听音频末尾添加音频节奏标识，默认 False |

**响应 `T2VResp`**：

```jsonc
{
  "voice_id": "ttv-voice-2025060717322425-xxxxxxxx", // 生成的音色 ID，可用于语音合成
  "trial_audio": "hex 编码音频",                       // 使用生成音色合成的试听音频，hex 编码
  "base_resp": { "status_code": 0, "status_msg": "success" }
}
```

（来源：https://platform.minimaxi.com/docs/api-reference/voice-design-design.md）

**`base_resp.status_code`**（Voice Design 内联子集）：`0` 正常、`1000` 未知错误、`1001` 超时、`1002` 触发 RPM 限流、`1004` 鉴权失败、`1008` 余额不足、`1013` 服务内部错误、`1027` 输出内容错误、`1039` 触发 TPM 限流、`2013` 输入格式信息不正常（**无 1026 输入内容涉敏**；来源：`voice-design-design.md` `BaseResp.status_code.description`）

---

## 6. 音乐生成（Music Generation）

### 6.1 生成音乐

- **方法 / URL**：`POST https://api.minimaxi.com/v1/music_generation`（来源：https://platform.minimaxi.com/docs/api-reference/music-generation.md）
- **请求头**：`Content-Type: application/json`（必填）（来源：同上）
- **必填**：仅 `model`（来源：同上）

**模型枚举与限制**（来源：同上）

| 模型 | 说明 |
| --- | --- |
| `music-3.0` | 推荐；文本生成音乐，仅限 Token Plan 用户和付费用户，RPM 120 |
| `music-2.6` | 上一代文本生成音乐模型，仅限 Token Plan 用户和付费用户，RPM 120 |
| `music-cover` | 基于参考音频生成翻唱版本，仅限 Token Plan 用户和付费用户，RPM 120 |
| `music-3.0-free` | `music-3.0` 限免版，所有用户可用，RPM 3 |
| `music-2.6-free` | `music-2.6` 限免版，所有用户可用，RPM 3 |
| `music-cover-free` | `music-cover` 限免版，所有用户可用，RPM 3 |

> 概览页 `api-overview` 的「支持模型」表仅列出 `music-3.0` 一项（来源：https://platform.minimaxi.com/docs/api-reference/api-overview），完整枚举以接口页为准。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 见上表 |
| `prompt` | string | 条件必填 | 音乐描述（风格、情绪、场景）。`maxLength: 2000`。music-3.0/2.6 系纯音乐（`is_instrumental: true`）必填 [1,2000]；非纯音乐可选 [0,2000]；`music-cover` 系必填，描述目标翻唱风格 [10,300] |
| `lyrics` | string | 条件必填 | 歌词，`\n` 分隔每行。`minLength: 1`、`maxLength: 3500`。支持结构标签 `[Intro]` `[Verse]` `[Pre Chorus]` `[Chorus]` `[Interlude]` `[Bridge]` `[Outro]` `[Post Chorus]` `[Transition]` `[Break]` `[Hook]` `[Build Up]` `[Inst]` `[Solo]`。music-3.0/2.6 系纯音乐非必填；非纯音乐必填 [1,3500]；`music-cover` 系可选（不传则由 ASR 从参考音频提取）[10,1000]；`lyrics_optimizer: true` 且 `lyrics` 为空时由 prompt 自动生成 |
| `stream` | boolean | 否 | 默认 `false` |
| `output_format` | string | 否 | `url` / `hex`，默认 `hex`；`stream: true` 时仅支持 `hex`；**url 有效期 24 小时** |
| `audio_setting` | object | 否 | 见下 |
| `aigc_watermark` | boolean | 否 | 默认 `false`，仅非流式生效 |
| `lyrics_optimizer` | boolean | 否 | 默认 `false`；仅 music-3.0/3.0-free/2.6/2.6-free 支持 |
| `is_instrumental` | boolean | 否 | 是否生成纯音乐（无人声），默认 `false`；仅 music-3.0/3.0-free/2.6/2.6-free 支持 |
| `audio_url` | string | 条件 | 参考音频 URL，仅 `music-cover`/`music-cover-free`。与 `audio_base64` 必须且只能提供其一；与 `cover_feature_id` 互斥。要求：时长 6 秒~6 分钟、≤50 MB、常见音频格式（mp3、wav、flac 等） |
| `audio_base64` | string | 条件 | Base64 参考音频，约束同 `audio_url` |
| `cover_feature_id` | string | 条件 | 翻唱前处理接口返回的特征 ID（两步翻唱）。仅 music-cover 系；与 `audio_url`/`audio_base64` 互斥；传入时 `lyrics` 必填 [10,1000]；有效期 24 小时；相同音频返回相同 ID |

`audio_setting`（来源：同上）：

| 字段 | 可选值 |
| --- | --- |
| `sample_rate` | `16000` / `24000` / `32000` / `44100` |
| `bitrate` | `32000` / `64000` / `128000` / `256000` |
| `format` | `mp3` / `wav` / `pcm` |

**响应 `GenerateMusicResp`**（示例）：

```jsonc
{
  "data": {
    "audio": "hex编码的音频数据",  // output_format 为 hex 时返回，16 进制编码字符串
    "status": 2                    // 1=合成中，2=已完成
  },
  "trace_id": "04ede0ab069fb1ba8be5156a24b1e081",
  "extra_info": {
    "music_duration": 25364, "music_sample_rate": 44100,
    "music_channel": 2, "bitrate": 256000, "music_size": 813651
  },
  "analysis_info": null,
  "base_resp": { "status_code": 0, "status_msg": "success" }
}
```

（来源：https://platform.minimaxi.com/docs/api-reference/music-generation.md）

> **返回形态**：音乐生成为**同步返回**，不返回 `task_id`/`file_id`；`output_format=hex` 时通过 `data.audio` 返回 hex 音频，`output_format=url` 时返回 URL（有效期 24 小时）。schema 中 `MusicData` 仅定义了 `status` 与 `audio` 两个属性，未定义 url 字段名；`trace_id` / `extra_info` / `analysis_info` 仅出现在 example，未出现在 `GenerateMusicResp` 的 properties 定义中（来源：同上）

**`base_resp.status_code`**（Music Generation 内联子集）：`0` 请求成功、`1002` 触发限流、`1004` 账号鉴权失败、`1008` 账号余额不足、`1026` 图片描述涉及敏感内容、`2013` 传入参数异常、`2049` 无效的 api key（来源：`music-generation.md` `BaseResp.status_code.description`）

### 6.2 翻唱前处理（Music Cover Preprocess）

- **方法 / URL**：`POST https://api.minimaxi.com/v1/music_cover_preprocess`（来源：https://platform.minimaxi.com/docs/api-reference/music-cover-preprocess.md）
- **必填**：`model`（枚举仅 `music-cover`）；`audio_url` 与 `audio_base64` 必须且只能提供其一。参考音频要求：时长 6 秒~6 分钟、≤50 MB、常见格式（mp3、wav、flac 等）（来源：同上）

```jsonc
{
  "cover_feature_id": "a1b2c3d4e5f67890abcdef1234567890", // 有效期 24 小时，基于 MD5 去重
  "formatted_lyrics": "[Verse 1]\n歌曲第一行\n…",           // ASR 提取并格式化的歌词，含段落标签
  "structure_result": "{\"num_segments\":4,\"segments\":[{\"start\":0,\"end\":15.5,\"label\":\"intro\"}…]}",
  "audio_duration": 90,                                    // 秒
  "trace_id": "061e5f144eb7f10b1fdde81126e24f91",
  "base_resp": { "status_code": 0, "status_msg": "success" }
}
```

`structure_result` 中的段落 `label` 取值：`intro`、`verse`、`chorus`、`bridge`、`outro`、`inst`、`silence`（来源：同上）

---

## 7. voice_id 来源：查询可用音色

- **方法 / URL**：`POST https://api.minimaxi.com/v1/get_voice`（来源：https://platform.minimaxi.com/docs/api-reference/voice-management-get.md）
- **必填**：`voice_type`，枚举 `system`（系统音色）/ `voice_cloning`（快速复刻音色，仅在成功用于语音合成后才可查询）/ `voice_generation`（文生音色接口生成的音色，同样需成功用于语音合成后才可查询）/ `all`（来源：同上）
- **响应分组**：`system_voice[]`、`voice_cloning[]`、`voice_generation[]`、`base_resp`；元素含 `voice_id`、`description`、`voice_name`（仅系统音色）、`created_time`（`yyyy-mm-dd`）（来源：同上）
- 静态清单另见「系统音色列表」：https://platform.minimaxi.com/docs/faq/system-voice-id （来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md 内链接）

**voice_id 的三类来源**（T2A `voice_setting.voice_id` 描述原文）：系统音色、复刻音色、文生音色（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md）
- 复刻音色 → 由 `/v1/voice_clone` 的请求字段 `voice_id` 自定义指定（来源：https://platform.minimaxi.com/docs/api-reference/voice-cloning-clone.md）
- 文生音色 → 由 `/v1/voice_design` 返回的 `voice_id`（形如 `ttv-voice-2025060717322425-xxxxxxxx`）（来源：https://platform.minimaxi.com/docs/api-reference/voice-design-design.md）

---

## 8. 全局错误码表

来源：https://platform.minimaxi.com/docs/api-reference/errorcode.md

| 错误码 | 含义 | 解决方法 |
| --- | --- | --- |
| 1000 | 未知错误/系统默认错误 | 请稍后再试 |
| 1001 | 请求超时 | 请稍后再试 |
| 1002 | 请求频率超限 | 请稍后再试 |
| 1004 | 未授权/Token 不匹配/Cookie 缺失 | 请检查 API Key |
| 1008 | 余额不足 | 请检查您的账户余额 |
| 1024 | 内部错误 | 请稍后再试 |
| 1026 | 输入内容涉敏 | 请调整输入内容 |
| 1027 | 输出内容涉敏 | 请调整输入内容 |
| 1033 | 系统错误/下游服务错误 | 请稍后再试 |
| 1039 | Token 限制 | 请调整 max_tokens |
| 1041 | 连接数限制 | 请联系我们 |
| 1042 | 不可见字符比例超限/非法字符超过 10% | 请检查输入内容 |
| 1043 | ASR 相似度检查失败 | 请检查 file_id 与 text_validation 匹配度 |
| 1044 | 克隆提示词相似度检查失败 | 请检查克隆提示音频和提示词 |
| 2013 | 参数错误 | 请检查请求参数 |
| 20132 | 语音克隆样本或 voice_id 参数错误 | 请检查 Voice Cloning 的 file_id 和 T2A v2 / T2A Large v2 的 voice_id |
| 2037 | 语音时长不符合要求(太长或太短) | 检查 voice_clone file_id 时长（≥10 秒且 ≤5 分钟） |
| 2038 | 用户语音克隆功能被禁用 | 需完成账户身份认证（个人或企业认证） |
| 2039 | 语音克隆 voice_id 重复 | 请修改 voice_id |
| 2042 | 无权访问该 voice_id | 请确认是否为该 voice_id 创建者 |
| 2045 | 请求频率增长超限 | 请避免请求骤增骤减 |
| 2048 | 语音克隆提示音频太长 | 调整 prompt_audio 时长（＜8s） |
| 2049 | 无效的 API Key | 请检查 API Key |
| 2056 | 超出 Token Plan 资源限制 | 等待下一时间段资源释放 |

WebSocket 专属错误码（未收录于上表）：`2201` 超时断开连接、`2202` 非法事件、`2203` 空文本跳过、`2204` 超出字符限制跳过、`2205` 请求超限（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-websocket.md）

---

## 9. 未覆盖 / 待确认事项

1. **音乐生成 `output_format=url` 的返回字段名未在 schema 中定义**：`MusicData` 只声明 `status` 与 `audio`，官方未给出 url 场景的字段名与示例，需实调验证（来源：https://platform.minimaxi.com/docs/api-reference/music-generation.md）
2. **音乐生成流式协议细节未给出**：仅说明 `stream: true` 时只支持 hex，未描述 chunk 帧结构（来源：同上）
3. **T2A Async 字符上限口径不一致**：概览页称「单次最大 100 万字符」，接口页 `text` 为 5 万字符、`text_file_id` 文件 <100 万字符（来源：https://platform.minimaxi.com/docs/api-reference/api-overview 与 https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-create.md）
4. **T2A Async 状态枚举大小写不一致**：OpenAPI `enum` 为小写，描述与示例为首字母大写，需按实际返回做大小写不敏感处理（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-query.md）
5. **`task_token` 用途未展开**：创建异步任务返回 `task_token`（「完成当前任务使用的密钥信息」），但查询接口只需 `task_id`，未说明何处使用（来源：https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-create.md）
6. **速率限制具体数值**：语音接口 RPM/TPM 未在上述页面给出（音乐生成除外），需查阅「速率限制」页面
7. **文件检索/下载接口细节**：异步 T2A 与复刻依赖 File API（`file-management-retrieve` / `file-management-upload` 等），本轮未展开，见 `files-api.md` 计划
8. **`analysis_info` 字段语义未定义**：仅出现在音乐生成响应 example 中且为 `null`（来源：https://platform.minimaxi.com/docs/api-reference/music-generation.md）
9. **`lyrics-generation` 页未覆盖**：llms.txt 中存在 `https://platform.minimaxi.com/docs/api-reference/lyrics-generation.md`（`POST /v1/lyrics_generation`，完整歌曲创作 / 歌词编辑），与音乐生成密切相关但本轮未展开；该页声明歌词结构标签枚举与 `music-generation.md` 列举的存在出入（如 `[Drop]` / `[Breakdown]` 仅在前者出现，`[Post Chorus]` / `[Transition]` 仅在后者出现），需要在版本中复核。
