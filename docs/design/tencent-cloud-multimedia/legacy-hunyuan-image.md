# 旧混元生图（product/1668）

> 状态: 实施中 | 最后核对: 2026-07-22
> 来源: https://cloud.tencent.com/document/product/1668

## 说明

为进一步提升大模型服务体验，腾讯混元大模型相关功能将逐步迁移至 TokenHub。迁移后，原平台不再新增模型能力，并停止支持新购模型服务。已购买的服务可继续使用，不受影响。如需使用更多模型，请前往 TokenHub。

## 服务域名

`aiart.tencentcloudapi.com`（就近地域）或带地域的 `aiart.ap-guangzhou.tencentcloudapi.com` 等。鉴权方式：API 3.0 TC3-HMAC-SHA256 v3 签名 + `SecretId`/`SecretKey`。

## 完整接口列表

| 接口名 | 功能 | 频率限制 |
| --- | --- | --- |
| TextToImageLite | 混元生图（极速版） | - |
| TextToImageRapid | 混元生图（2.0） | - |
| SubmitTextToImageJob | 提交混元生图（3.0）任务 | 20 次/秒 |
| QueryTextToImageJob | 查询混元生图（3.0）任务 | 20 次/秒 |
| ImageToImage | 图像风格化（图生图） | - |
| GenerateAvatar | 百变头像 | - |
| UploadTrainPortraitImages | 上传写真训练图片 | - |
| SubmitDrawPortraitJob | 提交生成写真图片任务 | - |
| QueryDrawPortraitJob | 查询生成写真图片任务 | - |
| SubmitTrainPortraitModelJob | 提交训练写真模型任务 | - |
| QueryTrainPortraitModelJob | 查询训练写真模型任务 | - |
| SubmitMemeJob | 提交表情动图生成任务 | - |
| QueryMemeJob | 查询表情动图生成任务 | - |
| SubmitGlamPicJob | 提交美照生成任务 | - |
| QueryGlamPicJob | 查询美照生成任务 | - |
| ChangeClothes | 模特换装 | - |
| ReplaceBackground | 商品背景生成 | - |
| SketchToImage | 线稿生图 | - |
| RefineImage | 图片变清晰 | - |
| ImageInpaintingRemoval | 局部消除 | - |
| ImageOutpainting | 扩图 | - |
| SubmitTextToImageProJob | 提交文生图（高级版）任务（即将下线） | - |
| QueryTextToImageProJob | 查询文生图（高级版）任务（即将下线） | 20 次/秒 |

## TextToImageLite（混元生图 极速版）

接口：https://cloud.tencent.com/document/product/1668/120721

### 输入参数

| 参数 | 必选 | 类型 | 描述 |
| --- | --- | --- | --- |
| Action | 是 | String | `TextToImageLite` |
| Version | 是 | String | `2022-12-29` |
| Region | 是 | String | 公共参数 |
| Prompt | 是 | String | 文本描述，最多 1024 utf-8 字符，推荐中文 |
| NegativePrompt | 否 | String | 反向提示词，最多 1024 utf-8 字符 |
| Resolution | 否 | String | 默认 `1024:1024`；宽高比 1:1 / 3:4 / 4:3 / 9:16 / 16:9；长边：160/200/225/258/512/520/608/768/1024/1080/1280/1600/1620/1920/2048/2400/2560/2592/3440/3840/4096 |
| Seed | 否 | Integer | 0 或不传=随机；正数=固定 |
| LogoAdd | 否 | Integer | 1=添加水印 / 0=不添加，默认 1 |
| LogoParam | 否 | LogoParam | 标识内容设置，默认"图片由 AI 生成" |
| RspImgType | 否 | String | `base64` 或 `url`，默认 base64；url 有效期 1 小时 |

### 输出参数

- `ResultImage`：根据 `RspImgType` 返回 base64 或 URL
- `Seed`
- `RequestId`

## TextToImageRapid（混元生图 2.0）

接口：https://cloud.tencent.com/document/product/1668/120720

| 参数 | 必选 | 类型 | 描述 |
| --- | --- | --- | --- |
| Action | 是 | String | `TextToImageRapid` |
| Version | 是 | String | `2022-12-29` |
| Region | 是 | String | - |
| Prompt | 是 | String | 文本描述，最多 256 utf-8 字符 |
| Resolution | 否 | String | 同上 |
| Seed | 否 | Integer | 0/不传=随机；正数=固定 |
| Image | 否 | Image | 参考图；传入时 Style 和 Resolution 不生效；Base64 和 Url 二选一；单边 128~2048 px，<6 MB；jpg/jpeg/png/bmp/tiff/webp |
| Style | 否 | String | 风格：1=宫崎骏、2=新海诚、3=去旅行、4=水彩、5=像素、6=童话世界、7=奇趣卡通、8=赛博朋克、9=极简、10=复古、11=暗黑系、12=波普风、13=糖果色、14=胶片电影、15=素描、16=水墨画、17=油画、18=粉笔、19=粘土、20=毛毡、21=刺绣、22=彩铅、23=莫奈、24=毕加索、25=穆夏、26=古风二次元、27=都市二次元、28=悬疑、29=校园、30=都市异能 |
| LogoAdd | 否 | Integer | 同上 |
| LogoParam | 否 | LogoParam | 同上 |
| RspImgType | 否 | String | base64 / url |

## SubmitTextToImageJob（混元生图 3.0 提交）

接口：https://cloud.tencent.com/document/product/1668/124632

### 输入参数

