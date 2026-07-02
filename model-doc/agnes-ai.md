文档地址：https://agnes-ai.com/zh-Hans/docs/overview
图标： ![alt text](image.png)
> ## Documentation Index
> Fetch the complete documentation index at: https://wiki.agnes-ai.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 快速开始

> 按照这些分步说明，快速高效地开始使用 Agnes AI API。

<Note>
  **前置条件**

  在发起任何 API 请求之前，请确保你已具备以下条件：

  * 一个有效的 Agnes AI 平台账户
  * 一个有效的 API 密钥（在 Agnes AI 开发者控制台中生成）
</Note>

<Steps>
  <Step title="创建账户">
    注册一个新账户，或登录你现有的 Agnes AI 平台账户。从开发者控制台，你可以管理 API 密钥、账单等。
  </Step>

  <Step title="生成 API Key">
    要认证你的 API 请求，请在 Agnes AI 平台中生成一个密钥 API Key：

    请妥善保存此密钥。你将使用它来认证所有 API 请求（如认证部分所述）：

    <span class="field-row"><code>Authorization: Bearer YOUR\_API\_KEY</code></span>
  </Step>

  <Step title="发起你的第一个请求">
    以下是使用 `curl` 创建聊天补全的示例请求（你也可以使用 Postman、Python requests 或其他 HTTP 客户端）：

    ```bash theme={null}
    curl https://apihub.agnes-ai.com/v1/chat/completions \
    -H "Authorization: Bearer YOUR_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "agnes-2.0-flash",
        "messages": [
          {
            "role": "user",
            "content": "你好！"
          }
        ]
      }'
    ```

    <Tip>
      在运行请求之前，请将 `YOUR_API_KEY` 替换为你实际的 API 密钥。成功的响应将返回与你输入匹配的聊天补全结果。
    </Tip>
  </Step>

  <Step title="后续步骤">
    在你的第一个请求之后，探索以下后续步骤以充分利用 Agnes AI API：

    * 阅读文档了解每个 API 端点的请求参数、响应格式和错误处理。
    * 集成流式响应或工具调用等高级功能，以增强你的应用功能。
  </Step>
</Steps>

# 文本模型  Agnes 2.0 Flash
> ## Documentation Index
> Fetch the complete documentation index at: https://wiki.agnes-ai.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Agnes 2.0 Flash

> 面向智能体工作流、工具调用、编码和图像理解的快速高效语言模型。

<Info>
  Agnes 2.0 Flash 是由 Sapiens AI 开发的快速高效语言模型，适合智能体工作流、工具调用、编码、多轮对话、推理和图像理解等高频生产场景。
</Info>

<CardGroup cols={2}>
  <Card title="模型名称" icon="cube">
    `agnes-2.0-flash`
  </Card>

  <Card title="API Endpoint" icon="link">
    `POST /v1/chat/completions`
  </Card>

  <Card title="上下文窗口" icon="file-lines">
    `512K`
  </Card>

  <Card title="当前价格" icon="tag">
    输入 / 输出 Token 当前均为 `$0 / 1M tokens`
  </Card>
</CardGroup>

## 概述

Agnes 2.0 Flash 针对快速、可靠、高性价比的语言生成、智能体任务执行和图像理解进行了优化。

该模型在 Claw-Eval 基准测试中表现出色，在通用排行榜上以 **Pass^3 得分 60.9%** 排名 **第 9**，展现了较强的自主智能体能力。

## 核心能力

<CardGroup cols={2}>
  <Card title="聊天补全" icon="message">
    为对话、应用和业务系统生成高质量响应。
  </Card>

  <Card title="多轮对话" icon="comments">
    在连续交互中保持上下文一致性。
  </Card>

  <Card title="图像 URL 输入" icon="link">
    支持通过公开可访问的图像 URL 输入视觉内容。
  </Card>

  <Card title="图像理解" icon="eye">
    可用于截图分析、图像描述、视觉问答和信息提取。
  </Card>

  <Card title="工具调用" icon="wrench">
    支持函数调用和外部工具编排。
  </Card>

  <Card title="智能体工作流" icon="robot">
    适合规划、执行和多步骤任务完成。
  </Card>

  <Card title="编码任务" icon="code">
    支持代码生成、调试、解释和重构。
  </Card>

  <Card title="流式输出" icon="bolt">
    支持实时返回响应，提升交互体验。
  </Card>
</CardGroup>

## 适用场景

<CardGroup cols={2}>
  <Card title="AI 助手" icon="robot">
    通用问答、效率助手、个人助理和应用内 Copilot。
  </Card>

  <Card title="自主智能体" icon="diagram-project">
    多步骤任务执行、规划、工具使用和工作流调度。
  </Card>

  <Card title="编码助手" icon="laptop-code">
    代码生成、Bug 排查、重构建议和代码解释。
  </Card>

  <Card title="客户支持" icon="headset">
    FAQ 自动回复、客服机器人和服务自动化。
  </Card>

  <Card title="搜索与问答" icon="magnifying-glass">
    基于检索的问答、摘要生成和信息提取。
  </Card>

  <Card title="图像理解" icon="image">
    截图分析、图片描述、视觉问答和结构化提取。
  </Card>
</CardGroup>

## API Reference

### Endpoint

```text theme={null}
POST https://apihub.agnes-ai.com/v1/chat/completions
```

### 请求头

```bash theme={null}
-H "Authorization: Bearer YOUR_API_KEY"
-H "Content-Type: application/json"
```

### 请求参数

| 参数                     | 类型              | 必填 | 说明                                          |
| ---------------------- | --------------- | -- | ------------------------------------------- |
| `model`                | string          | 是  | 模型名称，使用 `agnes-2.0-flash`。                  |
| `messages`             | array           | 是  | 对话消息数组，包含 `system`、`user` 和 `assistant` 消息。 |
| `messages[].content`   | string / array  | 是  | 可为纯文本，也可为包含 `text` 和 `image_url` 的内容块数组。    |
| `temperature`          | number          | 否  | 控制输出随机性。值越低，结果越确定。                          |
| `top_p`                | number          | 否  | 控制核采样。值越低，输出越聚焦。                            |
| `max_tokens`           | number          | 否  | 响应中生成的最大 token 数量。                          |
| `stream`               | boolean         | 否  | 是否启用流式输出。                                   |
| `tools`                | array           | 否  | 工具调用工作流的工具定义。                               |
| `tool_choice`          | string / object | 否  | 控制模型是否使用工具以及如何使用工具。                         |
| `chat_template_kwargs` | object          | 否  | OpenAI 兼容请求中启用 Thinking 等扩展能力。              |
| `thinking`             | object          | 否  | Anthropic 兼容请求中启用 Thinking 模式。              |

