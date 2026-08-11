# xAI（Grok）官方文档入口地图

> 抓取日期: 2026-08-11 | 来源: https://docs.x.ai/sitemap.xml | 渠道: xAI

> 状态: 待开发 | 最后核对: 2026-08-11

本文件汇总 SpaceXAI（xAI）官方文档（`https://docs.x.ai`）的入口结构、本轮已采集与待采集清单。所有后续模块文档（`audio.md` / `video.md` / `images.md` / ...）均以本表所列入口为根，逐页向内抓取。若官方 sitemap 或 URL 路径变化，先回到本表修正，再刷新对应模块文档。

## 0. 文档总入口

| 入口 | URL | 备注 |
| --- | --- | --- |
| Overview（含 Voice / Imagine / Models 计费概览） | https://docs.x.ai/overview | 各能力价格、Playground 入口 |
| 模型清单 | https://docs.x.ai/developers/models | 全模型列表（含 audio 子页） |
| 定价 | https://docs.x.ai/developers/pricing | 完整价格表 |
| Rate Limits | https://docs.x.ai/developers/rate-limits | — |
| Release Notes | https://docs.x.ai/developers/release-notes | — |
| Quickstart | https://docs.x.ai/developers/quickstart | — |
| REST API Reference 总入口 | https://docs.x.ai/developers/rest-api-reference/inference | 左侧目录：Chat / Images / Videos / Voice / Models / Files / Batches / Other / Legacy |
| gRPC API Reference | https://docs.x.ai/developers/grpc-api-reference | — |
| Console（API Key、Playground） | https://console.x.ai/ | — |

## 1. sitemap 结构（按主题分组）

来源：`https://docs.x.ai/sitemap.xml`（共 ~150 个 URL）。已按主题归类，标 ✅ 为已采集、⏳ 为待采集。

### 1.1 Audio（语音 / 音频）

| 主题 | URL | 状态 | 落地文档 |
| --- | --- | --- | --- |
| Voice 总览 | https://docs.x.ai/developers/model-capabilities/audio/voice | ✅ | `audio.md` §0 |
| Text to Speech 指南 | https://docs.x.ai/developers/model-capabilities/audio/text-to-speech | ✅ | `audio.md` §1 |
| Speech to Text 指南 | https://docs.x.ai/developers/model-capabilities/audio/speech-to-text | ✅ | `audio.md` §2 |
| Speech to Speech 指南 | https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech | ⏳ | — |
| Speech to Speech - SIP | https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech/sip | ⏳ | — |
| Custom Voices | https://docs.x.ai/developers/model-capabilities/audio/custom-voices | ✅（简表） | `audio.md` §4 |
| Ephemeral Tokens | https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens | ⏳ | — |
| TTS 模型清单 | https://docs.x.ai/developers/models/text-to-speech | ⏳ | — |
| STT 模型清单 | https://docs.x.ai/developers/models/speech-to-text | ⏳ | — |
| Speech-to-Speech 模型清单 | https://docs.x.ai/developers/models/speech-to-speech | ⏳ | — |
| Voice REST API Reference（聚合页） | https://docs.x.ai/developers/rest-api-reference/inference/voice | ✅ | `audio.md` §1.4 / §2.2 / §3 / §4 |
| STT REST API Reference | https://docs.x.ai/developers/rest-api-reference/inference/speech-to-text | ✅ | `audio.md` §2.2 |

### 1.2 Imagine / Images / Video（视觉生成）

