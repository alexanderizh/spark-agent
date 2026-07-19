# 多媒体模型与渠道配置指南

本文说明在 Spark-Agent 中新增多媒体模型、扩展已有渠道，以及接入全新多媒体渠道时需要修改的配置、代码和测试。

## 1. 三层配置

| 层级 | 内容 | 主要位置 |
| --- | --- | --- |
| Provider 渠道层 | 平台、调用方式、能力、默认值、启用模型 | packages/protocol/src/media-config.ts、Provider config_json |
| 模型能力层 | 模型 ID、参数枚举、默认值、输入输出、请求模板、结果路径 | packages/protocol/src/media-model-manifest.ts 及厂商 manifest |
| 运行时层 | 特殊鉴权、请求组装、文件上传、模型特有约束 | packages/agent-runtime/src/services/media/adapters/、validators/ |

不要把 modelIds 当成完整模型配置。modelIds 只是兼容性的模型 ID 列表；模型参数和请求契约应放在 MediaModelManifest。

## 2. 核心配置

### 2.1 Provider 配置

字段定义在：

packages/protocol/src/media-config.ts

典型配置：

~~~ts
{
  mediaProvider: 'bailian',
  mediaApiType: 'sync',
  mediaCapabilities: ['image.generate', 'image.edit'],
  mediaDefaults: {
    image: { size: '2K', n: 1 },
    polling: { intervalMs: 5000, timeoutMs: 600000 },
  },
  mediaModelRefs: [
    {
      manifestId: 'bailian:some-image-model',
      modelId: 'some-image-model',
      enabled: true,
    },
  ],
}
~~~

字段含义：

- mediaProvider：渠道 / adapter 类型。
- mediaApiType：sync、async 或 auto。
- mediaCapabilities：Provider 声明支持的能力。
- mediaDefaults：Provider 级默认值，优先级低于 capability.defaults。
- mediaModelRefs：当前 Provider 实际启用的 manifest 模型引用。

### 2.2 MediaModelManifest

类型和 schema 在：

packages/protocol/src/media-model-manifest.ts

参数配置在 capabilities[].paramSchema：

~~~ts
paramSchema: {
  type: 'object',
  additionalProperties: false,
  properties: {
    size: {
      type: 'string',
      title: '尺寸',
      enum: ['1K', '2K', '4K'],
      default: '2K',
    },
    n: {
      type: 'integer',
      title: '数量',
      minimum: 1,
      maximum: 4,
      default: 1,
    },
    watermark: {
      type: 'boolean',
      title: '水印',
      default: false,
    },
  },
},
defaults: {
  size: '2K',
  n: 1,
  watermark: false,
},
~~~

参数规则：

- enum：值枚举，驱动 UI 下拉和运行时枚举校验。
- type：参数类型。
- minimum / maximum：数值范围。
- minLength / maxLength：字符串长度范围。
- default / defaults：默认值。
- additionalProperties：是否允许未声明字段。
- aliases：规范字段名到 provider 原生字段名的映射。
- paramPolicy：严格模式、透传白名单、禁用字段、重命名、值转换、冲突处理。

推荐：

~~~ts
paramPolicy: {
  strict: true,
  passthrough: { enabled: false },
}
~~~

### 2.3 invocation

invocation 定义请求如何组装以及如何提取结果：

~~~ts
invocation: {
  mode: 'sync',
  endpoint: '/images/generations',
  method: 'POST',
  contentType: 'json',
  requestTemplate: {
    model: '{{modelId}}',
    prompt: '{{prompt}}',
    size: '{{size}}',
  },
  response: {
    kind: 'url',
    jsonPaths: ['data[].url'],
    download: true,
  },
}
~~~

异步轮询必须同时配置 task_poll、taskIdPaths、statusEndpoint、resultPaths 和 polling.statusMap。

## 3. 新增已有渠道下的模型

### 3.1 新增 manifest

按厂商放入对应文件：

- xAI：packages/protocol/src/xai-media-model-manifests.ts
- 阿里百炼：packages/protocol/src/bailian-media-model-manifests.ts
- 火山方舟：packages/protocol/src/volcengine-ark-media-model-manifests.ts
- 其他通用模型：packages/protocol/src/media-model-manifest.ts

新增 manifest 时确认：

1. id 全局唯一，通常使用 providerKind:modelId。
2. providerKind 和已有渠道一致。
3. modelId 与 provider 官方模型 ID 完全一致。
4. domains、capabilities、input、output 与真实能力一致。
5. paramSchema 的 enum、类型、范围和默认值来自官方文档。
6. invocation 的 endpoint、requestTemplate、response JSON 路径正确。
7. docs.sourceUrls 和 lastCheckedAt 已填写。

