# 多媒体模型渠道配置经验

> 记录日期: 2026-07-18
> 适用范围: 多媒体 Provider、MediaModelManifest、画布参数面板、spark_media MCP

## 一、先判断要改哪一层

多媒体配置分为三层，不能把 `modelIds` 当成完整模型配置：

1. **渠道层（Provider Profile）**：配置 `mediaProvider`、`mediaApiType`、`mediaCapabilities`、`mediaDefaults`、`mediaModelRefs`。
2. **模型能力层（MediaModelManifest）**：配置模型支持的能力、输入/输出、参数 schema、默认值、请求模板和结果提取。
3. **运行时层（Adapter / Validator）**：只有协议特殊或存在模型特有业务限制时才需要修改。

判断规则：

- 同一已有渠道、同样的 JSON 请求/URL 或 base64 返回协议：优先只加 manifest。
- 标准 JSON 提交 + 可选轮询 + URL/base64/binary 产物：通常可使用 `TemplateMediaAdapter`，无需新增 adapter。
- multipart、嵌套 content 数组、特殊鉴权、文件上传、回调、取消任务等：需要专用 adapter。
- 只接一个用户自定义 OpenAI 兼容图片/视频模型：可直接在 Provider UI 添加自定义模型并编辑 inline manifest，不必先改源码。

## 二、核心配置位置

### 1. 模型参数、枚举和请求契约

主入口：`packages/protocol/src/media-model-manifest.ts`

- `MediaModelManifest` / `MediaModelCapabilityManifest` 类型。
- `MediaModelManifestSchema`：manifest 结构 Zod 校验。
- `BUILTIN_MEDIA_MODEL_MANIFESTS`：内置模型清单。
- 每个 capability 的 `paramSchema.properties.<name>` 定义参数。
- `enum` 定义值枚举；`type`、`minimum`、`maximum`、`minLength`、`maxLength` 定义基础校验。
- `defaults` 定义能力级默认值。
- `aliases` 定义内部字段名到 provider 原生字段名的映射。
- `paramPolicy` 定义 strict、passthrough、forbidden、rename、map_value、conflicts 等契约。
- `invocation` 定义 endpoint、method、contentType、requestTemplate、response 和轮询。
- `docs.sourceUrls` 记录供应商文档来源。

模型清单也按厂商拆分在：

- `packages/protocol/src/xai-media-model-manifests.ts`
- `packages/protocol/src/bailian-media-model-manifests.ts`
- `packages/protocol/src/volcengine-ark-media-model-manifests.ts`
- `packages/protocol/src/media-model-shared-manifest-parts.ts`

### 2. Provider 渠道枚举和默认值

入口：`packages/protocol/src/media-config.ts`

- `MediaProviderKind` / `MEDIA_PROVIDER_KINDS`
- `MediaApiType` / `MEDIA_API_TYPES`
- `MediaCapabilityId` / `MEDIA_CAPABILITY_IDS`
- `ProviderMediaDefaults` / `ProviderMediaDefaultsSchema`

Provider 配置常见字段：

```ts
{
  mediaProvider: 'apimart',
  mediaApiType: 'auto',
  mediaCapabilities: ['image.generate', 'image.edit'],
  mediaDefaults: {
    image: { size: '1:1', n: 1 },
    timeoutMs: 600000,
    polling: { intervalMs: 5000 },
  },
  mediaModelRefs: [
    { manifestId: 'apimart:some-model', modelId: 'some-model', enabled: true },
  ],
}
```

`mediaDefaults.timeoutMs` 是 Provider 级统一接口超时，同步请求、异步任务提交、轮询总时限、单次轮询请求和结果下载都必须遵守。`mediaDefaults.polling.intervalMs` 只控制轮询间隔。历史 `mediaDefaults.polling.timeoutMs` 仅作为兼容回退读取，新配置不要继续写入旧字段。

### 3. 内置预设和模型列表

