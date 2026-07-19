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
    polling: { intervalMs: 5000, timeoutMs: 600000 },
  },
  mediaModelRefs: [
    { manifestId: 'apimart:some-model', modelId: 'some-model', enabled: true },
  ],
}
```

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
