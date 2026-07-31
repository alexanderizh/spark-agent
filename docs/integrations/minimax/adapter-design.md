# MiniMax 渠道适配设计

> 状态: 已落地 | 最后核对: 2026-07-31
>
> 提交前风险修复：Files 响应在 JSON 边界保留未加引号的 int64 file_id，避免 JSON.parse 先行舍入；画布创建、运行与重试任务均校验 Provider 文件来源配置，禁止跨账号复用 file_id。
>
> 2026-07-31 实施落地（按用户「只开发主流和最新模型」指令）：
>   - **已开发**：image-01(+image.edit subject_reference) / image-01-live(style) / Hailuo-2.3(+2.3-Fast，移除存疑 video.edit) / H3(V2 content[]) / 视频 Agent(11 模板)。
>   - **仅文档未开发**（按指令排除）：Hailuo-02(fl2v) / S2V-01(s2v) / 01 系列(legacy) / 语音 T2A / 音乐。
>   - **关键实现修正**（与计划 §3.2 不同）：v1/模板/Files 错误模型是 HTTP 恒 200 + body.base_resp.status_code(number)，fetchJson 不会触发 manifest.error；故 v1 错误由 adapter 主动 `assertMinimaxBaseResp` 检测后本地码映射，**不挂 manifest errorContract**。V2(H3) 是真实 HTTP 码 + OAI error，fetchJson 正常走 manifest.error(minimaxV2ErrorContract)。
>   - 6 个 manifest + 4 件套（adapter/validator/files-client/media-input）+ 2 处注册 + 4 个 preset 已落地；protocol/agent-runtime typecheck 通过；13 个单测全绿。
>
> 2026-07-31 实施后增强（用户「继续实现被中断的部分」）：
>   - **模板中文名渲染（P1）**：`SchemaField` 新增 `enumLabels?: Record<string,string>`（`canvasParameterPresentation.ts`），`schemaFields()` 读取 `x-template-labels` 填充（`CanvasInlineAiComposer.tsx`），`CanvasParameterControl` 的 enum/autocomplete 下拉用 `enumOptionLabel()` 显示中文名。视频 Agent 11 个模板下拉不再显示裸数字 id。新增 3 个单测。
>   - **Files 管理画布暴露（5.1）**：protocol 的 `MediaProviderKind` 加 `'minimax-hailuo'` + purpose 枚举；agent-runtime 导出 `MinimaxHailuoFilesClient`；desktop main IPC 4 handler 加 minimax 分支；renderer `CanvasProviderFilesTab` 渠道过滤 + 上传表单。用户可在画布「素材中心 → Files」上传/列出/删除文件、复制 file_id。desktop typecheck 零错误。
>   - **Files 错误归一统一（P3）**：抽取共享模块 `minimax-hailuo-error.ts`（`assertMinimaxBaseResp` + v1 状态码映射表），adapter 与 files client 共用同一套归一逻辑，消除重复。15 个单测全绿。
>   - **Files → 画布联动闭环（5.2）**：`CanvasNodeData` 加 `fileId?`；`buildTaskInputFiles` 透传 fileId（guard + 输出）；`materializeCanvasTaskInputFiles` 的 cloud_url 分支加 fileId 短路（跳过 auth:upload-file）；新增 `createProviderFileNode` 工厂（canvas.api + canvas.store，无 asset 模式）；`CanvasProviderFilesTab` 行级「加入视频生成」按钮（仅 minimax + active）→ FilmCenterHandlers → CanvasWorkspaceView handler。整条链路 typecheck 通过，199 画布测试文件 / 1305 测试零回归。
>
> 2026-07-31 全面审查复核（6 维度 + 硬验证，3 个只读 agent 交叉核实协议层/runtime/画布）：
>   - **6 维度全通过**：核心 adapter 四路径 / manifest-schema-preset 一致性 / 注册点+并行冲突 / 画布 5.2 联动 / P1 模板中文名 / 文档一致性。硬验证：minimax 单测 15/15、protocol+agent-runtime typecheck exit 0、一致性测试 20/20、git diff 纯净（23 文件全 minimax/fileId 相关，无并行冲突）。
>   - **关键纠错**：中途曾误判 speech 会因 `adapter.supports('audio')=false` 报 `capability_not_supported`——实则 router 在 `!adapter.supports(cap)` 时回退 `TemplateMediaAdapter`（manifest 兜底，`media-router.service.ts:318-321/376`），speech/music 正常请求能工作；但 v1 的 `base_resp` 错误（HTTP 200）在 template 路径下检测不全（失败时报错不准）。
>   - **speech preset 移除**：按「语音/音乐仅文档不开发」指令移除 `minimax-speech` preset（`provider-presets.ts`），避免错误归一不全的兜底路径暴露；manifest 骨架 + `speech-music.md` 文档保留，恢复时从 git 历史取回。music-2.6 本就无 preset（孤儿，用户不可达，无害）。protocol typecheck + 20 一致性测试零回归。
>
> 2026-07-31 风险排查修复（用户「是否只新增 minimax 支持，三端适配是否完成」追问，4 处真实缺口已修）：
>   - **P0-1 provider 配置白名单**：`SUPPORTED_IMAGE_VIDEO_MEDIA_PROVIDERS`（`providerMediaConfig.ts`）漏 `minimax-hailuo`（同文件 `USABLE_MEDIA_PROVIDER_KINDS` 却有，两者不一致），导致 ProvidersView image/video 模板下拉不显示 minimax + mediaProvider 被强制重置。已补，符合项目约定 `多媒体模型与渠道配置指南.md:333`。
>   - **P0-2 multimedia-use skill 适配**：`apps/desktop/resources/skills/multimedia-use/SKILL.md` 有火山方舟/百炼专项规则但零提及 minimax。补「MiniMax（minimax-hailuo）专项规则」段：图像两模型+编辑能力区分、v1/V2 双协议差异、本地文件通道差异（v1 仅 URL/base64，V2 可 mm_file://）、双错误模型、三条产物下载链路、Files 联动，全部带官方 URL。
>   - **P1 图标映射**：`VENDOR_ICON_MAP`（`ProviderLogo.tsx`）缺 `'minimax-hailuo'→'minimax'`。CanvasModelPicker 把 `providerKind` 直接当 vendorId 传入 `getProviderIconForVendor`，未映射时落到不存在的 `PROVIDER_ICON_MAP['minimax-hailuo']` → 返回 null → 图标退化成 emoji。已补映射 + 单测断言。
>   - **P2 测试护栏**：`providerMediaConfig.test.ts` 加 image/video 白名单含 minimax-hailuo 的守护测试；`registerProviderFilesIpc.test.ts` 加 minimax-hailuo 路由识别断言。desktop typecheck 零错误，4 个相关测试文件全绿（ProviderLogo 5 / providerMediaConfig 5 / registerProviderFilesIpc 2 / minimax adapter 15）。
>   - **canvasMediaInputMode / canvasMediaCapabilitySelection 测试未加断言**：adapter/validator 已有 15 个 minimax 单测覆盖核心路由逻辑，画布层断言边际价值低，本轮不做。

