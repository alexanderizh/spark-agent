# MiniMax 文档入口地图（采集第一层）

> 状态: 已落地 | 最后核对: 2026-07-31

> 2026-07-31 二次复核：§3.5 补 V2 模块文档指针（`video-models-v2.md`）+ V2/v1 关键差异对照表（待代码实现期同步刷新到 `adapter-design.md`）。

本文件汇总 MiniMax 开放平台文档（`https://platform.minimaxi.com/docs/`）的入口、左侧目录结构与本轮采集落地的可回溯链接。所有后续 `image-models.md` / `video-models.md` 等模块文档均以本表所列入口为根，逐页向内深入爬取。后续如果入口路径或模型 id 出现变动，先回到本表修正，再刷新对应模块文档。

## 0. 总入口

| 入口名称 | 文档 URL | 抓取日期 | 备注 |
| --- | --- | --- | --- |
| 模型概览 | https://platform.minimaxi.com/docs/guides/models-intro | 2026-07-31 | 模型家族介绍（语言/视频/语音/图像/音乐） |
| 接口概览 | https://platform.minimaxi.com/docs/api-reference/api-overview | 2026-07-31 | API 能力清单（同步 T2A / 异步 T2A / 视频 / 图像 / 音乐 / 文件） |

## 1. 模型概览（models-intro）抓取到的家族与历史模型

> 来源：https://platform.minimaxi.com/docs/guides/models-intro

| 家族 | 当前主推模型 | 历史/子型号 |
| --- | --- | --- |
| 语言模型 | MiniMax-M3（1M 上下文，Frontier Coding） | M2.7 / M2.7-highspeed、M2.5 / M2.5-highspeed、M2.1 / M2.1-highspeed、M2 |
| 视频模型 | MiniMax H3（多模态内容数组，2K 分辨率，5–15s 时长） | Hailuo-2.3、Hailuo-2.3-Fast（图生视频）、Hailuo-02 |
| 语音模型 | Speech-2.8-HD、Speech-2.8-Turbo | Speech-2.6-HD / Turbo、Speech-02-HD / Turbo |
| 图片模型 | image-01、image-01-live | — |
| 音乐模型 | music-3.0、music-2.6、music-cover | — |

## 2. 接口概览（api-reference/api-overview）左侧目录摘录

> 来源：https://platform.minimaxi.com/docs/api-reference/api-overview

- 语言模型（同步 Chat Completions；Anthropic / OpenAI SDK 兼容）
- 同步语音合成 T2A（HTTP + WebSocket）
- 异步长文本语音生成 T2A Async
- 音色快速复刻（Voice Cloning）
- 音色设计（Voice Design）
- 视频生成（Video Generation：文生视频、图生视频）
- 视频生成 Agent（带模板清单）
- 图像生成（Image Generation：文生图、图生图）
- 音乐生成（Music Generation）
- 文件管理（File：上传/列出/检索/下载/删除）
- 官方 MCP（Python + JavaScript）

## 3. 已识别的二级与三级入口 URL（用于下一层爬取）

下列 URL 在 `api-overview` 页面链接中出现，作为后续模块文档的入口根：