## 图像 URL 输入

Agnes 2.0 Flash 支持在同一个 `messages` 请求中同时传入文本和图像 URL。

| 输入类型   | 格式          | 说明                     |
| ------ | ----------- | ---------------------- |
| 文本     | `text`      | 纯文本指令或问题。              |
| 图像 URL | `image_url` | 通过公开可访问的图像 URL 传递图像内容。 |

```json theme={null}
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "Describe the content of this image."
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "https://example.com/image.jpg"
      }
    }
  ]
}
```

## 请求示例

<Tabs>
  <Tab title="基础聊天">
    ```bash theme={null}
    curl https://apihub.agnes-ai.com/v1/chat/completions \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-2.0-flash",
        "messages": [
          {
            "role": "system",
            "content": "You are a helpful AI assistant."
          },
          {
            "role": "user",
            "content": "Explain how autonomous agents use tools to complete tasks."
          }
        ],
        "temperature": 0.7,
        "max_tokens": 1024
      }'
    ```
  </Tab>

  <Tab title="流式输出">
    ```bash theme={null}
    curl https://apihub.agnes-ai.com/v1/chat/completions \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-2.0-flash",
        "messages": [
          {
            "role": "user",
            "content": "Write a short product introduction for an AI assistant app."
          }
        ],
        "stream": true
      }'
    ```
  </Tab>

  <Tab title="工具调用">
    ```bash theme={null}
    curl https://apihub.agnes-ai.com/v1/chat/completions \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-2.0-flash",
        "messages": [
          {
            "role": "user",
            "content": "What is the weather like in Singapore today?"
          }
        ],
        "tools": [
          {
            "type": "function",
            "function": {
              "name": "get_weather",
              "description": "Get the current weather for a location",
              "parameters": {
                "type": "object",
                "properties": {
                  "location": {
                    "type": "string",
                    "description": "The city and country"
                  }
                },
                "required": ["location"]
              }
            }
          }
        ]
      }'
    ```
  </Tab>

  <Tab title="图像理解">
    ```bash theme={null}
    curl https://apihub.agnes-ai.com/v1/chat/completions \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-2.0-flash",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "type": "text",
                "text": "Describe the content of this image."
              },
              {
                "type": "image_url",
                "image_url": {
                  "url": "https://example.com/image.jpg"
                }
              }
            ]
          }
        ]
      }'
    ```
  </Tab>
</Tabs>

## 响应格式

```json theme={null}
{
  "id": "chatcmpl_xxx",
  "object": "chat.completion",
  "created": 1774432125,
  "model": "agnes-2.0-flash",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Autonomous agents use tools by understanding the user's goal, breaking it into steps, selecting the right tools, executing actions, and using the results to complete the task."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 35,
    "completion_tokens": 58,
    "total_tokens": 93
  }
}
```

### 响应字段

| 字段                          | 类型      | 说明                          |
| --------------------------- | ------- | --------------------------- |
| `id`                        | string  | 补全请求的唯一 ID。                 |
| `object`                    | string  | 对象类型，通常为 `chat.completion`。 |
| `created`                   | integer | 请求时间戳。                      |
| `model`                     | string  | 请求使用的模型。                    |
| `choices`                   | array   | 生成结果列表。                     |
| `choices[].message.role`    | string  | 消息发送者角色。                    |
| `choices[].message.content` | string  | 模型生成内容。                     |
| `choices[].finish_reason`   | string  | 生成停止原因。                     |
| `usage`                     | object  | Token 使用信息。                 |

## Thinking 模式

对于编码、调试、推理和智能体工作流，可以启用 Thinking 模式以提升任务分解和问题解决能力。

<Tabs>
  <Tab title="OpenAI 兼容格式">
    ```json theme={null}
    {
      "model": "agnes-2.0-flash",
      "messages": [
        {
          "role": "user",
          "content": "Help me write a Python script to process a CSV file."
        }
      ],
      "chat_template_kwargs": {
        "enable_thinking": true
      }
    }
    ```
  </Tab>

  <Tab title="Anthropic 兼容格式">
    ```json theme={null}
    {
      "model": "agnes-2.0-flash",
      "messages": [
        {
          "role": "user",
          "content": "Help me refactor this TypeScript function and explain the changes."
        }
      ],
      "thinking": {
        "type": "enabled",
        "budget_tokens": 2048
      }
    }
    ```
  </Tab>
</Tabs>

<Tip>
  常规编码任务建议从 `budget_tokens: 2048` 开始；复杂调试、重构或多步骤智能体任务可适当提高预算。
</Tip>

## 最佳实践

<AccordionGroup>
  <Accordion title="提示词结构">
    ```text theme={null}
    [角色] + [任务] + [上下文] + [要求] + [输出格式]
    ```
  </Accordion>

  <Accordion title="产品文案生成">
    ```text theme={null}
    You are a product marketing expert. Write a concise App Store description for an AI assistant app. The tone should be clear, professional, and user-friendly.
    ```
  </Accordion>

  <Accordion title="编码任务">
    ```text theme={null}
    Help me debug this React component. The issue is that the button state does not update after clicking. Explain the cause and provide the corrected code.
    ```
  </Accordion>

  <Accordion title="智能体工作流">
    ```text theme={null}
    You are an autonomous research agent. Search for relevant information, summarize the key findings, and return the result in a structured format with source links.
    ```
  </Accordion>

  <Accordion title="图像理解任务">
    ```text theme={null}
    Analyze this screenshot. Identify the main UI elements, explain the possible issue, and provide suggestions to improve the user experience.
    ```
  </Accordion>
</AccordionGroup>

## 限制与价格

| 项目    | 数值      |
| ----- | ------- |
| 上下文窗口 | `512K`  |
| 最大输出  | `65.5K` |

| 类型       | 标准价格                | 当前价格             |
| -------- | ------------------- | ---------------- |
| 输入 Token | `$0.03 / 1M tokens` | `$0 / 1M tokens` |
| 输出 Token | `$0.15 / 1M tokens` | `$0 / 1M tokens` |

## 接入检查清单

<Check>
  使用 `agnes-2.0-flash` 作为模型名称。
</Check>

<Check>
  基础聊天补全请求必须包含 `model` 和 `messages`。
</Check>

<Check>
  图像输入需要使用公开可访问的 `image_url`。
</Check>