> 2026-07-31 三次复核（对照真实代码，3 个只读核实 agent 交叉验证协议层 / agent-runtime / canvas）：
> ① **范围纠偏**：按用户原始指令"音乐、语音模型也要采集，虽然现在不开发"，把 `speech-t2a-async / voice-cloning / voice-design / music-3.0 / music-cover` 从开发范围移到 §1.5"本轮不开发（仅文档）"；
> ② **命名纠偏**：`MediaProviderKind = 'minimax-hailuo'`（非 `'minimax'`），所有新文件 stem 统一为 `minimax-hailuo-*`，adapter `id` 必须是 `'minimax-hailuo'`；
> ③ **职责纠偏**：产物下载归 adapter 内 `MediaArtifactService.downloadMediaAsset`，Files client 只做上传/list/get/delete（与火山/xAI 一致）；
> ④ **错误契约**：`minimaxErrorContract` 挂到 manifest 的 `error` 字段（声明式，`fetchJson/pollTask` 自动透传），不是 adapter 常量；
> ⑤ **轮询**：走 adapter 的 `inspect` 回调（`pollTask`），manifest `statusMap` 仅 template 兜底 adapter 使用；
> ⑥ **补 §4.6**：V2(H3) `content[]` 多模态数组编译规则（原 §7.9 引用了不存在的 §4.6）；
> ⑦ **模板控件 Path 1**：`template_id` 作为 `paramSchema` enum 字段，画布 `CanvasParameterControl` 自动渲染下拉（下拉本身零画布层改动）；中文名通过 `x-template-labels` + `SchemaField.enumLabels` 贯通到下拉 label（P1 已落地，见 `CanvasParameterControl.tsx` 的 `enumOptionLabel`）。新增 `templateId` manifest 字段降级为可选 Path 2（未采用）。

## 0. 设计目标与边界

参考火山方舟 (`volcengine-ark-media-canvas-adaptation.md`)、阿里云百炼 (`bailian-multimedia-adapter.md`)、xAI (`xai-api-official-evidence-2026-07-16.md`) 与 APIMart 的渠道适配方式，把 MiniMax（minimaxi）开放平台的图像、视频、视频 Agent 模板与文件管理能力接入 Spark-Agent 的统一多媒体契约。

本轮**只设计与实现代码**，不外推任何官方未声明的字段；所有未在文档中列出的项标注为"未抓到"，待联调补齐。

> **参考样例优先级**（按代码完整度）：① **火山方舟**（adapter + validator + media-input + files client 四件套最完整）；② **xAI**（四件套齐全，且 `xai-media-input.ts` 演示"本地文件 → Files client 上传 → file_id"链路，对 minimax 视频首帧上传最有借鉴价值）。bailian 缺 `media-input.ts` 与独立 validator，**不作为主参考**。

## 1. 现状与新增范围

### 1.1 现有 minimax 骨架（已存在但只覆盖 5 个模型）

`packages/protocol/src/media-model-manifest.ts` 已登记 5 个 minimax manifest（`providerKind: 'minimax-hailuo'`，已由核实 agent 确认行号）：

| 现有 manifest id | modelId | capability | 行号 | 状态 |
| --- | --- | --- | --- | --- |
| `minimax:image-01` | `image-01` | `image.generate` | `media-model-manifest.ts:2921-2958` | 骨架存在，缺 `image-01-live`、缺 `subject_reference`（图生图）能力 |
| `minimax:speech-2.8-hd` / `-turbo` | `speech-2.8-hd/-turbo` | `audio.speech` | `:3076-3152` | 骨架存在；**本轮不开发，preset 已移除**（见 §1.5 + 顶部复核记录） |
| `minimax:music-2.6` | `music-2.6` | `audio.music` | `:3041-3077` | 骨架存在；**本轮不开发**（见 §1.5） |
| `minimax:hailuo-2.3` | `MiniMax-Hailuo-2.3` | `video.generate` / `video.image_to_video` / `video.edit` | `:3081-3163` | 骨架存在，当前由 `TemplateMediaAdapter` 兜底；本轮新 adapter 注册后接管 |

> 现有骨架的 `docs.sourceUrls` 全部指向 `https://platform.minimaxi.com/document/*`（实测 404，路径已失效）；本轮统一替换为 `https://platform.minimaxi.com/docs/api-reference/*` 真实可访问 URL（详见 `doc-map.md`）。