入口：`packages/protocol/src/provider-presets.ts`

新增模型想随某个预设自动出现时，同时更新对应 preset 的：

- `modelIds`：旧兼容路径和默认模型列表。
- `mediaModelRefs`：真正启用的 manifest 引用。
- `mediaCapabilities`、`mediaDefaults`：渠道级能力和默认值。

如果 Provider 已经通过 `mediaModelRefs` 绑定模型，resolver 会严格以 refs 为准，不会再用 `modelIds` 补模型。

### 4. 目录、持久化和解析

- `packages/agent-runtime/src/services/media/media-model-catalog.service.ts`：内置 manifest seed 到 SQLite，提供 list/describe/link/upsert。
- `packages/agent-runtime/src/services/media/media-model-resolver.ts`：将 Provider Profile 解析成画布/MCP 可用模型。
- `packages/storage/migrations/033_media_model_manifests.sql`：`media_model_manifests` 和 `media_provider_models` 表。

## 三、参数校验是否要手动配置

### 普通参数：不用另写 validator

`packages/agent-runtime/src/services/media/media-request-compiler.ts` 会统一执行：

- 类型、enum、数值范围、字符串长度校验。
- 字符串数字和布尔值的基础转换。
- Provider 默认值与 capability 默认值合并。
- aliases、transforms、conflicts、strict/passthrough、forbidden 处理。

因此新增普通参数时，通常只需修改 `paramSchema`，并按推荐方式声明：

```ts
paramPolicy: {
  strict: true,
  passthrough: { enabled: false },
}
```

如果没有 `paramPolicy`，编译器会根据 `additionalProperties` 推断兼容模式，并可能给出 `missing_param_policy` 警告；未声明字段可能被透传到 provider，风险较高。

### Manifest 结构和语义：已有自动校验

- `MediaModelManifestSchema` 检查结构。
- `validateMediaModelManifestSemantics()` 检查：异步轮询契约、模板变量、默认值、paramPolicy、错误路径等。
- Provider UI 编辑 inline manifest 时会执行 Zod + semantic 双重校验。

### Provider/模型特有规则：需要手动补

通用 compiler 不能表达的规则，需要写专用 validator，例如：

- 首帧/尾帧数量限制。
- 参考图、参考视频、参考音频的互斥关系。
- 特定模型允许的时长、分辨率、素材大小。
- 某模型禁止某个参数组合。

入口：`packages/agent-runtime/src/services/media/validators/`

注册表：`media-validator.registry.ts`

运行时顺序是通用校验 + `mediaProviderValidator(providerKind)`。同一渠道新增普通模型通常不需要新增 validator；新增模型有特殊限制时，在现有 provider validator 中按 `modelId` 增加分支即可。

注意：`paramSchema.input.required` 表示输入媒体类型（如 prompt/image）要求，不等价于“某个 modelParams 字段必填”。不要假设 JSON Schema 的 `required` 会自动形成完整参数必填校验；必须强制存在的字段应通过默认值、通用输入校验或 provider validator 明确处理。

## 四、增加模型的推荐流程

### A. 已有渠道新增普通模型

1. 查供应商文档，确认 model id、能力、输入输出、请求/响应协议。
2. 在 manifest 清单中新增唯一 `id` 和 `modelId`。
3. 配置 capability、`paramSchema` 枚举/范围、defaults、aliases、paramPolicy。
4. 配置 invocation：endpoint、requestTemplate、response；异步模型补 task_poll 和 polling。
5. 如需内置预设，补 `provider-presets.ts` 的 `modelIds` 和 `mediaModelRefs`。
6. 如果有模型特有约束，再改 provider validator；如果协议不兼容，再改/注册 adapter。
7. 补 manifest、compiler、validator、adapter 相关测试。

### B. 通过 UI 添加自定义模型

