# MiniMax 视频生成 Agent（Video Template Generation）对接

> 状态: 已落地 | 最后核对: 2026-07-31

本文档汇总 MiniMax 开放平台"视频生成 Agent"模块的官方对接信息：创建任务、查询任务状态、完整模板清单与鉴权/错误约定。所有字段均来自官方文档原文；标注 `(来源：…)` 的为可回溯链接。

视频生成 Agent 与"视频生成（Video Generation，文生视频/图生视频）"是**两套独立的异步通道**：路径、轮询接口、状态枚举、响应字段均不同。视频生成（v1 / Hailuo 系列）走 `/v1/video_generation` + `/v1/query/video_generation`；视频生成 v2 / MiniMax-H3 走 `/v2/video_generation`；视频 Agent 走 `/v1/video_template_generation` + `/v1/query/video_template_generation`。(来源：https://platform.minimaxi.com/docs/api-reference/video-agent-create ；https://platform.minimaxi.com/docs/api-reference/video-generation-query ；https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create)

## 0. 入口 URL 与归属

| 模块 | 入口 URL | 备注 |
| --- | --- | --- |
| 视频生成 Agent 接口说明 | https://platform.minimaxi.com/docs/api-reference/video-agent-create | OpenAPI 文档（与 api-overview 互补） |
| 创建视频 Agent 任务 | https://platform.minimaxi.com/docs/api-reference/video-agent-create | endpoint 仍可用；markdown 源中未出现 deprecated 标注 |
| 查询视频 Agent 任务状态 | https://platform.minimaxi.com/docs/api-reference/video-agent-query | 同上 |
| 视频 Agent 模板列表 | https://platform.minimaxi.com/docs/faq/video-agent-templates | 唯一模板清单来源；api-overview 不含模板小节 |

(来源：https://platform.minimaxi.com/docs/api-reference/video-agent-create ；https://platform.minimaxi.com/docs/faq/video-agent-templates)

## 1. 鉴权

- 认证方式：HTTP Bearer。Header `Authorization: Bearer <API_KEY>`。API Key 在 `账户管理 > 接口密钥` 创建。(来源：https://platform.minimaxi.com/docs/api-reference/video-agent-create)
- 与"视频生成"模块共用同一组 API Key（按量计费 Key 即可调用所有模态，含视频 Agent）。
- `Content-Type: application/json`（默认值，文档要求必填）。(来源：https://platform.minimaxi.com/docs/api-reference/video-agent-create)
- Base URL：`https://api.minimaxi.com`（国际站：`https://api.minimax.io/v1`，与接口概览示例一致）。

## 2. 创建视频 Agent 任务

### 2.1 Endpoint

| 项 | 值 |
| --- | --- |
| HTTP 方法 | `POST` |
| 路径 | `/v1/video_template_generation` |
| 完整 URL | `https://api.minimaxi.com/v1/video_template_generation` |
| 是否异步 | 是，返回 `task_id` 后需轮询查询接口 |

(来源：https://platform.minimaxi.com/docs/api-reference/video-agent-create)

### 2.2 请求头

| 字段 | 必填 | 取值 |
| --- | --- | --- |
| `Authorization` | 是 | `Bearer <API_KEY>` |
| `Content-Type` | 是 | `application/json`（默认/唯一允许） |

(来源：https://platform.minimaxi.com/docs/api-reference/video-agent-create)

### 2.3 请求体（application/json）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `template_id` | string | 是 | 视频模板的 ID。具体模板清单见本文档第 4 节。 |
| `media_inputs` | object[] | 否 | 媒体输入数组（如图片），用于填充模板中的媒体部分；不同模板对此要求不同。每项字段结构见 2.4。 |
| `text_inputs` | object[] | 否 | 文本输入数组，用于填充模板中的文本部分；不同模板对此要求不同。每项字段结构见 2.4。 |
| `callback_url` | string | 否 | 接收任务状态更新通知的回调 URL，详见 2.5。 |

(来源：https://platform.minimaxi.com/docs/api-reference/video-agent-create)

> 注：文档对 `media_inputs` / `text_inputs` 仅在示例中展示了 `{ "value": "..." }` 结构，**子属性面板（"Show child attributes"）在抓取时未展开**。当前可确认的字段只有 `value`；如下游需要其它命名键（`name` / `key` 等），需在示例之外单独验证（参考"模板清单"节中标 `/` 的模板：`生无可恋` 无 media_inputs，`绝地求生` 同时需要 media + text）。
>
> 注：OpenAPI `MediaInput` schema 已明文给出 `value` 字段的图像约束（格式/大小/尺寸/比例），见第 8 节第 4 条；`TextInput` schema 仅含 `value: 具体的文本内容`。

### 2.4 输入数组元素结构（来自官方示例）

```json
{
  "template_id": "393769180141805569",
  "media_inputs": [
    {
      "value": "https://cdn.hailuoai.com/prod/2024-09-18-16/user/multi_chat_file/9c0b5c14-ee88-4a5b-b503-4f626f018639.jpeg"
    }
  ],
  "text_inputs": [
    {
      "value": "狮子"
    }
  ]
}
```

(来源：https://platform.minimaxi.com/docs/api-reference/video-agent-create)

### 2.5 `callback_url` 协议（可选）

配置后 MiniMax 服务器会向 `callback_url` 发送 POST 校验与状态推送：

1. **地址验证**：服务端先发一次 POST，请求体包含 `challenge`；被调方需在 3 秒内原样返回 `challenge` 完成验证。
2. **状态更新**：验证通过后，每次状态变更推送一次；推送数据结构与"查询视频 Agent 任务状态"接口响应一致。

回调返回 `status` 字符串取值（与查询接口不同，使用小写）：

| 回调 status | 含义 |
| --- | --- |
| `processing` | 生成中 |
| `success` | 成功 |
| `failed` | 失败 |

(来源：https://platform.minimaxi.com/docs/api-reference/video-agent-create)

> 注：回调 `status` 取值集合（processing/success/failed）与查询接口的 `Preparing/Processing/Success/Fail` 大小写不同，注意区分。

### 2.6 响应（200 application/json）

```json
{
  "task_id": "401047179385389059",
  "base_resp": {
    "status_code": 0,
    "status_msg": "success"
  }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `task_id` | string | 任务的唯一 ID，可用于后续查询任务状态 |
| `base_resp.status_code` | int | 0 = 成功；其它见本文档第 5 节错误码 |
| `base_resp.status_msg` | string | 状态详情描述 |

(来源：https://platform.minimaxi.com/docs/api-reference/video-agent-create)

## 3. 查询视频 Agent 任务状态

### 3.1 Endpoint

| 项 | 值 |
| --- | --- |
| HTTP 方法 | `GET` |
| 路径 | `/v1/query/video_template_generation` |
| 完整 URL | `https://api.minimaxi.com/v1/query/video_template_generation` |
| 鉴权 | `Authorization: Bearer <API_KEY>` |

(来源：https://platform.minimaxi.com/docs/api-reference/video-agent-query)

### 3.2 查询参数

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `task_id` | string | 是 | 待查询的任务 ID。**只能查询当前账号创建的任务** |

(来源：https://platform.minimaxi.com/docs/api-reference/video-agent-query)

### 3.3 响应（200 application/json）

```json
{
  "task_id": "401047179385389059",
  "status": "Success",
  "video_url": "https://cdn.hailuoai.com/prod/video_20250714_141232_cdc5ba74.mp4",
  "base_resp": {
    "status_code": 0,
    "status_msg": "success"
  }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `task_id` | string | 被查询的任务 ID |
| `status` | enum<string> | 见下方状态枚举 |
| `video_url` | string | 任务成功时返回；下载链接有效期为 9 小时（32400 秒） |
| `base_resp.status_code` | int | 0 = 成功 |
| `base_resp.status_msg` | string | 状态详情 |

(来源：https://platform.minimaxi.com/docs/api-reference/video-agent-query)

### 3.4 状态枚举

| 取值（首字母大写） | 含义 |
| --- | --- |
| `Preparing` | 准备中 |
| `Processing` | 生成中 |
| `Success` | 成功 |
| `Fail` | 失败 |

(来源：https://platform.minimaxi.com/docs/api-reference/video-agent-query)

> 与"视频生成（Video Generation）"模块的轮询通道对比：`/v1/query/video_generation`（v1）状态枚举为 `Preparing / Queueing / Processing / Success / Fail`；**视频 Agent 没有 `Queueing`，两通道失败都用 `Fail`**。返回字段不同：v1 视频生成通过 `file_id` + File API 下载，视频 Agent 通过 `video_url`（9 小时有效 CDN 链接）直接下载。

## 4. 完整模板清单

> 来源：https://platform.minimaxi.com/docs/faq/video-agent-templates
> 注意：`api-reference/api-overview` 中**不含模板清单小节**（经抓取全文确认仅有"语言/同步语音合成/异步长文本语音生成/音色快速复刻/音色设计/MiniMax-H3 视频生成/图像生成/音乐生成/文件管理"等模块，MiniMax-H3 走 `/v2/video_generation` 多模态通道，与模板 Agent 是不同入口），本节模板表**仅以 faq 页为准**。

`media_inputs` / `text_inputs` 列填写"需要"表示该模板需要传入对应类型的输入；`/` 表示不需要。**官方仅披露模板级"是否需要"的二元信息**，并未在每个模板下列出字段名或枚举值；具体字段结构以本文档 2.4 为准。

| template_id | 模板名称 | 模板说明 | media_inputs | text_inputs |
| --- | --- | --- | --- | --- |
| `392753057216684038` | 跳水 | 上传你的照片，生成照片中主体完美跳水表现的视频 | 需要 | `/` |
| `393881433990066176` | 吊环 | 上传宠物照片，生成图中主体完成完美吊环动作的视频 | 需要 | `/` |
| `393769180141805569` | 绝地求生 | 上传宠物图片并输入野兽种类，生成宠物野外绝地求生视频 | 需要 | 需要 |
| `394246956137422856` | 万物皆可 labubu | 上传人物/宠物照片，生成 labubu 换脸视频 | 需要 | `/` |
| `393879757702918151` | 麦当劳宠物外卖员 | 上传爱宠照片，生成麦当劳宠物外卖员视频 | 需要 | `/` |
| `393766210733957121` | 藏族风写真 | 上传面部参考图，生成藏族风视频写真 | 需要 | `/` |
| `394125185182695432` | 生无可恋 | 输入各类主角痛苦做某事，一键生成角色痛苦生活的小动画 | `/` | 需要 |
| `393857704283172864` | 情书写真 | 上传照片生成冬日雪景写真 | 需要 | `/` |
| `398574688191234048` | 四季写真 | 上传人脸照片生成四季写真 | 需要 | `/` |
| `393866076583718914` | 女模特试穿广告 | 上传服装图片，生成女模特试穿对应服装的广告 | 需要 | `/` |
| `393876118804459526` | 男模特试穿广告 | 上传服装图片，生成男模特试穿对应服装的广告 | 需要 | `/` |

合计 **11 个模板**。

> 模板说明文案以 `faq/video-agent-templates` 页为准。当前抓取的 11 条文案均与官方原文逐字一致，例如 `394246956137422856` 在 faq 页为「上传人物/宠物照片，生成 labubu 换脸视频」。

## 5. 错误码

`base_resp.status_code` 与全平台其它接口共用一套错误码表（来源：https://platform.minimaxi.com/docs/api-reference/errorcode）。常用于视频 Agent 通道的条目：

| status_code | 含义 | 解决方法 |
| --- | --- | --- |
| `0` | 成功 | — |
| `1000` | 未知错误/系统默认错误 | 请稍后再试 |
| `1001` | 请求超时 | 请稍后再试 |
| `1002` | 请求频率超限 | 请稍后再试 |
| `1004` | 未授权/Token 不匹配/Cookie 缺失 | 请检查 API Key |
| `1008` | 余额不足 | 请检查您的账户余额 |
| `1024` | 内部错误 | 请稍后再试 |
| `1026` | 输入内容涉敏 | 请调整输入内容 |
| `1027` | 输出内容涉敏 | 请调整输入内容 |
| `1033` | 系统错误/下游服务错误 | 请稍后再试 |
| `1039` | Token 限制 | 请调整 max_tokens |
| `1041` | 连接数限制 | 请联系我们 |
| `1042` | 不可见字符比例超限/非法字符超过 10% | 请检查输入内容 |
| `2013` | 参数错误 | 请检查请求参数（如 template_id 不存在 / media_inputs 与模板不匹配） |
| `2045` | 请求频率增长超限 | 请避免请求骤增骤减情况 |
| `2049` | 无效的 API Key | 请检查 API Key |
| `2056` | 超出 Token Plan 资源限制 | 请等待下一个时间段资源释放 |

> 排查问题时可在响应 Header 找到 `trace_id`，反馈官方时附上。(来源：https://platform.minimaxi.com/docs/api-reference/errorcode)

## 6. 与"视频生成（Video Generation）"模块的边界

| 维度 | 视频生成（Video Generation，v1 / Hailuo 系列） | 视频生成 Agent（Video Template Generation） |
| --- | --- | --- |
| Endpoint 创建 | `POST /v1/video_generation` | `POST /v1/video_template_generation` |
| Endpoint 查询 | `GET /v1/query/video_generation` | `GET /v1/query/video_template_generation` |
| 状态枚举 | `Preparing / Queueing / Processing / Success / Fail` | `Preparing / Processing / Success / Fail`（无 Queueing；失败用 Fail） |
| 输入模型 | `prompt`、`first_frame_image_url`、`last_frame_image_url`、`subject_reference` 等自由组合 | 仅 `template_id` + 该模板规定的 `media_inputs` / `text_inputs` |
| 返回结果字段 | `file_id`（需要再走 File API 下载） | `video_url`（9 小时有效 CDN 链接） |
| 回调 status | `processing / success / failed` | `processing / success / failed` |

(来源：https://platform.minimaxi.com/docs/api-reference/video-agent-create ；https://platform.minimaxi.com/docs/api-reference/video-agent-query ；https://platform.minimaxi.com/docs/api-reference/video-generation-query ；https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create)

## 7. 速率限制

速率限制页面（https://platform.minimaxi.com/docs/guides/rate-limits）只单独列出"视频生成 Video Generation"接口的 RPM 配额（免费 5、充值 20），**未单列"视频生成 Agent"的 RPM**；按官方口径视频与其它模态统一管控，实测前可在控制台观察 `base_resp.status_code=1002 / 2045` 是否触发。

(来源：https://platform.minimaxi.com/docs/guides/rate-limits)

## 8. 已知缺口

1. `media_inputs[]` / `text_inputs[]` 的子属性面板（"Show child attributes"）抓取时未展开，目前**仅确认 `value` 一个字段**。官方示例里两个数组都只有 `value`，未出现 `name` / `key` 等其它键；如对接时需要其它键（例如按 `name` 绑定到模板内的特定输入位），需在 API 控制台或抓取子页面 JSON 后确认。
2. 模板清单是**当前最新**（2026-07-31 抓取共 11 个），官方未提供历史模板清单；新模板上线不会自动同步，需要重新抓 `/docs/faq/video-agent-templates`。
3. 视频 Agent 通道**没有专列的速率限制**（rate-limits 页面没有 video-agent 行；按量计费 Key 可调用所有模态，实测前可在控制台观察 `base_resp.status_code=1002 / 2045` 是否触发）。
4. `media_inputs[].value`（图像文件）官方 OpenAPI 已明文约束（来自 `video-agent-create` 的 `MediaInput` schema）：支持公网 URL 或 Base64 Data URL；格式仅 `JPG / JPEG / PNG / WebP`；**单图大小 < 20MB**；短边像素 **> 300px**；宽高比 **2:5 ~ 5:2**。模板参数差异仍仅披露"是否需要媒体/文本输入"，未披露"每模板要求的图片数量上限"，需实测确认。
