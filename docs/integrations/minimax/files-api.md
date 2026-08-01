# MiniMax 文件管理（File Management）API

> 状态: 已落地 | 最后核对: 2026-07-31

本文件记录 MiniMax 开放平台「文件管理（File）」模块 5 个接口的官方对接信息，用于对齐 `packages/agent-runtime/src/services/media/*-files.client.ts` 中已落地的火山 / xAI / 百炼 Files client 实现。

所有字段均逐条标注来源 URL，未在官方文档中出现的字段一律记为「官方未声明」，不做推测。

## 0. 采集入口与 URL 修正

原 `doc-map.md` 中登记的 `/docs/api-reference/files/upload`、`/docs/api-reference/files/list` 两条路径 **均返回 HTTP 404**，为 `api-overview` 页面链接字符串拼接的推测结果，非真实路径。

真实路径通过官方文档索引 `https://platform.minimaxi.com/docs/llms.txt` 与 `https://platform.minimaxi.com/docs/sitemap.xml` 获得，命名规则为 `file-management-<action>`（非 `files/<action>`）。

| 接口 | 可访问文档 URL | 纯 Markdown 源（含 OpenAPI） |
| --- | --- | --- |
| 文件上传 | https://platform.minimaxi.com/docs/api-reference/file-management-upload | 同 URL + `.md` |
| 文件列出 | https://platform.minimaxi.com/docs/api-reference/file-management-list | 同 URL + `.md` |
| 文件检索 | https://platform.minimaxi.com/docs/api-reference/file-management-retrieve | 同 URL + `.md` |
| 文件下载 | https://platform.minimaxi.com/docs/api-reference/file-management-retrieve-content | 同 URL + `.md` |
| 文件删除 | https://platform.minimaxi.com/docs/api-reference/file-management-delete | 同 URL + `.md` |

（来源：https://platform.minimaxi.com/docs/llms.txt ；https://platform.minimaxi.com/docs/sitemap.xml）

> 采集提示：每个文档页追加 `.md` 后缀可直接拿到内嵌的完整 OpenAPI 3.1.0 定义（`api-reference/file/management/api/openapi.json`），本文所有 schema 均据此抄录。

## 1. 通用约定

