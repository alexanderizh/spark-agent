> 抓取日期: 2026-08-11 | 来源: https://www.volcengine.com/docs/6561 (豆包语音 / Doubao Voice, LibraryID=6561) | 渠道: 火山引擎方舟 Volcengine Ark（豆包大模型语音） | 抓取方式: getDocDetail API

# 火山引擎方舟音频能力文档索引（Volcengine Ark / 豆包大模型语音）

## 1. 重要说明：语音文档在「豆包语音」产品库（LibraryID=6561）

火山引擎「方舟」（LibraryID=82379，ark.cn-beijing.volces.com）是面向文本/多模态/视频/图片生成的统一推理平台。**方舟库下未提供独立的 TTS / ASR / 音色克隆 REST API**，方舟仅在「接入语音模型」中说明如何把豆包语音模型挂到 Bot 上。**豆包语音合成的原生 API、ASR、声音复刻等全部接口文档位于「豆包语音」产品库（LibraryID=6561，docs.volcengine.com/.../6561/<docId>）**，使用 `openspeech.bytedance.com` 域名 + `X-Api-Key` 鉴权（音色管理类接口走火山引擎 OpenAPI `open.volcengineapi.com` + AKSK 签名）。本文档集针对的就是 LibraryID=6561 下的全部音频相关接口。

## 2. 抓取方式说明

| 抓取步骤 | 使用的 endpoint / 操作 | 备注 |
|---|---|---|
| 找文档库 ID | `GET https://docs.volcengine.com/api/doc/getLibList` | 列出火山全部 284 个文档库，定位到 6561=豆包语音、82379=方舟 |
| 找文档树 | `GET https://docs.volcengine.com/api/doc/getDocList?LibraryID=6561&DataSchema=all_second_nav&type=online` | 返回 245 篇文档的层级树 |
| 抓正文 | `GET https://docs.volcengine.com/api/doc/getDocDetail?DocumentID=<docId>` | **无需鉴权**，返回 JSON，`.Result.MDContent` 即 markdown 原文 |
| 普通网页直 fetch | `WebFetch`/`mcp__spark_search__fetch_url` 拿 `https://www.volcengine.com/docs/6561/<docId>` | **失败**：SPA 单页应用，HTML 仅返回骨架（0 字节正文），不可用 |
| 通过浏览器内 fetch | `fetch('https://www.volcengine.com/api/v1/getDocDetail?docId=<id>')` | **失败**：始终返回 `UnauthorizedAccess`（即使带 cookie） |
| 跨域尝试 | `https://api-docs.volcengine.com/...` | **失败**：返回空响应 |

结论：唯一可靠方式是用 `https://docs.volcengine.com/api/doc/getDocDetail?DocumentID=<docId>` 这个内部 API，参数名为 `DocumentID` 而非 `docId`，无需任何 cookie 或 token。所有 28 篇正文均通过该 endpoint 抓取。

## 3. 落盘文件清单

| 文件 | 行数 | 覆盖内容 |
|---|---|---|
| `tts.md` | 3478 | 豆包语音合成大模型全部接口（同步/单向流式 HTTP·WS、双向流式 WS、异步长文本、SSML、语音指令、模型列表、产品简介） |
| `music.md` | 395 | 豆包音频生成 HTTP（`seed-audio-1.0`，自然语言生成音频/音效/配乐，最长 120s） |
| `asr-transcription.md` | 4038 | 豆包语音识别大模型全部接口（单/双向流式 WS、录音文件识别标准/闲时/极速版 HTTP、错误码、产品简介） |
| `voice-clone.md` | 1545 | 声音复刻 / 音色训练 / 音色查询 / 音色升级 / 音色设计 / 音色管理 HTTP 接口与错误码 |
| `speaker-diarization.md` | （独立说明） | 豆包语音**无独立** speaker diarization API；该能力作为 ASR 内置参数 `enable_speaker_info` / `ssd_version` / `ssd_mode` 提供 |
| `doc-map.md` | 本文件 | 索引与摘要表 |

## 4. 核心模型/接口参数摘要表（任务核心交付物）

