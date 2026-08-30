# 无限画布异步任务按渠道 Task ID 恢复轮询开发计划

> 状态: 实施中 | 最后核对: 2026-08-09

## 1. 目标与验收口径

当 Provider 已经返回渠道任务 ID，而本地轮询因网络错误、超时、应用重启或进程切换中断时，用户可以在任务节点操作面板和任务详情面板点击“重新轮询”。该动作必须只查询原任务，不重新创建任务、不重复扣费，并在成功时只物化一次产物。

本功能的验收不是“按钮能点”，而是以下链路全部成立：

`提交成功 → 持久化 Provider Task ID/查询协议/归属 → 本地轮询失败 → 用户恢复 → 按原渠道协议查询 → 产物物化 → 画布单调回写`

任何无法证明查询协议、任务归属或任务 ID 对应关系的历史任务，都必须返回结构化 `poll_resume_unavailable`，不能猜测 endpoint。

## 2. 渠道适配矩阵

| 渠道                                                        | 查询方式                                                   | 产物方式                              | 恢复策略                  |
| ----------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------- | ------------------------- |
| 火山方舟                                                    | `GET /contents/generations/tasks/{id}`                     | `content.video_url` 下载              | 专用 Task Client          |
| 阿里云百炼                                                  | `GET /api/v1/tasks/{id}`                                   | `output.video_url/results[].url` 下载 | 专用 Task Client          |
| MiniMax Hailuo                                              | V2 详情或 V1 `query`，必要时 `files/retrieve`              | URL 或 file_id 下载                   | 专用协议                  |
| OpenAI Sora                                                 | `GET /videos/{id}`，完成后 `GET /videos/{id}/content`      | 二进制视频                            | 专用协议                  |
| Google Veo                                                  | 长任务 operation 查询                                      | inline/base64 或文件 URL              | Google LRO 协议           |
| Google Omni                                                 | `GET /interactions/{id}`                                   | inline/base64 或文件 URL              | Interaction 协议          |
| 腾讯 TokenHub                                               | `POST /v1/api/{image\|video}/query`，body `{model,id}`     | URL/base64                            | 专用 POST 查询            |
| APIMart、Agnes、xAI、Midjourney                             | 各自任务详情 endpoint；Agnes 可使用提交响应中的 `video_id` | URL/base64                            | 渠道策略或保存的 manifest |
| OpenAI-compatible、Kling、PixVerse、Wan、HappyHorse、Custom | 保存的 `task_poll` manifest                                | manifest result/artifact              | Manifest 通用恢复器       |

表中“保存的 manifest”是提交时的无凭据协议快照，包含 HTTP 方法、Task ID 位置、状态映射、结果路径、间隔、超时和 artifact 请求；API Key 只在恢复时从当前 Provider 配置读取。

## 3. 数据与安全边界

- `runtimeTaskId`、`providerTaskId`、历史兼容字段 `requestId` 三者分开保存和展示；恢复请求只使用明确的 `providerTaskId`。
- Runtime 任务持久化 `provider_profile_id`、`project_id`、`client_task_id`、`provider_task_id`、`polling_json` 和脱敏的 `submit_response_json`。
- IPC 主进程校验 Runtime 记录中的项目和画布任务归属、Provider Profile、Provider Task ID；Renderer 传入的 project/client 字段不能决定最终 stream 路由。
- 缺少归属、协议快照、Provider Task ID、API Key 或对应渠道适配器时 fail closed。
- 任务已经有产物时禁止恢复；恢复开始、成功写回、失败写回都使用状态和 Provider Task ID 条件更新。

## 4. 状态机与竞态规则

1. 只有 `failed + 无产物 + 有 Provider Task ID + 有恢复协议` 可以原子 claim 为 `running`。
2. 同一 Runtime 任务的第二次点击只能返回“已在轮询中”，不能启动第二个循环。
3. 每次查询前后检查任务仍是 `running`、Provider Task ID 未变、项目归属未变；取消后立即停止。
4. `completeRecovery` / `failRecovery` 只允许 `running` 状态写入；取消、重新提交、已有成功产物会拒绝晚到结果。
5. Provider 明确返回 `failed/expired/cancelled` 时写回终态并提示“重新提交”，不伪装成可恢复任务。
6. 网络错误、接口超时和本地下载失败保留原任务 ID，允许用户再次发起有限轮询；轮询上限来自保存的 manifest/provider 默认值，禁止无界循环。

## 5. UI 行为

- 任务节点操作面板和任务详情面板均显示“重新轮询”；按钮只在 Runtime 返回 `pollingAvailable=true` 且任务失败、无产物、存在 Provider Task ID 时显示。
- 恢复期间显示 loading 并禁用重复点击；“重新轮询”与“重新提交任务”使用不同文案、状态和提示。
- 任务详情同时展示 Runtime Task ID、Provider Task ID、Provider Profile、查询协议是否可恢复及不可恢复原因。
- 右键菜单保留“重新提交任务”作为显式新建 Provider 任务入口，避免在菜单中制造重复动作。

## 6. 已实施代码边界

- 协议：`canvas:task:repoll-media`、`providerTaskId`、恢复能力字段。
- Storage：migration 066 及媒体任务 Repository 的归属、协议快照、提交响应和原子恢复状态。
- Runtime：Provider 轮询描述生成、Manifest/专用渠道恢复器、取消与晚到结果保护。
- Main IPC：归属校验、API Key 解析、后台恢复、终态 stream 回写。
- Canvas：节点和任务面板入口、恢复 loading、Provider Task ID 与 Runtime Task ID 分开展示。

## 7. 测试计划

- Repository：迁移、双击 claim、错误 Provider Task ID、已有产物、取消后晚到成功/失败。
- Runtime：provider kind 推断、异步提交响应跨重启保存、各渠道 descriptor、取消后原轮询结果不覆盖。
- Recovery：manifest 的 path/query/header/body、状态映射、artifact 二次请求；Ark、Bailian、MiniMax、Sora、Google、Omni、TokenHub 的真实 HTTP 形状。
- IPC：跨项目注入、跨 Provider/Task ID、无协议历史任务、并发恢复、API Key 缺失和终态回写。
- Canvas：任务节点和任务面板均能恢复；重复 stream、重提交后的旧回调、任务已取消和已有产物均保持单调状态。

## 8. 后续收口

- 完成各内置 manifest 的回归样本和真实渠道沙盒验收后，将本文件状态改为“已落地”。
- 新增或变更 Provider 的 `task_poll`、专用查询接口或产物下载步骤时，必须同步更新本矩阵、manifest 测试和可观测性说明。
