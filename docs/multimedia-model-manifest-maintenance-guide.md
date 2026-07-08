# 多媒体模型 Manifest 维护手册

本手册描述如何在 Contract V2 体系下**录入新模型**、**更新模型字段**、**更新参数定义**、**更新枚举值**。读者包括人类维护者与 AI Agent。

> 状态: 已落地 | 最后核对: 2026-07-05

## 0. 适用范围

- 录入或修改 `MediaModelManifest`（包括 `capabilities` / `paramSchema` / `paramPolicy` / `error`）。
- 修改 `packages/agent-runtime/src/services/media/media-request-compiler.ts` 中的归一/转换规则。
- 修改各 `adapters/*-media.adapter.ts` 中与 manifest 直接相关的字段映射。

**不在本手册范围**：
- 新增 provider 适配器（走 [`multimedia-model-platform-adapters-design.md`](./multimedia-model-platform-adapters-design.md)）。
- 新增 IPC 通道或 MCP 工具（走各自的设计文档）。
- 数据库 schema 变更（走 `apps/desktop/src/main/db/migrations/`）。

## 1. 关键文件与角色

| 文件 | 角色 |
| --- | --- |
| `packages/protocol/src/media-model-manifest.ts` | `MediaModelManifest` 类型与 Zod schema；`BUILTIN_MEDIA_MODEL_MANIFESTS` 内置清单（唯一注册入口） |
| `packages/protocol/src/media-model-contract.ts` | Contract V2 类型：`CanonicalMediaParamName` / `MediaModelParamPolicy` / `MediaErrorContract` / `MediaParamTransformRule` |
| `packages/protocol/src/media-model-manifest-validation.ts` | `validateMediaModelManifestSemantics`：模板变量、async/polling 配对、default 与 schema 对齐、paramPolicy 内部一致性 |
| `packages/agent-runtime/src/services/media/media-request-compiler.ts` | `compileMediaRequest`：所有调用方（adapter / canvas / MCP）共用的参数编译器。包含 `CANONICAL_ALIASES_FALLBACK` 兜底表 |
| `packages/agent-runtime/src/services/media/media-error-normalizer.ts` | 错误归一实现，按 `MediaErrorContract` 把 provider 响应翻译为 `MediaProviderError` |
| `packages/agent-runtime/src/services/media/adapters/*.ts` | 平台适配器；通过 `ctx.mediaManifest` 读取 manifest，通过 `ctx.mediaManifestCapability` 读取当前 capability |
| `apps/desktop/src/renderer/design/components/ProviderManifestContractEditor.tsx` | Manifest 结构化编辑器（capability / paramPolicy / errorContract） |
| `apps/desktop/src/renderer/design/views/ProvidersView.tsx` | 内联清单 dry-run 预览（IPC: `canvas:media:prune-model-params-by-inline-manifest`） |

**核心原则**：参数差异尽量留在 manifest 里。仅在以下情形才需要改 adapter：
1. 平台协议特殊（multipart、自定义鉴权、签名、回调）。
2. 同一 provider 不同模型的差异无法用 `paramPolicy.transforms` 表达（极少见）。

## 2. Manifest 字段速查

### 2.1 顶层结构（`MediaModelManifest`）

```ts
{
  id: string                      // 全局唯一，建议格式 '<providerKind>:<modelId>'
  providerKind: string            // 与 MediaRouterService 注册的 adapter id 一致
  modelId: string                 // 调用 provider 时实际发送的 model 字段
  displayName: string
  version?: string
  domains: MediaDomain[]          // 'image' | 'audio' | 'video' | 'text' | 'document' | 'web' | 'slide' | 'sheet'
  capabilities: Capability[]      // 至少 1 条，最多 50 条
  invocation: { ... }             // 见 2.2
  docs: { sourceUrls: string[]; lastCheckedAt?: string; docMcp?: { serverName; toolName } }
  safety?: { maxPromptLength?; allowLocalFiles?; maxInputBytes? }
  error?: MediaErrorContract      // Contract V2 错误归一规则
}
```

**Zod 长度上限**（超出会在 `MediaModelManifestSchema.parse` 时报错）：
- `id` ≤ 160，`providerKind` ≤ 120，`modelId` ≤ 200，`displayName` ≤ 200
- `domains` 1..20，`capabilities` 1..50
- `docs.sourceUrls` ≤ 50 条，单条 ≤ 800 字符

