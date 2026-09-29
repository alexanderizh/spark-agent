/**
 * 语音轮次的模型消息构建（纯函数）
 *
 * 与远程连接的 createRemoteUserTurn 同构：模型输入带平台上下文前缀，
 * 时间线展示转写原文（userMessageDisplayContent）。
 * 前缀要求 Agent 口语化、简短、适合朗读——TTS 播报时代码块与表格会被省略。
 */

const VOICE_CONTEXT_PROMPT =
  '【语音助手会话】当前消息来自语音对话（语音转写文本）。请用口语化、简短自然的中文回复，适合直接朗读给用户听；避免使用 markdown 列表、表格和代码块（朗读时代码与表格会被省略），必要时用完整句子表达；如需执行危险操作（删除、覆盖、推送等）请先用一句话向用户确认。\n\n'

export function buildVoiceUserMessage(transcript: string, withContext: boolean): string {
  const trimmed = transcript.trim()
  if (!withContext) return trimmed
  return `${VOICE_CONTEXT_PROMPT}${trimmed}`
}