> **现有 `hailuo-2.3` manifest 的 `video.edit` 能力存疑**：minimax `/v1/video_generation` 文档只覆盖 t2v/i2v/fl2v/s2v 四种场景，无独立 video edit 端点。本轮核实是否保留；如保留需在 adapter 里明确 edit 走哪个端点，否则标注"未验证"。

### 1.2 本轮开发范围（新增 manifest）

| manifest id | modelId | domain | capability | 来源 |
| --- | --- | --- | --- | --- |
| `minimax:image-01-live` | `image-01-live` | image | `image.generate`（`subject_reference` 是否支持官方未明文，标注"未在文档中列出"；仅 `image-01` 明确支持） | image-models.md / image-edit-models.md |
| 扩展 `minimax:image-01` | `image-01` | image | 增 `image.edit`（图生图 + `subject_reference`） | image-edit-models.md §1 |
| `minimax:v1-hailuo-2.3-fast` | `MiniMax-Hailuo-2.3-Fast` | video | `video.image_to_video`（v1） | video-models.md |
| `minimax:v1-hailuo-02` | `MiniMax-Hailuo-02` | video | `video.generate` + `video.image_to_video` + `video.reference_to_video`（fl2v 首尾帧） | video-models.md |
| `minimax:v1-s2v-01` | `S2V-01` | video | `video.reference_to_video`（s2v 主体参考） | video-models.md |
| `minimax:v1-t2v-01` / `v1-t2v-01-director` | `T2V-01` / `T2V-01-Director` | video | `video.generate` | video-models.md |
| `minimax:v1-i2v-01` / `v1-i2v-01-live` / `v1-i2v-01-director` | `I2V-01` / `I2V-01-live` / `I2V-01-Director` | video | `video.image_to_video` | video-models.md |
| `minimax:v2-h3` | `MiniMax-H3` | video | `video.generate` + `video.image_to_video` + `video.reference_to_video`（V2 多模态 `content[]`，详见 §4.6） | video-models-v2.md |
| `minimax:hailuo-template` | `video-agent` | video | `video.generate`（走 `/v1/video_template_generation`；`template_id` 作为 paramSchema enum，见 §4.3） | video-templates.md |

> 共 **12 个 manifest 新增/扩展**（image-01-live + 扩展 image-01 + 8 个 v1 视频 + 1 个 v2 + 1 个 template）。上一版"11 个"计数有误，已修正。

### 1.3 本轮新增客户端（命名统一为 `minimax-hailuo-*`）

`MediaProviderKind` 在协议层已声明为 `'minimax-hailuo'`（`packages/protocol/src/media-config.ts:27`），文件名 stem 必须与之相等（与 `volcengine-ark-*` / `xai-*` 约定一致），否则 `MediaRouterService` 注册找不到 adapter。

| 客户端 | 路径 | 责任 | 对照样例 |
| --- | --- | --- | --- |
| `MinimaxHailuoMediaAdapter` | `packages/agent-runtime/src/services/media/adapters/minimax-hailuo-media.adapter.ts` | `implements MediaProviderAdapter`（`id: 'minimax-hailuo'`）；manifest → HTTP/异步请求；`base_resp.status_code` / V2 OAI 错误归一；轮询 `inspect`；产物经 `MediaArtifactService` 下载 | `volcengine-ark-media.adapter.ts` |
| `validateMinimaxHailuoMediaRequest` | `packages/agent-runtime/src/services/media/validators/minimax-hailuo-media.validator.ts` | 函数式 validator（`MediaProviderValidator`）；请求前阻断非法首帧/尾帧/主体参考组合、文案超限、参数越界、模板 inputs 必填 | `volcengine-ark-media.validator.ts` |
| `MinimaxHailuoFilesClient` | `packages/agent-runtime/src/services/media/minimax-hailuo-files.client.ts` | **仅** Files 的 upload/list/get/delete（用户素材上传，拿 `file_id`）；不负责产物下载 | `xai-files.client.ts`（含 upload → file_id 链路） |
| `resolveMinimaxHailuoMediaReference` | `packages/agent-runtime/src/services/media/minimax-hailuo-media-input.ts` | 通用角色 → minimax 字段映射（`first_frame_image` / `last_frame_image` / `subject_reference[]` / V2 `content[].role`） | `xai-media-input.ts`（本地文件 → Files 上传 → file_id） |

**注册点（必须改，否则不生效）**：
- adapter：`packages/agent-runtime/src/services/media/media-router.service.ts:102-121` 构造函数加 `this.register(new MinimaxHailuoMediaAdapter())`；
- validator：`packages/agent-runtime/src/services/media/validators/media-validator.registry.ts` 加 `import` + `['minimax-hailuo', validateMinimaxHailuoMediaRequest]`。

> 无 `.mjs` 镜像（所有 adapter/validator/files-client/media-input 均为 `.ts`；stdio MCP server 是独立实现，不调用 TS adapter）。

### 1.4 视频 Agent 模板（Path 1：零画布改动）

**推荐方案 Path 1**：把 `template_id` 作为 `minimaxVideoTemplateSchema` 的一个 **enum 字段**。

- 在 `media-model-shared-manifest-parts.ts` 新增 `minimaxVideoTemplateSchema`，`properties.templateId` 写 `{ type:'string', title:'模板', enum:[...11 个 id] }`，中文名通过自定义关键字 `x-template-labels: { id: 中文名 }` 注入。
- 画布消费（P1 已落地）：`schemaFields()`（`CanvasInlineAiComposer.tsx`）读取 `x-template-labels` 填入 `SchemaField.enumLabels`；`CanvasParameterControl.tsx` 的 `enumOptionLabel()` 用它作下拉 label。下拉控件本身复用既有 `enum` 分支 antd `<Select>`，`canvasParameterPresentation.ts` 自动归一化为 enum control——**无新控件**，仅 enumLabels 一条 label 贯通线。
- `media_inputs[]` / `text_inputs[]` 子属性面板：参考 `CanvasInlineAiComposer.tsx:2071 createCustomParamDraft` 的 k-v 列表编辑器蓝本（小幅改造，非必须本轮完成）。