### 2.2 `invocation` 调用与响应

```ts
invocation: {
  mode: 'sync' | 'async_polling' | 'async_callback' | 'stream' | 'file_job'
  endpoint: string                // 支持 {{modelId}} / {{prompt}} / 各 paramSchema 字段占位
  method: 'GET' | 'POST'
  contentType: 'json' | 'multipart' | 'binary'
  headers?: Record<string, unknown>
  requestTemplate: Record<string, unknown>
  response: MediaArtifactRetrieval
  polling?: { intervalMs; timeoutMs; statusMap; retry? }   // mode=async_polling 时必填
}
```

`response` 四种形态（互斥）：

| kind | 用途 | 必填字段 |
| --- | --- | --- |
| `inline_base64` | 同步响应里直接含 base64 | `jsonPaths` |
| `url` | 同步响应里返回 URL，可选下载 | `jsonPaths`, `download` |
| `task_poll` | 异步：先取 task_id，再轮询 | `taskIdPaths`, `statusEndpoint`, `resultPaths` |
| `binary_response` | 整个响应体即二进制媒体 | — |

**`async_polling` 强约束**：`response.kind` 必须 = `task_poll`，且必须配置 `polling`。`validateMediaModelManifestSemantics` 会拒绝违反的清单。

`polling.timeoutMs` 上限 172_800_000（48 小时），与火山方舟异步视频对齐。`intervalMs` 范围 [250, 300_000]。

### 2.3 `capability` 能力定义

```ts
{
  id: 'image.generate' | 'image.edit' | 'video.generate' | ...   // 允许 string，但应取标准枚举
  label: string                   // 中文，UI 展示
  input: {
    required: ('prompt' | 'image' | 'images' | 'video' | 'audio' | 'mask' | 'text' | 'file')[]
    maxImages?: number            // 1..64
    acceptedMimeTypes?: string[]
  }
  output: {
    types: ('image' | 'video' | 'audio' | 'text' | 'file')[]
    mimeTypes?: string[]
  }
  paramSchema: Record<string, unknown>    // JSON Schema，见 §2.4
  defaults?: Record<string, unknown>
  aliases?: Record<string, string>        // canonical -> provider 原生字段名
  paramPolicy?: MediaModelParamPolicy      // Contract V2 参数策略
}
```

### 2.4 `paramSchema` 规范

- 必须是 JSON Schema object（`type: 'object'`），含 `properties`。
- `additionalProperties` 决定 compiler 兼容模式下的行为：
  - `false` → 未声明字段被裁掉（`unsupported_by_model`）。
  - `true` → 未声明字段在 `paramPolicy.strict !== true` 时按兼容透传处理。
- 字段名建议用 canonical camelCase（`aspectRatio`、`outputFormat`、`responseFormat`、`durationSeconds`、`generateAudio`、`returnLastFrame`、`searchEnabled`、`negativePrompt` 等）。Provider 原生 snake_case 字段通过 `CANONICAL_ALIASES_FALLBACK` 自动归一；显式声明可读性更好。
- 每个字段应包含 `type`、`title`（中文 UI 标签）；枚举字段必须用 `enum`；数值字段标 `minimum` / `maximum` / `default`。
- **推荐值 + 范围内自定义**：字段需要既给推荐下拉、又允许范围内自定义输入时（如 Seedream 的 `size`：方式1 分辨率档 + 方式2 任意「宽x高」像素值），在字段定义里加 `'x-allow-custom': true`。前端 `schemaFields`（`CanvasInlineAiComposer.tsx`）识别该标记后渲染为 antd `AutoComplete`（推荐值下拉 + 自由输入），而非强下拉 `Select`。`description` 里应写清自定义范围，供用户参考。详见 §6.4。

### 2.5 `paramPolicy` Contract V2 字段

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `strict` | boolean | `true` = 只放行 schema.properties + passthrough.allow 中的字段 |
| `passthrough.enabled` | boolean | 是否允许兼容透传 |
| `passthrough.allow` | string[] | 显式白名单（聚合平台用） |
| `passthrough.deny` | string[] | 永远丢弃，即使 schema 声明过 |
| `passthrough.allowScalarsOnly` | boolean | 仅允许标量透传（默认 true） |
| `aliases` | Record<string,string> | canonical -> provider 原生，与 `capability.aliases` 互补 |
| `transforms` | TransformRule[] | 见 §5.3 |
| `forbidden` | { name; reason }[] | 强制裁剪并记录 `forbidden_by_contract` |
| `conflicts` | { fields[]; strategy }[] | `prefer_first` / `prefer_last` / `error` |
| `conditionals` | ConditionalRule[] | 按 input_kind / capability / model_id 动态裁剪 |

