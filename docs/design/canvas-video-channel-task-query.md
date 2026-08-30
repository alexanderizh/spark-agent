# 画布渠道视频任务查询

> 状态: 已落地 | 最后核对: 2026-08-09

## 目标

在画布侧栏新增「渠道视频任务」页面，统一查看各视频渠道的异步任务。目前支持火山方舟、阿里云百炼和 MiniMax 官方渠道，后续渠道通过同一任务查询契约接入，不把供应商字段和鉴权逻辑写入页面。

## API 验证结论

火山方舟官方任务列表接口可达：

```text
GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks?page_num=1&page_size=1
Authorization: Bearer <API Key>
```

2026-08-08 在无凭据环境下请求返回 HTTP 401 `AuthenticationError`，说明官方地址和鉴权入口有效；当前工作区没有可用于真实成功调用的火山 API Key，因此未伪造成功结果。应用运行时会从已配置的 Provider Keychain 读取 API Key，在主进程完成真实请求。

阿里云百炼任务管理接口使用同一 Provider 的 Bearer API Key：

```text
GET  https://dashscope.aliyuncs.com/api/v1/tasks/?page_no=1&page_size=20
GET  https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}
POST https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}/cancel
Authorization: Bearer <API Key>
```

2026-08-08 在无凭据环境下请求列表接口返回 HTTP 401，说明官方地址和鉴权入口有效；当前工作区没有真实阿里云 API Key，因此未伪造成功调用结果。

官方文档说明：列表支持 `page_no`、`page_size`、`status`、`model_name`，详情返回 `output.task_status` 和视频结果；取消接口仅支持取消 `PENDING` 状态任务。阿里云百炼也支持工作空间域名 `{WorkspaceId}.{region}.maas.aliyuncs.com`。

MiniMax 任务管理使用同一 Provider 的 Bearer API Key。V2 任务支持分页列表、详情和取消/删除：

```text
GET    https://api.minimaxi.com/v2/query/video_generation?page_num=1&page_size=20
GET    https://api.minimaxi.com/v2/query/video_generation/{task_id}
DELETE https://api.minimaxi.com/v2/video_generation/{task_id}
Authorization: Bearer <API Key>
```

官方 V2 删除接口会按任务状态取消排队任务，或删除成功/失败任务记录；旧版 Hailuo 任务详情兼容
`GET https://api.minimaxi.com/v1/query/video_generation?task_id={task_id}`。当前没有可用于真实成功调用的 MiniMax API Key，因此只完成了官方地址/协议确认和 mock 联调。
2026-08-08 在无凭据环境下请求 V2 列表接口返回 HTTP 401，说明官方地址和鉴权入口有效；未伪造成功结果。

本轮对应官方接口：

- 创建任务：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1520757?lang=zh
- 查询单个任务：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1521309?lang=zh
- 查询任务列表：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1521675?lang=zh
- 删除任务：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1521720?lang=zh
- MiniMax V2 查询任务：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-query
- MiniMax V2 查询列表：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-list
- MiniMax V2 取消/删除：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-delete
- MiniMax 旧版任务查询：https://platform.minimaxi.com/docs/api-reference/video-generation-query

## 分层架构

```text
画布页面
  ↓ typed IPC（不携带 API Key）
主进程 Provider Resolver
  ↓ Provider Profile + Keychain
VideoChannelTaskProvider
  ├─ VolcengineArkVideoTaskClient
  ├─ BailianVideoTaskClient
  ├─ MinimaxVideoTaskClient
  └─ 后续：其他渠道 client
```

公共协议位于 `packages/protocol/src/video-channel-tasks.ts`，包含归一后的任务字段和 `list/get/delete` IPC 映射。供应商客户端位于 `packages/agent-runtime/src/services/media/`，页面只消费 `id/model/status/videoUrl/error/createdAt` 等稳定字段。

## 火山方舟实现

- 官方多媒体任务固定使用 `/api/v3`，避免复用聊天或 Coding Plan 的 `/api/coding/v3`。
- 列表请求支持 `page_num`、`page_size`、`filter.status`、`filter.model`、重复的 `filter.task_ids` 参数。
- 状态归一为 `submitted`、`queued`、`running`、`succeeded`、`failed`、`expired`、`cancelled` 和 `unknown`。
- 成功产物读取 `content.video_url`；尾帧读取 `content.last_frame_url`；时间戳兼容 Unix 秒和 ISO 字符串。
- 401/403、429、参数错误和其它渠道错误在 IPC 边界分别映射为可识别的 Provider 错误，Key、Authorization 和响应中的敏感 URL 不返回到日志或页面。

