# 阿里云百炼 · 音色克隆 / 声音复刻（Voice Clone）

> 抓取日期: 2026-08-11 | 来源: https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api | 渠道: 阿里云百炼 Bailian

本文档原文摘录自阿里云百炼官方文档，覆盖声音复刻（Voice Cloning）和声音设计（Voice Design）的 HTTP API、参数表、返回字段。所有参数名、枚举值、字段名均保持官方原文。

百炼的「音色克隆」能力命名为「声音复刻」（voice-enrollment / qwen-voice-enrollment）。「声音设计」是基于文字描述从零生成全新音色的另一种自定义音色方式，与声音复刻共用同一接口地址。

---

## 1. 接口地址

### Qwen-Audio-TTS / CosyVoice / Qwen-TTS

| 地域 | 接口地址 |
|---|---|
| 华北 2（北京） | `POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization` |
| 新加坡 | `POST https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/audio/tts/customization` |

`{WorkspaceId}` 替换为真实业务空间 ID。

### MiniMax

| 接口地址 | base_url |
|---|---|
| `POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` | `https://dashscope.aliyuncs.com/api/v1` |

第三方模型（MiniMax）目前仅支持通过 `dashscope.aliyuncs.com` 域名调用，暂不支持专属域名。

## 2. 请求头

| 参数 | 类型 | 是否必选 | 说明 |
|---|---|---|---|
| Authorization | string | 是 | `Bearer <your_api_key>` |
| Content-Type | string | 是 | Qwen-Audio-TTS/CosyVoice/Qwen-TTS 固定 `application/json`；MiniMax 固定 `application/json; charset=utf-8` |

---

## 3. 创建音色（Qwen-Audio-TTS / CosyVoice / Qwen-TTS）

### 3.1 请求体

Qwen-Audio-TTS/CosyVoice 声音复刻：

```bash
curl -X POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
-d '{
"model": "voice-enrollment",
"input": {
  "action": "create_voice",
  "target_model": "qwen-audio-3.0-tts-flash",
  "prefix": "myvoice",
  "url": "https://your-audio-url.wav",
  "language_hints": ["zh"]
}
}'
```

Qwen-TTS 声音复刻：

```bash
curl -X POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
-d '{
"model": "qwen-voice-enrollment",
"input": {
  "action": "create",
  "target_model": "qwen3-tts-vc-realtime-2026-01-15",
  "preferred_name": "myvoice",
  "audio": {"data": "data:audio/mpeg;base64,{base64_encoded_audio}"}
}
}'
```

### 3.2 请求参数

#### model `string`（必选）

| 取值 | 说明 |
|---|---|
| `voice-enrollment` | Qwen-Audio-TTS / CosyVoice 声音复刻 |
| `qwen-voice-enrollment` | Qwen-TTS 声音复刻 |

#### input `object`（必选）

##### action `string`（必选）

- Qwen-Audio-TTS/CosyVoice（voice-enrollment）：固定 `create_voice`
- Qwen（qwen-voice-enrollment）：固定 `create`

##### target_model `string`（必选）

驱动音色的语音合成模型。必须与后续调用语音合成接口时使用的模型一致，否则合成会失败。

##### url `string`（条件必选）

**仅适用于 Qwen-Audio-TTS/CosyVoice**（model 为 voice-enrollment 时）。

用于复刻音色的音频文件 URL，要求公网可访问。

##### audio `object`（条件必选）

**仅适用于 Qwen-TTS**（model 为 qwen-voice-enrollment 时）。

音频数据，支持两种提交方式：

- **Data URL（Base64 编码）**：格式 `{"data": "data:{mime_type};base64,{base64_encoded_data}"}`，支持的 MIME 类型：`audio/wav`、`audio/mpeg`、`audio/mp4`。
- **音频 URL**：格式 `{"data": "https://your-audio-url.wav"}`，URL 必须公网可访问且无需鉴权。

##### text `string`（可选）

**仅适用于 Qwen-TTS**（model 为 qwen-voice-enrollment 时）。

音频对应的文本内容，用于辅助提升复刻效果。

##### prefix `string`（条件必选）

**仅适用于 Qwen-Audio-TTS/CosyVoice**（model 为 voice-enrollment 时）。