**路由**：operation 仍是 `text_to_video`（→ `video.generate` capability），**不新增协议 operation**；adapter 根据 `paramSchema` 是否含 `templateId` 值分流到 `/v1/video_template_generation`。

**可选 Path 2（更重，不推荐）**：扩展 `MediaModelCapabilityManifest` 新增 `templateId?: string` + `templateInputRoles?: ('media'|'text')[]` optional 字段（需同步改 interface `media-model-manifest.ts:88-114` + zod `:211-237`），并在 `CanvasOperationPanel.tsx:2437-2465` 新增模板卡片网格控件。仅在 Path 1 的下拉交互不足以承载模板视觉时才走。

> **注意区分**：`ProviderMediaModelRef.templateManifestId`（`media-model-manifest.ts:178/302`）已存在，语义是"用某 built-in manifest 作为模板的 ref"，与本设计的 `templateId`（平台原生模板 id）完全不同，不要混用。

### 1.5 本轮不开发范围（仅文档已落地，不写代码）

按用户原始指令"音乐、语音模型也要采集，虽然现在不开发"。以下能力**文档已采集**（见 `speech-music.md`），但**本轮不实现 manifest/adapter**：

| 能力 | 落地文档 | 未来开发时需先解决的设计问题 |
| --- | --- | --- |
| T2A 同步 (`/v1/t2a_v2`) | speech-music.md §1 | 现有 `speech-2.8-hd/-turbo` 骨架是否可用待验证 |
| T2A 异步 (`/v1/t2a_async_v2`) | speech-music.md §3 | `task_id` create=string / query=int64 双类型转换 |
| Voice Cloning (`/v1/voice_clone`) | speech-music.md §4 | 4 个语音端点同属 `audio.speech` capability，画布模型选择器会重复；需新增 `audio.voice_clone` capability 或改用独立 manifest + adapter 分流 |
| Voice Design (`/v1/voice_design`) | speech-music.md §5 | 同上；且生成的是 `voice_id` 而非音频产物，语义上不是 `audio.speech` |
| Music 3.0 / Cover | speech-music.md §6-8 | `MusicData` 输出字段官方未正式定义 |

> **未来开发的协议前置项**（本轮不做、但先记录）：`MediaCapabilityId`（`media-config.ts:71-82`，闭合 union）若要支持 voice cloning/design，需新增 capability id 或重新设计"同 capability 多端点"的路由机制。

## 2. 分层架构

```text
画布通用角色与素材元数据（CanvasOperationPanel / CanvasMediaInputConfigurator）
  first_frame / last_frame / subject_reference / reference(image|video|audio)
  sizeBytes / width / height / durationMs
  ※ 画布只产出通用角色，不感知 provider 字段（canvasMediaInputMode.ts:163-174）
                  ↓
模型 manifest（paramSchema 自动渲染参数面板，CanvasParameterControl.tsx）
  rolePolicy / maxImages / maxVideos / maxAudios / paramSchema / paramPolicy / error
                  ↓
Provider validator + adapter（agent-runtime）
  validator 阻断非法组合 → minimax 顶层字段 + base_resp/OAI 错误 → inspect 轮询 → MediaArtifactService 下载产物
                  ↓
MinimaxHailuoFilesClient（仅用户素材上传：本地图片/视频 → file_id）
```

## 3. 通用适配约定

### 3.1 鉴权

| Header | 值 | 来源 |
| --- | --- | --- |
| `Authorization` | `Bearer <API_key>` | https://platform.minimaxi.com/docs/api-reference/file-management-upload.md `securitySchemes.bearerAuth` |
| `Content-Type` | `application/json` 或 `multipart/form-data` | 同上 |

API Key 通过 Provider 配置持有（main 进程 keystoreRef，renderer 永远拿不到明文）；adapter 不持久化。Token Plan 订阅 Key 与按量付费 Key 互斥，由 Provider Profile 层在创建时锁定。

### 3.2 错误模型

- **v1 / 模板 / Files / T2A / Music**：HTTP 总是 200；业务状态码在响应体的 `base_resp.status_code`；`base_resp.status_code != 0` 即失败。
- **V2 (H3)**：HTTP 真实状态码（401/400/429/402/422/500），响应体为 OAI `error` 结构，业务码在 `error.message` 末尾括号内。**与 v1 不共享错误归一**。
- 异步轮询的 `status` 字段与错误码**分开**判断：业务码非 0 即中止；状态字段只在业务码为 0 时决定继续轮询还是下载产物。

**错误契约挂 manifest（声明式，与 apimart/xai 一致）**：在 minimax manifest 的 `error` 字段声明 `MediaErrorContract`，`fetchJson/pollTask` 经 `ctx.mediaManifest.error` 自动透传（参考 `apimartErrorContract` / `xaiErrorContract` 在 `media-model-manifest.ts:401,1890`）。V2 因错误结构不同，在 adapter 内写本地 `minimaxV2ErrorExtractor`（参考 `volcengineErrorExtractor` 在 `volcengine-ark-media.adapter.ts:821`），不挂 manifest `error`。

