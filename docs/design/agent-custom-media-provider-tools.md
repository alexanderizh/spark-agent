# Agent 自定义多媒体渠道配置工具设计

> 状态: 已落地 | 最后核对: 2026-08-08

## 目标

让用户通过 Agent 对话配置应用未内置的图片、音频和视频渠道。Agent 负责收集渠道资料、读取真实官方文档、生成完整 Contract V2、保存 Provider，并分阶段调试；专用工具优先复用现有 ProviderService、Keychain、Manifest 校验器和画布运行时。

## 内置工具

| 工具                              | 作用                                                               | 是否写入 | 是否发起媒体请求 |
| --------------------------------- | ------------------------------------------------------------------ | -------- | ---------------- |
| `providers_media_guide`           | 返回资料清单、能力枚举、约束和带唯一 ID 的起始 Manifest            | 否       | 否               |
| `providers_media_validate`        | 校验结构、语义、参数、请求、轮询、产物解析和 URL，生成脱敏请求预览 | 否       | 否               |
| `providers_media_configure`       | 校验通过后，通过 ProviderService 创建或更新自定义渠道              | 是       | 否               |
| `providers_media_discover_models` | 调用渠道 `/models` 初始化真实模型清单                              | 否       | 仅模型查询       |
| `providers_media_diagnose`        | 检查配置、Keychain、模型接口和真实能力调用                         | 否       | 仅明确确认后     |

## Agent 工作流

1. 向用户确认渠道名称、API Base URL、鉴权方式、模型 ID 或 `/models` 地址、能力范围和官方文档。
2. 使用 `spark_search` 搜索并抓取官方接口与模型文档；请求字段、枚举、状态值和结果路径必须有真实文档依据，并记录到 `docs.sourceUrls`。
3. 每个模型生成一个完整 Manifest。相同 `modelId` 可以存在于不同 Provider；Manifest ID 属于内部身份，Agent 可省略 `manifest.id`，由校验/保存工具按渠道身份稳定生成、修复冲突或保留更新中的历史 ID，并通过 `resolvedModels` 返回有效值。
4. 先运行只读校验并修复全部错误，再保存配置。API Key 只在最终保存或模型发现阶段传入，保存到系统 Keychain。
5. 保存后先做配置与凭据诊断；只有用户明确同意可能计费的真实请求，才可执行能力调用。

## 运行链路

Agent 调用 `spark_platform` MCP；MCP 只做严格参数声明和本地 RPC 转发。PlatformBridge 按调用惰性创建配置服务，避免可选功能影响普通 Agent 启动。配置服务复用以下正式路径：

- ProviderService：Provider 持久化、协议归一化、Keychain 和 `/models`。
- MediaModelManifestSchema 与语义校验：结构和异步合同检查。
- media request/invocation compiler：参数合同与最终 HTTP 请求预览。
- MediaRouterService：与画布相同的真实适配器选择和调用链路。

## 安全、兼容与诊断

- 不返回、不复述、不记录明文 API Key；请求头、查询参数、响应和异常中的凭据统一脱敏。
- 新建配置由工具生成渠道唯一 Manifest ID；无效格式、手工渠道段和跨 Provider 冲突会自动修复。更新历史 `custom:<modelId>` 配置时保留原 ID 并警告，保证旧配置可继续编辑和运行。
- 畸形草稿必须进入结构校验并返回字段路径，不能在迁移阶段抛 `TypeError`。
- 现有通用 Provider 工具保持不变；自定义多媒体配置使用独立工具，不改变普通文本渠道和旧媒体渠道启动路径。
- 诊断按 `configuration`、`credential`、`models`、`invoke` 分阶段返回，并对 401、404、400 和轮询超时给出针对性建议。
- 真实诊断请求需要 `confirmExecute=true`；临时产物目录在诊断结束后清理。

## 日志与测试

日志只记录动作、Provider ID、模型数、能力数、Manifest ID 调整数量、阶段、状态码和脱敏错误摘要。测试覆盖畸形草稿迁移、自动 ID 生成/修复/保留、重复模型、请求预览、协议保留、Keychain 输入不回显、模型发现、付费调用确认、真实调用脱敏、MCP 契约及 PlatformBridge 路由。