| 模块 | 入口 URL（来源：api-overview 页面） | 抓取日期 |
| --- | --- | --- |
| ~~语言模型 Anthropic 兼容~~ | ~~`.../api-reference/llm/anthropic-api`~~ **（404，原路径已失效；正确入口见 §3.4）** | 2026-07-31 |
| ~~语言模型 OpenAI 兼容~~ | ~~`.../api-reference/llm/openai-api`~~ **（404，原路径已失效；正确入口见 §3.4）** | 2026-07-31 |
| ~~同步语音合成 HTTP~~ | ~~`.../speech-t2a/http`~~ **（404，已废弃，见 §3.3）** | 2026-07-31 |
| ~~同步语音合成 WebSocket~~ | ~~`.../speech-t2a/websocket`~~ **（404，已废弃，见 §3.3）** | 2026-07-31 |
| ~~异步长文本语音 创建任务~~ | ~~`.../speech-t2a-async/create`~~ **（404，已废弃，见 §3.3）** | 2026-07-31 |
| ~~异步长文本语音 查询任务~~ | ~~`.../speech-t2a-async/query`~~ **（404，已废弃，见 §3.3）** | 2026-07-31 |
| ~~音色快速复刻 上传音频~~ | ~~`.../voice-cloning/upload`~~ **（404，已废弃，见 §3.3）** | 2026-07-31 |
| ~~音色快速复刻 快速复刻~~ | ~~`.../voice-cloning/clone`~~ **（404，已废弃，见 §3.3）** | 2026-07-31 |
| ~~音色设计~~ | ~~`.../voice-design/voice-design`~~ **（404，已废弃，见 §3.3）** | 2026-07-31 |
| 文生视频（Hailuo-2.3，历史） | https://platform.minimaxi.com/docs/api-reference/video-generation-t2v | 2026-07-31 |
| 图生视频（Hailuo-2.3-Fast，历史） | https://platform.minimaxi.com/docs/api-reference/video-generation-i2v | 2026-07-31 |
| 首尾帧视频（fl2v，历史） | https://platform.minimaxi.com/docs/api-reference/video-generation-fl2v | 2026-07-31 |
| 主体参考视频（s2v，历史） | https://platform.minimaxi.com/docs/api-reference/video-generation-s2v | 2026-07-31 |
| 查询视频任务状态（历史） | https://platform.minimaxi.com/docs/api-reference/video-generation-query | 2026-07-31 |
| **视频生成 V2 创建（H3，当前主推）** | https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create | 2026-07-31 |
| **视频生成 V2 查询（H3，当前主推）** | https://platform.minimaxi.com/docs/api-reference/video-generation-v2-query | 2026-07-31 |
| **视频生成 V2 列表** | https://platform.minimaxi.com/docs/api-reference/video-generation-v2-list | 2026-07-31 |
| **视频生成 V2 取消/删除** | https://platform.minimaxi.com/docs/api-reference/video-generation-v2-delete | 2026-07-31 |
| **视频生成 V2 下载** | https://platform.minimaxi.com/docs/api-reference/video-generation-download | 2026-07-31 |
| 视频 Agent 创建任务 | https://platform.minimaxi.com/docs/api-reference/video-agent-create | 2026-07-31 |
| 视频 Agent 查询任务 | https://platform.minimaxi.com/docs/api-reference/video-agent-query | 2026-07-31 |
| 视频 Agent 模板列表 | https://platform.minimaxi.com/docs/faq/video-agent-templates | 2026-07-31 |
| 文生图 | https://platform.minimaxi.com/docs/api-reference/image-generation-t2i | 2026-07-31 |
| 图生图 | https://platform.minimaxi.com/docs/api-reference/image-generation-i2i | 2026-07-31 |
| 文生图 OpenAPI JSON | https://platform.minimaxi.com/docs/api-reference/image/generation/api/text-to-image.json | 2026-07-31 |
| 图生图 OpenAPI JSON | https://platform.minimaxi.com/docs/api-reference/image/generation/api/image-to-image.json | 2026-07-31 |
| 图片生成 模块指南 | https://platform.minimaxi.com/docs/guides/image-generation | 2026-07-31 |
| 错误码查询 | https://platform.minimaxi.com/docs/api-reference/errorcode | 2026-07-31 |
| 速率限制 | https://platform.minimaxi.com/docs/guides/rate-limits | 2026-07-31 |
| 音乐生成 | https://platform.minimaxi.com/docs/api-reference/music-generation ✅（原 `music-generation/music` 为 404） | 2026-07-31 |
| **歌词生成（Lyrics Generation）** | https://platform.minimaxi.com/docs/api-reference/lyrics-generation | 2026-07-31 |
| **视频生成 指南** | https://platform.minimaxi.com/docs/guides/video-generation | 2026-07-31 |
| **视频 Prompt 技巧** | https://platform.minimaxi.com/docs/guides/video-prompt | 2026-07-31 |
| **MCP 接入指南（Python + JS）** | https://platform.minimaxi.com/docs/guides/mcp-guide | 2026-07-31 |
| **按量计费定价** | https://platform.minimaxi.com/docs/guides/pricing-paygo | 2026-07-31 |
| **视频资源包定价** | https://platform.minimaxi.com/docs/guides/pricing-video | 2026-07-31 |
| **Token Plan 定价** | https://platform.minimaxi.com/docs/guides/pricing-token-plan | 2026-07-31 |
| **产品定价总览** | https://platform.minimaxi.com/docs/pricing/overview | 2026-07-31 |
| **接口相关 FAQ** | https://platform.minimaxi.com/docs/faq/about-apis | 2026-07-31 |
| **账户相关 FAQ** | https://platform.minimaxi.com/docs/faq/about-account | 2026-07-31 |
| **联系我们** | https://platform.minimaxi.com/docs/faq/contact-us | 2026-07-31 |
| **模型发布日志** | https://platform.minimaxi.com/docs/release-notes/models | 2026-07-31 |
| **接口更新日志** | https://platform.minimaxi.com/docs/release-notes/apis | 2026-07-31 |
| ~~文件上传~~ | ~~https://platform.minimaxi.com/docs/api-reference/files/upload~~ **（404，已废弃，见 §3.1）** | 2026-07-31 |
| ~~文件列表~~ | ~~https://platform.minimaxi.com/docs/api-reference/files/list~~ **（404，已废弃，见 §3.1）** | 2026-07-31 |