如果新模型和已有模型完全共用参数，可以复用 shared schema；如果只在一个模型上增加或减少字段，建议为该模型单独定义 schema，避免影响其他模型。

### 3.2 更新 Provider preset

文件：

packages/protocol/src/provider-presets.ts

例如百炼图片 preset 是 bailian-images。希望预设自动带出新模型时，同步更新：

~~~ts
modelIds: [
  'wan2.7-image-pro',
  'wan2.7-image',
  'new-image-model',
],
mediaModelRefs: [
  ...,
  {
    manifestId: 'bailian:new-image-model',
    modelId: 'new-image-model',
    enabled: true,
  },
],
~~~

不需要内置 preset 时，可以只新增 manifest，之后在 Provider 中手动绑定 mediaModelRefs。

修改 preset 不会自动修改已经保存的 Provider；已有 Provider 仍要重新勾选或手动补 mediaModelRefs。

### 3.3 检查专用 adapter

检查：

packages/agent-runtime/src/services/media/media-router.service.ts

如果已有 adapter 的 supports(capability) 返回 true，通常会优先走专用 adapter，manifest 的 requestTemplate 不一定真正控制线上请求。

## 4. 阿里云百炼新增生图模型

百炼专用实现：

packages/agent-runtime/src/services/media/adapters/bailian-media.adapter.ts

图片链路大致是：

~~~text
MediaRouterService
  -> BailianMediaAdapter
  -> generateImage()
  -> imageParameters()
  -> POST /multimodal-generation/generation
~~~

所以除了新增：

packages/protocol/src/bailian-media-model-manifests.ts

还必须检查 imageParameters：

1. size 允许哪些值。
2. n 的最大值。
3. 是否支持 4K。
4. 是否支持 color_palette、thinking_mode、enable_sequential 等字段。
5. 新参数是否进入 pick() 的最终字段白名单。
6. camelCase 是否需要在 normalizeBailianImageParams() 中转成 snake_case。
7. 请求 body 是否仍是 input.messages[].content[] 结构。
8. 返回 JSON 路径是否仍能被 extractImages() 识别。

当前 adapter 会硬编码筛选最终字段。新模型如果增加 style，仅在 manifest 中声明还不够；必须将 style 加入 adapter 的字段白名单，否则不会发给百炼。

## 5. 参数校验和 validator

普通参数由：

packages/agent-runtime/src/services/media/media-request-compiler.ts

统一处理：

- 类型、enum、数值范围、字符串长度。
- 字符串数字和布尔值的基础转换。
- Provider 默认值与 capability 默认值合并。
- aliases、transforms、conflicts。
- strict、passthrough、forbidden 过滤。

模型特有规则需要手动写，例如：

- 某模型只支持文生图。
- 最多支持 1 张参考图。
- 某尺寸只能配合某质量档位。
- 某参数与组图模式互斥。

validator 目录：

packages/agent-runtime/src/services/media/validators/

注册表：

packages/agent-runtime/src/services/media/validators/media-validator.registry.ts

百炼当前没有独立的 bailian-media.validator.ts，部分规则直接写在 bailian-media.adapter.ts。若希望 canvas preflight 阶段就报错，可以新增百炼 validator 并在 registry 注册。

职责建议：

- validator：输入数量、能力组合、模型限制、参数互斥。
- adapter：参数归一化、请求字段组装、文件上传、响应解析。
- manifest：参数 schema、枚举、默认值、UI 描述、请求模板。

注意：input.required 表示 prompt/image/video 等输入媒体类型要求，不等价于 modelParams 某字段必填。真正必填的参数应通过默认值、validator 或 adapter 明确处理。

## 6. 新增全新渠道 / 平台

### 6.1 协议层

修改：

packages/protocol/src/media-config.ts

同步增加：

1. MediaProviderKind union。
2. MEDIA_PROVIDER_KINDS。
3. 如果是新能力，再增加 MediaCapabilityId 和 MEDIA_CAPABILITY_IDS。
4. 检查相关 Zod schema、类型守卫和能力映射。

如果只是新增模型，不要修改这里；新增 model ID 不需要新增 MediaProviderKind。

### 6.2 Manifest 层

新增该平台的模型 manifest，配置：

- providerKind、modelId、domains。
- capabilities、input、output。
- paramSchema、defaults、aliases、paramPolicy。
- invocation、response、polling。
- docs、error、safety。

标准 JSON 请求优先复用 TemplateMediaAdapter；特殊协议再写专用 adapter。

### 6.3 Adapter 层

新增：

packages/agent-runtime/src/services/media/adapters/foo-media.adapter.ts

实现 MediaProviderAdapter，并确认：