| 主题 | URL | 状态 | 落地文档 |
| --- | --- | --- | --- |
| Imagine 总览 | https://docs.x.ai/developers/model-capabilities/imagine | ⏳ | — |
| Imagine Files | https://docs.x.ai/developers/model-capabilities/imagine/files | ⏳ | — |
| Imagine Files - Inputs | https://docs.x.ai/developers/model-capabilities/imagine/files/inputs | ⏳ | — |
| Imagine Files - Outputs | https://docs.x.ai/developers/model-capabilities/imagine/files/outputs | ⏳ | — |
| Images - Generation | https://docs.x.ai/developers/model-capabilities/images/generation | ⏳ | — |
| Images - Editing | https://docs.x.ai/developers/model-capabilities/images/editing | ⏳ | — |
| Images - Multi-Image Editing | https://docs.x.ai/developers/model-capabilities/images/multi-image-editing | ⏳ | — |
| Images - Understanding | https://docs.x.ai/developers/model-capabilities/images/understanding | ⏳ | — |
| Video - Generation | https://docs.x.ai/developers/model-capabilities/video/generation | ✅（音频部分） | `audio.md` §5；`video.md` 待补 |
| Video - Image-to-Video | https://docs.x.ai/developers/model-capabilities/video/image-to-video | ⏳ | — |
| Video - Reference-to-Video | https://docs.x.ai/developers/model-capabilities/video/reference-to-video | ⏳ | — |
| Video - Editing | https://docs.x.ai/developers/model-capabilities/video/editing | ⏳ | — |
| Video - Extension | https://docs.x.ai/developers/model-capabilities/video/extension | ⏳ | — |
| Images REST API Reference | https://docs.x.ai/developers/rest-api-reference/inference/images | ⏳ | — |
| Videos REST API Reference | https://docs.x.ai/developers/rest-api-reference/inference/videos | ✅（仅确认 endpoint） | `video.md` 待补 |

### 1.3 Text（语言模型）

| 主题 | URL |
| --- | --- |
| Text 总览 | https://docs.x.ai/developers/model-capabilities/text/generate-text |
| Comparison | https://docs.x.ai/developers/model-capabilities/text/comparison |
| Reasoning | https://docs.x.ai/developers/model-capabilities/text/reasoning |
| Multi-Agent | https://docs.x.ai/developers/model-capabilities/text/multi-agent |
| Streaming | https://docs.x.ai/developers/model-capabilities/text/streaming |
| Structured Outputs | https://docs.x.ai/developers/model-capabilities/text/structured-outputs |
| Legacy Chat Completions | https://docs.x.ai/developers/model-capabilities/legacy/chat-completions |
| grok-4.5 介绍 | https://docs.x.ai/developers/grok-4-5 |
| Chat REST API Reference | https://docs.x.ai/developers/rest-api-reference/inference/chat |

### 1.4 Files & Collections

| 主题 | URL |
| --- | --- |
| Files 总览 | https://docs.x.ai/developers/files |
| Managing Files | https://docs.x.ai/developers/files/managing-files |
| Public URLs | https://docs.x.ai/developers/files/public-urls |
| Chat with Files | https://docs.x.ai/developers/model-capabilities/files/chat-with-files |
| Collections 总览 | https://docs.x.ai/developers/files/collections |
| Collections Metadata | https://docs.x.ai/developers/files/collections/metadata |
| Collections API | https://docs.x.ai/developers/files/collections/api |
| Collections Search REST | https://docs.x.ai/developers/rest-api-reference/collections/search |
| Collection REST | https://docs.x.ai/developers/rest-api-reference/collections/collection |
| Collections REST 总览 | https://docs.x.ai/developers/rest-api-reference/collections |
| Files Upload REST | https://docs.x.ai/developers/rest-api-reference/files/upload |
| Files Download REST | https://docs.x.ai/developers/rest-api-reference/files/download |
| Files Manage REST | https://docs.x.ai/developers/rest-api-reference/files/manage |
| Files REST 总览 | https://docs.x.ai/developers/rest-api-reference/files |

### 1.5 Tools

| 主题 | URL |
| --- | --- |
| Tools Overview | https://docs.x.ai/developers/tools/overview |
| Function Calling | https://docs.x.ai/developers/tools/function-calling |
| Web Search | https://docs.x.ai/developers/tools/web-search |
| X Search | https://docs.x.ai/developers/tools/x-search |
| Citations | https://docs.x.ai/developers/tools/citations |
| Code Execution | https://docs.x.ai/developers/tools/code-execution |
| Image Generation Tool | https://docs.x.ai/developers/tools/image-generation |
| Remote MCP | https://docs.x.ai/developers/tools/remote-mcp |
| Collections Search Tool | https://docs.x.ai/developers/tools/collections-search |
| Tool Usage Details | https://docs.x.ai/developers/tools/tool-usage-details |
| Advanced Usage | https://docs.x.ai/developers/tools/advanced-usage |
| Streaming & Sync | https://docs.x.ai/developers/tools/streaming-and-sync |

