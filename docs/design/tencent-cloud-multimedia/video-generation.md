# 视频生成（TokenHub）

> 状态: 实施中 | 最后核对: 2026-07-22
> 来源: https://cloud.tencent.com/document/product/1823/130081

## 端点

- 异步提交：`POST /v1/api/video/submit`
- 异步查询：`POST /v1/api/video/query`

## 支持模型

| model | 接口名（原 3.0 协议） | 任务 |
| --- | --- | --- |
| `hy-video-1.5` | SubmitHunyuanToVideoJob / DescribeHunyuanToVideoJob | 文生视频 / 图生视频 |
| `yt-video-2.0` | SubmitImageToVideoGeneralJob / DescribeImageToVideoGeneralJob | 图生视频（通用） |
| `yt-video-fx` | SubmitTemplateToVideoJob / DescribeTemplateToVideoJob | 视频特效（图片 + 模板） |
| `yt-video-humanactor` | SubmitHumanActorJob / DescribeHumanActorJob | 人像驱动（参考照片） |

另：可灵（Kling）和 Vidu 系列的视频模型通过同一组 `/v1/api/video/{submit|query}` 端点访问，提交时 `model` 字段传对应 model id。

## 文生视频提交示例（HY-Video-1.5）

```http
POST /v1/api/video/submit
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "model": "hy-video-1.5",
  "prompt": "小河流水"
}
```

响应：

```json
{
  "id": "143*************128",
  "request_id": "d5******-****-****-****-********c506",
  "object": "video",
  "created_at": 1775196710,
  "status": "queued"
}
```

## 视频查询示例

```http
POST /v1/api/video/query
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "model": "hy-video-1.5",
  "id": "1429*****0"
}
```

响应（已完成）：

```json
{
  "request_id": "bb*******93",
  "object": "video",
  "created_at": 1774807628,
  "completed_at": 1774807628,
  "status": "completed",
  "progress": 100,
  "data": { "url": "https://vc*******e6a6" }
}
```

## 图生视频示例（YT-Video-2.0）

```http
POST /v1/api/video/submit
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "model": "yt-video-2.0",
  "image": { "url": "https://obj1-******.jpeg" }
}
```

## 字段命名约定

所有参数在 OpenAI 兼容层统一以小写下划线呈现（`LogoAdd` → `logo_add`）。Kling / Vidu 模型参数以 `video.md` 中各接口详尽为准。

## 异步任务

- `id`：任务 ID，提交时返回；查询时回传
- `status`：`queued` / `in_progress` / `completed`
- `progress`：0-100 整数（部分模型返回）
- `data.url`：生成视频文件 URL，**URL 1 小时有效**（旧文档惯例）

## 模板列表与特效

视频特效模型（`yt-video-fx`）依赖 `template` 参数指定模板 ID，模板枚举见 `video-effects.md` 与文档：
- 主入口：https://cloud.tencent.com/document/product/1616 （模板列表导航）
- 各模板详细参数待二次采集