# 3D 生成（TokenHub）

> 状态: 实施中 | 最后核对: 2026-07-22
> 来源: https://cloud.tencent.com/document/product/1823/130082

## 端点

- 异步提交：`POST /v1/api/3d/submit`
- 异步查询：`POST /v1/api/3d/query`

## 支持模型

| model | 任务 | 默认并发 | 说明 |
| --- | --- | --- | --- |
| `hy-3d-3.0` | 文生 3D / 图生 3D / 多视图 3D / 单几何（白模）/ 草图生 3D / 智能拓扑生 3D | 3 | 专业版，3.0 |
| `hy-3d-3.1` | 文生 3D / 图生 3D / 八视图生 3D / 单几何（白模） | 3 | 专业版，3.1，几何/纹理更优 |
| `hy-3d-express` | 文生 3D / 图生 3D | 1 | 极速版，1 分 30 秒内生成 |

接口名（原生协议）：

| model | 提交接口 | 查询接口 |
| --- | --- | --- |
| `hy-3d-3.0` / `hy-3d-3.1` | `SubmitHunyuanTo3DProJob` | `QueryHunyuanTo3DProJob` |
| `hy-3d-express` | `SubmitHunyuanTo3DRapidJob` | `QueryHunyuanTo3DRapidJob` |

## 输入图片要求

- 大小：不超过 10 MB（编码后会增加 ~30%，建议上传 ≤ 8 MB）
- 分辨率：最低 128x128，最高 5000x5000
- 建议：
  - 背景简洁（纯色背景）
  - 不含文字或渐变色
  - 仅包含单一主体
  - 主体在画面中占比超过 50%

## 提交示例

```http
POST /v1/api/3d/submit
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "model": "hy-3d-3.0",
  "prompt": "一只小狗"
}
```

提交响应：

```json
{
  "id": "14*******984",
  "request_id": "75********33",
  "object": "3d_job",
  "created_at": 1774806931,
  "status": "queued"
}
```

## 查询示例

```http
POST /v1/api/3d/query
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "model": "hy-3d-3.0",
  "id": "1429890795996585984"
}
```

生成中：

```json
{
  "request_id": "c41*******bf",
  "object": "3d_job",
  "created_at": 1774806968,
  "status": "in_progress"
}
```

已完成（返回两种格式）：

```json
{
  "request_id": "7824******50",
  "object": "3d_job",
  "created_at": 1774807344,
  "completed_at": 1774807344,
  "status": "completed",
  "data": [
    {
      "type": "obj",
      "url": "https://hunyuan-test*******552a3",
      "preview_image_url": "https://hunyuan-test*******125a56c0081cc404"
    },
    {
      "type": "glb",
      "url": "https://hunyuan*****-b668642f9ae",
      "preview_image_url": "https://hunyuan****1deca56c0081cc404"
    }
  ]
}
```

`data[].type` 包含 `obj` 和 `glb`，每个对应一个 `url` 和 `preview_image_url`。

## 字段命名约定

OpenAI 兼容层把所有驼峰转小写下划线，例如 `ResultFormat` → `result_format`。