/**
 * 移动桥接新建会话的标题规则（纯函数，可单测）。
 *
 * 两条约束来自 agent-runtime 的标题派生：
 *   1. 占位标题必须落在「可派生」集合里（`新会话` 在 `DEFAULT_SESSION_TITLES` 中），
 *      首轮 turn 才会用用户的首条消息改写它 —— 之前固定写「移动端会话」，既不在集合里
 *      也不以「 会话」结尾，于是移动端/远程视图里永远一屏同名；
 *   2. 「 · 远程创建」后缀是来源标记，派生与 LLM 精炼都会保留它（见
 *      `withRemoteCreatedTitleSuffix`），这里负责首次写入时不重复、不超长。
 */
import { REMOTE_CREATED_TITLE_SUFFIX, SESSION_TITLE_MAX_LENGTH } from '@spark/agent-runtime'

/** 与 agent-runtime 的 `SESSION_TITLE_MAX_LENGTH` 对齐，含后缀 */
const MAX_TITLE_LENGTH = SESSION_TITLE_MAX_LENGTH

/**
 * @param title 调用方给的标题（小程序里通常是首条消息的前 30 字），空则由首轮消息派生
 * @returns `<title | 新会话> · 远程创建`
 */
export function buildBridgeSessionTitle(title?: string | null): string {
  const base = title?.trim() ?? ''
  if (base.endsWith(REMOTE_CREATED_TITLE_SUFFIX)) {
    return base.slice(0, MAX_TITLE_LENGTH + REMOTE_CREATED_TITLE_SUFFIX.length)
  }
  const room = MAX_TITLE_LENGTH - REMOTE_CREATED_TITLE_SUFFIX.length
  const trimmed = base.length > 0 ? truncateByChars(base, room) : '新会话'
  return `${trimmed}${REMOTE_CREATED_TITLE_SUFFIX}`
}

/** 按字符（而非码元）截断，避免把 emoji / 生僻字劈成半个代理对 */
function truncateByChars(text: string, limit: number): string {
  const chars = Array.from(text)
  if (chars.length <= limit) return text
  return chars.slice(0, limit).join('').trimEnd()
}