```ts
// 挂到 v1/模板/Files manifest 的 error 字段
const minimaxErrorContract: MediaErrorContract = {
  codePaths: ['base_resp.status_code'],
  messagePaths: ['base_resp.status_msg'],
  requestIdPaths: ['trace_id', 'id', 'task_id'],
  mappings: {
    0: 'success',
    1000: 'unknown_error', 1001: 'timeout', 1002: 'rate_limited',
    1004: 'auth_failed', 1008: 'insufficient_balance',
    1013: 'service_internal_error', 1024: 'internal_error',
    1026: 'unsafe_input', 1027: 'unsafe_output', 1033: 'downstream_service_error',
    1039: 'tpm_rate_limited', 1041: 'connection_limit', 1042: 'illegal_characters',
    1043: 'asr_similarity_failed', 1044: 'clone_prompt_similarity_failed',
    2013: 'invalid_parameter', 20132: 'voice_clone_param_error',
    2037: 'voice_duration_out_of_range', 2038: 'auth_required',
    2039: 'voice_id_duplicate', 2042: 'voice_id_no_access',
    2045: 'rate_growth_exceeded', 2048: 'prompt_audio_too_long',
    2049: 'invalid_api_key', 2056: 'token_plan_resource_exceeded',
  },
  retryableCodes: [1000, 1001, 1002, 1039],
}
```

> **endpoint 私有子集提示**（不要假设全表可用，参考 `auth-errors.md` §2.3）：
> - 视频生成 POST / 视频 Agent POST / 图像生成 / 音乐生成：`0/1002/1004/1008/1026/2013/2049`（7 条 + 0）
> - 视频生成 GET / 视频 Agent GET（查询）：`0/1002/1004/1026/1027`（5 条 + 0，**无 1008/2013/2049**）
> - Files 4 接口：`0/1000/1001/1002/1004/1008/1013/1026/1027/1039/2013`（10 条 + 0）

### 3.3 异步通道（走 adapter `inspect` 回调）

**架构事实**：`pollTask(url, headers, {inspect})`（`media-http.util.ts:163-247`）的轮询逻辑由各 adapter 自己写的 `inspect(data): 'done'|'pending'|'failed'` 回调决定，**不消费 manifest 的 `statusMap`**（`commonStatusMap` 只给 `TemplateMediaAdapter` 兜底用）。因此本轮新 adapter 注册后，现有 `hailuo-2.3` manifest 的 `statusMap` 字段不再生效，由 adapter 的 `inspect` 接管。

三套独立通道，各自 `inspect` 逻辑：

| 通道 | endpoint | inspect 成功/失败判定 | task_id 类型 |
| --- | --- | --- | --- |
| 视频生成 v1（t2v/i2v/fl2v/s2v） | `POST /v1/video_generation` + `GET /v1/query/video_generation?task_id=` | `status==='Success'`→done / `'Fail'`→failed / 其余 pending；产物 `file_id` 走 Files retrieve_content | 全程 string |
| 视频 Agent（template） | `POST /v1/video_template_generation` + `GET /v1/query/video_template_generation?task_id=` | `status==='Success'`→done / `'Fail'`→failed；产物直接含 `video_url` | 全程 string |
| 视频生成 V2（H3） | `POST /v2/video_generation` + `GET /v2/query/video_generation/{task_id}` | `status==='succeeded'`→done / `'failed'\|'expired'`→failed / 其余 pending；产物 `content.url` 直接 CDN | 全程 string |
| 图像生成（同步） | `POST /v1/image_generation` | 同步响应 `data.image_urls[]` / `data.image_base64[]`（24h） | 仅记录 `id` |

轮询参数（沿用工程默认）：视频/视频 Agent 5s 间隔 / 120 次上限；V2 同；`pollTask` 自带瞬时错误退避重试（默认 3 次）。

### 3.4 产物下载（adapter 经 MediaArtifactService）

**架构事实**：所有现有渠道的视频/图片产物下载都由 `MediaArtifactService.downloadMediaAsset(kind, url, outputDir, filename, fetch, timeoutMs)` 在 **adapter 内部**完成（参考 `volcengine-ark-media.adapter.ts:232-242`）。Files client **不负责产物下载**。

minimax 各通道产物获取方式：

| 通道 | 产物获取链路 | 时效 |
| --- | --- | --- |
| 视频生成 v1 | adapter 拿 query resp 的 `file_id`(int64) → 调 `MinimaxHailuoFilesClient` 的 `retrieveContent(file_id)` 拿二进制流 → 写盘；或拿 `download_url` → `MediaArtifactService.downloadMediaAsset` | `download_url` **1 小时**（`FileObject.download_url.description` 原文） |
| 视频 Agent | resp 直接含 `video_url`(HTTPS) → `MediaArtifactService.downloadMediaAsset` | 9 小时 |
| 视频生成 V2 (H3) | query resp 直接含 `content.url`(CDN) → `MediaArtifactService.downloadMediaAsset`；**不走 Files** | 官方未给数字，按 9 小时处理 |
| 图像生成 | 同步 resp `data.image_urls[]` → `MediaArtifactService.downloadMediaAsset` | 24 小时 |

> **`file_id` 类型差异（int64）**：xAI/百炼/火山的 `id` 都是 string；minimax 的 `file_id` 是 **int64**。JS `number` 无法精确表示 `> 2^53-1`。Files Client 在序列化时**强制把 `file_id` 当 string 透传**（不做 number 隐式转换）。注意 T2A Async `file_id` 也是 int64，视频生成 query 的 `file_id` 是 string（跨通道不一致，统一按 string 透传）。

## 4. 请求体编译（manifest → HTTP）

### 4.1 文生图 / 图生图（image-01 / image-01-live）

来源：image-models.md / image-edit-models.md。

**文生图** `POST /v1/image_generation`（`image.generate` capability）：

```jsonc
{
  "model": "{{modelId}}",
  "prompt": "{{prompt}}",
  "aspect_ratio": "{{aspectRatio}}",     // alias: aspectRatio → aspect_ratio
  "width": "{{width}}", "height": "{{height}}",
  "response_format": "{{response_format}}",  // url | base64
  "seed": "{{seed}}", "n": "{{n}}",
  "prompt_optimizer": "{{prompt_optimizer}}",  // 图像侧默认 false
  "aigc_watermark": "{{aigc_watermark}}",
  "style": { "style_type": "{{style_type}}", "style_weight": "{{style_weight}}" }  // 仅 image-01-live 生效
}
```

