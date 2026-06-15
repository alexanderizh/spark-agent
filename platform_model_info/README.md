# 平台模型信息收集

本目录包含各AI平台多媒体模型的参数配置信息，用于项目中模型配置和参数选项的完整定义。

## 文件列表

| 文件 | 平台 | 状态 | 说明 |
|------|------|------|------|
| `apimart.json` | ApiMart | ✅ 完成 | 9个模型，包含文生图、视频生成模型的完整参数 |
| `xai.json` | xAI | ⚠️ 部分完成 | 2个模型，已获取定价和基础信息，需补充完整参数枚举 |
| `minimax.json` | MiniMax | ⚠️ 部分完成 | 6个模型，Hailuo 2.3完整，其他需补充 |
| `kling.json` | Kling | ✅ 完成 | 8个模型，3.0 / 3.0 Omni / 2.6 / 2.5 / O1 参数已补齐 |
| `openrouter.json` | OpenRouter |  |
| `volcengine.json` | 火山引擎 | Seedance 2.0 / Fast 已完成，其余模型待补 |
| `aliyun.json` | 阿里云百炼 | ✅ 完成 | Wan 2.7 Image Pro / Wan 2.7 I2V / HappyHorse 1.0 T2V / Qwen3 TTS Flash |

## 模型能力统计

### 文生图模型
- apimart: wan2.7-image, gpt-image-2, imagen-4.0, qwen-image-2.0, doubao-seedream-5-0-lite, gemini-3.1-flash, gemini-3-pro, gemini-2.5-flash
- xai: grok-imagine-image-quality
- minimax: image-01
- volcengine: Doubao-Seedream-5.0-lite, Doubao-Seedream-4.5
- aliyun: wan2.7-image-pro
- openrouter: gemini-3.1-flash, gpt-5.4-image-2, flux.2-pro

### 文生视频模型
- apimart: doubao-seedance-2.0
- xai: grok-imagine-video
- minimax: MiniMax-Hailuo-2.3, MiniMax-Hailuo-2.3-Fast
- kling: Kling Video 3.0, Kling 3.0 Omni, Kling O1, Kling 2.6 Pro/Std/Turbo
- volcengine: Doubao-Seedance-2.0, Doubao-Seedance-2.0-fast
- aliyun: HappyHorse-1.0-T2V
- openrouter: sora-2-pro

### 图生视频模型
- kling: 全系列支持
- aliyun: wan2.7-i2v
- xai: grok-imagine-video（支持）

### 语音生成模型
- minimax: Speech-2.8-HD, Speech-2.8-Turbo
- volcengine: Doubao-TTS-2.0, Doubao-Podcast-Voice, Doubao-Voice-Design
- aliyun: qwen3-tts-flash
- openrouter: gpt-audio, gpt-audio-mini

### 音乐生成模型
- minimax: music-2.6

### 3D生成模型
- volcengine: Doubao-Seed3D-2.0

## 待完成工作

### 高优先级
1. **火山引擎/阿里云**: Seedance 2.0 / Fast 已完成，其他火山模型与阿里云模型仍待补
2. **xAI**: 补充 grok-imagine-video 的 aspect_ratio、duration、quality 枚举值
3. **Kling**: 补充 Kling 3.0 和 3.0 Omni 的详细参数

### 中优先级
1. **MiniMax**: 补充 Speech-2.8、image-01、music-2.6 的完整参数
2. **OpenRouter**: 查看 https://openrouter.ai/models 获取各模型详细参数

## 数据格式说明

每个模型信息包含以下字段：
```json
{
  "provider": "平台标识",
  "modelId": "模型ID",
  "displayName": "显示名称",
  "capabilities": ["能力标签数组"],
  "endpoint": "API端点",
  "requestBody": { 请求参数结构及枚举值 },
  "defaults": { 默认参数值 },
  "limits": { 限制条件 },
  "response": { 响应结构 },
  "docs": ["文档链接"]
}
```

## 更新方式

运行项目中的 skill：
```
/skill run project:.claude/skills/model-info-collector/SKILL.md
```

或手动从各平台官方文档获取参数信息，更新对应JSON文件。