1. 配置 Provider 的 endpoint、API key、`mediaProvider`、`mediaApiType`、能力和默认模型。
2. 添加自定义 model id。
3. 打开自定义 manifest 编辑器，补齐参数 schema、请求模板、轮询和结果 JSON 路径。
4. 保存时 UI 会执行 manifest 结构和语义校验；可用 dry-run 预览参数裁剪/透传结果。

`packages/protocol/src/custom-media-manifest.ts` 提供图片/视频 JSON 接口的基础 manifest 模板。它适合简单 sync/async 接口；语音或特殊协议通常需要手动完善 manifest。

## 五、全新渠道/平台的额外改动

如果不是新增模型，而是新增 `MediaProviderKind`，还要检查：

1. `media-config.ts` 的 union、枚举数组和 Zod schema。
2. `MediaRouterService` 的 adapter 注册。
3. 是否需要专用 adapter；普通 JSON 协议可优先复用 TemplateMediaAdapter。
4. `media-validator.registry.ts` 是否需要新 validator。
5. `ProvidersView.tsx` 的渠道 label、可用白名单和 preset 筛选。
6. `provider-presets.ts` 的厂商/preset 元数据。
7. adapter、validator、manifest 和 IPC/画布链路测试。

## 六、排查要点

- UI 没有参数下拉：先检查 `mediaModelRefs` 是否绑定正确 manifest，再检查 `paramSchema.properties` 是否含 `enum` 或 `default`。
- 参数被丢弃：检查 `paramPolicy.strict`、`passthrough.allow/deny`、`forbidden` 和 aliases。
- 请求发错字段：检查 `aliases`、`paramPolicy.aliases`、`transforms` 以及 adapter 是否绕过 manifest。
- 异步任务无法完成：检查 `invocation.response.kind === 'task_poll'`、task id 路径、statusEndpoint、statusMap 和 polling。
- 新模型配置了 manifest 但仍走旧逻辑：检查专用 adapter 是否按 modelId 写了分支，以及 router 是否优先使用专用 adapter。
- 自定义模型没有精确参数能力：resolver 在缺少 manifest 时可能用同 provider 的代表性内置 manifest 合成；要获得准确参数 schema，应配置 inline manifest。

## 七、提示词长度校验原则

- `safety.maxPromptLength` 只表示 Provider 文档参考阈值，不得在本地作为硬阻断依据。
- 同时记录 `promptLengthUnit`（字符、Token 或 Provider 特有口径）和 `promptOverflowBehavior`（截断、拒绝或未知）。没有 tokenizer 时不能把 Token 阈值按 JavaScript 字符数精确校验。
- Provider 文档未明确给出阈值时不要猜测；历史兼容值即使暂时保留，也只能产生 advisory warning。
- 专用 validator/adapter 不要重复实现长度硬限制。确定性的缺参、输入格式和文件访问安全问题可以继续阻断。
- 画布媒体 prompt 使用 protocol 的共享拼接器，预检与执行必须保持同一拼接口径，并去除 System/User 中已逐字包含的文本引用正文。

## 八、普通会话的多 Provider 模型路由

- 普通 Agent 会话不能只把第一个媒体 Provider 的 key、endpoint 和默认模型注入 `spark_media`；否则 `list_models` 即使能展示其他模型，生成请求也无法切换渠道。
- 会话运行时通过 `SPARK_MEDIA_PROVIDERS_JSON` 聚合所有启用且凭据可用的媒体 Profile。每条路由包含 Profile ID、Provider kind、默认模型、API key、base URL、默认参数与 manifests；凭据只存在本地 MCP 子进程环境。
- `list_models` 返回 `providerProfileId`、`providerName` 与 `selectionKey`。显式模型选择优先使用 `selectionKey`，唯一 modelId 也可用；同名模型跨 Profile 冲突时必须报歧义，不能挑第一个。
- 生成工具收到显式 `model` 后，必须同时切换所属 Profile 的凭据、endpoint、adapter 和 manifest，并校验该模型确实支持目标 capability；未知或不支持的模型不能回退到默认模型。
- 未指定模型时才允许按配置顺序选择第一个支持目标 capability 的默认模型，以保持兼容。
- 只要统一 `spark_media` 可用，普通会话不应同时注入固定单模型的旧 `spark_image`，避免 Agent 被两套相互冲突的提示词误导；旧工具仅作为无法解析统一媒体配置时的兜底。