音色名称前缀，**仅允许数字和英文字母，不超过 10 个字符**。生成的音色名格式：`{target_model}-{prefix}-{唯一标识}`。

##### preferred_name `string`（条件必选）

**仅适用于 Qwen-TTS**（model 为 qwen-voice-enrollment 时）。

音色名称前缀，**仅允许数字、英文字母和下划线，不超过 16 个字符**。

##### language_hints `array[string]`（可选）

**仅适用于 Qwen-Audio-TTS/CosyVoice**（model 为 voice-enrollment 时），且仅 qwen-audio-3.0-tts-plus、qwen-audio-3.0-tts-flash、cosyvoice-v3.5-plus、v3.5-flash、v3-plus 和 v3-flash 模型支持。

辅助模型识别样本音频的语种，从而更准确地提取音色特征，提升复刻效果。若设置的语种与实际音频语种不符（例如为中文音频设置 `en`），系统将忽略该设置并自动检测语种。

数组当前版本仅处理第一个元素。

取值范围（因模型而异）：

- **qwen-audio-3.0-tts-plus / qwen-audio-3.0-tts-flash**：`zh` / `en` / `fr` / `de` / `ja` / `ko` / `ru` / `pt` / `th` / `id` / `vi` / `it` / `es` / `ms` / `fil` / `ar`
- **cosyvoice-v3-plus**：`zh` / `en` / `fr` / `de` / `ja` / `ko` / `ru`
- **cosyvoice-v3.5-plus / cosyvoice-v3.5-flash / cosyvoice-v3-flash**：`zh` / `en` / `fr` / `de` / `ja` / `ko` / `ru` / `pt` / `th` / `id` / `vi`

默认值：`["zh"]`。

##### language `string`（可选）

**仅适用于 Qwen-TTS**（model 为 qwen-voice-enrollment 时）。

指定 audio.data 音频对应的语种。若使用该参数，设置的语种须与实际用于复刻的音频语种一致。

取值范围：`zh` / `en` / `de` / `it` / `pt` / `es` / `ja` / `ko` / `fr` / `ru`

默认值：`zh`。

##### max_prompt_audio_length `float`（可选）

**仅适用于 Qwen-Audio-TTS/CosyVoice**（model 为 voice-enrollment 时），且仅 qwen-audio-3.0-tts-plus、qwen-audio-3.0-tts-flash、cosyvoice-v3.5-plus、v3.5-flash 和 v3-flash 模型支持。

音频预处理后用于声音复刻的参考音频最大时长（秒）。取值范围：`[3.0, 30.0]`。

默认值：`10.0`。

##### enable_preprocess `boolean`（可选）

**仅适用于 Qwen-Audio-TTS/CosyVoice**（model 为 voice-enrollment 时），且仅 qwen-audio-3.0-tts-plus、qwen-audio-3.0-tts-flash、cosyvoice-v3.5-plus、v3.5-flash 和 v3-flash 模型支持。

是否开启音频预处理（降噪、音频增强、音量规整）。有背景噪音时建议开启；安静环境建议关闭以最大程度还原音色。

默认值：`false`。

### 3.3 返回体

Qwen-Audio-TTS/CosyVoice：

```json
{
  "output": {
    "voice_id": "qwen-audio-3.0-tts-flash-myvoice-xxxxxx"
  },
  "usage": { "count": 1 },
  "request_id": "xxxx-xxxx-xxxx"
}
```

Qwen-TTS：

```json
{
  "output": {
    "voice": "yourVoice",
    "target_model": "qwen3-tts-vc-realtime-2026-01-15"
  },
  "usage": { "count": 1 },
  "request_id": "xxxx-xxxx-xxxx"
}
```

> **重要**：Qwen-Audio-TTS/CosyVoice 返回 `voice_id` 字段，Qwen 返回 `voice` 字段。Qwen-TTS 声音复刻还可能返回 `fallback_mode` 和 `fallback_reason` 字段。

