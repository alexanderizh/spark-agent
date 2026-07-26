# 平台多媒体模型标签路由

> 状态: 已落地 | 最后核对: 2026-07-27

## 目标

Spark 平台模型仍使用现有受管 NewAPI Provider 的地址、API Key 和登录生命周期。平台目录中带有多媒体标签的模型不进入聊天模型列表，而是转换成已有 `MediaModelManifest` 的模板引用，在调用时复用对应的应用内适配器。

平台层只负责间接映射，不复制 OpenAI、火山等供应商的参数、校验和响应处理代码。

## 标签协议

图片模型必须同时配置两个标签：

- `model:image`：声明该条目属于图片模型，不得出现在聊天模型选择器中。
- `<adapter>:<template-model-id>`：选择应用内已有适配器及其模型 Manifest。

当前支持的 adapter 名称：

| 平台标签                                   | 应用内 Provider kind   |
| ------------------------------------------ | ---------------------- |
| `openai`、`openai-images`                  | `openai-images`        |
| `volcengine`、`volcengine-ark`、`ark`      | `volcengine-ark`       |
| `google`、`gemini`、`google-generative-ai` | `google-generative-ai` |
| `xai`                                      | `xai`                  |
| `bailian`                                  | `bailian`              |
| `apimart`                                  | `apimart`              |
| `agnes`                                    | `agnes`                |
| `omni`                                     | `omni`                 |
| `midjourney`                               | `midjourney`           |
| `tencent-tokenhub`                         | `tencent-tokenhub`     |

模板模型必须已经存在于应用内置 Manifest 目录中，并且属于图片域。一个图片模型只能配置一个适配器标签。

## 平台配置示例

平台模型 ID 与模板模型 ID 相同：

```json
{
  "model_name": "gpt-image-2",
  "tags": "model:image,openai:gpt-image-2"
}
```

平台模型使用别名，实际仍套用 GPT Image 2 参数和适配器：

```json
{
  "model_name": "spark-img",
  "tags": "model:image,openai:gpt-image-2"
}
```

平台代理火山 Seedream，并复用应用内火山适配器：

```json
{
  "model_name": "spark-seedream",
  "tags": "model:image,volcengine-ark:doubao-seedream-4-5-251128"
}
```

NewAPI 管理端模型记录示例（由 Spark 服务端读取，桌面端不会直接访问该管理接口）：

```json
{
  "success": true,
  "message": "",
  "data": {
    "items": [
      {
        "id": 17,
        "model_name": "spark-img",
        "tags": "model:image,openai:gpt-image-2",
        "status": 1
      },
      {
        "id": 18,
        "model_name": "glm-5",
        "tags": "",
        "status": 1
      }
    ]
  }
}
```

## 运行时语义

- 桌面端先从 NewAPI `/api/user/models` 获取当前影子账户可用的模型 ID，再调用 Spark 服务端 `/api/v1/platform-model/catalog` 补齐这些 ID 对应的 tags。两边按模型 ID 取交集，服务端额外返回的模型不会进入本地 Provider。
- `/api/user/models` 只负责可用性，可能只返回字符串数组；NewAPI `/api/models/` 的管理权限和管理员凭据只存在于 Spark 服务端，不会下发给桌面端。
- `model_name` 是真正发送给平台接口的 `model` 值。例如 `spark-img` 不会被替换成 `gpt-image-2`。
- 标签中的 `gpt-image-2` 只用于查找参数 schema、默认值、能力、校验规则和适配器。解析后的 `adapterModelId` 会保留该模板身份，画布和 skill 的模型专属分支不会误把 `spark-img` 当成一种未知模型。
- 文本模型继续使用平台根地址；媒体模型使用平台 `${baseUrl}/v1` 入口。
- 平台受管图片模型统一调用 NewAPI 的 OpenAI 图片路径：`image.generate` 使用 `/images/generations`，`image.edit` 与 `image.variations` 使用 `/images/edits`。请求参数、校验和响应解析仍由标签指定的应用内适配器与模板负责；普通用户自定义 Provider 继续使用各供应商原生路径。
- 平台设置弹窗把对话模型与图片模型分区展示；图片模型由 tags 生成并自动启用，不参与默认对话模型选择。
- 只有 `managedType: newapi` 的平台受管 Provider 会按模型 Manifest 间接选择适配器。普通 Provider 的适配器选择规则保持不变。
- `spark_media` 运行时会把平台图片模型作为该渠道的媒体默认模型，并在用户显式选择模型时按 Manifest 切换对应适配行为；普通渠道的默认模型规则保持不变。
- Spark 服务端会分页读取 NewAPI 管理端模型目录（最多 100 页），避免平台模型超过首屏数量后在画布或 skill 中缺失。
- 缺少适配器标签、配置多个适配器标签或找不到模板时，该图片模型不会启用，并在主进程日志记录原因。

## 更新与兼容

平台模型 ID 可用性与 tags 的合并结果是映射关系的唯一来源。登录 bootstrap、应用恢复已有登录态以及 Provider 页面事件刷新都会重新合并目录：普通条目写入文本 `modelIds`，图片条目写入 `mediaModelRefs`。整个目录请求失败时保留当前 Provider；NewAPI 管理目录未配置、因而缺少单条元数据的模型按普通文本模型处理并记录警告。旧版本中误存进聊天 `modelIds` 的图片模型会自动迁移；原有 Provider、用户自定义渠道及所有已有适配器配置不需要迁移。
