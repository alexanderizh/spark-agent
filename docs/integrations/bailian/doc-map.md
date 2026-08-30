# 阿里云百炼（Bailian / DashScope）音频能力 — 文档索引

> 抓取日期: 2026-08-11 | 渠道: 阿里云百炼 Bailian（Model Studio）| 文档来源域名: help.aliyun.com/zh/model-studio/

本文档汇总阿里云百炼平台音频相关模型与 API 的入口，供开发 audio adapter 时按模型/能力检索。

---

## 1. 能力覆盖

| 能力 | 是否提供 | 本地文档 | 备注 |
|---|---|---|---|
| 语音合成 TTS（文本转语音） | ✅ | `tts.md` | Qwen3-TTS / Qwen-Audio-TTS / CosyVoice / MiniMax / 旧版 Qwen-TTS |
| 音乐生成 | ❌ | — | **百炼官方文档未提供音乐生成能力**；MiniMax/speech-* 是 TTS 不是音乐模型 |
| 语音识别 / 转写 ASR | ✅ | `asr-transcription.md` | Qwen-Audio-3.0-ASR / Fun-ASR / Qwen-ASR / Paraformer / Gummy / SenseVoice |
| 说话人分离 diarization | ⚠️ 非独立接口 | 见 `asr-transcription.md` §8 | 作为录音文件识别接口的 `diarization_enabled` 参数提供，无独立 endpoint |
| 音色克隆 / 个性化声音 | ✅ | `voice-clone.md` | voice-enrollment / qwen-voice-enrollment / MiniMax voice_clone |

---

## 2. 模型总览（modelId → 能力 / endpoint / 认证 / 文档）

### 2.1 TTS（语音合成）

通用 endpoint：
- HTTP（旧版 Qwen-TTS）：`POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`
- HTTP（CosyVoice / Qwen-Audio-TTS，仅华北 2 北京可用）：`POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`
- WebSocket（CosyVoice / Qwen-Audio-TTS）：`wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`
- WebSocket（Qwen-TTS-Realtime）：`wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model={model}`

认证：`Authorization: Bearer <api-key>`（HTTP header 或 WebSocket 握手 header）。