## 九、平台受管模型的标签映射

- Spark 平台的 NewAPI Provider 同时承载文本模型和多媒体模型时，不能把 `model:image` 条目写入文本 `modelIds`，否则会污染聊天模型选择器。
- 平台目录标签使用 `model:image` 声明图片域，使用 `<adapter>:<template-model-id>` 引用应用内已有 Manifest，例如 `openai:gpt-image-2`。
- 平台 `model_name` 是实际发送给网关的模型 ID；模板模型 ID 只负责参数 schema、校验、能力和适配器选择，二者不得互换。
- 映射生成 template-backed `mediaModelRefs`。Resolver 克隆模板并覆盖 manifest id、modelId 和显示名，允许多个平台别名复用同一个内置模板。
- 克隆 Manifest 必须保留 `adapterModelId`（模板的真实 modelId）：`modelId` 用于发给平台，`adapterModelId` 用于 Canvas validator/native adapter 与 `spark_media` skill 的模型专属行为判断。
- 只有 `managedType=newapi` 的受管 Provider 才按命中 Manifest 的 `providerKind` 选择已有适配器；普通 Provider 保持渠道级适配器逻辑。
- 文本 Anthropic SDK 使用平台根地址，多媒体适配器使用平台 `/v1` 地址，因此受管配置需要分别保存 `apiEndpoint` 与 `mediaApiEndpoint`。
- 平台受管图片模型只复用目标适配器的参数、校验和响应处理，不继承供应商官方请求路径；统一通过 NewAPI 的 `/images/generations` 与 `/images/edits` 入口调用。该路径覆盖必须以 `managedType=newapi` 为边界，普通自定义 Provider 保持原生路径。
- `spark_media` 路由对受管平台渠道写入 `adapterFromManifest=true`，并把首个有效平台媒体模型设为媒体默认；普通渠道不得因此改写原有默认模型。

## 十、自定义适配器协议基底

- `MediaModelManifest.baseTemplate` 只记录编辑器使用的协议基底（完全自定义、OpenAI 兼容、通用异步或渠道预置），运行时仍以完整 Manifest 为准；该字段必须保持可选，保证历史配置无需迁移即可继续运行。
- 协议基底不是一次性示例。用户选择后要写回 Manifest 并稳定回显；再次编辑请求路径、参数或响应映射时，不能根据内容猜测并覆盖已保存的选择。
- OpenAI 兼容基底按媒体域生成完整合同：图片生成使用 `/images/generations` JSON 请求，图片编辑使用 `/images/edits` multipart 请求，视频使用 `/videos` 异步轮询，语音合成使用 `/audio/speech` 二进制响应。接口路径相对 Provider 的 `/v1` base URL 配置。
- 轮询成功后仍需单独下载产物的渠道使用可选 `task_poll.artifact`：请求可引用 `{{taskId}}` 和 `{{poll.xxx}}`，响应可配置 URL、Base64 或二进制。OpenAI 视频必须在任务完成后请求 `/videos/{{taskId}}/content`，不能把轮询 JSON 当作视频产物。
- Contract V2 的 `invocation.request` 是实际编译入口，但编辑器修改请求时必须同步更新 legacy 的 endpoint/method/contentType/requestTemplate 镜像，避免旧读取链路和调试信息出现不一致。
- JSON 表单编辑器必须保留尚未完成或暂时非法的本地草稿并显示错误，不能因父级受控回显把输入恢复为旧值。