**语义校验陷阱**：`forbidden` 的 `name` 必须出现在 `paramSchema.properties` 或 `aliases` 中，否则 `validateMediaModelManifestSemantics` 报 `invalid_param_policy`。这是为了防止拼写错误的 forbidden 静默失效。

### 2.6 `error` Contract V2 错误归一

```ts
error: {
  codePaths: ['error.code', 'error.type', 'status']      // 按顺序尝试，第一个非空即采用
  messagePaths: ['error.message', 'message']
  requestIdPaths: ['request_id', 'task_id', 'id']
  paramNamePaths: ['error.param']                         // 结构化参数名
  paramNamePatterns: ['parameter[:\\s]+`?([a-z_]+)`?']    // 兜底正则（从 message 抽）
  mappings: {                                             // provider code -> 内部 code
    invalid_api_key: 'auth_failed',
    invalid_request_error: 'invalid_parameter_value',
    rate_limit_exceeded: 'rate_limited',
    FAILED: 'task_failed'
  }
  retryableCodes: ['rate_limit_exceeded', 'service_unavailable']
}
```

**内部 code 枚举**（`MediaNormalizedErrorCode`）共 12 个：`unsupported_parameter` / `invalid_parameter_value` / `missing_required_input` / `auth_failed` / `quota_exceeded` / `rate_limited` / `content_policy_blocked` / `task_failed` / `task_timeout` / `bad_provider_response` / `artifact_download_failed` / `provider_http_error`。

未命中 mappings 时回落到 `provider_http_error`，但 `retryableCodes` 仍可标记可重试。

---

## 3. 场景 A — 录入新模型（新 manifest）

### 3.1 收集信息

从官方文档获取以下信息（缺一项都可能造成静默失败）：

1. **modelId**：provider 实际接收的字符串（如 `doubao-seedream-5-0-260128`，**不是** display name）。
2. **endpoint**：完整路径（如 `/images/generations`）。
3. **请求体结构**：用 curl/postman 试一次成功请求，记下每个字段名（snake_case 还是 camelCase）。
4. **响应结构**：图片/视频在哪条 JSON 路径（`data[].url` / `images[0].b64_json` / `output[0].uri`）。
5. **错误响应**：故意发一个错请求，记下错误 JSON 结构（`error.code` / `error.message` / `request_id`）。
6. **能力范围**：是否支持图生图 / 多图参考 / 图生视频。**不要凭名字猜**，对照官方文档。
7. **参数枚举**：尺寸 / 比例 / 分辨率 / 时长的可选取值；很多平台不同模型支持不同（如 Seedream 4.5 只 2K/4K，5.0 主模型不支持联网搜索）。

> 在 manifest 的 `docs.sourceUrls` 里贴上**核对过的官方文档 URL**，并写 `lastCheckedAt`。这条规则是后续维护者救命的信息——不要省。

### 3.2 撰写顺序（推荐）

#### 第 1 步：定义 `paramSchema`

```ts
const myModelImageSchema = {
  type: 'object',
  additionalProperties: true,        // 默认 true；严格模型用 false + paramPolicy.strict
  properties: {
    size: { type: 'string', title: '画幅', enum: ['1:1', '16:9', '9:16'], default: '1:1' },
    resolution: { type: 'string', title: '分辨率', enum: ['1K', '2K'], default: '1K' },
    n: { type: 'integer', title: '数量', minimum: 1, maximum: 4, default: 1 },
    seed: { type: 'integer', title: '随机种子' },
  },
}
```

**判断 `additionalProperties`**：
- 平台会拒绝未知字段 → `false`（如 Volcengine Seedream 系列）。
- 平台忽略未知字段、是聚合代理 → `true`（如 APIMart）。
- 不确定 → 先 `true` 上线，发现 422 再改 `false`。

#### 第 2 步：选择 `invocation.response`