| modelId | 能力 | method + endpoint | 认证方式 | 必填参数（摘要） | 同步/异步 | 输出格式 | 文档URL |
|---|---|---|---|---|---|---|---|
| `seed-tts-2.0`（豆包语音合成大模型 2.0） | TTS 单向流式（一次性输入文本，流式出音频） | `POST https://openspeech.bytedance.com/api/v3/tts/unidirectional`（HTTP Chunked） | `X-Api-Key`（必选）；旧版控制台可用 `X-Api-App-Id` + `X-Api-Access-Key` 双头 | `X-Api-Resource-Id: seed-tts-2.0`（或 `seed-icl-2.0`）；`X-Api-Request-Id`；body `req_params.text`、`req_params.speaker`、`req_params.audio_params` | 同步流式 | `mp3`/`pcm`/`ogg_opus`/`wav`（流式推荐 `pcm`） | https://www.volcengine.com/docs/6561/2528925 |
| `seed-tts-2.0` | TTS 单向流式（WebSocket，等同 HTTP 版） | `WSS wss://openspeech.bytedance.com/api/v3/tts/unidirectional/stream` | 同上 | 同上；事件驱动响应 | 同步流式 | 同上 | https://www.volcengine.com/docs/6561/2534913 |
| `seed-tts-2.0` | TTS 双向流式（文本流式输入 + 音频流式输出，超低时延） | `WSS wss://openspeech.bytedance.com/api/v3/tts/bidirection` | 同上（额外 `X-Api-Connect-Id`） | `StartConnection` → `StartSession`（`req_params.speaker`、`audio_params`） → `TaskRequest.text` → `FinishConnection` | 同步流式 | `mp3`/`pcm`/`ogg_opus`/`wav` | https://www.volcengine.com/docs/6561/2532486 |
| `seed-tts-2.0-standard`（异步长文本默认版本） | TTS 异步长文本合成 | 提交：`POST https://openspeech.bytedance.com/api/v3/tts/submit`；查询：`POST https://openspeech.bytedance.com/api/v3/tts/query` | `X-Api-Key` | 提交：`speaker`、`text`、`audio_params`；查询：`task_id` | 异步（submit + poll query） | `mp3`/`pcm`/`ogg_opus`/`wav` | https://www.volcengine.com/docs/6561/1829010 |
| `seed-audio-1.0`（豆包音频生成 1.0） | 自然语言音频生成（音效/人声/配乐，最长 120s） | `POST https://openspeech.bytedance.com/api/v3/tts/create` | `X-Api-Key` | `model: seed-audio-1.0`；`text_prompt`（必选）；可选 `references[]`、`speaker` / `audio_data` / `audio_url`、`image_data` / `image_url`；`audio_config`（format/sample_rate/speech_rate/loudness_rate/pitch_rate/enable_subtitle） | 同步（响应体内直接返回 base64 `audio`，附带 `url` 2 小时有效） | `wav`/`mp3`/`pcm`/`ogg_opus`（默认 `wav`，采样率默认 40000） | https://www.volcengine.com/docs/6561/2550782 |
| `volc.seedasr.sauc.duration`（小时版）/ `volc.seedasr.sauc.concurrent`（并发版） | ASR 单向流式（说完一句出整句结果） | `WSS wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream` | `X-Api-Key` | `X-Api-Resource-Id`（如上之一）；`X-Api-Request-Id`；`X-Api-Sequence: -1`；payload 二进制音频帧 | 同步流式 | 文本 + 时间戳 + 可选 speaker_id | https://www.volcengine.com/docs/6561/2628951 |
| `volc.seedasr.sauc.duration` / `volc.seedasr.sauc.concurrent` | ASR 双向流式（边说边出字 + 持续修正） | `WSS wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async` | 同上 | 同上 | 同步流式 | 文本 + 时间戳 + 可选 speaker_id | https://www.volcengine.com/docs/6561/2630027 |
| `volc.seedasr.auc`（2.0）/ `volc.bigasr.auc`（1.0） | 录音文件识别标准版（≤5h、≤512MB） | 提交：`POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit`；查询：`POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/query` | `X-Api-Key` | 提交：`X-Api-Resource-Id`（如 `volc.seedasr.auc`）、`X-Api-Request-Id`、`audio.url`、`language`、`model_name: bigmodel`；查询：`task_id` | 异步（3h 内返回） | 文本 + 句/词时间戳 + 可选 speaker_id（需 `enable_speaker_info=true` + `ssd_version`） | 提交 https://www.volcengine.com/docs/6561/2606791 ；查询 https://www.volcengine.com/docs/6561/2606792 |
| `volc.bigasr.auc_turbo` | 录音文件识别极速版（≤2h、≤100MB，30min 音频 10s 返回） | `POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash`（单接口同步返回） | `X-Api-Key` | `X-Api-Resource-Id: volc.bigasr.auc_turbo`；`X-Api-Request-Id`；`X-Api-Sequence: -1`；`audio.url`、`language` | 同步 | 文本 + 时间戳 | https://www.volcengine.com/docs/6561/2608628 |
| `volc.bigasr.auc_idle` | 录音文件识别闲时版（≤5h、≤512MB，24h 内返回，闲时算力成本低） | 提交：`POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/idle/submit`；查询：`POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/idle/query` | `X-Api-Key` | `X-Api-Resource-Id: volc.bigasr.auc_idle`；`X-Api-Request-Id`；`X-Api-Sequence: -1`；`audio.url`、`language`、`model_name: bigmodel` | 异步（24h 内） | 文本 + 时间戳 | 提交 https://www.volcengine.com/docs/6561/2608618 ；查询 https://www.volcengine.com/docs/6561/2608619 |
| `seed-icl-2.0`（豆包声音复刻大模型 2.0） | 声音复刻 - 音色训练（提交训练任务） | `POST https://openspeech.bytedance.com/api/v3/tts/voice_clone` | `X-Api-Key` | `X-Api-Resource-Id: seed-icl-2.0`；`X-Api-Request-Id`；`req_params.speaker`（待训练的音色 ID）、`req_params.audios[]`（参考音频） 等 | 异步（训练完成后通过查询接口拿 `speaker` 状态） | speaker_id（仅训练后用于后续 TTS 调用） | https://www.volcengine.com/docs/6561/2534906 |
| `seed-icl-2.0`（同上） | 声音复刻 - 音色查询 | `POST https://openspeech.bytedance.com/api/v3/tts/get_voice` | `X-Api-Key` | `speaker`（音色 ID） | 同步 | 音色状态 + 训练详情 | https://www.volcengine.com/docs/6561/2535742 |
| `seed-icl-2.0`（同上） | 声音复刻 - 音色升级（1.0 → 2.0） | `POST https://openspeech.bytedance.com/api/v3/tts/upgrade_voice` | `X-Api-Key` | `speaker`（待升级的旧版本音色 ID） | 异步（升级任务） | 新版本 speaker_id | https://www.volcengine.com/docs/6561/2535751 |
| `seed-icl-1.0` / `seed-icl-1.0-concurr` / `seed-icl-2.0`（文档涉及多版本） | 音色设计（文生音色，根据自然语言描述生成新音色） | `POST https://openspeech.bytedance.com/api/v3/tts/voice_design` | `X-Api-Key` | `X-Api-Resource-Id`（如 `seed-icl-2.0`）；`req_params.text`（音色描述）、`req_params.count` 等 | 异步（设计任务，需轮询查询） | speaker_id（生成的新音色） | https://www.volcengine.com/docs/6561/2277844 |
| 走火山 OpenAPI（`open.volcengineapi.com`，`Service=speech_saas_prod`，`Version=2023-11-07`） | 音色管理（BatchListMegaTTSTrainStatus / ListMegaTTSTrainStatus / OrderAccessResourcePacks / RenewAccessResourcePacks / QuotaMonitoring / UsageMonitoring 等，AKSK 签名） | `POST open.volcengineapi.com?Action=<Action>&Version=2023-11-07` | **AKSK 签名**（火山引擎 IAM），与上述 `X-Api-Key` 不同；公共参数 `Region=cn-north-1`、`Service=speech_saas_prod`、`Version=2023-11-07` | 各 Action 不同；详见文档 | 同步 | JSON | https://www.volcengine.com/docs/6561/2235883 |
| 内嵌于 ASR（无独立 modelId） | 说话人分离 | （作为 ASR 接口的请求参数） | 同 ASR | `enable_speaker_info: true`、`ssd_version: 200 / 300`、`ssd_mode: 0 / 1`；响应字段 `speaker_id` | 同 ASR | 同 ASR，附加 `speaker_id` | 详见 `speaker-diarization.md` |

