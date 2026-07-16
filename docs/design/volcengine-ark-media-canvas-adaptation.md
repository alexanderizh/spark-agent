# 火山方舟多媒体、画布与 Files 适配

> 状态: 已落地 | 最后核对: 2026-07-17

## 目标与边界

本次改造把火山方舟 Seedream、Seedance 和 Files API 接入 Spark-Agent 的统一多媒体契约。画布只保存供应商无关的素材角色和模型参数；火山字段、枚举、互斥规则和请求结构由火山 manifest、validator 与 adapter 负责，不能泄漏到 xAI、APIMart 等其他渠道。

本轮已落地图片、视频、Chat/Responses 协议选择和 Files 生命周期。3D 生成与 AK/SK 管控面动态模型发现仍属于后续独立能力：它们需要新增 3D 资产/画布节点、AK/SK 凭证类型和远端任务恢复协议，不能伪装成现有图片/视频能力。

Seedance 异步链路按 `POST /contents/generations/tasks → GET /contents/generations/tasks/{id}` 执行，状态为 `queued/running/succeeded/failed/cancelled`，成功产物读取 `content.video_url`。创建、渠道任务 ID、每次轮询摘要和下载阶段均写入 `media:volcengine-ark` / `media:task-poll`；创建阶段的 `ModelNotOpen` 表示当前账号未开通目标模型，日志保留官方 RequestId 供控制台与工单核对。

## 官方事实源

- 模型列表：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1330310?lang=zh
- 图片生成 API：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1541523?lang=zh
- Seedream 5.0 Pro：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2582774?lang=zh
- Seedream 交互编辑：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2582775?lang=zh
- 视频生成 API：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1520757?lang=zh
- Seedance 2.0 教程：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2291680?lang=zh
- Chat Completions：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1494384?lang=zh
- Responses API：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1569618?lang=zh
- Files 上传：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1870405?lang=zh
- Files 查询：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1870406?lang=zh
- Files 列表：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1870407?lang=zh
- Files 删除：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1870408?lang=zh
- File object：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1873424?lang=zh

## 分层设计

```text
画布通用角色与素材元数据
  first_frame / last_frame / reference(image|video|audio)
  sizeBytes / width / height / durationMs
                  ↓
模型 manifest
  rolePolicy / maxImages / maxVideos / maxAudios / MIME / paramSchema
                  ↓
Provider validator + adapter
  本地阻断非法组合 → 火山 content[] / 顶层参数 → 任务轮询 → 产物落盘
```

`MediaModelCapabilityManifest` 新增的字段都是可选字段；没有显式声明的其他供应商继续使用原有角色推断，因此公共契约升级保持向后兼容。

画布提交前会把白名单目录内的 `safe-file://` 素材还原为本地路径。火山 adapter 将本地图片/音频编码为官方允许的 Base64；本地参考视频通过 Spark 公共上传回退转换为 HTTPS URL。无法读取或无法公开上传时直接返回精确错误，不会静默丢弃素材后退化为纯文本任务。

## Seedance 输入与参数

Seedance 2.0 系列显式声明最多 9 张参考图、3 段参考视频、3 段参考音频。画布和普通 `spark_media` MCP 都支持：

- 首帧；
- 首帧 + 尾帧；
- 多模态参考图/视频/音频；
- 视频编辑与延长。

提交前会阻止：

- 首帧/首尾帧与多模态参考混用；
- 尾帧脱离首帧；
- 纯音频参考；
- 超过图片、视频、音频数量；
- 参考视频或音频单段/总时长超限；
- 图片/视频尺寸、宽高比或文件大小超限；
- 带媒体输入时启用联网搜索；
- Seedance 2.0 使用 `seed`、`camera_fixed`、`frames`、`flex`；
- `draft=true` 与 `return_last_frame=true` 冲突；
- `service_tier=flex` 与 `priority` 冲突。

