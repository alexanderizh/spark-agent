# 用户自定义多媒体模型 Manifest 设计

> 状态: 已落地（含 Contract V2 升级：paramPolicy / errorContract / 结构化编辑器 / dry-run 预览） | 最后核对: 2026-07-05

## 目标

让用户配置的图片、视频和音频模型与内置模型共用画布和 `spark_media` 调用链，同时保持现有模板、内置 Manifest 和专用 Adapter 的行为不变。自定义模型应支持参数 Schema、同步或异步调用、结果提取，并在失败时留下可排查且不泄露密钥或完整 base64 的日志。

## Contract V2 补充（2026-07-05 升级）

在原始设计（manifestId 引用 + 内联 manifest）之上，每个 capability 现可声明更完整的调用契约：

- **`paramPolicy.strict`**：true 时仅允许 manifest 显式声明的字段（含 alias），其余字段全部丢弃并写入 `droppedParams`。
- **`paramPolicy.passthrough.{enabled, allow, deny}`**：兼容模式下控制未声明字段的透传；`allow` 是聚合平台显式白名单（如 `aspect_ratio`、`output_format`），`deny` 是永远丢弃的黑名单。
- **`paramPolicy.forbidden[]`**：每条 `{ name, reason }`，命中后不仅丢弃，还产生 `forbidden_param` 校验问题，便于在任务详情 / dry-run 输出里指出"该模型不支持 X，请改用 Y"。
- **`MediaErrorContract`**：声明 provider 错误响应的 `codePaths` / `messagePaths` / `paramNamePaths` / `requestIdPaths`（点路径 + 数组索引），可选 `mappings` 把外部 code 翻译成内部错误码、`retryableCodes` 标注可重试错误。

配套落地：

1. **共享编译器** `compileMediaRequest`（`packages/agent-runtime/src/services/media/media-request-compiler.ts`）作为单一来源，被 `TemplateMediaAdapter` / 画布 IPC / `MediaRouterService.preflight` 共用；纯 JS 镜像 `media-request-compiler.mjs` 让 `spark_media` MCP 子进程保持相同语义。
2. **结构化编辑器** `ProviderManifestContractEditor.tsx` 让用户在 ProvidersView 的自定义 manifest Modal 中用 Checkbox / Input / textarea 编辑 paramPolicy 与 errorContract，与 raw JSON textarea 双向同步；保存前同时跑 Zod schema 与 `validateMediaModelManifestSemantics`。
3. **Dry-run 预览** IPC `canvas:media:prune-model-params-by-inline-manifest` 不依赖目录或 Provider Profile，直接对 Modal 中正在编辑的 manifest 跑裁剪并返回 pruned / dropped / warnings / validationIssues；用户在保存前即可验证 strict / passthrough / forbidden 的实际效果。
4. **错误归一** `MediaProviderError.normalized` 由 `MediaRouterService` 在 provider 4xx 时按 manifest.error 提取，无 errorContract 时退回 HTTP 状态码兜底（401/403→auth_failed、429→rate_limited、400/422→invalid_parameter_value）。



## 最新代码判断

当前代码已经具备 `MediaModelManifest`、目录服务、`TemplateMediaAdapter`、画布模型参数面板和 `spark_media`。主要缺口不是新的 Adapter 接口，而是 Provider 只保存 `manifestId + modelId`：目录不存在的 `custom:` 引用会克隆一个内置 Manifest，因此协议、参数和响应路径仍然依赖猜测。

## 方案

### 1. Provider 引用可携带完整 Manifest

扩展 `ProviderMediaModelRef`，增加可选 `manifest`。内置引用继续只保存 `manifestId`；新建的自定义引用保存完整 Manifest。Provider 配置、导入导出和 IPC 沿用现有 JSON 配置字段，不新增数据库迁移。

解析优先级如下：

1. `ref.manifest`，并校验其 `id` 与 `ref.manifestId` 一致。
2. 媒体模型目录中的内置或已注册 Manifest。
3. 旧 `custom:` 引用的合成 Manifest，仅作为兼容兜底。

### 2. 路由兼容

- 内置模型继续按当前规则优先使用 APIMart、xAI、Volcengine、Google、Midjourney 等专用 Adapter。
- `mediaProvider=custom` 且匹配完整 Manifest 时使用 `TemplateMediaAdapter`。
- 旧引用和模板配置不改变保存格式，也不强制迁移。
- 本阶段支持通用 JSON 同步调用、JSON 异步轮询、URL、inline base64、binary response；multipart 和复杂上传留到后续阶段。

### 3. 调用前校验

新增 Manifest 语义校验，覆盖 Zod 结构校验之外的高频错误：

- 自定义引用 ID 与 Manifest ID 必须一致。
- `async_polling` 必须使用 `task_poll`，并配置 polling。
- endpoint、statusEndpoint 中的模板变量必须来自允许集合。
- requestTemplate 中引用的变量必须可由标准输入、模型参数或 aliases 提供。
- capability defaults 必须符合 `paramSchema` 的基础类型、枚举和数值范围。

校验错误返回字段路径和中文可操作提示，在保存阶段拦截，而不是等到画布调用时报 4xx。

### 4. 低门槛配置

Provider 高级设置增加“自定义调用协议”向导：

- 用户先选图片、视频或音频，再选“同步 JSON”或“异步任务”。
- 只填写模型 ID、请求路径、结果路径；异步模式再填写任务 ID、查询路径和成功状态。
- 请求参数由常用控件生成，额外参数允许添加名称、类型、默认值和是否必填。
- “高级 JSON”允许专家编辑完整 Manifest，但保存时使用同一校验器。
- 保存前提供“检查配置”；后续增加真实测试调用，测试产物不写入画布。

### 5. 日志与隐私

所有媒体调用和任务详情共用安全摘要：

- `Authorization`、API Key、token 完全掩码。
- data URL 和疑似 base64 不记录正文，仅记录 MIME、估算字节数、SHA-256 短摘要和极短首尾片段。
- 普通长字符串按长度截断。
- 记录 provider、manifest、capability、method、URL、状态码、request/task ID、轮询状态、结果提取路径和耗时。

### 6. 技能与画布

内置 Skill 不绑定具体模型 ID，只声明 capability。画布和 `spark_media` 都通过 Provider 引用解析出同一个 Manifest，因此自定义模型保存后可同时被两端发现和调用。

## 验收标准

- 现有内置模型、模板 Provider 和专用 Adapter 测试保持通过。
- 旧 `custom:` 引用仍可显示和调用原生 Adapter。
- 带完整 Manifest 的自定义图片模型可同步生成并落盘。
- 带完整 Manifest 的自定义视频模型可提交、轮询并落盘。
- 非法参数和协议在保存前给出字段级错误。
- 日志、IPC 和任务详情中不出现完整 base64、data URL、API Key 或 Authorization。

## 分阶段实施

1. 协议与运行时：内联 Manifest、解析优先级、语义校验、安全摘要。
2. Provider 向导：同步/异步模板、参数编辑、保存前检查。
3. 测试调用：dry-run 请求预览、真实测试和错误翻译。
4. 扩展协议：multipart、文件上传、mask、多参考图、首尾帧和音视频混合输入。