> 备注：上述路径为 `api-overview` 链接中出现的字符串拼接；具体可访问性需在二级爬取时逐 URL 验证；若返回 404，由 explore 子代理回退到 site 搜索并补全真实路径后写回本表。

### 3.1 文件管理（File）——已验证的真实 URL ✅

原表中 `files/upload`、`files/list` 两条推测路径**实测返回 HTTP 404**。真实路径命名规则为 `file-management-<action>`，通过官方文档索引获得：

- 文档索引（推荐采集入口）：https://platform.minimaxi.com/docs/llms.txt
- 站点地图：https://platform.minimaxi.com/docs/sitemap.xml

| 接口 | 真实可访问 URL | 方法 + 端点 | 抓取日期 |
| --- | --- | --- | --- |
| 文件上传 | https://platform.minimaxi.com/docs/api-reference/file-management-upload | `POST /v1/files/upload` | 2026-07-31 |
| 文件列出 | https://platform.minimaxi.com/docs/api-reference/file-management-list | `GET /v1/files/list` | 2026-07-31 |
| 文件检索 | https://platform.minimaxi.com/docs/api-reference/file-management-retrieve | `GET /v1/files/retrieve` | 2026-07-31 |
| 文件下载 | https://platform.minimaxi.com/docs/api-reference/file-management-retrieve-content | `GET /v1/files/retrieve_content` | 2026-07-31 |
| 文件删除 | https://platform.minimaxi.com/docs/api-reference/file-management-delete | `POST /v1/files/delete` | 2026-07-31 |

已落地文档：`docs/integrations/minimax/files-api.md`

### 3.2 采集方法论（对后续模块同样适用）

