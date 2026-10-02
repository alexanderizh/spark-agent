/**
 * @module llm-client-identity
 *
 * agent-runtime 直连 HTTP 的 LLM 请求统一携带的客户端身份头。
 *
 * 语义对齐 spark-engine 的 `llm/http/client-identity.ts`（正常对话路径已注入）：
 * Agent 网关（OpenCode Zen / Console Go）会拒绝"裸 HTTP 库调用"特征的请求 ——
 * 要求非运行时默认的 User-Agent，外加一个稳定的会话标识 `x-opencode-session`。
 * 不识别该头的渠道会直接忽略，因此对全部渠道统一注入是安全的。
 *
 * 分流器此前走 ModelService.complete() 裸 fetch 未带身份头，OpenCode Zen 网关
 * 一律 400（"Request is missing x-opencode-session"）→ 每轮分流必然降级兜底。
 */

/** 与 spark-engine 侧一致的非默认 UA 特征；版本差异对网关无语义。 */
export const LLM_CLIENT_USER_AGENT = 'spark-agent-runtime/1.0'

const SESSION_HEADER_NAME = 'x-opencode-session'
const MAX_SESSION_ID_LENGTH = 256

/**
 * 构造客户端身份头。
 *
 * @param sessionId 稳定的调用方会话标识（如 `autorouter:<routerId>`）；
 *   缺省时回退进程级固定 id —— 网关用它区分会话，complete() 的调用粒度
 *   （记忆抽取/分流决策）本就是短平快小任务，共用一个 id 语义无损。
 */
export function llmClientIdentityHeaders(sessionId?: string): Record<string, string> {
  const session = sessionId?.trim()
  const resolved =
    session !== undefined && session.length > 0 && session.length <= MAX_SESSION_ID_LENGTH
      ? session
      : 'spark-agent-runtime:default'
  return {
    'user-agent': LLM_CLIENT_USER_AGENT,
    [SESSION_HEADER_NAME]: resolved,
  }
}