## 5. 全部已抓取文档 docId ↔ 文件位置对照

### 5.1 TTS（语音合成）— 落入 `tts.md`

| docId | 标题 | URL |
|---|---|---|
| 1257543 | 产品简介 | https://www.volcengine.com/docs/6561/1257543 |
| 2499930 | 模型列表 | https://www.volcengine.com/docs/6561/2499930 |
| 2550870 | 同步语音合成（分组节点，无独立正文） | https://www.volcengine.com/docs/6561/2550870 |
| 2528925 | 单向流式语音合成 HTTP | https://www.volcengine.com/docs/6561/2528925 |
| 2534913 | 单向流式语音合成 WebSocket | https://www.volcengine.com/docs/6561/2534913 |
| 2532486 | 双向流式语音合成 WebSocket | https://www.volcengine.com/docs/6561/2532486 |
| 2550871 | 异步长文本语音合成（分组节点，无独立正文） | https://www.volcengine.com/docs/6561/2550871 |
| 1829010 | 异步长文本接口文档 | https://www.volcengine.com/docs/6561/1829010 |
| 1330194 | SSML 标记语言 | https://www.volcengine.com/docs/6561/1330194 |
| 1871062 | 语音指令与标签（豆包语音合成 2.0 能力介绍） | https://www.volcengine.com/docs/6561/1871062 |

