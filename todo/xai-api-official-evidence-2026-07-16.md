# xAI 多媒体官方文档证据快照（2026-07-16）

来源：`https://docs.x.ai/llms.txt`，抓取日期：2026-07-16。

本文件只记录本轮实现依赖的官方字段形状，避免上下文裁剪后误用 SDK 参数名或猜测 REST 请求体。

## Imagine 输入文件引用

- 官方说明：Imagine 端点接受 URL/base64 的位置均可替换为 Files API `file_id`。
- 图片编辑 REST：`"image": { "file_id": "file_..." }`。
- 多图编辑 REST：`"images": [{ "file_id": "file_..." }, { "url": "https://..." }]`，最多 3 张，可混用 URL/base64/file_id。
- 图生视频 REST：`"image": { "file_id": "file_..." }`。
- 视频编辑/扩展 REST：`"video": { "file_id": "file_..." }`。
- 参考图生视频 REST：`"reference_images": [{ "file_id": "file_..." }]`。
- `image_file_id`、`video_file_id`、`reference_image_file_ids` 是 SDK 参数名；REST JSON 不使用这些顶层字段。

文档章节：`/developers/model-capabilities/imagine/files/inputs`。

## Imagine 产物持久化

- 图片生成、图片编辑、视频生成、视频编辑、视频扩展均支持：
  `"storage_options": { "filename": "...", "public_url": true }`。
- 每个产物独立返回 `file_output.file_id`、`file_output.filename`；成功创建公开地址时返回 `file_output.public_url`。
- 公开地址创建失败时返回 `file_output.public_url_error`，但原始产物和 `file_output.file_id` 仍有效。
- 多图片请求中的每张图片拥有独立 `file_id` 和独立 `public_url`。
- 视频异步轮询完成响应中才出现 `file_output.public_url`。

文档章节：`/developers/model-capabilities/imagine/files/outputs`。

## Files API

- 上传：`POST /v1/files` multipart；`expires_after` 必须排在 `file` 前。
- 单文件限制按当前 managing-files 页面采用 48 MiB 安全上限。
- 列表：`GET /v1/files`，分页字段 `pagination_token`。
- 删除：`DELETE /v1/files/{file_id}`。
- 文件公开地址可通过 Files Public URLs API补建；本期 Imagine 请求默认直接使用 `storage_options.public_url=true`。

文档章节：`/developers/files/managing-files`、`/developers/files/public-urls`。