| modelId | 能力 (capability id) | HTTP method + endpoint | 认证 | 必填参数 | 同步/异步 | 输出格式 | 文档 URL |
|---|---|---|---|---|---|---|---|
| qwen3-tts-flash | audio.speech | POST `/api/v1/services/aigc/multimodal-generation/generation`（dashscope）或 `{wsId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` | Bearer API Key | model, input.text, input.voice | 同步（支持 SSE 流式） | wav（默认，url 24h 有效） | <https://help.aliyun.com/zh/model-studio/qwen-tts-api> |
| qwen3-tts-flash-2025-11-27 | audio.speech | 同上 | Bearer API Key | model, input.text, input.voice | 同步（支持 SSE 流式） | wav | 同上 |
| qwen3-tts-flash-2025-09-18 | audio.speech | 同上 | Bearer API Key | model, input.text, input.voice | 同步（支持 SSE 流式） | wav | 同上 |
| qwen3-tts-instruct-flash | audio.speech（指令控制） | 同上 | Bearer API Key | model, input.text, input.voice | 同步（支持 SSE 流式） | wav | 同上 |
| qwen3-tts-instruct-flash-2026-01-26 | audio.speech（指令控制） | 同上 | Bearer API Key | model, input.text, input.voice | 同步（支持 SSE 流式） | wav | 同上 |
| qwen3-tts-flash-realtime | audio.speech | WSS `/api-ws/v1/realtime?model=qwen3-tts-flash-realtime` | Bearer API Key（握手 header） | session.update, input_text_buffer.append/commit | 流式（WebSocket 双向） | pcm | <https://help.aliyun.com/zh/model-studio/interactive-process-of-qwen-tts-realtime-synthesis> |
| qwen3-tts-instruct-flash-realtime | audio.speech（指令控制） | WSS `/api-ws/v1/realtime?model=...` | Bearer API Key | 同上 | 流式 | pcm | 同上 |
| qwen3-tts-vc-2026-01-22 | audio.speech（声音复刻） | POST `/api/v1/services/aigc/multimodal-generation/generation` | Bearer API Key | model, input.text, input.voice（复刻音色 ID） | 同步（支持 SSE 流式） | wav | <https://help.aliyun.com/zh/model-studio/tts-model> |
| qwen3-tts-vc-realtime-2026-01-15 | audio.speech（声音复刻） | WSS `/api-ws/v1/realtime?model=...` | Bearer API Key | session.update + 复刻音色 | 流式 | pcm | 同上 |
| qwen3-tts-vd-2026-01-26 | audio.speech（声音设计） | POST `/api/v1/services/aigc/multimodal-generation/generation` | Bearer API Key | model, input.text, input.voice, instruction | 同步 | wav | 同上 |
| qwen-audio-3.0-tts-plus | audio.speech | HTTP `{wsId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer` 或 WSS `/api-ws/v1/inference` | Bearer API Key | model, input.text, input.voice | 同步（HTTP，支持 SSE 流式）/ 流式（WSS） | mp3/pcm/wav/opus（默认 mp3） | <https://help.aliyun.com/zh/model-studio/cosyvoice-tts-http-api> |
| qwen-audio-3.0-tts-flash | audio.speech | 同上 | Bearer API Key | model, input.text, input.voice | 同上 | 同上 | 同上 |
| cosyvoice-v3.5-plus | audio.speech | 同上 | Bearer API Key | model, input.text, input.voice | 同上 | 同上 | 同上 |
| cosyvoice-v3.5-flash | audio.speech | 同上 | Bearer API Key | model, input.text, input.voice | 同上 | 同上 | 同上 |
| cosyvoice-v3-plus | audio.speech | 同上 | Bearer API Key | model, input.text, input.voice | 同上 | 同上 | 同上 |
| cosyvoice-v3-flash | audio.speech | 同上 | Bearer API Key | model, input.text, input.voice | 同上 | 同上 | 同上 |
| cosyvoice-v2 | audio.speech | 同上 | Bearer API Key | model, input.text, input.voice | 同上 | 同上 | 同上 |
| cosyvoice-v1 | audio.speech | WSS `/api-ws/v1/inference`（仅 WebSocket） | Bearer API Key | model, input.text, input.voice | 流式 | 同上（不支持 opus） | <https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api> |
| MiniMax/speech-2.8-hd | audio.speech | POST `https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` | Bearer API Key | model, input.action=voice_clone, input.voice_id, input.audio_url, input.text | 同步 | mp3 | <https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api> |
| MiniMax/speech-02-hd | audio.speech | 同上 | Bearer API Key | 同上 | 同步 | mp3 | 同上 |
| MiniMax/speech-2.8-turbo | audio.speech | 同上 | Bearer API Key | 同上 | 同步 | mp3 | 同上 |
| MiniMax/speech-02-turbo | audio.speech | 同上 | Bearer API Key | 同上 | 同步 | mp3 | 同上 |
| qwen-tts（旧版，按 Token 计费） | audio.speech | POST `/api/v1/services/aigc/multimodal-generation/generation`（dashscope 域） | Bearer API Key | model, input.text, input.voice | 同步 | wav | <https://help.aliyun.com/zh/model-studio/qwen-tts-api> |
| qwen-tts-realtime（旧版，按 Token 计费） | audio.speech | WSS `/api-ws/v1/realtime?model=...` | Bearer API Key | session.update, input_text_buffer.* | 流式 | pcm | <https://help.aliyun.com/zh/model-studio/interactive-process-of-qwen-tts-realtime-synthesis> |

### 2.2 ASR（语音识别 / 转写）

通用 endpoint（非实时录音文件识别）：
- 提交任务：`POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/asr/transcription`
- 查询任务（Fun-ASR / Qwen-ASR / Qwen3-ASR-Filetrans）：`GET https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/tasks/{task_id}`
- 查询任务（Paraformer）：`POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/tasks/{task_id}`（注意 HTTP method 差异）

通用 endpoint（实时识别 WebSocket）：
- `wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`

OpenAI 兼容（仅 qwen3-asr-flash）：
- `POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`

DashScope 同步（仅 qwen3-asr-flash）：
- `POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`