### 5.2 音频生成 — 落入 `music.md`

| docId | 标题 | URL |
|---|---|---|
| 2550782 | 音频生成 HTTP（`seed-audio-1.0`） | https://www.volcengine.com/docs/6561/2550782 |

### 5.3 ASR（语音识别 / 转写）— 落入 `asr-transcription.md`

| docId | 标题 | URL |
|---|---|---|
| 1354871 | 产品简介 | https://www.volcengine.com/docs/6561/1354871 |
| 2607736 | 流式语音识别（分组节点，无独立正文） | https://www.volcengine.com/docs/6561/2607736 |
| 2628951 | 单向流式语音识别 WebSocket | https://www.volcengine.com/docs/6561/2628951 |
| 2630027 | 双向流式语音识别 WebSocket | https://www.volcengine.com/docs/6561/2630027 |
| 2606791 | 录音文件识别标准版 - 任务提交 HTTP | https://www.volcengine.com/docs/6561/2606791 |
| 2606792 | 录音文件识别标准版 - 结果查询 HTTP | https://www.volcengine.com/docs/6561/2606792 |
| 2608618 | 录音文件识别闲时版 - 任务提交 HTTP | https://www.volcengine.com/docs/6561/2608618 |
| 2608619 | 录音文件识别闲时版 - 结果查询 HTTP | https://www.volcengine.com/docs/6561/2608619 |
| 2608628 | 录音文件识别极速版 HTTP | https://www.volcengine.com/docs/6561/2608628 |
| 2611432 | 错误码查询 | https://www.volcengine.com/docs/6561/2611432 |

### 5.4 声音复刻 / 音色设计 / 音色管理 — 落入 `voice-clone.md`

| docId | 标题 | URL |
|---|---|---|
| 133350 | 声音复刻 - 产品简介 | https://www.volcengine.com/docs/6561/133350 |
| 2534906 | 音色训练 HTTP | https://www.volcengine.com/docs/6561/2534906 |
| 2535742 | 音色查询 HTTP | https://www.volcengine.com/docs/6561/2535742 |
| 2535751 | 音色升级 HTTP | https://www.volcengine.com/docs/6561/2535751 |
| 2277844 | 音色设计 HTTP | https://www.volcengine.com/docs/6561/2277844 |
| 2235883 | 音色管理 HTTP（火山 OpenAPI，AKSK） | https://www.volcengine.com/docs/6561/2235883 |
| 2534853 | 错误码查询 | https://www.volcengine.com/docs/6561/2534853 |

### 5.5 说话人分离 — 落入 `speaker-diarization.md`

无独立 docId；能力内嵌于 2606791 / 2628951 / 2630027 等接口，详见 `speaker-diarization.md`。

## 6. 缺失能力 / 文档未提及项