| 平台行为 | 选择 |
| --- | --- |
| 同步返回图片 URL | `{ kind: 'url', jsonPaths: ['data[].url'], download: true }` |
| 同步返回 base64 | `{ kind: 'inline_base64', jsonPaths: ['data[].b64_json'] }` |
| 提交任务 → 轮询 | `{ kind: 'task_poll', taskIdPaths: ['task_id'], statusEndpoint: '/tasks/{{taskId}}', resultPaths: ['output_url'] }` + `polling: { intervalMs, timeoutMs, statusMap }` |
| 直接返回二进制流 | `{ kind: 'binary_response' }` |

**statusMap** 必须覆盖 provider 实际返回的所有状态字符串，未匹配的状态会被视为 `failed`（避免无限轮询）。可参考 `commonStatusMap`（line 1030）和 `bailianVideoStatusMap`（line 1050，含大写枚举）。

#### 第 3 步：撰写 `requestTemplate`

最简模板（OpenAI 兼容）：
```ts
requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' }
```

模板变量（`{{varName}}`）会从 `modelId` / `prompt` / `inputFiles` / `paramSchema.properties` 中查找替换。**未在标准集合或 paramSchema 中声明的变量会被语义校验拒绝**（`unknown_template_variable`）。

标准变量集合见 `media-model-manifest-validation.ts:14-43`：`modelId` / `prompt` / `text` / `negativePrompt` / `inputFiles` / `image` / `imageUrl` / `images` / `inputImages` / `inputImageUrls` / `imageUrls` / `firstFrame` / `firstFrameImage` / `lastFrame` / `lastFrameImage` / `referenceImages` / `referenceImageUrls` / `video` / `videoUrl` / `videos` / `inputVideos` / `inputVideoUrls` / `firstClip` / `audio` / `audioUrl` / `media` / `params` / `providerParams`。

#### 第 4 步：决定 `aliases`

`aliases` 把 **canonical 名 → provider 原生名**。例如：

```ts
aliases: {
  outputFormat: 'output_format',
  responseFormat: 'response_format',
  sequentialImageGeneration: 'sequential_image_generation'
}
```

注意：snake_case → camelCase 的反方向是**自动**的（`CANONICAL_ALIASES_FALLBACK`），不需要写别名。仅在 provider 字段名不属于标准 snake_case 转换时（如 `sequential_image_generation` ↔ `sequentialImageGeneration` 这种长字段）才需要显式声明。

#### 第 5 步：判断是否需要 `paramPolicy`

| 情形 | 是否需要 |
| --- | --- |
| 单一模型、平台字段严格 | 不需要（用 `additionalProperties: false` 即可） |
| 同一 provider 不同模型字段差异（如 Seedream 5.0 不支持联网搜索） | 需要 `forbidden` |
| 聚合平台（APIMart） | 需要 `passthrough.allow` 显式白名单 |
| 字段名重映射（如 size:'16:9' → aspectRatio:'16:9'） | 需要 `transforms` |

#### 第 6 步：撰写 `error` Contract（可选但强烈推荐）

如果 provider 错误响应不是标准 `{ error: { code, message } }`，必须写。否则错误信息会以原始 JSON 透传给用户。

#### 第 7 步：组装 manifest 并加入 `BUILTIN_MEDIA_MODEL_MANIFESTS`

```ts
{
  id: 'myprovider:my-model-v1',       // 全局唯一
  providerKind: 'myprovider',
  modelId: 'my-model-v1',
  displayName: 'My Model V1',
  domains: ['image'],
  capabilities: [ /* 第 1..3 步的 capability */ ],
  invocation: { /* 第 2 步 */ },
  docs: {
    sourceUrls: ['https://provider.example.com/docs/my-model'],
    lastCheckedAt: '2026-07-05',
  },
  safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 50 * 1024 * 1024 },
  error: /* 第 6 步，可选 */,
}
```

在 `BUILTIN_MEDIA_MODEL_MANIFESTS`（line 1176）数组里追加，**按 providerKind 分组放在一起**便于查找。

#### 第 8 步：注册 provider preset（可选）

如果该 manifest 是某 provider 的主推模型，到 `apps/desktop/src/renderer/design/config/provider-presets.ts` 把它加入对应 provider 的 `mediaModelRefs`，否则用户需要手动从全局 catalog 里勾选。

### 3.3 测试

