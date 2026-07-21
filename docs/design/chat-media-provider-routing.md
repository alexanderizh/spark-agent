# 普通会话多媒体 Provider 路由设计

> 状态: 已落地 | 最后核对: 2026-07-22

普通 Agent 会话使用单个 `spark_media` MCP 服务聚合所有已启用且凭据可用的图片、音频和视频 Provider。模型清单不再只属于第一个命中的 Provider；每个模型会保留所属 Provider Profile 的凭据、endpoint、协议类型、默认参数和 Manifest。

## 运行时契约

- 会话运行时把所有可用配置写入仅对子进程可见的 `SPARK_MEDIA_PROVIDERS_JSON`。API Key 不进入提示词或工具返回值。
- `list_models` 返回 `providerProfileId`、`providerName` 和 `selectionKey`。`selectionKey` 由 Provider Profile 与 Manifest ID 组成，可在不同 Profile 配置同名模型时消除歧义。
- `describe_model` 和生成工具都接受 Manifest ID、唯一 Model ID 或 `selectionKey`。
- 用户明确指定模型时，MCP 必须切换到该模型所属 Provider 的 API Key、base URL、adapter 和 Manifest；找不到模型时直接返回错误，不得回退到默认模型。
- 未指定模型时，按配置顺序选择第一个支持目标 capability 的默认模型，保持历史行为。
- 同一个非限定模型名命中多个 Provider 时返回歧义错误，并列出可用 `selectionKey`。

## 兼容策略

旧 `spark_image` MCP 仍保留给无法解析成统一媒体配置的历史 Provider。只要存在可用的 `spark_media` 配置，普通会话只注入统一工具，避免 Agent 同时看到“固定默认图片模型”和“可路由媒体模型”两套相互冲突的指令。

画布继续使用 `MediaRouterService` 和画布媒体模型解析链，本改动只统一普通会话的 Skill/MCP 路由，不改变画布任务协议。

## 回归要求

- 至少用两个不同 Provider Profile 验证 `list_models` 同时可见。
- 显式选择非默认模型后，断言实际 HTTP 请求命中其所属 endpoint，并使用其所属凭据。
- 保持旧单 Provider 环境变量协议可用。
- 会话存在统一媒体配置时断言只注入 `spark_media`，不同时注入 `spark_image`。