| 能力 | 状态 | 说明 |
|---|---|---|
| 独立"音乐生成"模型 | **未提供** | 豆包语音产品库（6561）下无独立"音乐生成"产品；`seed-audio-1.0`（音频生成 HTTP）可通过自然语言 prompt 生成含配乐的音频，但不是专属音乐生成模型 |
| 独立"说话人分离 / 声纹注册"API | **未提供** | 仅作为 ASR 内置参数（`enable_speaker_info` / `ssd_version` / `ssd_mode`），见 `speaker-diarization.md` |
| "同步语音合成"独立 HTTP 接口 | **文档未提及正文** | docId=2550870 为分组节点（MDContent=0），其下无子文档；同步非流式合成可用 `seed-audio-1.0` 的 `/api/v3/tts/create` 或单向流式 `/api/v3/tts/unidirectional` 兼任 |
| "流式语音识别"概览正文 | **文档未提及正文** | docId=2607736 为分组节点（MDContent=0），其下子文档为 2628951 / 2630027，已分别抓取 |
| 端到端实时语音大模型（S2S-Omni / S2S-Strong Character）API | **未抓取** | 该模型用于实时语音对话（S2S），不属于任务要求的"TTS/ASR/音色克隆/音乐/说话人分离"五项中的任何一项；如需补充可另抓 docId 1594356（API 接入文档）+ 2549778（全双工版本） |
| 语音播客大模型 / 语音同传大模型 / 语音妙记大模型 / 机器翻译大模型 | **未抓取** | 不属于任务范围；如需补充可见文档树对应 docId（1631587、1631604、1798095、2306581） |
| 旧版（小模型）语音合成/识别接口 | **未抓取** | 归档分组「历史语音合成接口」「历史语音识别接口」下的 V1/V3 接口；新版大模型接口已完整覆盖 |
| SDK 文档（Android / iOS / Linux C++ / Java） | **未抓取** | 任务要求 API 文档；SDK 集成文档可在文档树「Speech SDK」分组（docId 2586547 等）下补抓 |
| 录音文件识别极速版 / 闲时版的 `enable_speaker_info` 字段 | **文档未提及** | 极速版（2608628）与闲时版（2608618）接口文档的 MDContent 中均未出现该字段；产品简介表声称支持说话人分离，可能由服务端默认开启或通过其他参数控制，文档未给出细节 |

## 7. 鉴权方式归纳

| 接口类别 | 鉴权方式 | 关键请求头 |
|---|---|---|
| TTS / ASR / 声音复刻训练-查询-升级 / 音色设计 / 音频生成（`openspeech.bytedance.com`） | 单一 API Key | `X-Api-Key`（必选）、`X-Api-Resource-Id`（模型版本，必选）、`X-Api-Request-Id`（必选，UUID）、`X-Api-Sequence`（流式 ASR 必选，固定 `-1`）、`X-Api-Connect-Id`（双向流式 TTS，连接追踪） |
| 同上（旧版控制台兼容） | 双头 AppID + AccessKey | `X-Api-App-Id` + `X-Api-Access-Key`，参考 docId 2534847 |
| 音色管理类（`BatchListMegaTTSTrainStatus` / `OrderAccessResourcePacks` / `QuotaMonitoring` 等） | 火山引擎 OpenAPI AKSK 签名 | 走 `open.volcengineapi.com`，`Region=cn-north-1`、`Service=speech_saas_prod`、`Version=2023-11-07`；详见 https://www.volcengine.com/docs/6369/67268 |

## 8. 后续若需补抓的建议入口

- 端到端实时语音大模型 API：docId 1594356
- 端到端实时语音 - 全双工版本：docId 2549778
- 语音播客大模型 API（websocket v3 协议）：docId 1668014
- 同声传译 2.0 API：docId 1756902
- 豆包语音妙记 API：docId 1798094
- 机器翻译大模型 API：docId 2306735
- 历史语音合成 V3 接口（HTTP Chunked/SSE 单向流式、WS 单/双向流式）：docId 1598757 / 1719100 / 1329505
- 历史声音复刻 API V3：docId 2227958
- 控制台相关 OpenAPI（音色 / API Key / 服务 / 资源包 / 标签 / 监控全量 Action 列表）：docId 1777242