1. **每个文档页追加 `.md` 后缀**可直接获得纯 Markdown 源，其中内嵌完整的 OpenAPI 3.1.0 定义（如 `file-management-upload.md` 含 `api-reference/file/management/api/openapi.json` 全文），比抓 HTML 渲染结果精确得多。
2. `docs/llms.txt` 是官方维护的全站文档索引（含每页一句话描述），**优先用它枚举真实 URL**，不要从 `api-overview` 的渲染文本推测路径（该页链接文本不含 href 目标）。
3. `web_search` 在本环境无可用 keyless 引擎（bing/baidu/duckduckgo 全部失败），采集时应直接走 `llms.txt` / `sitemap.xml` + curl。
4. 服务器 Base URL 为 `https://api.minimaxi.com`（注意是 `minimaxi.com`，非 `minimax.com`）。
>
> **2026-07-31 修正（video 子模块）**：原 doc-map 登记的两条视频 URL `video-generation-t2v/text-to-video` 与 `video-generation-i2v/image-to-video` 实测返回 404；正确入口分别为 `video-generation-t2v` 与 `video-generation-i2v`。同时还隐藏了 `video-generation-fl2v`（首尾帧）、`video-generation-s2v`（主体参考）、`video-generation-query`（状态轮询）三个独立子页面，已补回上表。详情见 `docs/integrations/minimax/video-models.md`。
>
> **2026-07-31 修正（image 子模块）**：原 doc-map 登记的两条图像 URL `image-generation/t2i` 与 `image-generation/i2i` 实测返回 404；正确入口分别为 `image-generation-t2i` 与 `image-generation-i2i`（去掉了二级 segment）。两条配套 OpenAPI JSON 也已登记（`image/generation/api/text-to-image.json` 与 `image/generation/api/image-to-image.json`）。模块指南页 `guides/image-generation`、错误码 `api-reference/errorcode`、速率限制 `guides/rate-limits` 同步登记。详情见 `docs/integrations/minimax/image-models.md` 与 `image-edit-models.md`。

### 3.3 语音合成与音乐生成（Speech / Music）——已验证的真实 URL ✅

原表中 7 条语音相关推测路径与 1 条音乐路径**实测全部返回 HTTP 404**。真实路径为扁平化连字符命名，通过 `docs/llms.txt` 索引获得，下列均实测 HTTP 200：

| 接口 | 真实可访问 URL | 方法 + 端点 | 抓取日期 |
| --- | --- | --- | --- |
| 同步语音合成 HTTP | https://platform.minimaxi.com/docs/api-reference/speech-t2a-http | `POST /v1/t2a_v2` | 2026-07-31 |
| 同步语音合成 WebSocket | https://platform.minimaxi.com/docs/api-reference/speech-t2a-websocket | `wss://api.minimaxi.com/ws/v1/t2a_v2` | 2026-07-31 |
| 创建异步语音合成任务 | https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-create | `POST /v1/t2a_async_v2` | 2026-07-31 |
| 查询语音生成任务状态 | https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-query | `GET /v1/query/t2a_async_query_v2` | 2026-07-31 |
| 上传复刻音频 | https://platform.minimaxi.com/docs/api-reference/voice-cloning-uploadcloneaudio | `POST /v1/files/upload`（`purpose=voice_clone`） | 2026-07-31 |
| 上传示例音频 | https://platform.minimaxi.com/docs/api-reference/voice-cloning-uploadprompt | `POST /v1/files/upload`（`purpose=prompt_audio`） | 2026-07-31 |
| 音色快速复刻 | https://platform.minimaxi.com/docs/api-reference/voice-cloning-clone | `POST /v1/voice_clone` | 2026-07-31 |
| 音色设计 | https://platform.minimaxi.com/docs/api-reference/voice-design-design | `POST /v1/voice_design` | 2026-07-31 |
| 查询可用音色 ID | https://platform.minimaxi.com/docs/api-reference/voice-management-get | `POST /v1/get_voice` | 2026-07-31 |
| 删除音色 | https://platform.minimaxi.com/docs/api-reference/voice-management-delete | 未展开 | 2026-07-31 |
| 音乐生成 | https://platform.minimaxi.com/docs/api-reference/music-generation | `POST /v1/music_generation` | 2026-07-31 |
| 翻唱前处理 | https://platform.minimaxi.com/docs/api-reference/music-cover-preprocess | `POST /v1/music_cover_preprocess` | 2026-07-31 |

配套 FAQ / 指南页与内嵌 API 定义原文：