```bash
# 1) 类型检查
pnpm --filter @spark/protocol exec tsc --noEmit
pnpm --filter @spark/agent-runtime exec tsc --noEmit

# 2) Zod schema 与语义校验（必跑）
pnpm --filter @spark/protocol exec vitest run src/__tests__/schemas.test.ts

# 3) 编译器快照（如果改了 canonical 字段或别名）
pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/media/

# 4) 适配器测试（如果新模型走的是已有 adapter）
pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/media/<provider>.test.ts
```

为新 manifest 添加至少一条 schema 测试（参考 `packages/protocol/src/__tests__/schemas.test.ts` 中已有的 manifest 测试块），验证：
- `MediaModelManifestSchema.parse(manifest)` 通过。
- `validateMediaModelManifestSemantics(manifest)` 返回空数组。

### 3.4 文档

- 在 `docs/multimedia-model-providers.md` §3 "Model Parameter Coverage" 表中添加新行。
- 如果引入了新 provider，更新 §1 中的 `mediaProvider` 枚举说明。
- 刷新本文档末尾的"最后核对"日期。

---

## 4. 场景 B — 更新现有模型的字段

适用：新增/移除某模型的参数（不改 canonical 命名）。

### 4.1 新增字段

1. **在 `paramSchema.properties` 中添加字段定义**（含 `type` / `title` / `enum` / `default`）。
2. **若该字段有 provider 原生名差异**，在 `aliases` 或 `paramPolicy.aliases` 中声明。
3. **若应设默认值**，在 `capability.defaults` 中添加（必须符合 schema，否则 `invalid_default`）。
4. **若该字段是 provider 不接受的**（如聚合平台某些上游模型不支持），加入 `paramPolicy.forbidden` 而不是从 schema 中省略——这样 UI 仍可让用户填写，运行时会被裁掉并记录原因。
5. **更新 manifest 的 `docs.lastCheckedAt`**。

**示例**：Seedream 5.0 lite 添加组图模式：
```ts
// paramSchema.properties 添加
sequentialImageGeneration: { type: 'string', title: '组图模式', enum: ['disabled', 'auto'], default: 'disabled' }
maxImages: { type: 'integer', title: '组图数量', minimum: 1, maximum: 15, default: 4 }

// capability.aliases 添加
sequentialImageGeneration: 'sequential_image_generation',
maxImages: 'max_images'

// capability.defaults 添加
sequentialImageGeneration: 'disabled'
```

### 4.2 移除字段

1. **判断是否真的需要移除**：
   - 平台不再支持 → 移除 schema 字段，但保留 `paramPolicy.forbidden` 一段时间（拦截旧 preset）。
   - 平台仍支持但 UI 不暴露 → 仅从 schema 移除，**不要**加 forbidden（用户通过 MCP `extraJson` 仍可传）。
2. **从 `capability.defaults` 中移除对应键**。
3. **从 `aliases` 中移除对应映射**。
4. **检查 `paramPolicy.transforms` / `conflicts` / `conditionals`** 是否引用了被移除的字段，一并清理。
5. **运行编译器快照测试**，diff 出 provider 请求体的变化，确认无意外。

### 4.3 修改默认值

1. 修改 `capability.defaults.<field>`。
2. 新值必须满足 `paramSchema.properties.<field>` 的 `enum` / `minimum` / `maximum` / `type`，否则 `invalid_default`。
3. 同步更新文档表（`multimedia-model-providers.md` §3）。

### 4.4 向后兼容

用户保存的 preset / 节点配置中可能含旧字段名或旧枚举值。处理策略：

| 旧字段情况 | 处理 |
| --- | --- |
| 字段被重命名 | 在 `aliases` 中保留旧名 → 新名映射，至少 1 个版本周期 |
| 字段被移除 | 在 `paramPolicy.forbidden` 中加 `{ name: 'oldName', reason: 'deprecated since vX.Y' }`，让 dropped 记录有原因 |
| 枚举值被移除 | 在 compiler 中加 `map_value` transform，把旧值映射到最接近的新值；同时在 dropped 记录里说明 |

---

## 5. 场景 C — 更新参数（canonical 命名 / 别名 / transforms）

### 5.1 风险等级

⚠️ **高风险**。canonical 参数名变更会破坏：
- 用户保存的 preset / canvas 节点配置（字段名匹配不上）。
- MCP 工具的 `extraJson` 字段。
- 跨节点参数继承。

**优先用别名而不是改名**。

### 5.2 添加 canonical 参数