| modelId | 能力 | HTTP method + endpoint | 认证 | 必填参数 | 同步/异步 | 输入方式 | 文档 URL |
|---|---|---|---|---|---|---|---|
| qwen-audio-3.0-asr-flash-filetrans | audio.transcription | POST 提交 + GET 查询 `/api/v1/services/audio/asr/transcription` + `/api/v1/tasks/{task_id}` | Bearer API Key | model, input.file_urls | 异步（提交-轮询） | 公网 URL（≤2GB，≤12h） | <https://help.aliyun.com/zh/model-studio/fun-asr-recorded-speech-recognition-http-api> |
| qwen-audio-3.0-asr-flash | audio.transcription | 同上 | Bearer API Key | model, input.file_urls | 异步 | URL / Base64（≤2GB，≤5min） | 同上 |
| fun-asr | audio.transcription（含说话人分离） | 同上 | Bearer API Key | model, input.file_urls | 异步 | 公网 URL（≤2GB，≤12h） | 同上 |
| fun-asr-mtl | audio.transcription（含说话人分离） | 同上 | Bearer API Key | model, input.file_urls | 异步 | 公网 URL（≤2GB，≤12h） | 同上 |
| fun-asr-flash-2026-06-15 | audio.transcription | 同上 | Bearer API Key | model, input.file_urls | 异步 | URL / Base64（≤2GB，≤5min） | 同上 |
| qwen3-asr-flash-filetrans | audio.transcription | POST 提交 + GET 查询 `/api/v1/services/audio/asr/transcription` + `/api/v1/tasks/{task_id}` | Bearer API Key | model, input.file_url | 异步 | 公网 URL（≤2GB，≤12h） | <https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference> |
| qwen3-asr-flash | audio.transcription（含情感识别） | POST OpenAI 兼容 `/compatible-mode/v1/chat/completions` 或 DashScope 同步 `/api/v1/services/aigc/multimodal-generation/generation` | Bearer API Key | model, messages（含 input_audio） | 同步（支持 SSE 流式） | URL / Base64 / 本地路径（≤10MB，≤5min） | 同上 |
| paraformer-v2 | audio.transcription（含说话人分离） | POST 提交 + POST 查询 `/api/v1/services/audio/asr/transcription` + `/api/v1/tasks/{task_id}` | Bearer API Key | model, input.file_urls | 异步 | 公网 URL（Paraformer 文档：不支持 Base64） | <https://help.aliyun.com/zh/model-studio/paraformer-recorded-speech-recognition-restful-api> |
| paraformer-v1 | audio.transcription（含说话人分离） | 同上 | Bearer API Key | model, input.file_urls | 异步 | 同上 | 同上 |
| paraformer-mtl-v1 | audio.transcription（含说话人分离，多语种） | 同上 | Bearer API Key | model, input.file_urls | 异步 | 同上 | 同上 |
| paraformer-8k-v2 | audio.transcription（8kHz 电话场景） | 同上 | Bearer API Key | model, input.file_urls | 异步 | 同上 | 同上 |
| qwen-audio-3.0-asr-flash-streaming | audio.transcription（流式） | WSS `/api-ws/v1/inference` | Bearer API Key（握手 header） | run-task（含 model/format/sample_rate） + binary 音频 | 流式（WebSocket） | 二进制流（pcm/wav/mp3/opus/speex/aac/amr） | <https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api> |
| fun-asr-realtime | audio.transcription（流式） | 同上 | Bearer API Key | 同上 | 流式 | 同上 | 同上 |
| fun-asr-flash-8k-realtime | audio.transcription（流式，8kHz 中文） | 同上 | Bearer API Key | 同上 | 流式 | 同上（8 kHz） | 同上 |
| qwen3-asr-flash-realtime | audio.transcription（流式 + 情感识别） | 同上 | Bearer API Key | 同上 | 流式 | pcm / opus（8/16 kHz） | 同上 |
| paraformer-realtime-v2 | audio.transcription（流式） | WSS `/api-ws/v1/inference`（仅华北 2 北京） | Bearer API Key | 同上 | 流式 | 二进制流 | <https://help.aliyun.com/zh/model-studio/websocket-for-paraformer-real-time-service> |
| paraformer-realtime-v1 | audio.transcription（流式） | 同上 | Bearer API Key | 同上 | 流式 | 二进制流（16 kHz） | 同上 |
| paraformer-realtime-8k-v2 / -v1 | audio.transcription（流式，8kHz 电话） | 同上 | Bearer API Key | 同上 | 流式 | 二进制流（8 kHz） | 同上 |
| gummy-realtime-v1（即将下线） | audio.transcription（流式，中英方言） | 同上 | Bearer API Key | 同上 | 流式 | 二进制流 | <https://help.aliyun.com/zh/model-studio/asr-model> |
| sensevoice-v1（即将下线） | audio.transcription | POST `/api/v1/services/audio/asr/transcription` | Bearer API Key | model, input.file_urls | 异步 | 公网 URL | 同上 |