Seedance 1.0 Pro Fast 的 manifest 只声明一张首帧，不再向画布暴露尾帧。1.5 Pro 和 1.0 Pro 保留首尾帧，但不暴露 2.0 的多模态参考角色。

## Seedream 模型与参数

- `doubao-seedream-5-0-pro-260628`：5.0 Pro，文生图和最多 10 图编辑；1K/2K；支持 `output_format` 与 standard/fast 提示词优化；不支持组图、流式、联网搜索。
- `doubao-seedream-5-0-lite-260128`：5.0 Lite，最多 14 张参考图；2K/3K/4K；支持组图和联网搜索。
- `doubao-seedream-5-0-260128`：按官方文档作为 Lite 兼容 ID，不再误标为“5.0 主模型”。
- 4.5：2K/4K；支持组图，提示词优化仅 standard。
- 4.0：1K/2K/4K；支持组图，提示词优化支持 standard/fast。

所有模型保留通用 `response_format=url|b64_json`，5.0 Pro/Lite 支持 `output_format=png|jpeg`。当前官方参数表未列出的 `seed`、`guidance_scale`、`negative_prompt` 会在请求前阻止。组图场景强制“参考图数 + 生成图数 ≤ 15”。

5.0 Pro 的 `<point>` / `<bbox>` 交互编辑协议已经进入能力说明，但本轮没有把画布矢量标注编辑器改造成供应商专用坐标编码器；在公共标注语义和可逆数据结构落地前，不自动拼接坐标，避免误编辑。

## Files API

项目资产中心新增 `Files` 主 Tab，并预留渠道子 Tab；当前只实现火山方舟，xAI 等渠道后续通过同一 provider-discriminated IPC 契约接入。火山页可在同渠道的多个 Provider Profile 间切换，支持：

- 本地文件上传，以及 HTTP/HTTPS/TOS URI 导入；
- 平台托管或指定 TOS `bucket/prefix`；
- 1–30 天过期时间；
- 视频 `fps/model/max_video_tokens/min_frame_tokens/max_frame_tokens/min_frames` 预处理；
- `after` 游标分页、状态筛选、单项查询、自动轮询、批量删除；
- 显示 `processing/active/failed`、MIME、文件大小、TOS、过期时间和官方错误信息。

Renderer 不直接持有 API Key；所有请求经 typed IPC 进入主进程，再由 `VolcengineArkFilesClient` 调用官方 `/api/v3/files`。即使 Provider 使用 `/api/coding/v3`，Files client 也会收敛到同源 `/api/v3/files`，避免错误请求到 Coding Plan 路径。

Provider 编辑页的原“Codex API 类型”已改为通用“API 协议”。火山标准 `/api/v3` 模板显式默认 Chat Completions，Coding Plan `/api/coding/v3` 模板默认 Responses；选择结果继续由现有 `codexApiKind` 贯穿连接测试、主对话和画布文本生成路由。

`spark_media` 新增：

- `upload_file`：本地二进制或 URL/TOS 二选一，`purpose=user_data`，可设置目标 TOS `bucket/prefix`、1–30 天过期时间和视频预处理参数，默认等待 `status=active`；
- `get_file`；
- `list_files`：支持 `after`、`limit`、`purpose`、`order`、`scope_id`；
- `delete_file`：属于破坏性操作，Agent 必须先取得用户确认。

Files 的 `file_id` 仅用于 Chat/Responses 理解输入。Seedance 生成 API 使用 URL/Base64/`asset://` 的 `content[]`，不得传入 Files `file_id`。

## 验证基线

- 所有内置 manifest 通过 Zod 和语义校验；
- xAI/APIMart/火山 adapter 回归；
- 火山素材角色、数量、时长、参数冲突专项测试；
- `spark_media` MCP 对 Seedance 嵌套 `content[]` 与 Files CRUD 的子进程测试；
- protocol、agent-runtime、desktop TypeScript strict 检查。