| 参数 | 必选 | 类型 | 描述 |
| --- | --- | --- | --- |
| Action | 是 | String | `SubmitTextToImageJob` |
| Version | 是 | String | `2022-12-29` |
| Region | 是 | String | - |
| Prompt | 是 | String | 最多 8192 utf-8 字符 |
| Images.N | 否 | Array of String | 参考图，最多 3 张；Base64 或 Url；单边 50~5000 px；<6 MB；jpg/jpeg/png/bmp/tiff/webp |
| Resolution | 否 | String | 默认 `1024:1024`；宽高 [512, 2048]；乘积 ≤ 1024×1024 |
| Seed | 否 | Integer | [1, 4294967295]；扩写开启时固定种子不生效 |
| LogoAdd | 否 | Integer | 默认 1 |
| LogoParam | 否 | LogoParam | - |
| Revise | 否 | Integer | 是否开启 prompt 改写：0=关闭、1=开启（默认）；开启预计 +20s；关闭需自行改写 |

### 输出参数

- `JobId`：任务 ID（如 `1259388371-1764399486-fd7b5e60-b633-11f0-827b-52540087afa5-0`）
- `RequestId`

## QueryTextToImageJob（混元生图 3.0 查询）

接口：https://cloud.tencent.com/document/product/1668/124633

| 参数 | 必选 | 类型 | 描述 |
| --- | --- | --- | --- |
| Action | 是 | String | `QueryTextToImageJob` |
| Version | 是 | String | `2022-12-29` |
| Region | 是 | String | - |
| JobId | 是 | String | 任务 ID |

### 输出参数

| 字段 | 类型 | 描述 |
| --- | --- | --- |
| JobStatusCode | String | 1=等待中、2=运行中、4=处理失败、5=处理完成 |
| JobStatusMsg | String | 排队中/处理中/处理失败/处理完成 |
| JobErrorCode | String | 失败错误码 |
| JobErrorMsg | String | 失败错误信息 |
| ResultImage | Array of String | 生成图 URL 列表，有效期 1 小时 |
| ResultDetails | Array of String | Success 代表成功 |
| RevisedPrompt | Array of String | 扩写后 prompt |
| RequestId | String | - |

## ImageToImage（图像风格化 图生图）

接口：https://cloud.tencent.com/document/product/1668/88066

| 参数 | 必选 | 类型 | 描述 |
| --- | --- | --- | --- |
| Action | 是 | String | `ImageToImage` |
| Version | 是 | String | `2022-12-29` |
| Region | 是 | String | - |
| InputImage | 否 | String | Base64；单边 50~5000 px；Base64 < 8 MB；jpg/jpeg/png/bmp/tiff/webp |
| InputUrl | 否 | String | 同上 URL 形式 |
| Prompt | 否 | String | 文本描述，最多 256 utf-8 字符 |
| NegativePrompt | 否 | String | 反向文本描述，最多 256 utf-8 字符 |
| Styles.N | 否 | Array of String | 绘画风格（详见风格列表），不传默认 201（日系动漫） |
| ResultConfig | 否 | ResultConfig | 分辨率：`origin`、`768:768`、`768:1024`、`1024:768`；默认 origin（长边最高 2000） |
| LogoAdd | 否 | Integer | 默认 1 |
| LogoParam | 否 | LogoParam | - |
| Strength | 否 | Float | 生成自由度 (0, 1]；推荐 0.6-0.8 |
| RspImgType | 否 | String | base64 / url，默认 base64 |
| EnhanceImage | 否 | Integer | 画质增强：0/1 |
| RestoreFace | 否 | Integer | 细节优化面部数量上限 0-6，默认 0 |

### 输出参数

- `ResultImage`
- `RequestId`

## OpenAI 兼容接口（旧控制台/MaaS）

接口：https://cloud.tencent.com/document/product/1668/129429

- base_url（**旧控制台**异步）：`https://api.cloudai.tencent.com/v1/aiart/submit` 与 `/query`
- base_url（**MaaS**同步）：`https://tokenhub.tencentmaas.com/v1/images/generations`
- 仅支持 HY-Image-V3.0
- 字段映射：
  - `model` = `HY-Image-V3.0`
  - `prompt` = Prompt
  - `images` = Images.N
  - `size` = Resolution
  - `extra_body.seed` / `extra_body.revise` / `extra_body.logo_add` / `extra_body.logo_param`
- OpenAI 其他参数（如 `output_compression`、`input_fidelity`、`input_image_mask`）**暂不支持**

### 异步提交示例（旧）

```http
POST /v1/aiart/submit
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "model": "HY-Image-V3.0",
  "prompt": "在图片中增加一个橘猫",
  "size": "1024:1024",
  "images": ["https://ai.cos.ap-guangzhou.myqcloud.com/cat.png"],
  "extra_body": {
    "seed": 84445,
    "revise": 0,
    "logo_add": 1,
    "logo_param": {
      "logo_rect": {"x":0,"y":0,"width":100,"height":50},
      "logo_url": "https://ai.cos.ap-guangzhou.myqcloud.com/logo.png"
    }
  }
}
```

返回：`{"request_id": "...", "job_id": "..."}`

### 异步查询示例

```http
POST /v1/aiart/query
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "job_id": "1259088371-1********10-0"
}
```

返回：

```json
{
  "request_id": "24******3f0",
  "status": "5",
  "data": [{"url": "https://aiart***********-0/0"}]
}
```

`status` 与 JobStatusCode 相同：1=等待、2=运行、4=失败、5=完成。

## 风格列表入口

- 图像风格化风格列表：https://cloud.tencent.com/document/product/1668/86250
- 百变头像风格列表：https://cloud.tencent.com/document/product/1668/107741
- AI 写真风格列表：https://cloud.tencent.com/document/product/1668/105740

## 错误码

详见 https://cloud.tencent.com/document/product/1668/88076（参考 `error-codes.md`）。