# 视频渠道异步任务可靠性修复

> 状态: 已落地 | 最后核对: 2026-07-17

## 背景

画布视频任务会依次经历输入准备、渠道任务创建、异步轮询和产物下载。此前这几个阶段缺少可关联的日志，且不同渠道存在各自的终态契约问题，最终都表现为界面长时间 loading 后超时。

## 已落地行为

### APIMart

- 视频创建仍使用 `POST /v1/videos/generations`。
- 图片和视频异步任务统一通过 `GET /v1/tasks/{task_id}` 查询。
- 成功响应从统一任务结果中提取视频地址并下载。

### xAI

- 视频成功终态接受官方标准 `status=done` 与 `video.url`。
- 若 `file_output.public_url` 可用则优先下载持久化地址；持久化失败时回退临时 `video.url`，不再把已生成任务继续当作 pending。
- 图生视频只准备真正使用的首帧，避免上传未使用图片。
- 视频提示词超过 4096 字符时在本地阻止提交。
- xAI Files 请求 30 秒超时；图片上传失败或超时时回退为 data URL。

### 火山方舟

- 保持官方 `POST /contents/generations/tasks` 创建和 `GET /contents/generations/tasks/{id}` 查询契约。
- 轮询识别 `queued`、`running`、`succeeded`、`failed` 和 `cancelled`，成功产物读取 `content.video_url`。
- 创建阶段沿用渠道错误提取器，保留 `ModelNotOpen` 等官方错误和 RequestId；该错误表示账号未开通目标模型，不能通过继续轮询修复。

## 日志与安全

- 公共轮询日志记录脱敏后的端点、尝试次数和累计耗时，并允许 adapter 附加 provider、capability、渠道任务 ID 和状态摘要。
- xAI 额外记录输入准备、Files 上传、任务创建和产物下载分段耗时。
- 未传渠道摘要的旧 adapter 也会记录轮询端点、尝试次数、终态和累计耗时，便于区分创建失败与轮询超时。
- API Key、Authorization、base64 原文和 URL query/fragment 不进入日志；超长 prompt 仅保留截断预览与原字符数。

## 验证基线

- xAI 官方临时 URL、CDN 持久化失败、未使用图片、提示词上限和 Files 超时专项测试。
- APIMart 统一任务端点回归测试。
- 火山 Seedance 创建、轮询、终态和下载回归测试。
- 公共轮询脱敏、超时错误和最后响应摘要测试。