### 3.4 返回字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| request_id | string | 本次调用的唯一标识符 |
| output.voice_id / output.voice | string | 音色 ID。Qwen-Audio-TTS/CosyVoice 返回 `voice_id`，Qwen 返回 `voice`。可直接用于语音合成接口的 voice 参数 |
| output.target_model | string | **仅 Qwen 返回**。驱动音色的语音合成模型 |
| output.fallback_mode | boolean | **仅适用于 Qwen-TTS**（model 为 qwen-voice-enrollment 时）。是否以降级模式创建音色 |
| output.fallback_reason | string | **仅当 fallback_mode 为 true 时返回**。降级原因，可能的值包括 `no_merged_segments`、`no_valid_asr_segments` 等 |
| usage.count | integer | 创建的音色数量，固定为 1 |

---

## 4. 创建音色（MiniMax）

音色复刻请求会生成一段试听音频，试听音频按所选模型的同步语音合成单价额外计费。

### 4.1 请求体

```bash
# 第三方模型（MiniMax）目前仅支持通过 dashscope.aliyuncs.com 域名调用，暂不支持专属域名
curl -X POST 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation' \
-H "Authorization: Bearer ${DASH_APIKEY}" \
-H 'Content-Type: application/json; charset=utf-8' \
-d '{
"input": {
  "action": "voice_clone",
  "voice_id": "bailian-test-voice-22",
  "audio_url": "https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/cosyvoice/cosyvoice-zeroshot-sample.wav",
  "text": "今天天气怎么样？"
},
"model": "MiniMax/speech-2.8-turbo"
}'
```

### 4.2 请求参数

#### model `string`（必选）

指定合成试听音频使用的语音模型。支持的模型：

- `MiniMax/speech-2.8-hd`
- `MiniMax/speech-02-hd`
- `MiniMax/speech-2.8-turbo`
- `MiniMax/speech-02-turbo`

#### input `object`（必选）

| 属性 | 类型 | 必选 | 说明 |
|---|---|---|---|
| action | string | 是 | 固定 `voice_clone`（声音克隆） |
| audio_url | string | 是 | 需要复刻的音频文件 URL。规范：格式 mp3 / m4a / wav；时长 10 秒 ~ 5 分钟；大小 ≤ 20 MB |
| clone_prompt | object | 否 | 音色复刻示例音频 |
| clone_prompt.prompt_audio | string | 否 | 示例音频文件 URL。格式 mp3 / m4a / wav；时长 < 8 秒；大小 ≤ 20 MB |
| clone_prompt.prompt_text | string | 否 | 示例音频的对应文本，句末需有标点符号 |
| text | string | 是 | 复刻声音期望试听的内容，限制 1000 字符以内 |
| voice_id | string | 是 | 克隆音色的 voice_id。长度 `[8, 256]`；首字符必须为英文字母；允许数字、字母、`-`、`_`；末位不可为 `-`、`_`；全局唯一 |
| language_boost | enum<string> | 否 | 默认 null。是否增强对指定的小语种和方言的识别能力。可设置为 `auto`。可选值见下表 |
| need_noise_reduction | boolean | 否 | 默认 false。是否开启降噪 |
| need_volume_normalization | boolean | 否 | 默认 false。是否开启音量归一化 |
| aigc_watermark | boolean | 否 | 默认 false。是否在合成试听音频末尾添加音频节奏标识 |

##### language_boost 可选值

`Chinese`、`Chinese,Yue`、`English`、`Arabic`、`Russian`、`Spanish`、`French`、`Portuguese`、`German`、`Turkish`、`Dutch`、`Ukrainian`、`Vietnamese`、`Indonesian`、`Japanese`、`Italian`、`Korean`、`Thai`、`Polish`、`Romanian`、`Greek`、`Czech`、`Finnish`、`Hindi`、`Bulgarian`、`Danish`、`Hebrew`、`Malay`、`Persian`、`Slovak`、`Swedish`、`Croatian`、`Filipino`、`Hungarian`、`Norwegian`、`Slovenian`、`Catalan`、`Nynorsk`、`Tamil`、`Afrikaans`、`auto`

##### 语气词标签（仅 speech-2.8-hd / speech-2.8-turbo 支持）

