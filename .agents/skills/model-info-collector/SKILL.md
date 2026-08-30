---
name: model-info-collector
description: Collect model parameters and capabilities from official AI platform documentation and update the project's built-in media model manifests. Use when researching, adding, or updating multimedia model definitions.
---

# Model Info Collector

收集AI平台的模型参数配置信息，生成标准化的模型能力描述文件。

## 用途

当用户需要：

- 收集某个平台的模型参数配置
- 更新项目中的模型能力定义
- 批量整理多平台模型信息

## 执行流程

### 1. 确定收集范围

明确需要收集的平台和模型列表：

- 平台名称和官网地址
- 具体模型ID列表
- 模型能力类型（文生图、文生视频、语音生成等）

### 2. 使用 Playwright 有头浏览器查阅文档（优先）

**重要：不要只拼链接，要实际进入页面一层层查找操作。**

```
工具使用顺序：
1. 优先使用 Playwright MCP 工具（mcp__playwright__*）
2. 若 Playwright 不可用，使用 Bash 打开 Edge 浏览器
3. 最后才考虑 WebFetch（仅限公开文档）
```

**Playwright 操作步骤：**

```
1. mcp__playwright__browser_navigate - 导航到文档首页
2. mcp__playwright__browser_snapshot - 获取页面快照，查看结构
3. mcp__playwright__browser_click - 点击链接进入子页面
4. mcp__playwright__browser_scroll - 滚动查看完整内容
5. 重复2-4直到找到目标模型文档
6. 提取参数表格中的所有字段和枚举值
```

**注意事项：**

- 如果单独的模型文档不存在，查找平台标准文档（通用参数）
- 需要登录的页面，先打开浏览器让用户登录，再继续操作
- 遇到404或权限问题，尝试从模型列表页或API总览页查找

### 3. 按标准格式整理

收集以下字段：

- `provider`: 平台标识
- `modelId`: 模型ID
- `displayName`: 显示名称
- `capabilities`: 能力标签数组
- `endpoint`: API端点
- `requestBody`: 请求参数结构及枚举值（**必须从文档中提取，不可臆造**）
- `defaults`: 默认参数值
- `limits`: 限制条件
- `response`: 响应结构
- `docs`: 文档链接

### 4. 写入项目（单一来源）

收集结果**直接写入**内置 manifest 源码，不要创建中间 JSON 目录：

```
packages/protocol/src/media-model-manifest.ts
└── BUILTIN_MEDIA_MODEL_MANIFESTS   # 追加或更新 MediaModelManifest 条目
```

要求：

- 每条 manifest 必须符合 `MediaModelManifestSchema`（同文件内 zod schema）
- `paramSchema` / `defaults` / `aliases` 从官方文档提取，不可臆造
- 改完后运行 `pnpm --filter @spark/protocol test` 与相关 media 单测
- 应用启动时 `MediaModelCatalogService.seedBuiltinManifests()` 会把内置条目 seed 进 SQLite

## 能力标签规范

| 能力     | 标签                                            |
| -------- | ----------------------------------------------- |
| 文生图   | `image.generate`                                |
| 图生图   | `image.edit`, `image.inpaint`, `image.outpaint` |
| 图编辑   | `image.edit`                                    |
| 图合成   | `image.compose`                                 |
| 文生视频 | `video.generate`                                |
| 图生视频 | `video.image_to_video`                          |
| 首尾帧   | `video.first_last_frame`                        |
| 参考图   | `video.reference_image`                         |
| 多图编辑 | `image.multi_edit`                              |
| 音频开关 | `video.audio_control`                           |
| 语音生成 | `audio.speech_generate`                         |
| 音乐生成 | `audio.music_generate`                          |
| 3D生成   | `3d.generate`                                   |

## 参数收集清单

### 图像生成模型必查参数：

- [ ] `size` / `resolution`: 分辨率枚举值（如 1024x1024, 768P, 1080P）
- [ ] `aspect_ratio`: 比例枚举（如 16:9, 9:16, 1:1）
- [ ] `quality`: 质量选项（如 standard, high）
- [ ] `n`: 生成数量
- [ ] `style`: 风格选项
- [ ] `response_format`: 输出格式（url, b64_json）
- [ ] `seed`: 随机种子支持

### 视频生成模型必查参数：

- [ ] `duration`: 时长枚举（秒）
- [ ] `aspect_ratio` / `resolution`: 比例/分辨率
- [ ] `fps`: 帧率选项
- [ ] `audio`: 音频生成开关
- [ ] `loop`: 循环支持
- [ ] 图生视频参数：`image`, `first_frame`, `last_frame`

### 语音模型必查参数：

- [ ] `voice` / `voice_id`: 音色选项
- [ ] `speed`: 语速范围
- [ ] `pitch`: 音调范围
- [ ] `format`: 输出格式（mp3, wav, etc）
- [ ] `sample_rate`: 采样率

## 注意事项

- **不要凭空臆造参数**，必须从文档中获取
- 枚举值要完整，包括所有可选项
- 限制条件（长度、大小、格式）要准确
- 如果无法访问文档或文档不完整，明确标注 `status: "NEEDS_INFO"`
- 需要登录的文档，标注 `status: "NEEDS_LOGIN"`

## 示例输出格式

```json
{
  "provider": "xai",
  "modelId": "grok-imagine-video",
  "displayName": "Grok Imagine Video",
  "capabilities": ["video.generate", "video.image_to_video"],
  "endpoint": "/videos/generations",
  "pollingEndpoint": "/videos/{request_id}",
  "requestBody": {
    "model": {
      "type": "string",
      "required": true,
      "enum": ["grok-imagine-video"]
    },
    "prompt": {
      "type": "string",
      "required": true,
      "maxLength": 8000,
      "description": "视频文本描述"
    },
    "image": {
      "type": "object",
      "required": false,
      "properties": {
        "url": { "type": "string" }
      },
      "description": "参考图片URL，用于图生视频"
    },
    "aspect_ratio": {
      "type": "string",
      "required": false,
      "enum": ["16:9", "9:16", "4:3"],
      "default": "16:9"
    },
    "duration": {
      "type": "integer",
      "required": false,
      "enum": [3, 6, 10],
      "default": 6,
      "description": "视频时长（秒）"
    },
    "quality": {
      "type": "string",
      "required": false,
      "enum": ["standard", "high"],
      "default": "standard"
    }
  },
  "defaults": {
    "aspectRatio": "16:9",
    "durationSeconds": 6,
    "quality": "standard"
  },
  "limits": {
    "maxPromptLength": 8000,
    "maxImages": 1,
    "acceptedMimeTypes": ["image/png", "image/jpeg", "image/webp"]
  },
  "response": {
    "taskIdPaths": ["request_id"],
    "resultPaths": ["video_url"]
  },
  "docs": ["https://docs.x.ai/developers/models/grok-imagine-video"],
  "status": "COMPLETE"
}
```

## 团队协作模式

当需要并行收集多平台时：

1. 将平台列表分配给团队成员
2. 每人负责1-2个平台
3. 使用 `mcp__spark_team__agent_dispatch_batch` 并行调度
4. 汇总结果并验证格式一致性
5. 合并进 `BUILTIN_MEDIA_MODEL_MANIFESTS` 并跑 protocol / media 相关测试
