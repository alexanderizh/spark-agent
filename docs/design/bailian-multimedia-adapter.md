# 阿里云百炼多媒体适配设计

> 状态: 已落地 | 最后核对: 2026-08-10

百炼 Provider 通过 `BailianMediaAdapter` 接入统一 `MediaRouterService`，因此模型在 Provider 配置中启用后，画布和内置 `spark_media`/多媒体 Skill 使用同一份 Manifest、角色策略、请求编译和错误模型。

## 已实施的 Wan 2.7 范围

- 图像：`wan2.7-image-pro` / `wan2.7-image`，同步 DashScope 原生协议；图片结果立即写入本地产物。
- 图像尺寸：任务面板提供 1K/2K/4K（按模型能力）和经过 provider 文档核对的
  `width*height` 画幅示例；百炼 Wan 2.7 接受官方像素范围内的自定义尺寸，并在适配器中
  校验像素面积与 1:8–8:1 宽高比约束。Qwen Image 2.0 使用官方推荐画幅，并校验总像素
  在 `512*512` 至 `2048*2048` 范围内。
- 视频：`wan2.7-t2v-2026-06-12`、`wan2.7-i2v-2026-04-25`、`wan2.7-r2v-2026-06-12`、`wan2.7-videoedit`；异步任务轮询成功后立即下载视频。
- 输入角色：画布和 Skill 的通用首帧、尾帧、参考图片/视频/音频被映射为百炼 `media[].type`。提交前阻断不合法的首尾帧、音频驱动、视频续写与视频编辑组合。

## 配置与协议

Provider endpoint 可使用百炼公共 DashScope 地址，或含业务空间的 `https://{WorkspaceId}.{region}.maas.aliyuncs.com` 地址。API Key 必须和地域匹配。适配器会标准化为 DashScope 原生 `/api/v1/services/aigc` 与 `/api/v1/tasks/{task_id}` 路径。

官方资料：

- https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference
- https://help.aliyun.com/zh/model-studio/image-to-video-general-api-reference
- https://help.aliyun.com/zh/model-studio/wan-reference-to-video-api-reference
- https://help.aliyun.com/zh/model-studio/wan-video-editing-api-reference

## 有意保留的边界

百炼的 Managed Agents、DashScope 原生和 OpenAI 兼容 Files API 具有不同 file ID 语义。首期文件管理使用仅在北京 Region 开放的 DashScope 原生 `https://dashscope.aliyuncs.com/api/v1/files`，支持上传、查询、分页列表和删除；上传只允许官方明确列出的 `fine-tune`、`file-extract`、`batch` purpose，并逐项报告部分失败。

内置 `spark_media` 同时支持百炼异步任务的单任务查询、24 小时窗口内的列表查询和 `PENDING` 状态任务取消；所有远端请求保留官方 `request_id`，并在错误中返回渠道的 `code`/`message` 供用户定位。

官方文件页没有声明此协议的 `file_id` 或返回下载 URL 能作为万相图像/视频生成素材。因此不会把它们自动透传给视频/图片模型；画布素材继续使用各模型 API 明确允许的 URL 形式，避免跨协议误传。

Files 官方资料：

- https://help.aliyun.com/zh/model-studio/upload-file-api
- https://help.aliyun.com/zh/model-studio/get-file-api
- https://help.aliyun.com/zh/model-studio/manage-asynchronous-tasks