<Check>
  流式响应请将 `stream` 设置为 `true`。
</Check>

<Check>
  工具调用工作流请提供 `tools`，并可选提供 `tool_choice`。
</Check>

# 图像  Agnes Image 2.0 Flash
> ## Documentation Index
> Fetch the complete documentation index at: https://wiki.agnes-ai.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Agnes Image 2.0 Flash

> 面向文生图、图生图和多图合成的高性能图像生成与编辑模型。

<Info>
  Agnes Image 2.0 Flash 是由 Sapiens AI 开发的高性能图像生成与图像编辑模型，支持文生图、图生图和多图合成，适合创意设计、营销视觉、电商产品图和社交内容生产。
</Info>

<CardGroup cols={2}>
  <Card title="模型名称" icon="cube">
    `agnes-image-2.0-flash`
  </Card>

  <Card title="API Endpoint" icon="link">
    `POST /v1/images/generations`
  </Card>

  <Card title="支持工作流" icon="wand-magic-sparkles">
    文生图、图生图、多图合成。
  </Card>

  <Card title="当前价格" icon="tag">
    生成图像当前为 `$0 / 张`
  </Card>
</CardGroup>

## 概述

Agnes Image 2.0 Flash 针对快速、高质量、低成本的图像生产工作流进行了优化。

该模型已登上 Artificial Analysis 图像编辑排行榜，获得 **ELO 评分 1,184**，进入 **Top 20** 区间，展现了较强的图像编辑能力。

## 核心能力

<CardGroup cols={2}>
  <Card title="文生图" icon="wand-magic-sparkles">
    通过文本提示词生成图像。
  </Card>

  <Card title="图生图" icon="images">
    编辑、变换或增强现有图像。
  </Card>

  <Card title="多图输入" icon="layer-group">
    使用多张参考图像组合生成新图像。
  </Card>

  <Card title="图像编辑" icon="paintbrush">
    修改构图、风格、物体、背景和场景。
  </Card>

  <Card title="风格控制" icon="palette">
    控制艺术风格、光照、布局和视觉方向。
  </Card>

  <Card title="快速生成" icon="bolt">
    适合高频、快速、生产级创意工作流。
  </Card>
</CardGroup>

## 适用场景

<CardGroup cols={2}>
  <Card title="创意设计" icon="pen-ruler">
    海报、概念艺术、社交媒体视觉素材。
  </Card>

  <Card title="营销内容" icon="bullhorn">
    产品广告、活动创意和横幅图。
  </Card>

  <Card title="图像编辑" icon="paintbrush">
    物体替换、背景更换、风格迁移和局部编辑。
  </Card>

  <Card title="角色合成" icon="users">
    将多个角色或参考图像组合到同一场景。
  </Card>

  <Card title="电商" icon="cart-shopping">
    产品图像增强、场景化和营销主图。
  </Card>

  <Card title="社交内容" icon="share-nodes">
    表情包、头像、缩略图和生活方式视觉素材。
  </Card>
</CardGroup>

## API Reference

### Endpoint

```text theme={null}
POST https://apihub.agnes-ai.com/v1/images/generations
```

### 请求头

```bash theme={null}
-H "Authorization: Bearer YOUR_API_KEY"
-H "Content-Type: application/json"
```

### 请求参数

| 参数                           | 类型        | 必填    | 说明                                             |
| ---------------------------- | --------- | ----- | ---------------------------------------------- |
| `model`                      | string    | 是     | 模型名称，使用 `agnes-image-2.0-flash`。               |
| `prompt`                     | string    | 是     | 描述目标图像或编辑指令的文本提示词。                             |
| `size`                       | string    | 是     | 输出图像尺寸，例如 `1024x768`、`1024x1024` 或 `768x1024`。 |
| `image`                      | string\[] | 图生图必填 | 输入图像数组，支持公网 URL 或 Data URI Base64。             |
| `return_base64`              | boolean   | 否     | 文生图需要返回 Base64 时使用。                            |
| `extra_body.response_format` | string    | 否     | 输出格式，常用值为 `url` 或 `b64_json`。                  |

## 重要说明

<Warning>
  请勿将 `response_format` 放在请求体顶层。需要 URL 或 Base64 输出时，请将它放在 `extra_body` 内部。
</Warning>

<CardGroup cols={2}>
  <Card title="文生图" icon="wand-magic-sparkles">
    仅需 `model`、`prompt` 和 `size`，不需要传 `image`。
  </Card>

  <Card title="图生图" icon="images">
    需要在 `extra_body.image` 中传入图片 URL 或 Data URI Base64。
  </Card>

  <Card title="不需要 tags" icon="ban">
    图生图请求不需要 `tags: ["img2img"]`。
  </Card>

  <Card title="安全示例" icon="key">
    公开文档中请统一使用 `YOUR_API_KEY`，不要暴露真实密钥。
  </Card>
</CardGroup>

## 请求示例

<Tabs>
  <Tab title="文生图：URL 输出">
    ```bash theme={null}
    curl https://apihub.agnes-ai.com/v1/images/generations \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-image-2.0-flash",
        "prompt": "A clean product photo of a glass cube on a white studio background, soft shadows, high detail",
        "size": "1024x768",
        "extra_body": {
          "response_format": "url"
        }
      }'
    ```

    返回路径：`data[0].url`
  </Tab>

  <Tab title="文生图：Base64 输出">
    ```bash theme={null}
    curl https://apihub.agnes-ai.com/v1/images/generations \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-image-2.0-flash",
        "prompt": "A clean product photo of a glass cube on a white studio background, soft shadows, high detail",
        "size": "1024x768",
        "return_base64": true
      }'
    ```

    返回路径：`data[0].b64_json`
  </Tab>

  <Tab title="图生图：URL 输出">
    ```bash theme={null}
    curl https://apihub.agnes-ai.com/v1/images/generations \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-image-2.0-flash",
        "prompt": "Transform this image into a cinematic cyberpunk style while preserving the main subject and composition",
        "size": "1024x768",
        "extra_body": {
          "image": [
            "https://example.com/input-image.png"
          ],
          "response_format": "url"
        }
      }'
    ```

    返回路径：`data[0].url`
  </Tab>

  <Tab title="图生图：Base64 输出">
    ```bash theme={null}
    curl https://apihub.agnes-ai.com/v1/images/generations \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-image-2.0-flash",
        "prompt": "Make the object orange while preserving the original composition",
        "size": "1024x768",
        "extra_body": {
          "image": [
            "https://example.com/input.png"
          ],
          "response_format": "b64_json"
        }
      }'
    ```

    返回路径：`data[0].b64_json`
  </Tab>

  <Tab title="多图合成">
    ```bash theme={null}
    curl https://apihub.agnes-ai.com/v1/images/generations \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-image-2.0-flash",
        "prompt": "Combine the two characters into an intense fantasy battle scene, dynamic lighting, detailed background, cinematic composition",
        "size": "1024x768",
        "extra_body": {
          "image": [
            "https://example.com/character-1.png",
            "https://example.com/character-2.png"
          ],
          "response_format": "url"
        }
      }'
    ```
  </Tab>

  <Tab title="Data URI 输入">
    ```text theme={null}
    data:image/png;base64,BASE64_HERE
    ```

    ```bash theme={null}
    curl https://apihub.agnes-ai.com/v1/images/generations \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-image-2.0-flash",
        "prompt": "Make the object matte black while preserving the original composition",
        "size": "1024x768",
        "extra_body": {
          "image": [
            "data:image/png;base64,BASE64_HERE"
          ],
          "response_format": "b64_json"
        }
      }'
    ```
  </Tab>
