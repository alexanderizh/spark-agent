/**
 * ModelCapability — 模型能力元数据类型定义
 */

export type Modality = 'text' | 'image' | 'audio' | 'video'

export interface ModelCapability {
  /** 上下文窗口大小（tokens） */
  contextWindow: number
  /** 最大输出 tokens */
  maxOutputTokens: number
  /** 是否支持视觉（图片输入） */
  supportsVision: boolean
  /** 是否支持工具调用/函数调用 */
  supportsToolUse: boolean
  /** 是否支持流式输出 */
  supportsStreaming: boolean
  /** 是否支持扩展思考（extended thinking / reasoning） */
  supportsExtendedThinking: boolean
  /** 支持的模态 */
  supportedModalities: Modality[]
}