| 资源 | URL |
| --- | --- |
| 系统音色列表（全量 voice_id） | https://platform.minimaxi.com/docs/faq/system-voice-id |
| 历史接口 | https://platform.minimaxi.com/docs/faq/history-query |
| 指南：同步语音合成（含 WS 握手鉴权示例） | https://platform.minimaxi.com/docs/guides/speech-t2a-websocket |
| 指南：异步语音合成 | https://platform.minimaxi.com/docs/guides/speech-t2a-async |
| 指南：音色快速复刻 | https://platform.minimaxi.com/docs/guides/speech-voice-clone |
| 指南：音乐生成 | https://platform.minimaxi.com/docs/guides/music-generation |
| 语音资源包定价 | https://platform.minimaxi.com/docs/guides/pricing-speech |
| T2A AsyncAPI（WebSocket 帧定义） | https://platform.minimaxi.com/docs/api-reference/speech/t2a/api/asyncapi.json |
| 音乐生成 OpenAPI | https://platform.minimaxi.com/docs/api-reference/music/api/openapi.json |
| 复刻音频上传 OpenAPI | https://platform.minimaxi.com/docs/api-reference/speech/voice-cloning/api/upload-file.json |
| 示例音频上传 OpenAPI | https://platform.minimaxi.com/docs/api-reference/speech/voice-cloning/api/upload-prompt.json |

已落地文档：`docs/integrations/minimax/speech-music.md`

> **2026-07-31 修正（speech/music 子模块）**：除路径修正外，还发现三处概览页与接口页口径不一致，已在 speech-music.md 中标注：①各接口 `model` 枚举额外含 `speech-01-hd` / `speech-01-turbo`（概览页未列）；②音乐模型实际枚举含 `music-3.0/2.6/cover` 及三个 `-free` 限免版共 6 个（概览页仅列 music-3.0）；③T2A Async 字符上限，概览页称 100 万，接口页 `text` 为 5 万、`text_file_id` 文件 <100 万。另发现概览页未提及的 `music-cover-preprocess`（两步翻唱）与 `voice-management-get/delete` 三个接口。
>
> **2026-07-31 二次复核（speech/music 子模块）**：进一步发现 `language_boost` OpenAPI `enum` 实为 **41 语种 + `auto`**（不是概览页所列 40 种），完整列表详见 `speech-music.md` 第 1 节表格；概览页缺 `Chinese,Yue` / `Nynorsk` 两条与 `auto` 标识。**`task_id` 类型在 T2A Async 通道里**create resp 为 `string`、query 为 `integer(int64)`（其它异步通道的 `task_id` 全程 string）。各 endpoint 内联 `BaseResp.status_code` 子集不一致——T2A HTTP 不含 1008、T2A Async 不含 1000/1001/1008/1026/2049、Voice Cloning 不含 1008、Voice Design 不含 1026、video query / video-agent query 不含 1008/2013/2049；完整子集对照见 `auth-errors.md` 第 2.3 节。Voice Cloning `file_id` 是 `integer(int64)`（与视频生成 `file_id: string` 不同）。`prompt_optimizer` 在图像生成默认值是 `false`，在视频生成默认值是 `true`。`MusicData` 仅声明 `status` 与 `audio` 两字段，未单独定义 `output_format=url` 场景的字段名。

### 3.4 语言模型（LLM）——已验证的真实 URL ✅

原表中 2 条语言模型入口 `llm/anthropic-api`、`llm/openai-api` **实测返回 HTTP 404**。正确路径以 `text-` 前缀扁平化命名，通过 `docs/llms.txt` 索引获得，下列均实测 HTTP 200：