## 阿里云百炼实现

- 通过 `dashscope.aliyuncs.com` 或官方 `*.maas.aliyuncs.com` 基础域名识别百炼渠道，不接受代理地址。
- 列表请求使用 `/api/v1/tasks/`，将公共分页、状态和模型筛选转换为百炼的 `page_no`、`page_size`、`status`、`model_name`。
- 百炼状态 `PENDING`、`RUNNING`、`SUCCEEDED`、`FAILED`、`CANCELED` 分别归一为排队中、生成中、已完成、失败和已取消。
- 百炼没有删除任务接口，页面操作显示为「取消」，主进程调用 `/tasks/{task_id}/cancel`；仅排队中的任务可以取消。

## MiniMax 实现

- 通过 `api.minimaxi.com` 基础域名识别 MiniMax 官方渠道，不接受代理地址。
- 任务页仅展示声明 `MiniMax-H3` 的 Provider；Hailuo V1 和视频 Agent 没有对应的 V2 分页列表接口，不会被误展示为可查询渠道。
- V2 列表请求使用 `/v2/query/video_generation`，支持公共分页、状态、任务 ID 和模型筛选。
- V2 详情使用 `/v2/query/video_generation/{task_id}`；详情请求失败且为 400/404 时回退到旧版
  `/v1/query/video_generation?task_id={task_id}`，兼容 Hailuo 2.3 等历史任务。
- V2 删除使用 `DELETE /v2/video_generation/{task_id}`，根据官方返回的 `action/status` 归一为取消或删除。
- MiniMax V2 的视频结果从 `task.content.url` 读取；旧版查询只返回 `file_id`，页面保留状态、尺寸和错误信息，视频地址由既有 Files 能力负责获取。

## 页面能力

- 画布菜单栏新增「渠道视频任务」。
- 查询前必须先选择已配置的 Provider Profile，不自动选择第一个配置，也不会在未选择时发起任务请求。
- 页面下拉只展示渠道/Provider 名称，不把模型名混入选项；API Key 归属于被选中的 Provider。
- 通过 Provider 的基础 Endpoint 主机名识别官方渠道，仅展示火山 `ark.cn-beijing.volces.com`、百炼 `dashscope.aliyuncs.com` / `*.maas.aliyuncs.com` 或 MiniMax `api.minimaxi.com`；代理地址、查询参数中的同名域名不会被识别。
- 仅展示已启用、存在 Keychain 引用且声明视频模型类型或 `video.*` 能力的 Provider Profile。
- 选中后 IPC 只传递 Provider Profile ID，主进程按该 ID 读取对应 Keychain API Key，再调用对应渠道接口。
- 表格展示任务 ID、模型、状态、创建时间、结果和操作。
- 支持本地关键词搜索、远端状态筛选、分页、详情刷新、打开视频和删除渠道任务。
- 未配置受支持的官方视频渠道或 API Key 时显示可操作的配置提示。

## 后续扩展约定

新增渠道时只需要：

1. 在 `VideoChannelTaskProviderKind` 增加渠道标识。
2. 新增一个实现 `VideoChannelTaskProvider` 的客户端，完成原始响应归一。
3. 在公共 Endpoint 解析器和主进程 Provider Resolver 注册该客户端和 API Key/Endpoint 解析规则。
4. 补充客户端 mock 测试和官方文档 URL；页面无需新增供应商分支。

## 验证记录

- [x] 官方 endpoint 无 Key 返回 401，确认 URL 与 Bearer 鉴权入口可达。
- [x] 阿里云百炼官方任务管理文档确认列表、详情和取消接口，以及 API Key Bearer 鉴权方式。
- [x] MiniMax 官方文档确认 V2 列表、详情、取消/删除接口，以及旧版详情查询和 API Key Bearer 鉴权方式。
- [ ] 配置真实火山 API Key 后执行列表、详情和删除接口联调。
- [ ] 配置真实阿里云百炼 API Key 后执行列表、详情和取消接口联调。
- [ ] 配置真实 MiniMax API Key 后执行 V2 列表、详情、取消/删除和旧版详情接口联调。
- [x] 完成 protocol、agent-runtime、desktop 类型检查和专项测试。