- id 与 MediaProviderKind 一致。
- supports(capability) 正确。
- URL、headers、鉴权正确。
- 输入文件处理正确。
- 同步/异步任务处理正确。
- 结果能落盘为 image/audio/video/text asset。
- provider 错误能转成 MediaProviderError。

然后在 MediaRouterService 构造函数中注册：

~~~ts
this.register(new FooMediaAdapter())
~~~

### 6.4 Validator 层

如果平台有特殊限制，新增 foo-media.validator.ts，并在 media-validator.registry.ts 注册 foo-media。

### 6.5 UI 和 preset 层

检查：

apps/desktop/src/renderer/design/views/ProvidersView.tsx

通常需要更新：

- MEDIA_PROVIDER_LABELS：显示名称。
- USABLE_MEDIA_PROVIDER_KINDS：平台下拉白名单。
- SUPPORTED_IMAGE_VIDEO_MEDIA_PROVIDERS：图片/视频白名单。
- preset 筛选逻辑。

如果需要一键创建渠道，再更新 packages/protocol/src/provider-presets.ts。

## 7. 持久化、seed 和 resolver

相关文件：

- packages/agent-runtime/src/services/media/media-model-catalog.service.ts
- packages/agent-runtime/src/services/media/media-model-resolver.ts
- packages/storage/migrations/033_media_model_manifests.sql

新增内置 manifest 通常不需要新 migration。应用启动时会把内置 manifest upsert 到 SQLite。

注意：

- 新增 manifest 后，旧 Provider 不会自动添加新的 mediaModelRefs。
- 如果 Provider 已配置 mediaModelRefs，resolver 会严格以 refs 为准，不会再用 modelIds 补模型。
- 新模型必须被 Provider Profile 启用，才会出现在画布和 MCP 的可用模型列表。

## 8. 校验机制与专用 adapter 注意事项

Manifest 结构校验由 MediaModelManifestSchema 负责。

语义校验由：

packages/protocol/src/media-model-manifest-validation.ts

中的 validateMediaModelManifestSemantics() 负责，检查：

- async_polling 是否配置 task_poll。
- 是否配置 polling。
- requestTemplate 模板变量是否存在。
- defaults 是否符合 paramSchema。
- paramPolicy 是否自相矛盾。
- error contract 路径是否合法。

当 provider 已注册专用 adapter 且支持当前 capability 时，router 会优先调用专用 adapter。此时 manifest 仍用于模型目录、参数面板、capability 匹配和 preflight，但实际请求 body 可能由 adapter 手动组装。

## 9. 测试清单

新增模型至少覆盖：

1. manifest 能通过 MediaModelManifestSchema。
2. semantic validation 无错误。
3. defaults 能通过 compiler。
4. enum、类型、范围错误能被识别。
5. 请求中的 model、参数字段、endpoint 正确。
6. 异步模型能解析 task id、状态和结果 URL。
7. 返回结构能正确提取图片、视频或音频。
8. 模型特有限制能返回明确错误。
9. preset 的 modelIds 和 mediaModelRefs 一致。

常用测试位置：

- packages/protocol/src/__tests__/media-model-manifest-validation.test.ts
- packages/protocol/src/__tests__/custom-media-manifest.test.ts
- packages/protocol/src/__tests__/provider-presets.test.ts
- packages/agent-runtime/src/__tests__/services/media/media-request-compiler.test.ts
- packages/agent-runtime/src/__tests__/services/media/media-built-in-validation-consistency.test.ts
- packages/agent-runtime/src/__tests__/services/media/media-adapters.test.ts

## 10. 最终检查清单

### 新增已有渠道下的模型

- [ ] 新增或修改厂商 manifest。
- [ ] 配置唯一 id、modelId、能力、输入输出。
- [ ] 配置 paramSchema 的参数、类型、枚举、范围。
- [ ] 配置 defaults、aliases、paramPolicy。
- [ ] 配置 endpoint、requestTemplate、response；异步模型补 polling。
- [ ] 检查专用 adapter 是否覆盖 manifest 请求逻辑。
- [ ] 如有模型特有约束，修改 adapter 或 validator。
- [ ] 如需预设自动包含，更新 provider-presets.ts。
- [ ] 为已有 Provider 更新 mediaModelRefs。
- [ ] 补 manifest、compiler、adapter、validator、preset 测试。

### 新增全新渠道

- [ ] 修改 MediaProviderKind 和相关枚举。
- [ ] 新增 manifest。
- [ ] 判断是否可使用 TemplateMediaAdapter。
- [ ] 必要时新增并注册专用 adapter。
- [ ] 必要时新增并注册 provider validator。
- [ ] 更新 Provider UI label 和可用白名单。
- [ ] 新增 vendor/preset。
- [ ] 补请求、轮询、错误、文件和结果处理测试。