</Tabs>

## 响应格式

<Tabs>
  <Tab title="URL 输出">
    ```json theme={null}
    {
      "created": 1780000000,
      "data": [
        {
          "url": "https://storage.googleapis.com/agnes-aigc/xxx.png",
          "b64_json": null,
          "revised_prompt": null
        }
      ]
    }
    ```
  </Tab>

  <Tab title="Base64 输出">
    ```json theme={null}
    {
      "created": 1780000000,
      "data": [
        {
          "url": null,
          "b64_json": "iVBORw0KGgoAAAANSUhEUgAA...",
          "revised_prompt": null
        }
      ]
    }
    ```
  </Tab>
</Tabs>

### 响应字段

| 字段                      | 类型            | 说明                             |
| ----------------------- | ------------- | ------------------------------ |
| `created`               | integer       | 请求创建时间戳。                       |
| `data`                  | array         | 生成的图像结果列表。                     |
| `data[].url`            | string / null | 生成图像 URL，Base64 输出时通常为 `null`。 |
| `data[].b64_json`       | string / null | Base64 图像数据，URL 输出时通常为 `null`。 |
| `data[].revised_prompt` | string / null | 修正后的提示词；没有时为 `null`。           |

## 最佳实践

<AccordionGroup>
  <Accordion title="文生图提示词">
    建议包含主体、场景、风格、光照、构图和质量要求。

    ```text theme={null}
    A professional product photo of a wireless headphone on a clean white background, soft studio lighting, sharp details, commercial photography style
    ```
  </Accordion>

  <Accordion title="图像编辑提示词">
    请同时说明需要改变的内容和需要保持不变的内容。

    ```text theme={null}
    Change the background to a futuristic city at night while keeping the person's face, outfit, and pose unchanged
    ```
  </Accordion>

  <Accordion title="多图合成提示词">
    请明确说明多张输入图之间的关系。

    ```text theme={null}
    Place the person from the first image beside the robot from the second image in a cinematic sci-fi battle scene
    ```
  </Accordion>

  <Accordion title="推荐提示词结构">
    ```text theme={null}
    [主体] + [场景/背景] + [风格] + [光照] + [构图] + [质量要求]
    ```

    ```text theme={null}
    [编辑指令] + [需要保留的元素] + [目标风格/场景] + [光照] + [构图] + [质量要求]
    ```
  </Accordion>
</AccordionGroup>

## 常见问题

<AccordionGroup>
  <Accordion title="是否支持文生图？">
    支持。文生图请求不需要 `image` 参数，仅需 `model`、`prompt` 和 `size`。
  </Accordion>

  <Accordion title="是否支持图生图？">
    支持。图生图请求需要在 `extra_body.image` 中传入图片数组。
  </Accordion>

  <Accordion title="图生图是否需要 tags？">
    不需要。请勿传递 `tags: ["img2img"]`。
  </Accordion>

  <Accordion title="为什么 response_format 放在顶层会报错？">
    当前 API 结构中，`response_format` 应放在 `extra_body` 内部，例如 `extra_body.response_format: "url"`。
  </Accordion>

  <Accordion title="输入图像 URL 无法访问怎么办？">
    请使用公网可访问的 HTTPS 图像 URL；如果图像无法公开访问，请改用 Data URI Base64。
  </Accordion>

  <Accordion title="请求超时怎么办？">
    图像生成可能需要数秒到数十秒，客户端超时时间建议设置为 `60s - 360s`。
  </Accordion>
</AccordionGroup>

## 定价

| 类型   | 标准价格         | 当前价格     |
| ---- | ------------ | -------- |
| 生成图像 | `$0.003 / 张` | `$0 / 张` |

## 接入检查清单

<Check>
  请求 URL 为 `https://apihub.agnes-ai.com/v1/images/generations`。
</Check>

<Check>
  模型名称为 `agnes-image-2.0-flash`。
</Check>

<Check>
  文生图请求不传 `image`。
</Check>

<Check>
  图生图请求在 `extra_body.image` 中传入图片数组。
</Check>

<Check>
  `response_format` 放在 `extra_body` 内部。
</Check>

# 图像  Agnes Image 2.1 Flash
> ## Documentation Index
> Fetch the complete documentation index at: https://wiki.agnes-ai.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Agnes Image 2.1 Flash

> 升级版图像生成模型，优化高信息密度图像生成，并支持文生图与图生图工作流。

<Info>
  Agnes Image 2.1 Flash 是 Sapiens AI 推出的升级图像生成模型，支持文生图和图生图。相比 2.0 版本，它更适合高信息密度图像、复杂构图和细节丰富的视觉场景。
</Info>

<CardGroup cols={2}>
  <Card title="模型名称" icon="cube">
    `agnes-image-2.1-flash`
  </Card>

  <Card title="API Endpoint" icon="link">
    `POST /v1/images/generations`
  </Card>

  <Card title="核心优化" icon="chart-network">
    高信息密度图像、复杂视觉细节和语义对齐。
  </Card>

  <Card title="当前价格" icon="tag">
    生成图像当前为 `$0 / 张`
  </Card>
</CardGroup>

## 概述

Agnes Image 2.1 Flash 可根据文本提示词生成图像，也可基于输入图像进行转换、重绘和风格化编辑。它支持以图像 URL 或 Base64 数据形式返回结果。