**图生图** 同 endpoint + `subject_reference`（`image.edit` capability，扩展到 `minimax:image-01`）：

```jsonc
{
  "model": "image-01",
  "prompt": "{{prompt}}",
  "subject_reference": [
    { "image_file": "{{subjectReferenceFileId}}", "type": "character" }   // 字段名 image_file（官方 OpenAPI ImageSubjectReference.image_file），不是 image_url；type 当前仅 character
  ]
}
```

`rolePolicy`：`image.edit` 的 `subject_reference` 走 `inferRolePolicy` 的"参考图"分支（`media-config.ts:424-427`），maxImages=1。

> **capability id 必须用 `image.edit`**（非 `image.image_to_image`）：协议 `MediaCapabilityId`（闭合 union，`media-config.ts:71-82`）只有 `image.edit`；`capabilityForOperation` 把 `image_to_image` / `image_edit` / `image_compose` 三种 operation 全映射到 `image.edit`。`image.image_to_image` 只在 manifest 内部 union（`MediaManifestCapabilityId`，带 `| string`）存在，provider profile 不能声明它。

### 4.2 视频生成 v1（Hailuo 全系 + S2V-01）

来源：video-models.md。`POST /v1/video_generation` 同一 endpoint 通过请求体字段区分四种场景：

| 场景 | 关键字段 | 触发路径 |
| --- | --- | --- |
| t2v | `prompt`（必填） | operation `text_to_video` → `video.generate` |
| i2v | `prompt` + `first_frame_image`（必填） | operation `image_to_video` → `video.image_to_video` |
| fl2v | `prompt` + `first_frame_image` + `last_frame_image` | `video.reference_to_video`（hailuo-02）；画布 `reference` 输入模式 + `selectCanvasMediaCapability` 多候选择优 |
| s2v | `prompt` + `subject_reference[]`（`type=character`） | `video.reference_to_video`（s2v-01）；同上 |

> **`video.reference_to_video` 可达性已确认**：画布 `canvasMediaCapabilitySelection.ts:26 selectCanvasMediaCapability()` 在模型同时声明 `image_to_video` 与 `reference_to_video` 时做多候选择优，经 `reference` 输入模式触发。无需新增 canvas operation。

> **fl2v 保守策略**：官方未明确 Hailuo-2.3 / -Fast 是否可用 fl2v（video-models.md §8 标"未抓到"）。validator **默认对 Hailuo-2.3 / -Fast 阻断 fl2v**，仅 Hailuo-02 放行。

模型枚举（与官方 modelId 完全一致）：

- `MiniMax-Hailuo-2.3`：t2v / i2v，duration [6,10]，resolution 768P/1080P
- `MiniMax-Hailuo-2.3-Fast`：仅 i2v，duration [6,10]，resolution 768P（默认）/1080P（仅 6s）
- `MiniMax-Hailuo-02`：t2v / i2v / fl2v，duration [6,10]，resolution 512P/768P/1080P
- `S2V-01`：s2v，duration / resolution 未在文档列出（video-models.md §8）

### 4.3 视频 Agent（template，Path 1）

来源：video-templates.md。`POST /v1/video_template_generation`：

```jsonc
{
  "template_id": "{{templateId}}",       // 11 个模板之一，来自 paramSchema.templateId enum
  "media_inputs": [{ "value": "{{firstFrame}}" }],   // URL/base64/mm_file://{file_id}
  "text_inputs":  [{ "value": "{{userText}}" }],     // 仅需要 text 的模板
  "callback_url": "{{callbackUrl}}"       // 可选
}
```

`minimaxVideoTemplateSchema`（新增到 `media-model-shared-manifest-parts.ts`）：

```ts
{ type:'object', additionalProperties:true, properties:{
  templateId: { type:'string', title:'模板', enum:[/* 11 个 id */],
                'x-template-labels': { /* id → 中文名 */ },
                description:'视频 Agent 模板，来自 video-templates.md §4' },
  callbackUrl: { type:'string', title:'回调地址（可选）' }
}}
```

validator 阻断：`templateId` 不在 11 项枚举 → 报错；模板声明需 media 但未传 first_frame → 报错；声明需 text 但未传 → 报错。

### 4.4 ~ 4.5（语音 / 音乐：本轮不开发）

见 §1.5。`speech-music.md` 文档已落地，本轮不写 manifest / adapter。

### 4.6 视频生成 V2（MiniMax-H3，`content[]` 多模态数组）

来源：video-models-v2.md。`POST /v2/video_generation`，**请求体不再是平铺字段**，而是 `content: ContentItem[]` 数组：

```jsonc
{
  "model": "MiniMax-H3",
  "content": [
    { "type": "text", "text": "{{prompt}}" },                 // 必填，≤ 7000 字符（v1 是 2000）
    { "type": "image_url", "image_url": { "url": "{{...}}" }, "role": "first_frame" }
    // role ∈ first_frame / last_frame / reference_image / reference_video / reference_audio
  ],
  "resolution": "2K",                  // 仅 2K
  "duration": 5,                        // [4,15] 整数
  "ratio": "16:9",                      // adaptive / 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16
  "aigc_watermark": false
}
```

**adapter 编译规则**（关键）：

1. **每次请求必须含至少一个非空 `type=text` 项**。
2. **场景由 content 元素组合 + role 决定**（不是 capability id）：
   - t2v：仅 1 个 text 项；`ratio` 必填且 ≠ `adaptive`。
   - i2v 首帧：text + 1 张 `image_url`(role=first_frame 或不填)。
   - i2v 尾帧：text + 1 张 `image_url`(role=last_frame)。
   - i2v 首尾帧：text + 2 张 `image_url`(first_frame + last_frame)。
   - r2v：text + `reference_image` + `reference_video` + `reference_audio` 任意子集；**不可仅音频，须含至少 1 个参考视频或图片**。