### 2.3 音色克隆（Voice Clone / Voice Design）

通用 endpoint：
- Qwen-Audio-TTS / CosyVoice / Qwen-TTS：`POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization`
- MiniMax：`POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`

| modelId（接口入参 model） | 能力 | HTTP method + endpoint | 认证 | 必填参数 | 同步/异步 | 输入方式 | 文档 URL |
|---|---|---|---|---|---|---|---|
| voice-enrollment（Qwen-Audio-TTS/CosyVoice 声音复刻） | audio.voice_clone | POST `/api/v1/services/audio/tts/customization` | Bearer API Key | model, input.action=create_voice, input.target_model, input.url, input.prefix | 同步 | 公网 URL | <https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api> |
| qwen-voice-enrollment（Qwen-TTS 声音复刻） | audio.voice_clone | 同上 | Bearer API Key | model, input.action=create, input.target_model, input.audio.data, input.preferred_name | 同步 | Data URL 或 公网 URL | 同上 |
| MiniMax/speech-2.8-hd / 02-hd / 2.8-turbo / 02-turbo | audio.voice_clone | POST `https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` | Bearer API Key | model, input.action=voice_clone, input.voice_id, input.audio_url, input.text | 同步（返回 demo_audio） | 公网 URL（mp3/m4a/wav，10s~5min，≤20MB） | 同上 |

action 取值（同 endpoint 不同 action）：

| model | action | 功能 |
|---|---|---|
| voice-enrollment | `create_voice` / `list_voice` / `query_voice` / `update_voice` / `delete_voice` | 创建/列表/详情/更新/删除（Qwen-Audio-TTS/CosyVoice） |
| qwen-voice-enrollment | `create` / `list` / `delete` | 创建/列表/删除（Qwen，不支持 query/update） |
| MiniMax/speech-* | `voice_clone` | 仅创建（不支持 list/query/update/delete） |

---

## 3. 关键 endpoint 速查

| 用途 | endpoint | method | 模型 |
|---|---|---|---|
| Qwen-TTS HTTP（标准） | `https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` | POST | qwen-tts-* / qwen3-tts-* (HTTP) |
| Qwen-Audio-TTS / CosyVoice HTTP（仅北京） | `https://{wsId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer` | POST | qwen-audio-3.0-tts-* / cosyvoice-v* |
| CosyVoice / Qwen-Audio-TTS 实时（WSS） | `wss://{wsId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference` | WS | qwen-audio-3.0-tts-* / cosyvoice-v* |
| Qwen-TTS Realtime（WSS） | `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model={model}` | WS | qwen3-tts-*-realtime / qwen-tts-realtime |
| 录音文件识别（Fun-ASR / Qwen-Audio-3.0-ASR / Qwen3-ASR-Filetrans） | `https://{wsId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/asr/transcription` | POST | 见 §2.2 |
| 录音文件识别（Paraformer） | 同上 | POST | paraformer-* |
| 任务查询（Fun-ASR / Qwen-ASR） | `https://{wsId}.cn-beijing.maas.aliyuncs.com/api/v1/tasks/{task_id}` | GET | — |
| 任务查询（Paraformer） | 同上 | POST | — |
| 实时 ASR（WSS） | `wss://{wsId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference` | WS | qwen-audio-3.0-asr-* / fun-asr-* / paraformer-realtime-* / qwen3-asr-realtime |
| Qwen3-ASR-Flash OpenAI 兼容 | `https://{wsId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions` | POST | qwen3-asr-flash |
| Qwen3-ASR-Flash DashScope 同步 | `https://{wsId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` | POST | qwen3-asr-flash |
| 音色管理（Qwen-Audio-TTS / CosyVoice / Qwen-TTS） | `https://{wsId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization` | POST | voice-enrollment / qwen-voice-enrollment |
| 音色克隆（MiniMax） | `https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` | POST | MiniMax/speech-* |