<CardGroup cols={2}>
  <Card title="高信息密度优化" icon="mountain-sun">
    更适合复杂场景、丰富构图和多层视觉元素。
  </Card>

  <Card title="构图保留" icon="crop">
    图生图编辑时可尽量保留原始构图和主体布局。
  </Card>
</CardGroup>

## 核心能力

<CardGroup cols={2}>
  <Card title="文生图" icon="wand-magic-sparkles">
    根据自然语言提示词生成高质量图像。
  </Card>

  <Card title="图生图" icon="images">
    根据提示词转换或优化现有图像。
  </Card>

  <Card title="高信息密度图像" icon="chart-network">
    优化细节丰富、布局复杂、视觉元素密集的图像生成效果。
  </Card>

  <Card title="构图保留" icon="crop">
    编辑输入图像时保留原始构图和主体布局。
  </Card>

  <Card title="灵活尺寸控制" icon="expand">
    支持 `1024x768` 等自定义输出尺寸。
  </Card>

  <Card title="URL / Base64 输出" icon="file-code">
    支持图像 URL 或 Base64 数据返回。
  </Card>
</CardGroup>

## 适用场景

<CardGroup cols={2}>
  <Card title="创意设计" icon="pen-ruler">
    概念艺术、视觉探索和海报草稿。
  </Card>

  <Card title="营销内容" icon="bullhorn">
    活动图片、产品视觉和社交媒体创意。
  </Card>

  <Card title="高密度视觉生成" icon="mountain-sun">
    精细场景、复杂环境和丰富构图。
  </Card>

  <Card title="图像转换" icon="paintbrush">
    风格迁移、场景重打光和背景变换。
  </Card>

  <Card title="产品可视化" icon="box">
    产品照片、模型图和商业视觉。
  </Card>

  <Card title="社交媒体素材" icon="share-nodes">
    封面、横幅、缩略图和帖子图片。
  </Card>
</CardGroup>

## API Reference

### Endpoint

```text theme={null}
POST https://apihub.agnes-ai.com/v1/images/generations
```

### 请求头

```bash theme={null}
-H "Authorization: Bearer YOUR_API_KEY"
-H "Content-Type: application/json"
```

### 请求参数

| 参数                           | 类型        | 必填    | 说明                                   |
| ---------------------------- | --------- | ----- | ------------------------------------ |
| `model`                      | string    | 是     | 模型名称，使用 `agnes-image-2.1-flash`。     |
| `prompt`                     | string    | 是     | 图像生成或图像编辑的文本指令。                      |
| `size`                       | string    | 是     | 输出图像尺寸，例如 `1024x768`。                |
| `image`                      | string\[] | 图生图必填 | 输入图像数组，支持公共图像 URL 或 Data URI Base64。 |
| `return_base64`              | boolean   | 否     | 文生图需要以 Base64 返回时使用。                 |
| `extra_body`                 | object    | 否     | 高级工作流的附加参数。                          |
| `extra_body.response_format` | string    | 否     | 输出格式，常见值为 `url` 或 `b64_json`。        |

## 重要说明

<Warning>
  请勿在请求体顶层放置 `response_format`。需要 URL 输出时，请使用 `extra_body.response_format: "url"`；图生图 Base64 输出请使用 `extra_body.response_format: "b64_json"`。
</Warning>

<CardGroup cols={2}>
  <Card title="文生图" icon="wand-magic-sparkles">
    必填参数为 `model`、`prompt` 和 `size`。
  </Card>

  <Card title="图生图" icon="images">
    需要在 `extra_body.image` 中提供输入图像 URL 或 Data URI Base64。
  </Card>

  <Card title="Base64 输出" icon="file-code">
    文生图可使用 `return_base64: true`；图生图请使用 `extra_body.response_format: "b64_json"`。
  </Card>

  <Card title="无需 tags" icon="ban">
    图生图不需要传递 `tags: ["img2img"]`。
  </Card>
</CardGroup>

## 请求示例

<Tabs>
  <Tab title="文生图：URL 输出">
    ```bash theme={null}
    curl https://apihub.agnes-ai.com/v1/images/generations \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-image-2.1-flash",
        "prompt": "A luminous floating city above a misty canyon at sunrise, cinematic realism",
        "size": "1024x768",
        "extra_body": {
          "response_format": "url"
        }
      }'
    ```

    返回路径：`data[0].url`
  </Tab>

  <Tab title="文生图：Base64 输出">
    ```bash theme={null}
    curl https://apihub.agnes-ai.com/v1/images/generations \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-image-2.1-flash",
        "prompt": "A clean product photo of a glass cube on a white studio background, soft shadows, high detail",
        "size": "1024x768",
        "return_base64": true
      }'
    ```

    返回路径：`data[0].b64_json`
  </Tab>

  <Tab title="图生图：URL 输出">
    ```bash theme={null}
    curl https://apihub.agnes-ai.com/v1/images/generations \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-image-2.1-flash",
        "prompt": "Transform the scene into a rain-soaked cyberpunk night with neon reflections while preserving the original composition",
        "size": "1024x768",
        "extra_body": {
          "image": [
            "https://example.com/input-image.png"
          ],
          "response_format": "url"
        }
      }'
    ```

    返回路径：`data[0].url`
  </Tab>

  <Tab title="图生图：Base64 输出">
    ```bash theme={null}
    curl https://apihub.agnes-ai.com/v1/images/generations \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-image-2.1-flash",
        "prompt": "Make the object orange while preserving the original composition",
        "size": "1024x768",
        "extra_body": {
          "image": [
            "https://example.com/input-image.png"
          ],
          "response_format": "b64_json"
        }
      }'
    ```

    返回路径：`data[0].b64_json`
  </Tab>

  <Tab title="Data URI 输入">
    ```text theme={null}
    data:image/png;base64,BASE64_HERE
    ```

    ```bash theme={null}
    curl https://apihub.agnes-ai.com/v1/images/generations \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-image-2.1-flash",
        "prompt": "Make the object matte black while preserving the original composition",
        "size": "1024x768",
        "extra_body": {
          "image": [
            "data:image/png;base64,BASE64_HERE"
          ],
          "response_format": "b64_json"
        }
      }'
    ```
  </Tab>
</Tabs>

## 响应格式

<Tabs>
  <Tab title="URL 输出">
    ```json theme={null}
    {
      "created": 1780000000,
      "data": [
        {
          "url": "https://storage.googleapis.com/agnes-aigc/xxx.png",
          "b64_json": null,
          "revised_prompt": null
        }
      ]
    }
    ```
  </Tab>

  <Tab title="Base64 输出">
    ```json theme={null}
    {
      "created": 1780000000,
      "data": [
        {
          "url": null,
          "b64_json": "iVBORw0KGgoAAAANSUhEUgAA...",
          "revised_prompt": null
        }
      ]
    }
    ```
  </Tab>