3. **i2v 与 r2v 互斥（强制）**：`reference_image`/`reference_video`/`reference_audio` 任一出现，就不能再出现 `first_frame`/`last_frame`（反之亦然）。validator 必须阻断同时出现。
4. **`image_url.url` 三种形态**：公网 URL / `mm_file://{file_id}` / `data:image/<格式>;base64,...`（`<格式>` 小写）。**请求体总大小 ≤ 64MB**，大文件用 URL 或 `mm_file://`，**不要 base64**（放大约 33%）。
5. **媒体限制**：图片 JPG/JPEG/PNG/WEBP/HEIC/HEIF ≤30MB、[256,5760]px；参考视频 MP4/MOV ≤50MB、≤3 段、每段 [2,15]s；参考音频 WAV/MP3 ≤15MB、≤3 段。

**轮询**：`GET /v2/query/video_generation/{task_id}`（path 参数，非 query），**仅支持最近 7 天内任务**。`inspect`：`status==='succeeded'`→done（取 `content.url`）/ `'failed'||'expired'`→failed / 其余 pending。状态枚举全小写（与 v1 首字母大写不同）。

**错误归一（独立）**：V2 是 OAI 风格 + 真实 HTTP 码，adapter 用本地 `minimaxV2ErrorExtractor` 解析 `error.http_code` + `error.message` 末尾 `(code)`，**不挂 manifest `error`、不与 v1 共享 `minimaxErrorContract`**。

## 5. Files 客户端（仅上传/list/get/delete）

### 5.1 接口对照

| 操作 | minimax | 与火山对照 |
| --- | --- | --- |
| 上传 | `POST /v1/files/upload`（multipart，`purpose` + `file`）→ 返回 `file_id`(int64) | 火山 `/api/v3/files` |
| 列表 | `GET /v1/files/list?purpose=`（无分页） | 火山 `/api/v3/files?after=&limit=` |
| 检索 | `GET /v1/files/retrieve?file_id=` | 火山 `/api/v3/files/{file_id}` |
| 下载产物 | **不走 Files client**；adapter 直接用 query resp 的 `download_url`(v1) / `content.url`(V2) / `video_url`(Agent) 经 `MediaArtifactService` 下载；v1 如需二进制可调 `GET /v1/files/retrieve_content?file_id=`（adapter 内） | 火山 `/api/v3/files/{file_id}/content` |
| 删除 | `POST /v1/files/delete`（单文件，不支持批量） | 火山 `DELETE /api/v3/files/{file_id}` |

### 5.2 已知差异与坑

1. `file_id` 是 int64；JS 端统一按 string 透传。
2. 列出接口**无分页**，`purpose` 是唯一过滤维度且必填；大量文件时截断行为官方未声明。
3. 三个接口的 `purpose` 枚举互不相同（upload 5 项 / list 4 项 / delete 5 项），按 endpoint 维度声明，不能合并。
4. 官方文档自身 3 处矛盾（list description `t2a_async` vs enum、delete header multipart vs json、retrieve_content application/json vs binary），如实保留并标"待联调确认"。

## 6. 校验规则（validator `validateMinimaxHailuoMediaRequest`）

| 规则 | 触发 | 来源 |
| --- | --- | --- |
| image-01 允许 `subject_reference`（maxImages=1） | 允许 | image-edit-models.md §1 |
| image-01-live 不允许 `width/height` | 阻断 | image-models.md §1 |
| Hailuo-2.3 / -Fast 不允许 fl2v | 阻断（保守） | video-models.md §8 |
| 视频 prompt ≤ 2000 字符（v1） | 阻断 | video-models.md §5.1 |
| V2 text ≤ 7000 字符 | 阻断 | video-models-v2.md §4.2 |
| V2 i2v 与 r2v 互斥 | 阻断 | video-models-v2.md §4.3 |
| V2 r2v 不可仅音频 | 阻断 | video-models-v2.md §4.3 |
| 视频 Agent 模板 `templateId` 不在 11 项枚举 | 阻断 | video-templates.md §4 |
| 视频 Agent 模板需要 media/text 但未传 | 阻断 | video-templates.md §4 |
| 任何 base_resp 非 0（v1） | adapter 抛 `media.error.code` 映射错误 | auth-errors.md §2 |
| Files `purpose` 不在当前 endpoint 枚举内 | client 阻断 | files-api.md §2-5 |

## 7. 边界与有意保留

1. **WebSocket T2A / Voice Cloning / Voice Design / Music** 本轮不接入（§1.5）。
2. **S2V-01 的 `duration` / `resolution`** 官方未列出，manifest 省略，画布参数面板隐藏。
3. **视频 Agent 模板子属性面板**（`media_inputs[].name`、`text_inputs[].key`）官方未展开；本轮只支持 `{value}` 形态。
4. **3D 生成、AK/SK 管控面动态模型发现** 不在范围内。
5. **国际站**（`api.minimax.io`）本轮只接入国内站（`api.minimaxi.com`）。
6. **`file_id` int64 字符串透传** 必须在 manifest 注释 + client 类型签名双重强调。T2A Async `file_id` 是 int64、视频生成 `file_id` 是 string，跨通道不一致；统一按 string 透传。
7. **V2 (H3) `content[]` 数组**：adapter 按 §4.6 规则组装，强制 i2v 与 r2v 互斥。
8. **V2 OAI 风格错误响应**：HTTP 真实状态码，adapter 用本地 `minimaxV2ErrorExtractor`，不与 v1 共享 `minimaxErrorContract`。
9. **现有 `hailuo-2.3` manifest 的 `video.edit` 能力存疑**：文档无独立 edit 端点；本轮核实是否保留，保留则需 adapter 明确端点。