- **服务器 Base URL**：`https://api.minimaxi.com`（来源：https://platform.minimaxi.com/docs/api-reference/file-management-upload.md，OpenAPI `servers[0].url`）
- **OpenAPI 标题**：`MiniMax File Management API`，version `1.0.0`（来源：同上）
- **鉴权方式**：HTTP Bearer Auth，`securitySchemes.bearerAuth` = `{type: http, scheme: bearer, bearerFormat: JWT}`（来源：同上）
- **鉴权头格式**：`Authorization: Bearer <API_key>`；API Key 可在 [账户管理 > 接口密钥](https://platform.minimaxi.com/user-center/basic-information/interface-key) 中查看（来源：https://platform.minimaxi.com/docs/api-reference/file-management-upload.md，`securitySchemes.bearerAuth.description`）
- **全局 security**：所有 5 个接口均声明 `security: [{bearerAuth: []}]`（来源：5 个 `.md` 页面的 OpenAPI 根节点）

### 文件格式与容量限制

**`api-overview` 已不再列出通用容量/格式表**，最新表述为「文件的支持格式、容量及大小限制以**上传文件**接口文档为准」（来源：https://platform.minimaxi.com/docs/api-reference/api-overview.md，「## 文件管理」一节）。

§2 中 `purpose` 各取值自带的格式说明即为当前唯一权威源：
- `voice_clone` / `prompt_audio`：mp3、m4a、wav
- `t2a_async_input`：text、zip
- `video_understanding`：MP4、AVI、MOV、MKV
- `video_generation_input`：jpg/jpeg/png/webp/heic/heif ≤30MB、mp4/mov ≤50MB、wav/mp3 ≤15MB

> 注意：通用「总容量 100GB / 单文件 512MB」类总量限制官方未在 Files 文档中声明，旧版 `api-overview` 中的相关表格已下架，接入时切勿照搬。

## 2. 接口一：文件上传（Upload File）

- **方法 / 路径**：`POST /v1/files/upload`
- **operationId**：`uploadFile`，tag `Files`，summary `Upload File`

（来源：https://platform.minimaxi.com/docs/api-reference/file-management-upload.md）

### 请求头

| 头 | 必填 | 取值 |
| --- | --- | --- |
| `Content-Type` | 是 | `multipart/form-data`（enum 仅此一项） |
| `Authorization` | 是 | `Bearer <API_key>` |

（来源：同上，`parameters[0]` 与 `securitySchemes`）

> 文档原文 `default` 值写作 `multipart/form-datan`（尾部多一个 `n`），判定为官方文档的排版笔误，enum 唯一合法值为 `multipart/form-data`。（来源：同上）

### multipart 字段名

请求体 `multipart/form-data`，`required: [purpose, file]`：

| 字段名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `purpose` | string (enum) | 是 | 文件使用目的，取值见下表 |
| `file` | string / binary | 是 | 需要上传的文件。文档原文：「填写文件的路径地址」 |

（来源：同上，`requestBody.content['multipart/form-data'].schema`）

### `purpose` 允许值（上传接口）

`enum: [voice_clone, prompt_audio, t2a_async_input, video_understanding, video_generation_input]`，`example: t2a_async_input`：

| 取值 | 含义 | 官方声明的支持格式 |
| --- | --- | --- |
| `voice_clone` | 快速复刻原始文件 | mp3、m4a、wav |
| `prompt_audio` | 音色复刻的示例音频 | mp3、m4a、wav |
| `t2a_async_input` | 异步长文本语音生成合成中，请求体中的文本文件 | text、zip |
| `video_understanding` | 多模态理解使用的视频文件，在对话请求中以 `mm_file://{file_id}` 形式引用，最长保存 7 天 | MP4、AVI、MOV、MKV |
| `video_generation_input` | 视频生成的输入素材（首帧图 / 参考图 / 参考视频 / 参考音频），在生成请求 content 的 `url` 字段以 `mm_file://{file_id}` 形式引用，有效期 7 天；上传即校验规格，不合格返回 400 且不留存，heic/heif 宽高由服务端解析 | 图片 jpg/jpeg/png/webp/heic/heif ≤30MB；参考视频 mp4/mov ≤50MB；参考音频 wav/mp3 ≤15MB |

（来源：同上，`properties.purpose.description` 与 `properties.purpose.enum`）

### 响应 schema（`UploadFileResp`）

```jsonc
{
  "file": {                       // FileObject
    "file_id": 0,                 // integer(int64) 文件的唯一标识符
    "bytes": 5896337,             // integer(int64) 文件大小，字节
    "created_at": 1700469398,     // integer(int64) 创建文件的 Unix 秒级时间戳
    "filename": "MiniMax Open Platform-Test bot.docx",  // string
    "purpose": "t2a_async_input"  // string 文件的使用目的
  },
  "base_resp": {                  // UploadFileBaseResp
    "status_code": 0,
    "status_msg": "success"
  }
}
```

（来源：同上，`components.schemas.UploadFileResp` 及其 `example`）

## 3. 接口二：文件列出（List Files）

- **方法 / 路径**：`GET /v1/files/list`
- **operationId**：`listFiles`，tag `Files`，summary `List Files`

（来源：https://platform.minimaxi.com/docs/api-reference/file-management-list.md）

### 查询参数

| 参数 | 位置 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- | --- |
| `purpose` | query | **是** | string (enum) | 列出文件分类 |

`enum: [voice_clone, prompt_audio, t2a_async_input, video_generation_input]`，`example: t2a_async_input`。

description 中列出的四项为：
1. `voice_clone`：快速复刻原始文件
2. `prompt_audio`：音色复刻的示例音频
3. `t2a_async`：异步长文本语音生成合成中音频
4. `video_generation_input`：视频生成的输入素材（首帧图 / 参考图 / 参考视频 / 参考音频）

（来源：同上，`paths['/v1/files/list'].get.parameters[0]`）

> ⚠️ 官方文档自相矛盾：description 第 3 项文字写作 `t2a_async`，而同一参数的 `enum` 第 3 项为 `t2a_async_input`。接入时建议以 `enum` 为准并对两者做容错。（来源：同上）

### 分页与过滤

**官方未声明任何分页字段**：该接口 `parameters` 数组仅有 `purpose` 一项，不存在 `cursor` / `page` / `limit` / `after` / `offset`，也不存在 `order` / `order_by` 等排序过滤器。响应体亦无 `has_more` / `next_cursor` / `total` 字段。（来源：同上，完整 `parameters` 与 `components.schemas.ListFileResp`）

即：列出接口为**一次性全量返回指定 purpose 下的文件**，`purpose` 是唯一过滤维度且为必填。

### 响应 schema（`ListFileResp`）

```jsonc
{
  "files": [                      // FileObject[]，description: "List of files"
    {
      "file_id": 0,
      "bytes": 5896337,
      "created_at": 1699964873,
      "filename": "297990555456011.tar",
      "purpose": "t2a_async_input"
    },
    {
      "file_id": 0,
      "bytes": 5896337,
      "created_at": 1700469398,
      "filename": "297990555456911.tar",
      "purpose": "t2a_async_input"
    }
  ],
  "base_resp": {                  // ListRetrieveDeleteFileBaseResp
    "status_code": 0,
    "status_msg": "success"
  }
}
```

（来源：同上，`components.schemas.ListFileResp` 及其 `example`）

## 4. 接口三：文件检索（Retrieve File）

- **方法 / 路径**：`GET /v1/files/retrieve`
- **operationId**：`retrieveFile`，tag `Files`，summary `Retrieve File`

（来源：https://platform.minimaxi.com/docs/api-reference/file-management-retrieve.md）

> URL 模板为 **query 参数形式**（`GET /v1/files/retrieve?file_id={file_id}`），**不是** REST 路径参数形式 `/v1/files/{file_id}`。（来源：同上，`parameters[0].in: query`）

### 查询参数

| 参数 | 位置 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- | --- |
| `file_id` | query | 是 | integer (int64) | 文件的唯一标识符 |

`file_id` 支持的来源（官方明示）：
- 视频生成中，「查询视频任务状态」接口获得的 `file_id`
- 异步语音合成中，「查询语音生成任务状态」接口获得的 `file_id`

（来源：同上，`parameters[0].description`）

### 响应 schema（`RetrieveFileResp`）

```jsonc
{
  "file": {                       // FileObject
    "file_id": 0,
    "bytes": 5896337,
    "created_at": 1700469398,
    "filename": "output_aigc.mp4",
    "purpose": "video_generation",
    "download_url": "www.downloadurl.com"   // 仅出现在 example 中，见下方说明
  },
  "base_resp": {
    "status_code": 0,
    "status_msg": "success"
  }
}
```

（来源：同上，`components.schemas.RetrieveFileResp` 及其 `example`）

> **关键差异**：`download_url` **只出现在 `RetrieveFileResp.example` 里，未被定义进 `FileObject` 的 `properties`**。因此它是官方示例可见、但 schema 未正式声明的字段。同时 example 中的 `purpose: video_generation` 也不在 upload 的 `purpose` enum 内。接入时应把 `download_url` 视为可选字段并做存在性判断。（来源：同上）

## 5. 接口四：文件下载（Retrieve File Content）

- **方法 / 路径**：`GET /v1/files/retrieve_content`
- **operationId**：`retrieveFileContent`，tag `Files`，summary `Retrieve File Content`

（来源：https://platform.minimaxi.com/docs/api-reference/file-management-retrieve-content.md）

### 查询参数

| 参数 | 位置 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- | --- |
| `file_id` | query | 是 | integer (int64) | 需要下载的文件 ID |

（来源：同上，`parameters[0]`）

### 响应

```yaml
responses:
  '200':
    content:
      application/json:
        schema:
          type: string
          format: binary
```

（来源：同上，`paths['/v1/files/retrieve_content'].get.responses`）

**该接口直接返回文件二进制内容（`format: binary`），不是返回 `download_url` 的 JSON 包装。** 需要 `download_url` 时使用 §4 的 `retrieve` 接口。

> 注意：官方把 binary 响应的 media type 标注为 `application/json`，与 `format: binary` 矛盾，判定为文档标注瑕疵；客户端应按二进制流读取，不要按 JSON 解析。实际响应 Content-Type 需在联调时实测确认（官方未声明）。（来源：同上）

该接口的 OpenAPI 片段中 `components` 仅含 `securitySchemes`，**未定义任何 base_resp 结构**，即错误场景的响应体结构官方未声明。（来源：同上）

## 6. 接口五：文件删除（Delete File）

- **方法 / 路径**：`POST /v1/files/delete`
- **operationId**：`deleteFile`，tag `Files`，summary `Delete File`

（来源：https://platform.minimaxi.com/docs/api-reference/file-management-delete.md）

### 请求头

| 头 | 必填 | 取值 |
| --- | --- | --- |
| `Content-Type` | 是 | 参数声明 enum 为 `multipart/form-data` |
| `Authorization` | 是 | `Bearer <API_key>` |

> ⚠️ 官方文档矛盾：`parameters` 中的 `Content-Type` 声明为 `multipart/form-data`（且同样带 `multipart/form-datan` 笔误默认值），但 `requestBody.content` 实际定义的是 **`application/json`**。按 requestBody 定义，请求体应以 JSON 发送。此处以 `requestBody` 为准，联调时需实测确认。（来源：同上）

### 请求体 schema（`DeleteFileReq`，`application/json`）

```jsonc
{
  "file_id": 0,                   // integer(int64) 必填，文件的唯一标识符
  "purpose": "t2a_async_input"    // string 必填，enum 见下
}
```

`required: [file_id, purpose]`

`purpose` 的 `enum: [voice_clone, prompt_audio, t2a_async, t2a_async_input, video_generation]`：

| 取值 |
| --- |
| `voice_clone` |
| `prompt_audio` |
| `t2a_async` |
| `t2a_async_input` |
| `video_generation` |

（来源：同上，`components.schemas.DeleteFileReq`）

> 删除接口的 `purpose` enum 是 5 个接口中最全的（5 项），比 upload（5 项，含 `video_understanding` / `video_generation_input`）和 list（4 项，含 `video_generation_input`）都多，且三者取值集合互不相同。**特别注意**：`delete` 包含的 `t2a_async`（无 `_input` 后缀）在 `upload` / `list` 中均无对应项；upload 包含的 `video_understanding` 在 list / delete 中均无；upload 与 list 共同包含的 `video_generation_input` 在 delete 中亦无。接入时应按接口分别维护各自的枚举，不要合并成单一常量。
>
> `purpose` 三个接口对比表（来源：upload / list / delete 三个 `.md` 页面的 enum 字段）：
>
> | 取值 | upload | list | delete |
> | --- | :---: | :---: | :---: |
> | `voice_clone` | ✅ | ✅ | ✅ |
> | `prompt_audio` | ✅ | ✅ | ✅ |
> | `t2a_async` | ❌ | ❌ | ✅ |
> | `t2a_async_input` | ✅ | ✅ | ✅ |
> | `video_generation` | ❌ | ❌ | ✅ |
> | `video_understanding` | ✅ | ❌ | ❌ |
> | `video_generation_input` | ✅ | ✅ | ❌ |
>
> 注意 delete 接口的 `purpose` 描述中第 3 项文字写作 `t2a_async`，而 upload / list 接口的 `enum` 第 3 项为 `t2a_async_input`。接入时建议以 `enum` 字段为准并对两者做容错。（来源：同上传注释的 `list` description 矛盾）

### 是否支持批量

**不支持批量**。`DeleteFileReq.file_id` 为单个 `integer(int64)` 标量，非数组；官方未提供任何批量删除接口或数组入参。（来源：同上，`components.schemas.DeleteFileReq.properties.file_id`）

### 响应 schema（`DeleteFileResp`）

```jsonc
{
  "file_id": 0,                   // integer(int64) The unique identifier for the file.
  "base_resp": {
    "status_code": 0,
    "status_msg": "success"
  }
}
```

（来源：同上，`components.schemas.DeleteFileResp` 及其 `example`）

## 7. 文件对象（FileObject）标准字段

`FileObject` 在 upload / list / retrieve 三个接口中定义完全一致：

| 字段 | 类型 | 格式 | 官方描述 | 出现于 |
| --- | --- | --- | --- | --- |
| `file_id` | integer | int64 | 文件的唯一标识符 | upload / list / retrieve / delete(resp) |
| `bytes` | integer | int64 | 文件大小，以字节为单位 | upload / list / retrieve |
| `created_at` | integer | int64 | 创建文件时的 Unix 时间戳，以秒为单位 | upload / list / retrieve |
| `filename` | string | — | 文件的名称 | upload / list / retrieve |
| `purpose` | string | — | 文件的使用目的 | upload / list / retrieve |
| `download_url` | string | — | **schema 未声明**，仅见于 retrieve 的 example | retrieve(example) |

（来源：https://platform.minimaxi.com/docs/api-reference/file-management-upload.md ；https://platform.minimaxi.com/docs/api-reference/file-management-list.md ；https://platform.minimaxi.com/docs/api-reference/file-management-retrieve.md，`components.schemas.FileObject`）

### 与其他渠道的差异（对接注意）

| 维度 | MiniMax | OpenAI 风格（xAI / 百炼 / 火山方舟） |
| --- | --- | --- |
| 主键字段名 | `file_id` | `id` |
| 主键类型 | **integer (int64)** | string |
| `object` 字段 | **官方未声明，不存在** | 通常有 `object: "file"` |
| 列表包装字段 | `files` | 通常为 `data` |
| 分页 | **官方未声明，无分页** | 通常有 `after` / `limit` / `has_more` |
| 错误包装 | `base_resp.status_code` / `status_msg`，HTTP 200 | HTTP 状态码 + `error` 对象 |

> `file_id` 为 int64。JavaScript `number` 无法安全表示超过 2^53-1 的整数，若实际 id 超出安全整数范围，需要以字符串形式透传，避免精度丢失。（依据：https://platform.minimaxi.com/docs/api-reference/file-management-upload.md 声明的 `type: integer, format: int64`）

## 8. 错误码

文件管理接口的错误通过 **HTTP 200 + `base_resp.status_code`** 返回（`status_code: 0` 表示成功）。`UploadFileBaseResp` 与 `ListRetrieveDeleteFileBaseResp` 结构相同，均为 `{status_code: integer, status_msg: string}`。（来源：https://platform.minimaxi.com/docs/api-reference/file-management-upload.md ；https://platform.minimaxi.com/docs/api-reference/file-management-delete.md）

### 文件管理接口内联声明的状态码

| status_code | 含义 | upload | list | retrieve | delete |
| --- | --- | --- | --- | --- | --- |
| 0 | 成功（见各接口 example） | ✅ | ✅ | ✅ | ✅ |
| 1000 | 未知错误 | ✅ | ✅ | ✅ | ✅ |
| 1001 | 超时 | ✅ | ✅ | ✅ | ✅ |
| 1002 | 触发 RPM 限流 | ✅ | ✅ | ✅ | ✅ |
| 1004 | 鉴权失败 | ✅ | ✅ | ✅ | ✅ |
| 1008 | 余额不足 | ✅ | ✅ | ✅ | ✅ |
| 1013 | 服务内部错误 | ✅ | ✅ | ✅ | ✅ |
| 1026 | 输入内容错误 | ✅ | ✅ | ✅ | ✅ |
| 1027 | 输出内容错误 | ✅ | ✅ | ✅ | ✅ |
| 1039 | 触发 TPM 限流 | ✅ | ✅ | ✅ | ✅ |
| 2013 | 输入格式信息不正常 | ✅ | ✅ | ✅ | ✅ |

四个接口的 `BaseResp.status_code.description` 内联子集**完全相同**（10 条 + 0），与 https://platform.minimaxi.com/docs/api-reference/errorcode.md 全表 24 条相比，**少了 1013 之外的 `1008` 也包括**——这里 `1008` 是 4 个接口的子集**包含**的状态码。**实际是 4 个接口的子集 = 10 条**：1000/1001/1002/1004/1008/1013/1026/1027/1039/2013 + 0。

（来源：https://platform.minimaxi.com/docs/api-reference/file-management-upload.md ；https://platform.minimaxi.com/docs/api-reference/file-management-list.md ；https://platform.minimaxi.com/docs/api-reference/file-management-retrieve.md ；https://platform.minimaxi.com/docs/api-reference/file-management-delete.md，`BaseResp.status_code.description`；全表见 `auth-errors.md` 第 2.2 节）

### 平台级完整错误码表

| 错误码 | 含义 | 解决方法 |
| --- | --- | --- |
| 1000 | 未知错误/系统默认错误 | 请稍后再试 |
| 1001 | 请求超时 | 请稍后再试 |
| 1002 | 请求频率超限 | 请稍后再试 |
| 1004 | 未授权 / Token 不匹配 / Cookie 缺失 | 请检查 API Key |
| 1008 | 余额不足 | 请检查您的账户余额 |
| 1024 | 内部错误 | 请稍后再试 |
| 1026 | 输入内容涉敏 | 请调整输入内容 |
| 1027 | 输出内容涉敏 | 请调整输入内容 |
| 1033 | 系统错误 / 下游服务错误 | 请稍后再试 |
| 1039 | Token 限制 | 请调整 max_tokens |
| 1041 | 连接数限制 | 请联系我们 |
| 1042 | 不可见字符比例超限 / 非法字符超过 10% | 请检查输入内容 |
| 1043 | ASR 相似度检查失败 | 请检查 file_id 与 text_validation 匹配度 |
| 1044 | 克隆提示词相似度检查失败 | 请检查克隆提示音频和提示词 |
| 2013 | 参数错误 | 请检查请求参数 |
| 20132 | 语音克隆样本或 voice_id 参数错误 | 请检查 Voice Cloning 的 file_id 与 T2A 的 voice_id |
| 2037 | 语音时长不符合要求 | voice_clone file_id 时长应 ≥10 秒且 ≤5 分钟 |
| 2038 | 用户语音克隆功能被禁用 | 需完成个人或企业认证 |
| 2039 | 语音克隆 voice_id 重复 | 请修改 voice_id |
| 2042 | 无权访问该 voice_id | 请确认是否为该 voice_id 创建者 |
| 2045 | 请求频率增长超限 | 请避免请求骤增骤减 |
| 2048 | 语音克隆提示音频太长 | prompt_audio 时长 <8s |
| 2049 | 无效的 API Key | 请检查 API Key |
| 2056 | 超出 Token Plan 资源限制 | 请等待下一时间段资源释放 |

（来源：https://platform.minimaxi.com/docs/api-reference/errorcode）

> 排查建议：反馈问题时请提供响应 Header 中的 `trace_id`。（来源：同上）

## 9. 官方未声明 / 需联调确认的缺口

以下内容在官方文档中**没有**任何声明，接入实现时不得臆造，需通过联调实测或联系官方确认：

1. **列表分页**：无 `cursor` / `page` / `limit` / `offset`，也无 `has_more` / `total`。大量文件时的返回上限与截断行为未知。（来源：https://platform.minimaxi.com/docs/api-reference/file-management-list.md）
2. **列表排序**：无 `order` / `order_by` / `sort` 参数，返回顺序未定义。（来源：同上）
3. **`object` 字段**：`FileObject` 无 `object` 属性，与 OpenAI 风格不兼容。（来源：upload/list/retrieve 三页 `components.schemas.FileObject`）
4. **`download_url` 的正式契约**：只在 retrieve 的 example 出现，未进 schema；其有效期、是否始终返回、对哪些 purpose 返回，官方均未声明。（来源：https://platform.minimaxi.com/docs/api-reference/file-management-retrieve.md）
   - 相关旁证：`api-overview` 声明异步长文本语音返回的 url 有效期为 9 小时（32400 秒），但该声明针对 T2A Async 而非 Files 接口本身。（来源：https://platform.minimaxi.com/docs/api-reference/api-overview）
5. **下载接口响应的真实 Content-Type**：文档标为 `application/json` 但 `format: binary`，实际值需实测。（来源：https://platform.minimaxi.com/docs/api-reference/file-management-retrieve-content.md）
6. **下载接口的错误响应结构**：该接口未定义 base_resp。（来源：同上）
7. **删除接口的真实 Content-Type**：header 参数与 requestBody 定义冲突（`multipart/form-data` vs `application/json`）。（来源：https://platform.minimaxi.com/docs/api-reference/file-management-delete.md）
8. **`purpose` 枚举不一致**：upload / list / delete 三接口的 enum 集合互不相同；`video_generation`、`video_understanding`、`t2a_async` 的适用接口范围存在交叉缺口。（来源：三页 enum 对比）
9. **文件保留期 / TTL**：仅 `video_understanding` 明示「最长保存 7 天」，其余 purpose 的保留期未声明。（来源：https://platform.minimaxi.com/docs/api-reference/file-management-upload.md）
10. **速率限制（RPM / TPM 具体数值）**：文件管理接口的具体限额未在 Files 文档中给出，`api-overview` 侧栏另有「速率限制」页需单独采集。（来源：https://platform.minimaxi.com/docs/api-reference/api-overview）
11. **格式约束冲突已不存在**：`api-overview` 不再提供通用格式表；接入方应以 upload 的 `purpose` 描述为准。（来源：api-overview.md 2026-07-31 复核）