支持的语气词：`(laughs)`（笑声）、`(chuckle)`（轻笑）、`(coughs)`（咳嗽）、`(clear-throat)`（清嗓子）、`(groans)`（呻吟）、`(breath)`（正常换气）、`(pant)`（喘气）、`(inhale)`（吸气）、`(exhale)`（呼气）、`(gasps)`（倒吸气）、`(sniffs)`（吸鼻子）、`(sighs)`（叹气）、`(snorts)`（喷鼻息）、`(burps)`（打嗝）、`(lip-smacking)`（咂嘴）、`(humming)`（哼唱）、`(hissing)`（嘶嘶声）、`(emm)`（嗯）、`(whistles)`（口哨）、`(sneezes)`（喷嚏）、`(crying)`（抽泣）、`(applause)`（鼓掌）

### 4.3 返回体

```json
{
  "output": {
    "base_resp": {
      "status_code": 0,
      "status_msg": "success"
    },
    "demo_audio": "https://minimax-algeng-chat-tts.oss-cn-wulanchabu.aliyuncs.com/.../xxx.mp3?Expires=...&Signature=...",
    "input_sensitive": false,
    "input_sensitive_type": 0
  },
  "usage": { "characters": 18 },
  "request_id": "b1160386-ebf1-913f-9275-ef176c5e1c91"
}
```

### 4.4 返回字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| request_id | string | 本次调用的唯一标识符 |
| output.input_sensitive | boolean | 输入音频是否命中风控 |
| output.input_sensitive_type | integer | 命中风控类型。0 正常 / 1 严重违规 / 2 色情 / 3 广告 / 4 违禁 / 5 谩骂 / 6 暴恐 / 7 其他 |
| output.demo_audio | string | 链接形式的试听音频 |
| output.base_resp.status_code | integer | 状态码。0 正常 / 1000 未知错误 / 1001 超时 / 1002 触发限流 / 1004 鉴权失败 / 1013 服务内部错误 / 2013 输入格式信息不正常 / 2038 无复刻权限 |
| output.base_resp.status_msg | string | 状态详情 |
| usage.characters | integer | 输入文本的字符数 |

---

## 5. 查询音色列表

> MiniMax 不支持通过本接口查询音色列表。如需查询 MiniMax 系列模型（如 MiniMax/speech-2.8-turbo）的可用音色 ID（含系统音色与已复刻音色），请参见「声音管理」。

### 5.1 请求体

Qwen-Audio-TTS/CosyVoice：

```bash
curl -X POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
-d '{
"model": "voice-enrollment",
"input": {
  "action": "list_voice",
  "prefix": "myvoice",
  "page_size": 10,
  "page_index": 0
}
}'
```

Qwen-TTS 声音复刻：

```bash
curl -X POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
-d '{
"model": "qwen-voice-enrollment",
"input": {
  "action": "list",
  "page_size": 10,
  "page_index": 0
}
}'
```

### 5.2 请求参数

#### model `string`（必选）

取值：`voice-enrollment`（Qwen-Audio-TTS/CosyVoice）或 `qwen-voice-enrollment`（Qwen）。

#### input `object`（必选）

| 属性 | 类型 | 必选 | 说明 |
|---|---|---|---|
| action | string | 是 | Qwen-Audio-TTS/CosyVoice：`list_voice`；Qwen：`list` |
| prefix | string | 否 | **仅适用于 Qwen-Audio-TTS/CosyVoice**。按前缀筛选音色 |
| page_index | integer | 否 | 页码索引 |
| page_size | integer | 否 | 每页包含数据条数 |

### 5.3 返回体

Qwen-Audio-TTS/CosyVoice：

```json
{
  "output": {
    "voice_list": [
      {
        "voice_id": "qwen-audio-3.0-tts-flash-myvoice-xxxxxx",
        "gmt_create": "2024-12-11 13:38:02",
        "gmt_modified": "2024-12-11 13:38:02",
        "status": "OK"
      }
    ]
  },
  "usage": { "count": 1 },
  "request_id": "xxxx-xxxx-xxxx"
}
```

Qwen：

```json
{
  "output": {
    "page_index": 0,
    "page_size": 10,
    "total_count": 2,
    "voice_list": [
      {
        "voice": "yourVoice1",
        "gmt_create": "2025-08-11 17:59:32",
        "gmt_modified": "2025-08-11 17:59:32",
        "language": "zh",
        "target_model": "qwen3-tts-vc-realtime-2026-01-15"
      }
    ]
  },
  "usage": { "count": 0 },
  "request_id": "xxxx-xxxx-xxxx"
}
```