地域域名规则：
- 华北 2（北京）：`{wsId}.cn-beijing.maas.aliyuncs.com`
- 新加坡：`{wsId}.ap-southeast-1.maas.aliyuncs.com`
- 美国（弗吉尼亚）：`{wsId}.us-east-1.maas.aliyuncs.com`（仅 DashScope 同步调用，模型需加 `-us` 后缀）
- 旧域名：`dashscope.aliyuncs.com`（仍可用，推荐迁移到专属域名）

认证：所有接口统一 `Authorization: Bearer <api-key>`。

---

## 4. 本地文档清单

| 文件 | 行数（落盘后核对） | 内容 |
|---|---|---|
| `tts.md` | 见文件 | TTS 模型清单、Qwen-TTS HTTP API、CosyVoice/Qwen-Audio-TTS HTTP API、CosyVoice WebSocket API、Qwen-TTS-Realtime WebSocket API、Python SDK、指令控制、支持语言 |
| `asr-transcription.md` | 见文件 | ASR 模型清单、音频规格、Paraformer 录音文件识别 HTTP API、Fun-ASR / Qwen-Audio-3.0-ASR-Flash-Filetrans HTTP API、Qwen-ASR API（OpenAI 兼容 + DashScope 同步 + 异步）、Paraformer Realtime WebSocket API、Fun-ASR Realtime WebSocket API（含客户端/服务端事件）、说话人分离说明 |
| `voice-clone.md` | 见文件 | 声音复刻创建/查询/列表/详情/更新/删除接口（voice-enrollment / qwen-voice-enrollment）、MiniMax voice_clone 接口、音色状态说明、声音设计说明 |
| `doc-map.md` | 本文 | 能力索引、模型清单、endpoint 速查 |

未建立 `music.md` —— 百炼官方文档未提供音乐生成能力。
未建立 `speaker-diarization.md` —— 百炼无独立说话人分离接口，见 `asr-transcription.md` §8。

---

## 5. 抓取中的疑点 / 待确认事项

1. **Qwen-TTS HTTP endpoint 域名**：qwen-tts-api 文档中明确给出 `https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`（旧域名）。其他 CosyVoice/Qwen-Audio-TTS 文档建议迁移至 `{wsId}.cn-beijing.maas.aliyuncs.com`，但 Qwen-TTS HTTP 文档未说明是否同样支持新域名。**adapter 实现时建议优先用 dashscope.aliyuncs.com，或通过实际请求测试专属域名是否兼容**。

2. **MiniMax voice_clone 输入限制**：MiniMax 接口要求 audio_url 时长 10s~5min、大小 ≤ 20MB、格式 mp3/m4a/wav。Qwen-TTS 声音复刻的 audio.data 文档未明确时长/大小限制（仅说明 Data URL 形式支持 audio/wav / audio/mpeg / audio/mp4 三种 MIME）。**adapter 实现时需在前端做用户提示或捕获服务端校验错误**。

3. **Paraformer 任务查询接口 method 差异**：Paraformer 文档明确写查询接口为 `POST`；Fun-ASR / Qwen-ASR / Qwen3-ASR-Filetrans 文档明确写查询接口为 `GET`。endpoint 路径相同（`/api/v1/tasks/{task_id}`），但 HTTP method 不同。**adapter 实现时需按 model 选择对应 method**。

4. **声音设计（Voice Design）独立 endpoint**：tts-model 文档将「声音设计」作为独立能力列出，但 voice-clone-design-http-api 文档中未提供独立的声音设计创建接口。声音设计音色似乎在合成阶段通过 `instruction` 参数控制，与声音复刻共用本文 §3 创建音色接口。**adapter 实现时若需提供「声音设计」入口，应通过 `instruction` 参数在合成接口中实现**。