1. 在 `media-model-contract.ts:25-46` 的 `CanonicalMediaParamName` 联合类型中添加。
2. 在 `media-request-compiler.ts` 的 `CANONICAL_ALIASES_FALLBACK`（line 76）中，添加 provider snake_case → 新 canonical 的兜底映射。
3. 为相关 manifest 的 `paramSchema.properties` 添加该字段定义。
4. 在编译器 / 适配器中处理新字段（如需写文件、特殊编码）。
5. 添加编译器单元测试覆盖归一与别名两条路径。

### 5.3 配置 `transforms`

`MediaParamTransformRule` 四种变体：

```ts
// 重命名：把 raw 中的 from 字段改名为 to
{ kind: 'rename', from: 'oldName', to: 'newName' }

// 值映射：枚举式把 provider 值翻译为 canonical 值（或反向）
{ kind: 'map_value', field: 'size', values: { 'small': '1024x1024', 'large': '2048x2048' } }

// 智能比例：size:'16:9' 自动转 aspectRatio:'16:9'（size 字段消失）
{ kind: 'ratio_size_to_aspect', from: 'size', to: 'aspectRatio' }

// 按 input.kind 裁字段：图生图场景下不要 prompt 优化
{ kind: 'drop_when_input_kind', field: 'promptOptimizationMode', inputKinds: ['image', 'images'] }
```

**`map_value` 注意**：values 表是**双向**查找的——provider 值与 canonical 值任一方向都能命中。`field` 用 canonical 名。

### 5.4 修改 `CANONICAL_ALIASES_FALLBACK`

修改前先 `git grep` 该别名是否已被某 manifest 显式声明；显式声明优先级更高，改 fallback 不会影响它们。修改后**必须**跑：

```bash
pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/media/media-request-compiler.test.ts
```

并审视快照差异——任何 canonical 名变化都会反映在 `providerParams` 的 key 上。

---

## 6. 场景 D — 更新枚举值

### 6.1 添加枚举值

平台新增了画幅 / 分辨率档位（如 Seedream 新增 8K）：

1. 在 `paramSchema.properties.<field>.enum` 数组里追加新值。
2. 如果新值有默认值倾向，更新 `default`。
3. **不需要改 transforms**——枚举值原样透传。
4. 检查 adapter 是否有"size → pixels"硬编码映射（如 VolcengineArkMediaAdapter 的 size 字典），如有需同步。

### 6.2 移除枚举值

平台下线某档位：

1. 从 `enum` 中移除。
2. **如果用户 preset 中可能存了旧值**，在 compiler 加一条 `map_value` transform 映射到最近似的新值；或在 `paramPolicy.forbidden` 中显式拦截（会在运行时记 `forbidden_by_contract`，告知用户更新 preset）。
3. 更新文档表的"支持值"列。

### 6.3 替换枚举值（旧值 → 新值）

最复杂的场景。推荐流程：

1. **保留旧值在 enum 中**至少一个版本（兼容已保存的 preset）。
2. 添加 `transforms.map_value` 把旧值映射到新值。
3. 在 UI 编辑器（`ProviderManifestContractEditor`）侧添加 deprecation tag。
4. 在 `multimedia-model-providers.md` 中标注 `deprecated since vX.Y`。
5. 下个大版本才真正从 enum 移除。

### 6.4 推荐值 + 范围内自定义（`x-allow-custom`）

平台既给推荐档位、又允许范围内自定义时（典型：火山方舟 Seedream `size`，方式1 `2K/3K/4K` 分辨率档 + 方式2 任意「宽x高」像素值，只要总像素乘积在区间内即可）：

1. 在 `paramSchema.properties.<field>.enum` 录入**全部官方推荐值**（分辨率档 + 各档对应的像素值）。
2. 在字段定义里加 `'x-allow-custom': true`。
3. 在 `description` 写清自定义范围（如「总像素乘积 [3686400, 16777216]、宽高比 [1/16, 16]」），供用户参考。
4. 前端 `schemaFields`（`CanvasInlineAiComposer.tsx` / `CanvasOperationPanel.tsx` / `CanvasOperationPresetModal.tsx`）识别 `x-allow-custom`，渲染为 antd `AutoComplete`：推荐值作下拉，用户也可输入任意字符串。
5. adapter 直接透传字符串值，**不做范围校验**——由 provider 裁决（超出范围的值 provider 返回 400，被 `errorContract` 归一为 `invalid_parameter_value`）。