> Qwen-Audio-TTS/CosyVoice 和 Qwen 均使用 `voice_list` 数组字段名。Qwen-Audio-TTS/CosyVoice 每项包含 `voice_id` 字段，Qwen 每项包含 `voice` 字段。Qwen 的 output 中还包含 `page_index` / `page_size` / `total_count` 分页信息字段。

### 5.4 返回字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| output.page_index | integer | **仅 Qwen 返回**。当前页码索引 |
| output.page_size | integer | **仅 Qwen 返回**。每页数据条数 |
| output.total_count | integer | **仅 Qwen 返回**。音色总数 |
| output.voice_list | array[object] | 查询到的音色列表 |
| voice_list[].voice_id / voice | string | 音色 ID。Qwen-Audio-TTS/CosyVoice 为 `voice_id`，Qwen 为 `voice` |
| voice_list[].gmt_create | string | 创建时间 |
| voice_list[].gmt_modified | string | 修改时间 |
| voice_list[].status | string | **仅 Qwen-Audio-TTS/CosyVoice 返回**。音色状态，取值参见 §8 |
| voice_list[].target_model | string | **仅 Qwen 返回**。驱动音色的语音合成模型 |
| usage.count | integer | Qwen-Audio-TTS/CosyVoice 固定 1；Qwen 固定 0 |

---

## 6. 查询音色详情

> **仅适用于 Qwen-Audio-TTS/CosyVoice**（model 为 voice-enrollment 时）。Qwen 和 MiniMax 模型不支持查询音色详情操作。

### 6.1 请求体

```bash
curl -X POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
-d '{
"model": "voice-enrollment",
"input": {
  "action": "query_voice",
  "voice_id": "yourVoiceId"
}
}'
```

### 6.2 请求参数

| 参数 | 类型 | 必选 | 说明 |
|---|---|---|---|
| model | string | 是 | 固定 `voice-enrollment` |
| input.action | string | 是 | 固定 `query_voice` |
| input.voice_id | string | 是 | 要查询的音色 ID |

### 6.3 返回体

```json
{
  "output": {
    "gmt_create": "2024-12-11 13:38:02",
    "resource_link": "https://yourAudioFileUrl",
    "target_model": "qwen-audio-3.0-tts-flash",
    "gmt_modified": "2024-12-11 13:38:02",
    "status": "OK"
  },
  "usage": { "count": 1 },
  "request_id": "xxxx-xxxx-xxxx"
}
```

### 6.4 返回字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| output.resource_link | string | 音频文件的 URL 地址 |
| output.gmt_create | string | 创建时间 |
| output.gmt_modified | string | 修改时间 |
| output.status | string | 音色状态，取值参见 §8 |
| output.target_model | string | 驱动音色的语音合成模型 |
| usage.count | integer | 固定 1 |

---

## 7. 更新音色

> **仅适用于 Qwen-Audio-TTS/CosyVoice**（model 为 voice-enrollment 时）。Qwen 和 MiniMax 模型不支持更新操作。

### 7.1 请求体

```bash
curl -X POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
-d '{
"model": "voice-enrollment",
"input": {
  "action": "update_voice",
  "voice_id": "yourVoiceId",
  "url": "https://new-audio-url.wav"
}
}'
```

### 7.2 请求参数

| 参数 | 类型 | 必选 | 说明 |
|---|---|---|---|
| model | string | 是 | 固定 `voice-enrollment` |
| input.action | string | 是 | 固定 `update_voice` |
| input.voice_id | string | 是 | 要更新的音色 ID |
| input.url | string | 是 | 新的音频文件 URL，要求公网可访问 |

### 7.3 返回体

```json
{
  "output": {},
  "usage": { "count": 1 },
  "request_id": "xxxx-xxxx-xxxx"
}
```

---

## 8. 删除音色

### 8.1 请求体

Qwen-Audio-TTS/CosyVoice：

```bash
curl -X POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
-d '{
"model": "voice-enrollment",
"input": {
  "action": "delete_voice",
  "voice_id": "yourVoiceId"
}
}'
```