| 接口 | 真实可访问 URL | 方法 + 端点 | 抓取日期 |
| --- | --- | --- | --- |
| 通过 Anthropic SDK 调用 | https://platform.minimaxi.com/docs/api-reference/text-anthropic-api | `POST /v1/text/chatcompletion_v2` | 2026-07-31 |
| 通过 OpenAI SDK 调用 | https://platform.minimaxi.com/docs/api-reference/text-openai-api | `POST /v1/text/chatcompletion_v2` | 2026-07-31 |
| Messages API（Anthropic 兼容） | https://platform.minimaxi.com/docs/api-reference/text-chat-anthropic | `POST /v1/messages` | 2026-07-31 |
| Chat Completions API（OpenAI 兼容） | https://platform.minimaxi.com/docs/api-reference/text-chat-openai | `POST /v1/chat/completions` | 2026-07-31 |
| Responses API（OpenAI Responses 兼容） | https://platform.minimaxi.com/docs/api-reference/responses-create | `POST /v1/responses` | 2026-07-31 |
| Token 估算 | https://platform.minimaxi.com/docs/api-reference/responses-input-tokens | `POST /v1/responses/input_tokens` | 2026-07-31 |
| Anthropic 主动缓存 | https://platform.minimaxi.com/docs/api-reference/anthropic-api-compatible-cache | Anthropic 兼容 cache 控制 | 2026-07-31 |
| Prompt 缓存 | https://platform.minimaxi.com/docs/api-reference/text-prompt-caching | Prompt 缓存说明 | 2026-07-31 |
| AI SDK 接入 | https://platform.minimaxi.com/docs/api-reference/text-ai-sdk | AI SDK 集成 | 2026-07-31 |
| 获取模型列表（Anthropic 规范） | https://platform.minimaxi.com/docs/api-reference/models/anthropic/list-models | `GET /v1/models` | 2026-07-31 |
| 获取单个模型详情（Anthropic 规范） | https://platform.minimaxi.com/docs/api-reference/models/anthropic/retrieve-model | `GET /v1/models/{model_id}` | 2026-07-31 |
| 获取模型列表（OpenAI 规范） | https://platform.minimaxi.com/docs/api-reference/models/openai/list-models | `GET /v1/models` | 2026-07-31 |
| 获取单个模型详情（OpenAI 规范） | https://platform.minimaxi.com/docs/api-reference/models/openai/retrieve-model | `GET /v1/models/{model_id}` | 2026-07-31 |

配套指南页：

| 资源 | URL |
| --- | --- |
| 模型调用指南 | https://platform.minimaxi.com/docs/guides/text-generation |
| 工具使用 & 交错思维链 | https://platform.minimaxi.com/docs/guides/text-m3-function-call |
| 通过 SDK 接入 | https://platform.minimaxi.com/docs/guides/quickstart-sdk |
| 前置准备（账户 + API Key） | https://platform.minimaxi.com/docs/guides/quickstart-preparation |
| 本地部署指南（vLLM / SGLang / MLX） | https://platform.minimaxi.com/docs/guides/local-deploy |
| 服务端工具（Server Tools） | https://platform.minimaxi.com/docs/guides/server-tools |

配套 OpenAPI / JSON 定义（由 `llms.txt` 索引获得）：

| 资源 | URL |
| --- | --- |
| Chat Completions OpenAPI | https://platform.minimaxi.com/docs/api-reference/text/api/openapi-chat.json |
| OpenAI Chat OpenAPI | https://platform.minimaxi.com/docs/api-reference/text/api/openapi-chat-openai.json |
| Anthropic Chat OpenAPI | https://platform.minimaxi.com/docs/api-reference/text/api/openapi-chat-anthropic.json |
| Responses OpenAPI | https://platform.minimaxi.com/docs/api-reference/text/api/openapi-responses.json |
| 获取模型列表 JSON（OpenAI） | https://platform.minimaxi.com/docs/api-reference/models/openai/api/list-models.json |
| 获取单个模型 JSON（OpenAI） | https://platform.minimaxi.com/docs/api-reference/models/openai/api/retrieve-model.json |

### 3.5 视频生成 V2（H3）配套 OpenAPI / JSON 定义 ✅

由 `llms.txt` 索引获得，下列均实测 HTTP 200（视频 V2 接口在 §3 表格已登记，此处集中收录其官方 OpenAPI/JSON 定义，供模块文档精确抓取）：