## 十一、Agent 对话配置自定义渠道

- Agent 配置应用未内置的媒体渠道时，优先使用 `providers_media_guide`、`providers_media_validate`、`providers_media_configure`、`providers_media_discover_models` 和 `providers_media_diagnose`。
- 固定流程是：收集渠道/模型/能力/鉴权/官方文档 → 使用 `spark_search` 读取真实文档 → 生成完整 Contract V2 → 只读校验和脱敏请求预览 → 保存 → 分阶段诊断。
- 同一模型名可存在于多个自定义 Provider；跨渠道身份由 Provider Profile ID 与渠道唯一 Manifest ID 共同确定。Agent 不负责拼接 ID：可省略 `manifest.id`，由 validate/configure 按渠道身份稳定生成、修复冲突或保留历史 ID，并通过 `resolvedModels` 回传。
- Manifest 迁移运行在结构校验之前，必须能容忍缺失 `invocation`、`response` 等畸形草稿并交给 Schema 返回字段级错误，不能泄漏 `Cannot read properties of undefined` 一类实现异常。
- API Key 只在最终保存、模型发现或真实诊断时传入 ProviderService，进入系统 Keychain；工具返回、请求预览、异常和日志都不能包含明文。
- `providers_media_diagnose.execute` 复用画布的 MediaRouterService，因此可验证实际适配器、参数编译、请求、轮询和产物解析。真实调用可能计费，必须先取得用户明确同意并设置 `confirmExecute=true`。
- Agent 只能把官方文档明确声明的参数、枚举、状态映射和结果路径写入 Manifest。文档 URL 写入 `docs.sourceUrls`，便于后续协议漂移复核。

## 十二、MiniMax 音频闭环（speech / music）

- MiniMax v1 通道的 audio.speech（T2A `POST /v1/t2a_v2`）/ audio.music（`POST /v1/music_generation`）必须接入专用 adapter（`MinimaxHailuoMediaAdapter`），不能依赖 manifest 的 `requestTemplate` 兜底：template adapter 路径不会执行 `assertMinimaxBaseResp`，导致「HTTP 200 + `base_resp.status_code` 非 0」的业务错误（1004 鉴权 / 1026 敏感 / 2013 参数等）检测不到，用户拿到空响应或误导性成功。这是上一轮移除 minimax audio preset 的根因；专用 adapter 内主动 `assertMinimaxBaseResp` 后根因消除。
- audio 产物双路径由 `output_format` 决定：`url`（默认）时 `data.audio` 是下载链接（24h），复用 `downloadMediaAsset`；`hex` 时 `data.audio` 是 16 进制字符串，用 `Buffer.from(hex,'hex')` + `writeBinaryAsset` 落盘。T2A 与 Music 响应形态一致（`data.audio` 在 url/hex 下承载不同内容）。
- `voice_id` 必填但不硬枚举（300+ 系统音色 + 动态复刻/文生音色）：schema 字段名用 `voice`（description 引导），adapter 映射到官方 `voice_setting.voice_id`；缺失时用 provider `mediaDefaults.audio.voice`（preset 默认 `male-qn-qingse`，官方示例音色）兜底，再缺失则 `invalid_input` 报错。
- base_resp 错误码子集按接口不同：T2A HTTP 不含 1008 余额、1026 敏感（含 1004/1039/1042/2013）；Music 含 1008/1026。统一走 `MINIMAX_V1_ERROR_MAP` 归一，未覆盖码兜底 `provider_http_error`。`1042`（非法字符>10%）尚未映射，可后续补 `invalid_parameter_value`。
- manifest capability `defaults.output_format` 与 schema `default` 必须一致（统一 `url`），否则编辑器回显与运行时默认分歧。music 的 `audio_setting.format` 仅 `mp3/wav/pcm`（无 flac），与 T2A 的 `mp3/pcm/flac/wav/pcmu_raw/pcmu_wav/opus` 不同。
