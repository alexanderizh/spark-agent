# 多媒体提示词校验策略

> 状态: 已落地 | 最后核对: 2026-07-19

## 事故结论

Qwen Image 2.0 的 `1300` 在供应商文档中是 Token 阈值，且超出后由 Provider 自动截断。旧实现把它解释为 JavaScript 字符数，并在请求发出前返回本地 `invalid_input`，因此“当前 2746 个字符”的错误来自 Spark，而不是模型方。

画布旧链路还存在预检口径差异：renderer 只校验 User Prompt，main 合并 System Prompt、User Prompt 和节点上下文后再次严格校验。前者可以通过，后者会突然失败。

## 当前策略

1. `maxPromptLength` 只产生 warning，所有媒体入口均不得据此本地硬阻断。
2. `promptLengthUnit` 可声明 `characters`、`tokens` 或 `provider_specific`；Token 没有对应 tokenizer 时只显示保守提醒，不声称已精确计数。
3. `promptOverflowBehavior` 记录 Provider 的 `truncate`、`reject` 或 `unknown` 行为。
4. 画布中的 manifest/schema/Provider 兼容性问题降级为任务警告并继续下发，由 Provider 返回权威结果。
5. 缺少必需 prompt/媒体、畸形 data URL、本地路径越权等确定性结构或安全错误继续阻断。
6. 专用 adapter 不得重复实现提示词长度硬限制；现有 xAI TTS 15000 字符和 APIMart Seedance 4000 字符检查已改为 advisory。

## 内置清单审计

本次共检查 35 个内置 `maxPromptLength` 声明。结论如下：

| 范围                                    | 审计结果                                       | 处理                                               |
| --------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| Qwen Image 2.0 / Pro                    | 官方为 1300 Token，超出自动截断                | 修正单位与溢出行为                                 |
| Wan 2.7 Image / Pro                     | 官方为 5000 字符，旧清单错误写成 8000          | 修正数值、单位与溢出行为                           |
| Wan 2.7 视频系列                        | 官方为 5000 字符，超出自动截断                 | 补单位与溢出行为                                   |
| HappyHorse                              | 官方按中文 2500 / 非中文 5000 字符区分         | 现有单值字段无法精确表达；保留参考提示且永不阻断   |
| MiniMax 图片/视频                       | 官方可核对到 1500 / 2000 字符                  | 保留参考提示且永不阻断                             |
| xAI、OpenAI、Google、火山、部分聚合渠道 | 当前官方页面未找到与清单数值一一对应的明确依据 | 保留兼容数据但只作 warning，后续逐模型补证据和单位 |

## 维护要求

- 新增或修改阈值必须在 `docs.sourceUrls` 中保存官方来源，并填写单位和 Provider 溢出行为。
- 未找到官方证据时优先不填 `maxPromptLength`；不得用经验值制造本地硬错误。
- 任何提示词限制都要覆盖“长度 warning 不进入 `blockingIssues`”回归测试。
- 画布预检必须使用与 main 相同的共享 prompt 拼接器，同时保留原始可编辑 user/system 字段。