```ts
size: {
  type: 'string',
  title: '画幅',
  enum: ['2K', '3K', '4K', '2048x2048', '2304x1728', /* ...全部官方推荐值 */],
  default: '2K',
  description: '分辨率档或「宽x高」像素值；自定义需同时满足总像素乘积范围 [3686400, 16777216] 与宽高比 [1/16, 16]。',
  'x-allow-custom': true,
}
```

参考实现：`volcengineSeedream5LiteImageSchema` 等四个 Seedream schema（`packages/protocol/src/media-model-manifest.ts`）。

---

## 7. 常见陷阱

### 7.1 `additionalProperties: false` 误用

如果 schema 设了 `false`，但用户通过 MCP `extraJson` 传了 schema 未声明的字段，会被静默裁掉。除非平台会 422 拒绝未知字段，否则用 `additionalProperties: true` + `paramPolicy.strict: false`（兼容透传）。

### 7.2 别名方向写反

`capability.aliases` 与 `paramPolicy.aliases` 都是 **canonical → provider 原生**。反过来写在编译器里不会生效，但也不会报错——是个静默陷阱。

正确：
```ts
aliases: { sequentialImageGeneration: 'sequential_image_generation' }
```

错误：
```ts
aliases: { sequential_image_generation: 'sequentialImageGeneration' }  // ❌
```

### 7.3 `async_polling` 缺 `polling`

`mode: 'async_polling'` 必须配 `response.kind: 'task_poll'` 和 `polling` 配置。`validateMediaModelManifestSemantics` 会拒绝违反的 manifest，但仅当 manifest 走 `ProviderMediaModelRefSchema` 校验时才触发——直接 `MediaModelManifestSchema.parse` 不跑语义校验。**测试时务必用 `ProviderMediaModelRefSchema` 或显式调用 `validateMediaModelManifestSemantics`**。

### 7.4 `forbidden` 字段未声明

`forbidden` 的 `name` 必须在 `paramSchema.properties` 或 `aliases` 中能找到，否则语义校验报 `invalid_param_policy`。这是设计上的"防呆"——避免拼写错的 forbidden 静默失效。

### 7.5 statusMap 漏覆盖

如果平台返回的状态字符串不在 `polling.statusMap` 中，会被视为 `failed`。这是为了避免无限轮询，但会导致**仍可成功的任务被误判失败**。务必对照平台文档列出所有可能状态（含大小写差异，参考 `bailianVideoStatusMap` 同时收录大小写）。

### 7.6 error contract 未透传到 fetchJson

每个 adapter 的 `fetchJson` / `pollTask` 调用必须显式传 `errorContract`：

```ts
await fetchJson(url, {
  ...,
  ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
})
```

**漏传是真实存在的 bug 类型**（M4 引入 errorContract 时一度所有 adapter 都漏传）。新增 adapter 或修改 fetch 逻辑时务必检查。

### 7.7 manifest.id 与 modelId 混淆

- `id`：全局唯一，建议 `<providerKind>:<modelId>`，用于 catalog 索引、provider 引用。
- `modelId`：发给 provider 的实际字符串。

`ProviderMediaModelRefSchema` 校验 `ref.manifestId === ref.manifest.id`，但不校验 id 与 modelId 的关系。**不要让两者完全不同**，否则排查问题时非常痛苦。

### 7.8 `requestTemplate` 引用了未声明的变量

`{{myCustomField}}` 必须出现在标准变量集合或 `paramSchema.properties` 中，否则 `unknown_template_variable`。如果确实需要自定义字段，先在 paramSchema 中声明（即使 `paramPolicy.forbidden` 把它裁掉）。

---

## 8. 测试清单

| 测试 | 跑法 | 必跑？ |
| --- | --- | --- |
| Protocol schema + 语义校验 | `pnpm --filter @spark/protocol exec vitest run src/__tests__/schemas.test.ts` | ✅ |
| Compiler 单元 + 快照 | `pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/media/media-request-compiler.test.ts` | ✅ |
| 错误归一 | `pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/media/media-error-normalizer.test.ts` | 改 errorContract 时 ✅ |
| 对应 adapter | `pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/media/<provider>.test.ts` | 改 adapter 时 ✅ |
| 桌面 IPC（dry-run 预览） | `pnpm --filter @spark/desktop exec vitest run src/renderer/tests/` | 改 IPC 或编辑器时 ✅ |

