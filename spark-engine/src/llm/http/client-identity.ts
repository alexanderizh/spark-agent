import { SPARK_ENGINE_VERSION } from '../../version.js'

/**
 * Client identity headers every upstream request carries.
 *
 * Agent gateways (OpenCode Zen / Console Go) reject requests that look like a
 * bare HTTP library call: they expect a client-specific User-Agent instead of
 * the runtime default, plus a stable per-conversation id in
 * `x-opencode-session`. Channels that do not know the session header ignore it,
 * so one identity set stays correct for every route.
 *
 * The session id is an opaque conversation identifier, never user content, and
 * it must stay constant for the whole session — the gateway uses it to tell one
 * conversation from another.
 */
export const CLIENT_USER_AGENT = `spark-engine/${SPARK_ENGINE_VERSION}`

const SESSION_HEADER_NAME = 'x-opencode-session'
const MAX_SESSION_ID_LENGTH = 256

export function clientIdentityHeaders(sessionId: string | undefined): Record<string, string> {
  const session = sessionId?.trim()
  return {
    'user-agent': CLIENT_USER_AGENT,
    ...(session !== undefined && session.length > 0 && session.length <= MAX_SESSION_ID_LENGTH
      ? { [SESSION_HEADER_NAME]: session }
      : {}),
  }
}
