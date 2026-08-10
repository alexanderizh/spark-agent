> 来源: 阿里云百炼官方帮助中心 `help.aliyun.com/help/json/document_detail.json?nodeId=` | 抓取: 2026-07-19
>
> 本文件仅记录官方页面明确写出的字段,未做任何推测。

# 千问 Qwen 图像模型 — 官方 API 参数

抓取入口(控制台 nodeId → 帮助中心 alias):

| 控制台 nodeId | 帮助中心 alias | 标题 | 能力 |
|---|---|---|---|
| 2975126 | `/model-studio/qwen-image-api` | 千问-文生图 | 纯文本生图 |
| 2976416 | `/model-studio/qwen-image-edit-api` | 千问-图像编辑 | 图生图 / 多图融合 / 编辑 |

原始 JSON: `raw/qwen-image-api.json`、`raw/qwen-image-edit-api.json`;纯文本: `raw/qwen-image-api.txt`、`raw/qwen-image-edit-api.txt`。

---

## 1. 接入协议

- 同步接口(官方推荐): `POST /api/v1/services/aigc/multimodal-generation/generation`
- 北京: `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`
- 新加坡: `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`
- 鉴权: `Authorization: Bearer $DASHSCOPE_API_KEY`
- 与 wan2.7 同步图像走**同一端点**;但请求体结构不同(见下)。

---

## 2. 文生图模型(qwen-image-api)

### 2.1 模型清单(稳定别名 → 当前快照)

| modelId(稳定别名) | 当前等价快照 | 备注 |
|---|---|---|
| `qwen-image-2.0-pro` ⭐ | qwen-image-2.0-pro-2026-04-22 | Pro 系列,文字渲染/真实质感/语义遵循更强 |
| `qwen-image-2.0-pro-2026-06-22` ⭐ | — | |
| `qwen-image-2.0-pro-2026-04-22` | — | |
| `qwen-image-2.0-pro-2026-03-03` | — | |
| `qwen-image-2.0` ⭐ | qwen-image-2.0-2026-03-03 | 加速版,兼顾效果与速度 |
| `qwen-image-2.0-2026-03-03` ⭐ | — | |
| `qwen-image-max` | qwen-image-max-2025-12-30 | 默认 1664*928 |
| `qwen-image-max-2025-12-30` | — | |
| `qwen-image-plus` | qwen-image | |
| `qwen-image-plus-2026-01-09` | — | |
| `qwen-image` | — | |

> 推荐对外暴露稳定别名(`qwen-image-2.0-pro` / `qwen-image-2.0` / `qwen-image-max` / `qwen-image-plus` / `qwen-image`),带日期的快照作为可选项。

### 2.2 请求体(关键:与 wan 不同)

```json
{
  "model": "qwen-image-2.0-pro",
  "input": {
    "messages": [
      { "role": "user", "content": [ { "text": "正向提示词" } ] }
    ]
  },
  "parameters": {
    "negative_prompt": "反向提示词",
    "prompt_extend": true,
    "watermark": false,
    "size": "2048*2048"
  }
}
```

要点:
- `parameters` 是**与 `input` 平级的顶层字段**(不是 `input.parameters`)。
- prompt 放在 `input.messages[0].content[0].text`,**不是** wan 的 `input.prompt`。
- `messages` 仅 1 个元素,单轮;`content` 仅支持**1 个 text**(多个报错)。

### 2.3 参数约束

| 参数 | 类型 | 必选 | 约束 |
|---|---|---|---|
| `model` | string | 是 | 见 2.1 |
| `input.messages[].role` | string | 是 | 固定 `user` |
| `input.messages[].content[].text` | string | 是 | 2.0 系列 ≤1300 Token,其他 ≤800 Token,超出截断;仅 1 个 |
| `parameters.negative_prompt` | string | 否 | ≤500 字符 |
| `parameters.size` | string | 否 | 格式 `宽*高`(星号) |
| `parameters.n` | integer | 否 | 2.0 系列 1–6;**max/plus 固定 1**,其他值报错 `InvalidParameter: num_images_per_prompt must be 1` |
| `parameters.prompt_extend` | bool | 否 | 默认 `true` |
| `parameters.watermark` | bool | 否 | 默认 `false`,右下角 "Qwen-Image" 水印 |
| `parameters.seed` | integer | 否 | `[0, 2147483647]` |

size 取值:
- **2.0 系列**: 像素区间 `512*512` ~ `2048*2048`,默认 `2048*2048`;推荐 `2688*1536`(16:9)、`1536*2688`(9:16)、`2048*2048`(1:1)、`2368*1728`(4:3)、`1728*2368`(3:4)。
- **max / plus 系列**: 默认 `1664*928`;可选 `1664*928`(16:9)、`1472*1104`(4:3)、`1328*1328`(1:1)、`1104*1472`(3:4)、`928*1664`(9:16)。

### 2.4 响应(同步,直接返回结果)

```json
{
  "output": {
    "choices": [{
      "finish_reason": "stop",
      "message": {
        "role": "assistant",
        "content": [{ "image": "https://dashscope-result-*.oss-*.aliyuncs.com/xxx.png?Expires=xxx" }]
      }
    }]
  },
  "usage": { "height": 2048, "image_count": 1, "width": 2048 },
  "request_id": "..."
}
```