## 8. 落地文件清单

### 8.1 已落地文档（Phase 0，已完成）

| 文件 | 说明 |
| --- | --- |
| `docs/integrations/minimax/doc-map.md` | 入口 URL 总表 + 各子模块真实路径 |
| `docs/integrations/minimax/image-models.md` / `image-edit-models.md` | 文生图 / 图生图 |
| `docs/integrations/minimax/video-models.md` / `video-models-v2.md` | 视频生成 v1 4 场景 / V2 H3 |
| `docs/integrations/minimax/video-templates.md` | 视频 Agent 11 模板 |
| `docs/integrations/minimax/speech-music.md` | TTS / 克隆 / 设计 / 音乐（**本轮不开发，仅文档**） |
| `docs/integrations/minimax/files-api.md` | Files 5 接口 |
| `docs/integrations/minimax/auth-errors.md` | 鉴权 + 错误码 + 异步通道 |
| `docs/integrations/minimax/adapter-design.md` | 本文件 |

### 8.2 待开发代码（Phase 1-4）

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `packages/protocol/src/media-model-shared-manifest-parts.ts` | 改 | 扩展 minimax schema（`subject_reference` / `style` / fl2v / s2v / V2 content / 新增 `minimaxVideoTemplateSchema`） |
| `packages/protocol/src/media-model-manifest.ts` | 改 | 新增/扩展 12 个 manifest；v1/模板/Files manifest 挂 `error: minimaxErrorContract`；修正现有 5 个骨架的 `sourceUrls` |
| `packages/agent-runtime/src/services/media/adapters/minimax-hailuo-media.adapter.ts` | 新建 | adapter（`id: 'minimax-hailuo'`）；v1/V2/模板三套编译 + 双错误归一 + `inspect` 轮询 |
| `packages/agent-runtime/src/services/media/validators/minimax-hailuo-media.validator.ts` | 新建 | 函数式 validator |
| `packages/agent-runtime/src/services/media/minimax-hailuo-files.client.ts` | 新建 | Files upload/list/get/delete（仅上传链路） |
| `packages/agent-runtime/src/services/media/minimax-hailuo-media-input.ts` | 新建 | 角色 → minimax 字段映射（含 V2 `content[].role`） |
| `packages/agent-runtime/src/services/media/media-router.service.ts:102-121` | 改 | 注册 `new MinimaxHailuoMediaAdapter()` |
| `packages/agent-runtime/src/services/media/validators/media-validator.registry.ts` | 改 | 注册 `validateMinimaxHailuoMediaRequest` |
| **画布层** | **不改** | Path 1 零画布改动；`template_id` 经 paramSchema enum 自动渲染 |

## 9. 验证基线

- 所有新增 manifest 通过 `validateMediaModelManifestSemantics`（`media-model-manifest-validation.ts:52-122`）校验（该校验**不**检查 capability.id 白名单，`templateId` 不会触发失败）。
- `minimax-hailuo-media.adapter.test.ts` 覆盖：v1 t2v/i2v/fl2v/s2v 四场景请求体、V2 `content[]` 六场景 + i2v/r2v 互斥、模板 `template_id` 分流、v1 `base_resp` 错误归一、V2 OAI 错误归一、各通道 `inspect` 轮询、产物经 `MediaArtifactService` 下载、`file_id` string 透传。
- `minimax-hailuo-media.validator.test.ts` 覆盖：image-01/01-live 互斥、Hailuo duration/resolution、fl2v 阻断、V2 字符上限与互斥、模板 inputs 必填。
- `minimax-hailuo-media-input.test.ts` 覆盖：角色映射、本地文件 → Files 上传 → file_id。
- **不新建 `*.client.test.ts`**（与现有约定一致：files client 无独立单测，靠 adapter 集成测试覆盖）。
- protocol / agent-runtime / desktop TypeScript strict（根 `node node_modules/typescript/bin/tsc -p <pkg>/tsconfig.json`）。

## 10. 阶段计划与待决策项

### 10.1 阶段

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| Phase 0 | 文档采集 + 设计稿（含本轮三次复核） | ✅ 完成 |
| Phase 1 | 协议层：`media-model-shared-manifest-parts.ts` 扩展 schema + `media-model-manifest.ts` 新增 12 manifest + 挂 error contract | 待开始 |
| Phase 2 | agent-runtime：adapter + validator + files client + media-input 四件套 + 两处注册 | 待开始 |
| Phase 3 | 测试：adapter / validator / media-input 三类单测 | 待开始 |
| Phase 4 | typecheck + 联调（需 API Key 实测 3 处官方文档自相矛盾项） | 待开始 |

### 10.2 待用户决策（不阻塞 Phase 1，但 Phase 2 前需定）

1. **现有 `hailuo-2.3` manifest 的 `video.edit` 能力**：保留还是移除？文档无独立 edit 端点。
2. **V1 是否同时保留**：用户原话以 V2(H3) 为主推，v1 Hailuo 已降级。是否仍开发 v1 全系 8 个模型？（建议：保留，因 V2 仅 H3 一个模型、且 v1 的 i2v/live/director 系列 V2 无对应。）
3. **3 处官方文档矛盾**（需 API Key 实测）：异步语音文件上限（guide 10 万 / API 100 万字符）、`file_id` 类型（query string / download int64）、music 与 lyrics 结构标签枚举差异 —— 本轮按文档原文标注，不替官方选边。
4. **语音/音乐未来开发的路由机制**（本轮不做，先记录）：4 个语音端点同属 `audio.speech` 会致画布模型选择器重复，需新增 capability 或改路由。