| 资源 | URL |
| --- | --- |
| v2-video-generation（V2 全量） | https://platform.minimaxi.com/docs/api-reference/video/generation/api/v2-video-generation.json |
| text-to-video（Hailuo-2.3 文生视频） | https://platform.minimaxi.com/docs/api-reference/video/generation/api/text-to-video.json |
| image-to-video（Hailuo-2.3-Fast 图生视频） | https://platform.minimaxi.com/docs/api-reference/video/generation/api/image-to-video.json |
| start-end-to-video（首尾帧 fl2v） | https://platform.minimaxi.com/docs/api-reference/video/generation/api/start-end-to-video.json |
| subject-reference-to-video（主体参考 s2v） | https://platform.minimaxi.com/docs/api-reference/video/generation/api/subject-reference-to-video.json |

V2 配套模块文档（2026-07-31 二次复核时新建）：

| 模块 | 入口 | 已落地 |
| --- | --- | --- |
| 创建视频生成任务（V2） | https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create | `docs/integrations/minimax/video-models-v2.md` §4 |
| 查询单个任务（V2） | https://platform.minimaxi.com/docs/api-reference/video-generation-v2-query | `docs/integrations/minimax/video-models-v2.md` §5 |
| 查询任务列表（V2） | https://platform.minimaxi.com/docs/api-reference/video-generation-v2-list | `docs/integrations/minimax/video-models-v2.md` §6 |
| 取消/删除任务（V2） | https://platform.minimaxi.com/docs/api-reference/video-generation-v2-delete | `docs/integrations/minimax/video-models-v2.md` §7 |
| 视频下载 | https://platform.minimaxi.com/docs/api-reference/video-generation-download | `docs/integrations/minimax/video-models-v2.md` §8 |

V2 与 v1 关键差异（待代码实现期同步刷新到 `adapter-design.md` §3.4 / §4.6）：

- 状态枚举：v1 首字母大写 `Preparing/Queueing/Processing/Success/Fail`；V2 全小写 `queued/running/succeeded/failed/cancelled/expired`。
- 错误响应：v1 HTTP 200 + `base_resp.status_code`；V2 真实 HTTP 码（401/400/429/402/422/500）+ OAI `error` 结构 + `error.message` 末尾括号内 `(内部 code)`。
- 任务产物：v1 返 `file_id` 走 Files API；V2 返 `content.url`（HTTPS CDN）**直接下载**，不需 Files。
- 请求体：v1 平铺字段（`prompt` / `first_frame_image` / `last_frame_image` / `subject_reference`）；V2 `content[]` 多模态数组 + `role` 标注用途。
- 比例：v1 由 `first_frame_image` 决定；V2 显式 `ratio` 字段（`adaptive` / 6 种固定比例）。
- `text` 上限：v1 2000 字符；V2 7000 字符。
- 任务 ID 窗口：V2 明确仅支持最近 7 天内查询；v1 文档未声明。

## 4. 已识别的鉴权与速率

- API Key 形态：按量付费 API Key 通过「接口密钥 > 创建新的 API Key」获取；订阅用户使用 Token Plan 订阅 Key；两者相互独立。
- 来源：https://platform.minimaxi.com/docs/api-reference/api-overview
- 速率限制、异步长音频 URL 有效期（9 小时）、文件总容量 100GB / 单文件 512MB 等约束在 `api-overview` 与各模块页确认后再写入对应模块文档。

## 5. 下一步动作

1. 并行启动 5 个 explore 子代理，按模块深入抓取参数（image / video / video-agent / speech+music / files）。
2. 每个子代理必须以本表 URL 为入口，禁止使用未在本表登记的来源。
3. 子代理返回后，写入 `image-models.md`、`video-models.md`、`video-templates.md`、`speech-music.md`、`files-api.md`、`auth-errors.md`，并在每行参数后追加来源 URL。