### 1.6 Advanced API Usage

| 主题 | URL |
| --- | --- |
| Async | https://docs.x.ai/developers/advanced-api-usage/async |
| Batch API | https://docs.x.ai/developers/advanced-api-usage/batch-api |
| Context Compaction | https://docs.x.ai/developers/advanced-api-usage/context-compaction |
| Deferred Chat Completions | https://docs.x.ai/developers/advanced-api-usage/deferred-chat-completions |
| mTLS | https://docs.x.ai/developers/advanced-api-usage/mtls |
| Priority Processing | https://docs.x.ai/developers/advanced-api-usage/priority-processing |
| Prompt Caching（总览 + 5 子页） | https://docs.x.ai/developers/advanced-api-usage/prompt-caching |
| WebSocket Mode | https://docs.x.ai/developers/advanced-api-usage/websocket-mode |

### 1.7 其他

| 主题 | URL |
| --- | --- |
| Batches REST | https://docs.x.ai/developers/rest-api-reference/inference/batches |
| Models REST | https://docs.x.ai/developers/rest-api-reference/inference/models |
| Legacy & Deprecated REST | https://docs.x.ai/developers/rest-api-reference/inference/legacy |
| Other REST | https://docs.x.ai/developers/rest-api-reference/inference/other |
| Management REST（auth/audit/billing） | https://docs.x.ai/developers/rest-api-reference/management |
| Management API Guide | https://docs.x.ai/developers/management-api-guide |
| Cost Tracking | https://docs.x.ai/developers/cost-tracking |
| Debugging | https://docs.x.ai/developers/debugging |
| Docs MCP | https://docs.x.ai/developers/docs-mcp |
| Migration（may-15-retirement） | https://docs.x.ai/developers/migration/may-15-retirement |
| Community Integrations | https://docs.x.ai/developers/community |
| Google Cloud Vertex AI | https://docs.x.ai/developers/community/google-cloud-vertex-ai |
| Microsoft Foundry | https://docs.x.ai/developers/community/microsoft-foundry |
| FAQ（accounts / billing / general / security / team-management） | https://docs.x.ai/developers/faq/general |
| Cookbook | https://docs.x.ai/cookbook |
| Cookbook 示例 | https://docs.x.ai/cookbook/examples/[...slug] |

### 1.8 Grok（消费级 / Build / Console / Grok Connectors）

| 主题 | URL |
| --- | --- |
| Grok Overview | https://docs.x.ai/grok/overview |
| Grok User Guide | https://docs.x.ai/grok/user-guide |
| Grok Organization | https://docs.x.ai/grok/organization |
| Grok Management | https://docs.x.ai/grok/management |
| Grok FAQ | https://docs.x.ai/grok/faq |
| Connector Management | https://docs.x.ai/grok/connector-management |
| Connectors 总览 | https://docs.x.ai/grok/connectors |
| Custom MCP Tunneling | https://docs.x.ai/grok/connectors/custom-mcp-tunneling |
| Gmail / Google Calendar | https://docs.x.ai/grok/connectors/gmail-google-calendar |
| Google Drive | https://docs.x.ai/grok/connectors/google-drive |
| Microsoft Teams | https://docs.x.ai/grok/connectors/microsoft-teams |
| OneDrive | https://docs.x.ai/grok/connectors/onedrive |
| Outlook | https://docs.x.ai/grok/connectors/outlook |
| Salesforce | https://docs.x.ai/grok/connectors/salesforce |
| SharePoint | https://docs.x.ai/grok/connectors/sharepoint |
| HubSpot MCP Setup | https://docs.x.ai/integrations/hubspot-mcp-setup |

### 1.9 Build / Console / CLI（Grok Code / Agent SDK）