- 图片 URL **24 小时失效**,必须立即下载。
- 多张图时 `choices` 内返回多元素(按官方"一次请求即可获得结果")。

---

## 3. 图像编辑模型(qwen-image-edit-api)

### 3.1 模型清单

| modelId(稳定别名) | 当前等价快照 | 备注 |
|---|---|---|
| `qwen-image-2.0-pro` ⭐ | qwen-image-2.0-pro-2026-04-22 | **生图+编辑二合一**(与文生图同名) |
| `qwen-image-2.0-pro-2026-06-22` ⭐ | — | |
| `qwen-image-2.0-pro-2026-04-22` | — | |
| `qwen-image-2.0-pro-2026-03-03` | — | |
| `qwen-image-2.0` ⭐ | qwen-image-2.0-2026-03-03 | 加速版,**生图+编辑二合一** |
| `qwen-image-2.0-2026-03-03` ⭐ | — | |
| `qwen-image-edit-max` | qwen-image-edit-max-2026-01-16 | 工业设计/几何推理/角色一致性 |
| `qwen-image-edit-max-2026-01-16` | — | |
| `qwen-image-edit-plus` | qwen-image-edit-plus-2025-10-30 | 多图输出+自定义分辨率 |
| `qwen-image-edit-plus-2025-12-15` | — | |
| `qwen-image-edit-plus-2025-10-30` | — | |
| `qwen-image-edit` | — | 单图编辑和多图融合 |

> ⭐ `qwen-image-2.0-pro` / `qwen-image-2.0` 在文生图与图像编辑两个文档里**同时出现且同名** —— 这两个模型是"生图编辑二合一",既能纯文生图(无输入图),也能图生图/编辑(有输入图)。路由应按"是否有输入图"区分 capability,而非按 modelId。

### 3.2 请求体

```json
{
  "model": "qwen-image-2.0-pro",
  "input": {
    "messages": [{
      "role": "user",
      "content": [
        { "image": "https://输入图1" },
        { "image": "https://输入图2" },
        { "text": "编辑指令" }
      ]
    }]
  },
  "parameters": { "negative_prompt": " ", "size": "2048*2048" }
}
```

要点:
- `content`: **1–3 张 image**(URL 或 Base64 `data:image/jpeg;base64,...`) + **1 个 text** 编辑指令。
- 多图按数组顺序;输出比例以**最后一张**输入图为准。
- GIF 仅处理第一帧。
- 不使用 mask / bbox;纯自然语言指令驱动(与 wan2.7 的 `bbox_list` 不同)。

### 3.3 参数约束

| 参数 | 约束 |
|---|---|
| `content[].image` | 1–3 张 |
| `content[].text` | 仅 1 个;2.0 系列 ≤1300 Token,其他 ≤800 Token |
| `parameters.n` | 2.0 系列 / edit-max / edit-plus: 1–6;**`qwen-image-edit` 仅 1** |
| `parameters.size` | `宽*高`;2.0 系列 512*512~2048*2048;max/plus 默认接近 1024*1024;系统调整到最接近 16 的倍数 |
| `parameters.prompt_extend` | 默认 `true`,**`qwen-image-edit` 不支持** |
| `parameters.negative_prompt` | 可选 |
| `parameters.seed` | `[0, 2147483647]` |

### 3.4 响应

与文生图完全一致:`output.choices[].message.content[].image`,URL 24h 失效。

---

## 4. 错误结构(两个模型族一致)

```json
{ "request_id": "...", "code": "InvalidParameter", "message": "num_images_per_prompt must be 1" }
```

- 错误为**顶层** `code` / `message` / `request_id`(与 wan 异步任务的 `output.code` 不同)。
- 常见:`InvalidParameter`、`InvalidApiKey`。

---

## 5. 与现有 wan2.7 适配器的关键差异(实现要点)

| 维度 | wan2.7(已接入) | qwen(待接入) |
|---|---|---|
| 端点 | `multimodal-generation/generation`(同步图像) | **同端点** |
| prompt 位置 | `input.prompt` | `input.messages[0].content[0].text` |
| 参数位置 | `parameters`(顶层) | `parameters`(顶层,结构一致) |
| 输入图 | `input.image_url` / `input.image` | `input.messages[0].content[].image`(数组,1–3 张) |
| size 格式 | `1K/2K/4K` | `宽*高`(星号,如 `2048*2048`) |
| n 限制 | wan2.7 组图 1–12 | 2.0 系列 1–6;**max/plus/edit 固定 1** |
| 二合一 | 否(文生图/编辑不同模型) | **是**(`qwen-image-2.0-pro`/`qwen-image-2.0` 同名双能) |
| 编辑方式 | `bbox_list` 坐标框 | 自然语言指令,无 mask |

> 结论:qwen 不能复用 wan 的请求体构造路径,需在 `BailianMediaAdapter` 内按 modelId 前缀(`qwen-image*` / `qwen-image-edit*`)分流到独立的请求体构造器;响应解析(`output.choices[].message.content[].image`)可复用现有同步图像提取逻辑。
