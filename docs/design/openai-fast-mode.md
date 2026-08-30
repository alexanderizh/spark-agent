# OpenAI Fast mode

> 状态: 已落地 | 最后核对: 2026-08-30

## 目标

在会话推理强度控件中提供独立的 OpenAI Fast mode 开关。该开关不修改 `reasoningEffort`，而是把用户选择映射为上游真实支持的服务层参数。

## 契约

- 会话偏好存放在 metadata 的 `fastMode` 布尔字段中，旧会话缺少该字段时按关闭处理。
- 仅 OpenAI 协议的 Chat Completions / Responses 文本链路使用该偏好；Anthropic、Embedding、Auto Router 和未配置 OpenAI 转发渠道的本地 CLI 不展示开关，也不发送参数。
- OpenAI-compatible 渠道可能不支持 Fast mode。上游拒绝时保留真实错误，不自动降级并伪装成功。
- 开关默认关闭；切换 Provider 不删除会话偏好，但不兼容链路会在运行时强制按关闭处理。

## 请求映射

| 执行路径             | 开启                         | 关闭                                           |
| -------------------- | ---------------------------- | ---------------------------------------------- |
| Chat Completions     | `service_tier: "fast"`       | 不发送 `service_tier`                          |
| Codex app-server     | `serviceTier: "fast"`        | 显式发送 `serviceTier: null`，清除线程粘滞状态 |
| Codex SDK / CLI 回退 | 配置 `service_tier = "fast"` | 不写入临时配置                                 |

## 状态与执行链路

`ComposerReasoningControl` 负责交互，`fastMode` 随会话创建、更新、排队 turn、目标插话和团队成员执行快照传递。`SessionService` 根据最终 Provider、API 类型和 CLI override 再做一次能力校验，只有兼容链路才把 `fastMode: true` 交给执行器。本地 Codex CLI 直接支持 Fast mode；本地 Claude CLI 仅在切换到兼容的 OpenAI 渠道时支持。

## 验证要求

- 能力测试覆盖 Chat、Responses、Anthropic、Embedding、本地 CLI 和 Auto Router。
- 会话测试覆盖 metadata 兼容读取、运行时 patch 持久化和最终协议判定。
- 每种执行器均需直接断言最终请求或配置中的服务层参数，不能只验证 UI 状态。

官方语义参考：[OpenAI Fast mode](https://developers.openai.com/api/docs/guides/fast-mode)。