为新 manifest 添加的测试至少包含：

```ts
import { MediaModelManifestSchema } from '@spark/protocol'
import { validateMediaModelManifestSemantics } from '@spark/protocol'
import { BUILTIN_MEDIA_MODEL_MANIFESTS } from '@spark/protocol'

test('my-model manifest 通过 schema 与语义校验', () => {
  const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(m => m.modelId === 'my-model-v1')!
  expect(MediaModelManifestSchema.safeParse(manifest).success).toBe(true)
  expect(validateMediaModelManifestSemantics(manifest)).toEqual([])
})
```

---

## 9. 提交前检查清单

- [ ] 类型检查：`pnpm --filter @spark/protocol exec tsc --noEmit`、`pnpm --filter @spark/agent-runtime exec tsc --noEmit`
- [ ] Lint：`pnpm --filter @spark/protocol exec eslint src/media-model-manifest.ts src/media-model-contract.ts`
- [ ] 单元测试：第 8 节"必跑"项全绿
- [ ] manifest 的 `docs.lastCheckedAt` 已刷新为今天
- [ ] `multimedia-model-providers.md` §3 表（如涉及）已同步
- [ ] **GitNexus 影响分析**：对修改的符号跑 `gitnexus_impact({ target, direction: 'upstream' })`，HIGH/CRITICAL 风险须先和团队确认
- [ ] **GitNexus detect_changes**：提交前跑 `node .gitnexus/run.cjs detect-changes --scope compare --base-ref origin/develop -r spark-agent`，确认影响范围与预期一致
- [ ] **文档新鲜度**：本文档与 `multimedia-model-providers.md` 顶部状态行的"最后核对"已更新
- [ ] PR 描述中粘贴：manifest 的官方文档链接 + curl 示例响应（便于 reviewer 校对）

---

## 10. 快速模板（复制即用）

```ts
const myModelSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    size: { type: 'string', title: '画幅', enum: ['1:1', '16:9', '9:16'], default: '1:1' },
    n: { type: 'integer', title: '数量', minimum: 1, maximum: 4, default: 1 },
    seed: { type: 'integer', title: '随机种子' },
  },
}

const myModelErrorContract: MediaErrorContract = {
  codePaths: ['error.code', 'error.type'],
  messagePaths: ['error.message', 'message'],
  requestIdPaths: ['request_id', 'id'],
  paramNamePaths: ['error.param'],
  mappings: {
    invalid_api_key: 'auth_failed',
    rate_limit_exceeded: 'rate_limited',
  },
  retryableCodes: ['rate_limit_exceeded', 'service_unavailable'],
}

// 在 BUILTIN_MEDIA_MODEL_MANIFESTS 中追加：
{
  id: 'myprovider:my-model-v1',
  providerKind: 'myprovider',
  modelId: 'my-model-v1',
  displayName: 'My Model V1',
  domains: ['image'],
  capabilities: [
    {
      id: 'image.generate',
      label: '文生图',
      input: { required: ['prompt'] },
      output: { types: ['image'], mimeTypes: ['image/png', 'image/jpeg'] },
      paramSchema: myModelSchema,
      defaults: { size: '1:1', n: 1 },
    },
  ],
  invocation: {
    mode: 'sync',
    endpoint: '/images/generations',
    method: 'POST',
    contentType: 'json',
    requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}', size: '{{size}}' },
    response: { kind: 'url', jsonPaths: ['data[].url'], download: true },
  },
  docs: {
    sourceUrls: ['https://myprovider.example.com/docs/my-model'],
    lastCheckedAt: '2026-07-05',
  },
  safety: { maxPromptLength: 8000, allowLocalFiles: true, maxInputBytes: 50 * 1024 * 1024 },
  error: myModelErrorContract,
}
```

异步版本（task_poll）：

```ts
invocation: {
  mode: 'async_polling',
  endpoint: '/videos/generations',
  method: 'POST',
  contentType: 'json',
  requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
  response: {
    kind: 'task_poll',
    taskIdPaths: ['task_id', 'id'],
    statusEndpoint: '/videos/{{taskId}}',
    resultPaths: ['video_url', 'output.url'],
  },
  polling: {
    intervalMs: 5000,
    timeoutMs: 900_000,
    statusMap: commonStatusMap,   // 复用现有，必要时补全大小写
  },
}
```