| 主题 | URL |
| --- | --- |
| Build Overview | https://docs.x.ai/build/overview |
| Modes and Commands | https://docs.x.ai/build/modes-and-commands |
| Keyboard Shortcuts | https://docs.x.ai/build/keyboard-shortcuts |
| Build Settings | https://docs.x.ai/build/settings |
| Settings Reference | https://docs.x.ai/build/settings/reference |
| Build Enterprise | https://docs.x.ai/build/enterprise |
| CLI Headless Scripting | https://docs.x.ai/build/cli/headless-scripting |
| CLI Reference | https://docs.x.ai/build/cli/reference |
| Terminal Support | https://docs.x.ai/build/cli/terminal-support |
| Background Tasks | https://docs.x.ai/build/features/background-tasks |
| Dashboard | https://docs.x.ai/build/features/dashboard |
| Hooks | https://docs.x.ai/build/features/hooks |
| MCP Servers | https://docs.x.ai/build/features/mcp-servers |
| Permissions | https://docs.x.ai/build/features/permissions |
| Plan Mode | https://docs.x.ai/build/features/plan-mode |
| Project Rules | https://docs.x.ai/build/features/project-rules |
| Sandbox | https://docs.x.ai/build/features/sandbox |
| Sessions | https://docs.x.ai/build/features/sessions |
| Skills/Plugins/Marketplaces | https://docs.x.ai/build/features/skills-plugins-marketplaces |
| Subagents | https://docs.x.ai/build/features/subagents |
| Theming | https://docs.x.ai/build/features/theming |
| Worktrees | https://docs.x.ai/build/features/worktrees |
| Console Billing | https://docs.x.ai/console/billing |
| Console Collections | https://docs.x.ai/console/collections |
| Console Usage | https://docs.x.ai/console/usage |
| Console FAQ | https://docs.x.ai/console/faq/accounts |

## 2. 已采集落地

| 文件 | 覆盖范围 | 主来源 |
| --- | --- | --- |
| `audio.md` | TTS（REST + 流式）、STT（REST + 流式）、Realtime、Custom Voices、视频附带音频、`XAI_TTS_PARAM_SCHEMA` 偏差校对 | https://docs.x.ai/developers/model-capabilities/audio/voice + 4 个子页 + REST API Reference |

## 3. 待采集（按优先级）

| 优先级 | 模块 | 入口 |
| --- | --- | --- |
| P0 | Video（grok-imagine-video-1.5 全模式） | https://docs.x.ai/developers/model-capabilities/video/generation 等 5 个子页 |
| P0 | Images（grok-2-image 生成 / 编辑 / 多图编辑 / 理解） | https://docs.x.ai/developers/model-capabilities/images/* 4 个子页 |
| P1 | Imagine Files（与视频 / 图像共用文件接口） | https://docs.x.ai/developers/model-capabilities/imagine/files* 3 个子页 |
| P1 | Files API（chat-with-files、public URLs、collections） | https://docs.x.ai/developers/files* |
| P2 | Live / Realtime（Speech-to-Speech 深度） | https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech |
| P2 | Tools（Function Calling / Web Search / X Search / Live Search） | https://docs.x.ai/developers/tools/* |

## 4. 抓取注意事项

- **sitemap 路径**：`https://docs.x.ai/sitemap.xml` 返回的 URL 形如 `https://docs.x.ai//overview`（**双斜杠**），实际请求时需归一化为单斜杠。Mintlify 渲染，HTML 抓取即可，不需要 `.md` 后缀（与 MiniMax 不同）。
- **`Show optional fields` 折叠**：REST API Reference 页面的请求体默认只显示 required 字段，可选字段需展开。fetch_url 抓取的是已渲染后 DOM，能拿到全部字段（包括默认值与枚举）。
- **章节切分**：REST API Reference 的 `inference/voice` 单页同时包含 Realtime / TTS / STT / Custom Voices 四大节，约 24k 字符；`inference/speech-to-text` 是 STT 单页重复（约 6k 字符，去重后等价于 voice 页的 STT 节）。
- **Mintlify LLM 友好视图**：每页顶部都有 "Copy for LLM" / "View as Markdown" 按钮，对应 URL 加 `.md` 后缀（如 `https://docs.x.ai/developers/model-capabilities/audio/text-to-speech.md`）可拿到原始 markdown，避免折叠面板（**未在本轮使用，后续可考虑**）。
- **`docs-mcp`**：xAI 官方提供 `https://docs.x.ai/developers/docs-mcp` 暴露文档为 MCP，未来若要做"动态文档校对"可直接挂载。