5. **音色状态查询频率限制**：文档未说明 `query_voice` / `list_voice` 的频率限制。adapter 实现时建议本地缓存音色列表，避免每次合成前都查询。

6. **错误码完整列表**：Paraformer 文档仅示例 `InvalidFile.DownloadFailed` / `FILE_DOWNLOAD_FAILED` / `FILE_403_FORBIDDEN`。完整错误码在百炼官方「错误码」专页，本文未抓取。adapter 实现时需补充错误码映射表。

7. **gummy-chat-v1 1 分钟限制**：模型列表中标注「短音频实时识别（1 分钟限制）」，文档未说明具体 endpoint 差异，建议作为普通实时 ASR WebSocket 调用即可（adapter 不必区分 gummy-chat-v1 与其他 realtime 模型的事件流）。

8. **Paraformer 旧模型默认 api_key**：Paraformer 文档示例代码使用 `api_key = "your-dashscope-api-key"`，与百炼新文档推荐的 DASHSCOPE_API_KEY 环境变量一致，但未说明 Paraformer 是否必须使用 dashscope.aliyuncs.com 域名。adapter 实现建议优先用 `{wsId}.cn-beijing.maas.aliyuncs.com`。

9. **录音文件 OSS 临时 URL 限制**：RESTful API 支持 `oss://` 前缀，SDK 不支持；adapter 实现时若用户从 SDK 调用需提示用户使用 https URL。

---

## 6. 原始文档 URL 总览

| 主题 | URL |
|---|---|
| 百炼 Model Studio 帮助中心首页 | <https://help.aliyun.com/zh/model-studio/> |
| 获取 API Key | <https://help.aliyun.com/zh/model-studio/get-api-key> |
| 语音合成模型清单 | <https://help.aliyun.com/zh/model-studio/tts-model> |
| Qwen-TTS HTTP API | <https://help.aliyun.com/zh/model-studio/qwen-tts-api> |
| CosyVoice/Qwen-Audio-TTS HTTP API | <https://help.aliyun.com/zh/model-studio/cosyvoice-tts-http-api> |
| CosyVoice/Qwen-Audio-TTS WebSocket API | <https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api> |
| Qwen-TTS-Realtime WebSocket API | <https://help.aliyun.com/zh/model-studio/interactive-process-of-qwen-tts-realtime-synthesis> |
| CosyVoice Python SDK | <https://help.aliyun.com/zh/model-studio/cosyvoice-python-sdk> |
| 实时语音合成用户指南 | <https://help.aliyun.com/zh/model-studio/realtime-tts-user-guide> |
| 语音识别模型清单 | <https://help.aliyun.com/zh/model-studio/asr-model> |
| Paraformer 录音文件识别 HTTP API | <https://help.aliyun.com/zh/model-studio/paraformer-recorded-speech-recognition-restful-api> |
| Fun-ASR / Qwen-Audio-3.0-ASR-Flash-Filetrans HTTP API | <https://help.aliyun.com/zh/model-studio/fun-asr-recorded-speech-recognition-http-api> |
| Qwen-ASR API 参考 | <https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference> |
| Paraformer Realtime WebSocket API | <https://help.aliyun.com/zh/model-studio/websocket-for-paraformer-real-time-service> |
| Fun-ASR-Realtime WebSocket API | <https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api> |
| Fun-ASR 客户端事件 | <https://help.aliyun.com/zh/model-studio/fun-asr-client-events> |
| Fun-ASR 服务端事件 | <https://help.aliyun.com/zh/model-studio/fun-asr-server-events> |
| 实时语音识别用户指南 | <https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide> |
| 非实时语音识别用户指南 | <https://help.aliyun.com/zh/model-studio/non-realtime-speech-recognition-user-guide> |
| 声音复刻 HTTP API | <https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api> |
| 声音复刻用户指南 | <https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide> |
| 百炼语音 Demo（GitHub） | <https://github.com/aliyun/alibabacloud-bailian-speech-demo> |