</Tabs>

## 推荐提示词结构

<AccordionGroup>
  <Accordion title="文生图结构">
    ```text theme={null}
    [主体] + [场景 / 环境] + [风格] + [光照] + [构图] + [质量要求]
    ```

    ```text theme={null}
    日出时分薄雾峡谷上方的发光浮空城市，电影级写实风格，广角构图，丰富的建筑细节，柔和的金色光线，高视觉密度
    ```
  </Accordion>

  <Accordion title="图生图结构">
    ```text theme={null}
    [改变要求] + [新风格 / 场景] + [需要添加或移除的元素] + [需要保留的元素]
    ```

    ```text theme={null}
    将白天街道场景改为电影级赛博朋克夜景，添加霓虹招牌和湿滑路面倒影，同时保留原始街道布局、相机角度和主要建筑形状。
    ```
  </Accordion>

  <Accordion title="高信息密度图像">
    请清晰描述视觉层次结构，包括主要主体、背景环境、重要次要细节、风格、光照和构图约束。

    ```text theme={null}
    建在悬崖上的大型奇幻港口城市，数百艘小船，层叠的石桥，发光的窗户，远山，多云的日落天空，电影级奇幻写实风格，广角构图，丰富的建筑细节，高视觉密度
    ```
  </Accordion>
</AccordionGroup>

## 常见错误与故障排除

<AccordionGroup>
  <Accordion title="顶层放置 response_format">
    错误写法：

    ```json theme={null}
    {
      "model": "agnes-image-2.1-flash",
      "prompt": "A futuristic city",
      "size": "1024x768",
      "response_format": "url"
    }
    ```

    正确写法：

    ```json theme={null}
    {
      "model": "agnes-image-2.1-flash",
      "prompt": "A futuristic city",
      "size": "1024x768",
      "extra_body": {
        "response_format": "url"
      }
    }
    ```
  </Accordion>

  <Accordion title="图生图传递 tags">
    图生图不需要传递 `tags: ["img2img"]`。只需在 `extra_body.image` 中提供输入图像。
  </Accordion>

  <Accordion title="输入图像 URL 无法访问">
    请使用公共 HTTPS 图像 URL，并确认不需要登录、cookie 或私有请求头；如果无法公开访问，请使用 Data URI Base64。
  </Accordion>

  <Accordion title="请求超时">
    根据提示词复杂度、图像尺寸和服务器负载情况，图像生成可能需要数秒到几十秒。客户端超时时间建议设置为 `60s - 360s`。
  </Accordion>

  <Accordion title="图生图缺少 image 参数">
    图生图生成时，`extra_body.image` 为必填项。

    ```json theme={null}
    {
      "model": "agnes-image-2.1-flash",
      "prompt": "Make the image cyberpunk style while preserving the original composition",
      "size": "1024x768",
      "extra_body": {
        "image": ["https://example.com/input.png"],
        "response_format": "url"
      }
    }
    ```
  </Accordion>
</AccordionGroup>

## 定价

| 类型   | 标准价格         | 当前价格     |
| ---- | ------------ | -------- |
| 生成图像 | `$0.003 / 张` | `$0 / 张` |

## 接入检查清单

<Check>
  使用 `agnes-image-2.1-flash` 作为模型名称。
</Check>

<Check>
  使用 `https://apihub.agnes-ai.com/v1/images/generations` 作为 API 端点。
</Check>

<Check>
  文生图请求必须包含 `model`、`prompt` 和 `size`。
</Check>

<Check>
  图生图请求需要在 `extra_body.image` 中提供输入图像。
</Check>

<Check>
  请勿将 `response_format` 放在顶层，也不要传递 `tags: ["img2img"]`。
</Check>

# 视频  Agnes Video V2.0

> ## Documentation Index
> Fetch the complete documentation index at: https://wiki.agnes-ai.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Agnes Video V2.0

> 面向文生视频、图生视频、多图视频和关键帧动画的异步视频生成 API。

<Info>
  Agnes Video V2.0 是面向生产场景的视频生成模型，支持文生视频、图生视频、多图视频生成和关键帧动画。视频生成采用异步任务 API：先创建任务，再通过 `video_id` 或 `task_id` 获取结果。
</Info>

<CardGroup cols={2}>
  <Card title="模型名称" icon="cube">
    `agnes-video-v2.0`
  </Card>

  <Card title="创建任务" icon="video">
    `POST /v1/videos`
  </Card>

  <Card title="获取结果" icon="link">
    `GET /agnesapi?video_id=<VIDEO_ID>`
  </Card>

  <Card title="当前价格" icon="tag">
    视频时长当前为 `$0 / 秒`
  </Card>
</CardGroup>

## 概述

开发者可以使用文本提示词、图片 URL 或多张参考图片生成高质量视频。该模型适用于故事讲述、营销视频、产品演示、社交媒体内容、应用动态素材和 AI 创意工作流。

## 核心能力

<CardGroup cols={2}>
  <Card title="文生视频" icon="clapperboard">
    通过文本提示词直接生成视频。
  </Card>

  <Card title="图生视频" icon="image">
    将静态图片转化为动态视频。
  </Card>

  <Card title="多图视频生成" icon="layer-group">
    使用多张参考图片引导视频生成。
  </Card>

  <Card title="关键帧动画" icon="timeline">
    在多个关键帧之间生成流畅过渡。
  </Card>

  <Card title="场景运动控制" icon="camera">
    通过提示词控制主体动作、镜头运动和场景动态。
  </Card>

  <Card title="视觉一致性" icon="eye">
    在帧间保持主体、风格和场景一致。
  </Card>

  <Card title="电影级输出" icon="film">
    生成高质量电影级视频内容。
  </Card>

  <Card title="异步 API" icon="clock">
    创建任务后再轮询或查询生成结果。
  </Card>
</CardGroup>

## 适用场景

<CardGroup cols={2}>
  <Card title="故事讲述" icon="book-open">
    短片、角色场景和叙事片段。
  </Card>

  <Card title="营销视频" icon="bullhorn">
    产品广告、宣传视频和推广内容。
  </Card>

  <Card title="社交媒体内容" icon="share-nodes">
    Reels、Shorts、TikTok 风格视频。
  </Card>

  <Card title="图片动画" icon="wand-magic-sparkles">
    为肖像、产品、角色或场景添加动画效果。
  </Card>

  <Card title="产品演示" icon="box">
    通过文本或图片生成产品展示视频。
  </Card>

  <Card title="关键帧过渡" icon="arrows-left-right">
    在不同视觉状态之间生成流畅过渡。
  </Card>