Qwen-TTS 声音复刻：

```bash
curl -X POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
-d '{
"model": "qwen-voice-enrollment",
"input": {
  "action": "delete",
  "voice": "yourVoice"
}
}'
```

### 8.2 请求参数

| 参数 | 类型 | 必选 | 说明 |
|---|---|---|---|
| model | string | 是 | `voice-enrollment` 或 `qwen-voice-enrollment` |
| input.action | string | 是 | Qwen-Audio-TTS/CosyVoice：`delete_voice`；Qwen：`delete` |
| input.voice_id | string | 条件必选 | **仅适用于 Qwen-Audio-TTS/CosyVoice**。要删除的音色 ID |
| input.voice | string | 条件必选 | **仅适用于 Qwen**。要删除的音色名称 |

### 8.3 返回体

Qwen-Audio-TTS/CosyVoice：

```json
{
  "output": {},
  "usage": { "count": 1 },
  "request_id": "xxxx-xxxx-xxxx"
}
```

Qwen：

```json
{
  "output": { "voice": "yourVoice" },
  "usage": { "count": 0 },
  "request_id": "xxxx-xxxx-xxxx"
}
```

> Qwen-Audio-TTS/CosyVoice 的 output 为空对象，Qwen 返回 voice 字段。

---

## 9. 音色状态说明

音色创建后会经过审核流程。**此状态体系仅适用于 Qwen-Audio-TTS/CosyVoice**（model 为 voice-enrollment 时），Qwen 的查询和列表返回中不包含 status 字段。

| 状态 | 说明 |
|---|---|
| `DEPLOYING` | 审核中 / 处理中 |
| `OK` | 审核通过，可正常使用 |
| `UNDEPLOYED` | 审核未通过，不可使用 |

---

## 10. 声音设计（Voice Design）

声音设计是另一种自定义音色方式：用文字描述期望的音色（如「温暖的低音女声」），从零生成全新音色。模型清单见 `tts.md` §1.2 中标记「声音设计 = 支持」的模型。

声音设计音色同样通过本文 §3 接口创建，区别在于：
- 声音复刻：提供音频样本（`url` 或 `audio.data`）
- 声音设计：通过 `instruction` 参数（语音合成接口侧）用文字描述期望音色

> 文档未提供声音设计的独立 endpoint；声音设计音色在合成阶段通过 `instruction` 控制，与声音复刻共用本文 §3 创建音色接口（部分模型在创建阶段也支持 `instruction` 类参数）。

支持声音设计的模型（来自 tts-model 文档）：
- Qwen-Audio-TTS：qwen-audio-3.0-tts-plus、qwen-audio-3.0-tts-flash
- CosyVoice：cosyvoice-v3.5-plus、cosyvoice-v3.5-flash、cosyvoice-v3-plus、cosyvoice-v3-flash
- Qwen3-TTS-VD：qwen3-tts-vd-2026-01-26、qwen3-tts-vd-realtime-2026-01-15、qwen3-tts-vd-realtime-2025-12-16

---

## 11. 关键限制与注意

- 自定义音色 `target_model` 必须与后续调用语音合成接口时使用的模型一致，否则合成会失败。
- MiniMax 声音复刻仅通过 `dashscope.aliyuncs.com` 域名调用。
- MiniMax audio_url 规范：格式 mp3/m4a/wav；时长 10 秒~5 分钟；大小 ≤ 20 MB。
- Qwen-TTS Data URL 编码后仍需符合 10 MB 输入限制（百炼 Qwen-ASR 限制；TTS 文档未明确数值，文档未提及）。
- 音色状态 `OK` 才可正常使用，`UNDEPLOYED` 表示审核未通过。
- Qwen-TTS 声音复刻可能返回 `fallback_mode` 降级模式，提示音质可能不理想。

---

## 12. 文档原始 URL

| 子主题 | URL |
|---|---|
| 声音复刻 HTTP API | <https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api> |
| 声音复刻用户指南 | <https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide> |
| 语音合成（模型清单 + 声音复刻/设计能力矩阵） | <https://help.aliyun.com/zh/model-studio/tts-model> |
