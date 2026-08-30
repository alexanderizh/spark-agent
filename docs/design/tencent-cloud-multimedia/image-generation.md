# 图像生成（TokenHub）

> 状态: 已落地 | 最后核对: 2026-07-23
> 来源: https://cloud.tencent.com/document/product/1823/130080

## 端点

- OpenAI 兼容入口：`https://tokenhub.tencentmaas.com`（境内）/ `https://tokenhub-intl.tencentmaas.com`（新加坡）
- 文生图同步（极速版）：`POST /v1/api/image/lite`
- 文生图/图生图异步提交：`POST /v1/api/image/submit`
- 异步任务查询：`POST /v1/api/image/query`

## 支持模型

| model           | 端点                                           | 同步/异步 | 任务            |
| --------------- | ---------------------------------------------- | --------- | --------------- |
| `hy-image-lite` | `/v1/api/image/lite`                           | 同步      | 文生图          |
| `hy-image-v3.0` | `/v1/api/image/submit` + `/v1/api/image/query` | 异步      | 文生图 / 图生图 |

## 字段命名约定

OpenAI 兼容层把原驼峰转小写下划线，例如 `LogoAdd` → `logo_add`、`RspImgType` → `rsp_img_type`。

## 同步调用示例（极速版）

```http
POST /v1/api/image/lite HTTP/1.1
Host: tokenhub.tencentmaas.com
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "model": "hy-image-lite",
  "prompt": "雨中, 竹林, 小路",
  "rsp_img_type": "url"
}
```

同步响应：

```json
{
  "created": 1774806537,
  "request_id": "ce************c3",
  "data": [{ "url": "https://hyimg*************9c81de85" }]
}
```

## 异步提交示例（3.0）

```http
POST /v1/api/image/submit
Host: tokenhub.tencentmaas.com
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "model": "hy-image-v3.0",
  "prompt": "在图片中增加一个橘猫",
  "images": ["https://example.com/sample.jpeg"]
}
```

异步提交响应：

```json
{
  "id": "251*************0",
  "request_id": "96**********1d4",
  "object": "image_job",
  "created_at": 1774806585,
  "status": "queued"
}
```

## 异步查询示例

```http
POST /v1/api/image/query
Host: tokenhub.tencentmaas.com
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "model": "hy-image-v3.0",
  "id": "251*************0"
}
```

查询响应（已完成）：

```json
{
  "request_id": "5785*****da7f2af",
  "object": "image_job",
  "created_at": 1774806639,
  "completed_at": 1774806639,
  "status": "completed",
  "data": [
    {
      "url": "https://****965e",
      "revised_prompt": "<think>用户希望在图片中增加一****纹理。</recaption><answer><boi><img_size_1024><img_ratio_34>"
    }
  ]
}
```

## `images` 输入说明

- `images` 可以为任意可访问的图片地址（公网 URL）
- 旧混元生图（1668）接口中以 Base64 提交，文档将字段名为 `InputImage` / `InputUrl`

## 状态机

`queued` → `in_progress`（如返回中包含） → `completed` 或失败。失败时返回错误结构（见 `error-codes.md`）。

## Spark-Agent 接入状态

- `hy-image-lite` 已接入同步文生图。
- `hy-image-v3.0` 已接入异步文生图 / 图生图，查询使用 `POST /v1/api/image/query` + `{model, id}`。
- Adapter 会主动下载生成结果到本地产物目录，不依赖临时 URL 的有效期假设。

## 详情页（按混元原生接口，与 TokenHub 同步）

| 接口名                                                  | 文档                                                     |
| ------------------------------------------------------- | -------------------------------------------------------- |
| TextToImageLite                                         | https://cloud.tencent.com/document/product/1668/120721   |
| TextToImageRapid（2.0）                                 | https://cloud.tencent.com/document/product/1668/120720   |
| SubmitTextToImageJob（3.0 提交）                        | https://cloud.tencent.com/document/product/1668/124632   |
| QueryTextToImageJob（3.0 查询）                         | https://cloud.tencent.com/document/product/1668/124633   |
| ImageToImage（图生图）                                  | https://cloud.tencent.com/document/product/1668/88066    |
| SubmitTextToImageProJob（高级版，即将下线）             | https://cloud.tencent.com/document/product/1668/88046 区 |
| ChangeClothes（模特换装）                               | 同 API 文档                                              |
| ReplaceBackground（商品背景生成）                       | 同 API 文档                                              |
| SketchToImage（线稿生图）                               | 同 API 文档                                              |
| RefineImage / ImageInpaintingRemoval / ImageOutpainting | 图像编辑                                                 |

完整原生接口列表见 `legacy-hunyuan-image.md`。