</CardGroup>

## 前提条件

<Note>
  在接入之前，请确认拥有有效的 Agnes AI API Key，网络可访问 Agnes AI API 网关，并已准备好用于视频生成的文本提示词。图生视频、多图视频或关键帧动画还需要提供可公开访问的图片 URL。
</Note>

## API Reference

### 创建视频任务

```text theme={null}
POST https://apihub.agnes-ai.com/v1/videos
```

### 获取视频结果：推荐方式

```text theme={null}
GET https://apihub.agnes-ai.com/agnesapi?video_id=<VIDEO_ID>
```

### 获取视频结果：兼容旧版方式

```text theme={null}
GET https://apihub.agnes-ai.com/v1/videos/<TASK_ID>
```

### 请求头

```bash theme={null}
-H "Authorization: Bearer YOUR_API_KEY"
-H "Content-Type: application/json"
```

## 创建任务参数

| 参数                    | 类型      | 必填 | 说明                               |
| --------------------- | ------- | -- | -------------------------------- |
| `model`               | string  | 是  | 模型名称，使用 `agnes-video-v2.0`。      |
| `prompt`              | string  | 是  | 视频内容的文本描述。                       |
| `image`               | string  | 否  | 图生视频使用的图片 URL。                   |
| `mode`                | string  | 否  | 生成模式，例如 `ti2vid` 或 `keyframes`。  |
| `height`              | integer | 否  | 视频高度，默认值为 `768`。                 |
| `width`               | integer | 否  | 视频宽度，默认值为 `1152`。                |
| `num_frames`          | integer | 否  | 视频帧数，必须 `≤ 441` 且遵循 `8n + 1` 规则。 |
| `frame_rate`          | number  | 否  | 视频帧率，支持范围为 `1–60`。               |
| `num_inference_steps` | integer | 否  | 推理步数。                            |
| `seed`                | integer | 否  | 随机种子，用于生成可复现结果。                  |
| `negative_prompt`     | string  | 否  | 反向提示词，描述需要避免的内容。                 |
| `extra_body.image`    | array   | 否  | 多图视频或关键帧模式下的输入图片 URL 数组。         |
| `extra_body.mode`     | string  | 否  | 附加模式设置，例如 `keyframes`。           |

## 参数标准化

<Note>
  Agnes Video V2.0 会对部分视频生成参数进行标准化处理。当提交的 `width`、`height` 或宽高比与模型支持规格不完全匹配时，系统会自动映射到最接近的标准输出尺寸。
</Note>

模型目前支持三个标准分辨率档位：`480p`、`720p` 和 `1080p`。

| 宽高比    | 推荐场景                                      |
| ------ | ----------------------------------------- |
| `16:9` | 横版视频、产品演示、网站展示、YouTube 风格内容。              |
| `9:16` | 竖版短视频、移动端内容、TikTok / Reels / Shorts 风格内容。 |
| `1:1`  | 方形视频、社交媒体信息流、角色或产品展示。                     |
| `4:3`  | 传统横版格式和通用演示内容。                            |
| `3:4`  | 竖版演示、肖像或产品为主的内容。                          |

<Tip>
  展示任务信息、计算视频时长或排查生成结果问题时，请以 API 响应中的 `size`、`seconds` 等字段为准。
</Tip>

## 创建任务示例

<Tabs>
  <Tab title="文生视频">
    ```bash theme={null}
    curl -X POST https://apihub.agnes-ai.com/v1/videos \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-video-v2.0",
        "prompt": "A cinematic shot of a cat walking on the beach at sunset, soft ocean waves, warm golden lighting, realistic motion",
        "height": 768,
        "width": 1152,
        "num_frames": 121,
        "frame_rate": 24
      }'
    ```
  </Tab>

  <Tab title="图生视频">
    ```bash theme={null}
    curl -X POST https://apihub.agnes-ai.com/v1/videos \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-video-v2.0",
        "prompt": "The woman slowly turns around and looks back at the camera, natural facial expression, cinematic camera movement",
        "image": "https://example.com/image.png",
        "num_frames": 121,
        "frame_rate": 24
      }'
    ```
  </Tab>

  <Tab title="多图视频">
    ```bash theme={null}
    curl -X POST https://apihub.agnes-ai.com/v1/videos \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-video-v2.0",
        "prompt": "Create a smooth transformation scene between the two reference images, cinematic lighting, consistent character identity, natural motion",
        "extra_body": {
          "image": [
            "https://example.com/image1.png",
            "https://example.com/image2.png"
          ]
        },
        "num_frames": 121,
        "frame_rate": 24
      }'
    ```
  </Tab>

  <Tab title="关键帧动画">
    ```bash theme={null}
    curl -X POST https://apihub.agnes-ai.com/v1/videos \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-video-v2.0",
        "prompt": "Generate a smooth cinematic transition between the keyframes, maintaining visual consistency and natural camera movement",
        "extra_body": {
          "image": [
            "https://example.com/keyframe1.png",
            "https://example.com/keyframe2.png"
          ],
          "mode": "keyframes"
        },
        "num_frames": 121,
        "frame_rate": 24
      }'
    ```
  </Tab>
</Tabs>

## 创建任务响应

```json theme={null}
{
  "id": "task_YOUR_TASK_ID",
  "task_id": "task_YOUR_TASK_ID",
  "video_id": "video_YOUR_VIDEO_ID",
  "object": "video",
  "model": "agnes-video-v2.0",
  "status": "queued",
  "progress": 0,
  "created_at": 1780457477,
  "seconds": "10.0",
  "size": "1280x768"
}
```

| 字段           | 类型      | 说明                  |
| ------------ | ------- | ------------------- |
| `id`         | string  | 任务 ID，可与旧版查询接口配合使用。 |
| `task_id`    | string  | 任务 ID，作用与 `id` 相同。  |
| `video_id`   | string  | 视频 ID，推荐用于获取视频结果。   |
| `object`     | string  | 对象类型，通常为 `video`。   |
| `model`      | string  | 当前任务使用的模型。          |
| `status`     | string  | 当前任务状态。             |
| `progress`   | integer | 当前任务进度百分比。          |
| `created_at` | integer | 任务创建时间戳。            |
| `seconds`    | string  | 视频时长，单位为秒。          |
| `size`       | string  | 视频分辨率。              |

## 获取视频结果

<Tabs>
  <Tab title="推荐方式：video_id">
    ```bash theme={null}
    curl --location --request GET 'https://apihub.agnes-ai.com/agnesapi?video_id=<VIDEO_ID>' \
      --header 'Authorization: Bearer YOUR_API_KEY'
    ```
  </Tab>

  <Tab title="指定 model_name">
    ```bash theme={null}
    curl --location --request GET 'https://apihub.agnes-ai.com/agnesapi?video_id=<VIDEO_ID>&model_name=agnes-video-v2.0' \
      --header 'Authorization: Bearer YOUR_API_KEY'
    ```

    适用于使用上游原始视频 ID、非默认模型，或需要显式指定模型名称的场景。
  </Tab>

  <Tab title="兼容旧版：task_id">
    ```bash theme={null}
    curl --location --request GET 'https://apihub.agnes-ai.com/v1/videos/<TASK_ID>' \
      --header 'Authorization: Bearer YOUR_API_KEY'
    ```
  </Tab>
</Tabs>

## 获取结果响应

```json theme={null}
{
  "id": "task_YOUR_TASK_ID",
  "video_id": "video_YOUR_VIDEO_ID",
  "model": "agnes-video-v2.0",
  "object": "video",
  "status": "completed",
  "progress": 100,
  "seconds": "10.0",
  "size": "1280x768",
  "remixed_from_video_id": "https://storage.googleapis.com/agnes-aigc/aigc/videos/2026/06/03/video_xxxxxx.mp4",
  "error": null
}
```

| 字段                      | 类型            | 说明                                         |
| ----------------------- | ------------- | ------------------------------------------ |
| `id`                    | string        | 任务 ID。                                     |
| `video_id`              | string        | 视频 ID。                                     |
| `model`                 | string        | 当前任务使用的模型。                                 |
| `object`                | string        | 对象类型。                                      |
| `status`                | string        | 任务状态。                                      |
| `progress`              | integer       | 任务进度百分比。                                   |
| `seconds`               | string        | 视频时长，单位为秒。                                 |
| `size`                  | string        | 视频分辨率。                                     |
| `remixed_from_video_id` | string        | 最终生成的视频 URL，仅在 `status` 为 `completed` 时可用。 |
| `error`                 | object / null | 任务失败时返回的错误信息。                              |

## 任务状态

| 状态            | 说明         |
| ------------- | ---------- |
| `queued`      | 任务正在队列中等待。 |
| `in_progress` | 视频正在生成。    |
| `completed`   | 视频生成成功。    |
| `failed`      | 视频生成失败。    |

## 视频时长控制

视频时长由 `num_frames` 和 `frame_rate` 控制。

```text theme={null}
seconds = num_frames / frame_rate
```

<Warning>
  `num_frames` 必须小于或等于 `441`，并且必须遵循 `8n + 1` 规则。
</Warning>

| 目标时长   | 推荐参数                                |
| ------ | ----------------------------------- |
| 约 3 秒  | `num_frames: 81`, `frame_rate: 24`  |
| 约 5 秒  | `num_frames: 121`, `frame_rate: 24` |
| 约 10 秒 | `num_frames: 241`, `frame_rate: 24` |
| 约 18 秒 | `num_frames: 441`, `frame_rate: 24` |

## 推荐参数

| 场景       | 推荐设置                                                              |
| -------- | ----------------------------------------------------------------- |
| 标准视频生成   | `width: 1152`, `height: 768`, `num_frames: 121`, `frame_rate: 24` |
| 社交短视频    | `num_frames: 81` 或 `121`, `frame_rate: 24`                        |
| 较长视频     | 增大 `num_frames` 或降低 `frame_rate`。                                 |
| 更流畅的运动   | 使用 `frame_rate: 24` 或 `30`。                                       |
| 可复现结果    | 设置固定 `seed`。                                                      |
| 关键帧过渡    | 使用 `extra_body.mode: "keyframes"`。                                |
| 避免不需要的内容 | 使用 `negative_prompt`。                                             |

## 提示词最佳实践

<AccordionGroup>
  <Accordion title="文生视频提示词">
    推荐结构：

    ```text theme={null}
    [主体] + [动作] + [场景] + [镜头运动] + [光线] + [风格]
    ```

    示例：

    ```text theme={null}
    A young astronaut walking across a red desert planet, dust blowing in the wind, slow cinematic tracking shot, dramatic sunset lighting, realistic sci-fi style
    ```
  </Accordion>

  <Accordion title="图生视频提示词">
    描述哪些内容应该运动，以及哪些关键主体元素应该保持稳定。

    ```text theme={null}
    Animate the character with subtle breathing motion, hair moving gently in the wind, background lights flickering softly, while keeping the face and outfit consistent
    ```
  </Accordion>

  <Accordion title="多图视频提示词">
    描述输入图片之间的关系，以及场景如何过渡。

    ```text theme={null}
    Use the first image as the starting scene and the second image as the target scene. Create a smooth transformation with consistent lighting, natural motion, and cinematic pacing
    ```
  </Accordion>

  <Accordion title="关键帧动画提示词">
    清晰描述关键帧之间的过渡关系。

    ```text theme={null}
    Create a smooth transition from the first keyframe to the second keyframe, maintaining character identity, consistent camera angle, and natural motion between scenes
    ```
  </Accordion>
</AccordionGroup>

## 错误码

| 状态码   | 说明               |
| ----- | ---------------- |
| `400` | 请求无效。请检查请求参数。    |
| `401` | 未授权。请检查 API Key。 |
| `404` | 任务或视频未找到。        |
| `500` | 服务器错误。           |
| `503` | 服务繁忙。请稍后重试。      |

## 定价

| 类型   | 标准价格         | 当前价格     |
| ---- | ------------ | -------- |
| 视频时长 | `$0.005 / 秒` | `$0 / 秒` |

## 接入检查清单

<Check>
  使用 `agnes-video-v2.0` 作为模型名称。
</Check>

<Check>
  视频生成是异步任务，需要先创建任务，再获取结果。
</Check>

<Check>
  创建任务响应会同时返回 `task_id` 和 `video_id`，新接入建议使用 `video_id`。
</Check>

<Check>
  `num_frames` 必须小于或等于 `441`，并遵循 `8n + 1` 规则。
</Check>

<Check>
  图生视频使用 `image`，多图视频和关键帧动画使用 `extra_body.image`。
</Check>
