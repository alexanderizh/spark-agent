import crypto from 'node:crypto'

const DEFAULT_API_BASE_URL = 'https://ilinkai.weixin.qq.com'
const BOT_TYPE = '3'
const CHANNEL_VERSION = '2.4.9'
const APP_ID = 'bot'
const APP_CLIENT_VERSION = String(encodeVersion(CHANNEL_VERSION))
const BOT_AGENT = 'SparkWork/1.0.0'
const QR_LOGIN_TTL_MS = 5 * 60_000
const QR_STATUS_TIMEOUT_MS = 35_000
const GET_UPDATES_TIMEOUT_MS = 45_000

function encodeVersion(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map((part) => Number(part) || 0)
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff)
}

function randomWechatUin(): string {
  return Buffer.from(String(crypto.randomBytes(4).readUInt32BE(0)), 'utf8').toString('base64')
}

function baseInfo(): Record<string, string> {
  return { channel_version: CHANNEL_VERSION, bot_agent: BOT_AGENT }
}

function normalizeBaseUrl(value?: string): string {
  const url = new URL(value?.trim() || DEFAULT_API_BASE_URL)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('微信机器人 API 地址必须使用 HTTPS')
  }
  return url.toString().replace(/\/$/, '')
}

function commonHeaders(): Record<string, string> {
  return {
    'iLink-App-Id': APP_ID,
    'iLink-App-ClientVersion': APP_CLIENT_VERSION,
  }
}

function authenticatedHeaders(token?: string): Record<string, string> {
  return {
    ...commonHeaders(),
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

const LOSSLESS_ID_FIELDS = new Set(['message_id', 'msg_id', 'svr_id'])

function parseJsonPreservingIds<T>(rawText: string): T {
  let output = ''
  let index = 0
  while (index < rawText.length) {
    if (rawText[index] !== '"') {
      output += rawText[index++]
      continue
    }
    const stringStart = index
    index += 1
    let escaped = false
    while (index < rawText.length) {
      const char = rawText[index++]
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') break
    }
    const keyToken = rawText.slice(stringStart, index)
    output += keyToken
    let cursor = index
    while (/\s/.test(rawText[cursor] ?? '')) cursor += 1
    if (rawText[cursor] !== ':') continue

    let key: unknown
    try {
      key = JSON.parse(keyToken)
    } catch {
      continue
    }
    if (typeof key !== 'string' || !LOSSLESS_ID_FIELDS.has(key)) continue

    output += rawText.slice(index, cursor + 1)
    cursor += 1
    while (/\s/.test(rawText[cursor] ?? '')) output += rawText[cursor++]
    const numberStart = cursor
    if (rawText[cursor] === '-') cursor += 1
    while (/\d/.test(rawText[cursor] ?? '')) cursor += 1
    const next = rawText[cursor]
    if (
      cursor > numberStart &&
      !(cursor === numberStart + 1 && rawText[numberStart] === '-') &&
      (next == null || next === ',' || next === '}' || /\s/.test(next))
    ) {
      output += `"${rawText.slice(numberStart, cursor)}"`
      index = cursor
    } else {
      index = numberStart
    }
  }
  return JSON.parse(output) as T
}

async function requestJson<T>(
  baseUrl: string,
  endpoint: string,
  options: {
    method: 'GET' | 'POST'
    token?: string
    body?: unknown
    signal?: AbortSignal
    timeoutMs?: number
    authenticated?: boolean
  },
): Promise<T> {
  const url = new URL(endpoint, `${normalizeBaseUrl(baseUrl)}/`)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)
  const abortFromCaller = () => controller.abort()
  if (options.signal?.aborted) {
    abortFromCaller()
  } else {
    options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  }
  try {
    const response = await fetch(url, {
      method: options.method,
      headers:
        options.authenticated === false ? commonHeaders() : authenticatedHeaders(options.token),
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`微信机器人请求失败：HTTP ${response.status} ${text.slice(0, 180)}`)
    }
    try {
      return (text.length > 0 ? parseJsonPreservingIds<T>(text) : {}) as T
    } catch {
      throw new Error('微信机器人返回了无效的 JSON 响应')
    }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}

type QrLoginSession = {
  loginId: string
  qrcode: string
  qrPayload: string
  apiBaseUrl: string
  expiresAt: number
  pollController?: AbortController
}

export type WeixinQrLoginStatus =
  | 'wait'
  | 'scaned'
  | 'need_verifycode'
  | 'confirmed'
  | 'expired'
  | 'verify_code_blocked'
  | 'binded_redirect'

export type WeixinQrLoginResult = {
  status: WeixinQrLoginStatus
  message: string
  botToken?: string
  botId?: string
  baseUrl?: string
  userId?: string
}

export type WeixinInboundMessage = {
  externalId: string
  messageId?: string
  contextToken?: string
  text: string
}

type GetUpdatesResponse = {
  ret?: number
  errcode?: number
  errmsg?: string
  msgs?: Array<{
    message_type?: number
    group_id?: string
    from_user_id?: string
    message_id?: number | string
    context_token?: string
    item_list?: Array<{
      type?: number
      text_item?: { text?: string }
    }>
  }>
  get_updates_buf?: string
}

type WeixinPoller = {
  token: string
  baseUrl: string
  running: boolean
  lastError?: string
  failCount: number
  cursor: string
  controller: AbortController
}

/**
 * Thin client for the iLink HTTP protocol documented by Tencent's
 * openclaw-weixin channel. The upstream protocol reference notes that some
 * server-side behavior is not a complete public contract.
 */
export class WeixinClawBotClient {
  private readonly qrLogins = new Map<string, QrLoginSession>()
  private readonly pollers = new Map<string, WeixinPoller>()

  async startQrLogin(
    connectionId: string,
    localTokens: string[] = [],
  ): Promise<{ loginId: string; qrPayload: string; expiresAt: string }> {
    this.purgeExpiredLogins()
    const existing = this.qrLogins.get(connectionId)
    if (existing != null) {
      existing.pollController?.abort()
      this.qrLogins.delete(connectionId)
    }
    const response = await requestJson<{
      qrcode?: string
      qrcode_img_content?: string
    }>(DEFAULT_API_BASE_URL, `ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`, {
      method: 'POST',
      body: { local_token_list: localTokens.slice(0, 10) },
      authenticated: true,
    })
    const qrcode = response.qrcode?.trim()
    const qrPayload = response.qrcode_img_content?.trim()
    if (!qrcode || !qrPayload) throw new Error('微信服务器没有返回有效的授权二维码')
    const loginId = crypto.randomUUID()
    const expiresAt = Date.now() + QR_LOGIN_TTL_MS
    this.qrLogins.set(connectionId, {
      loginId,
      qrcode,
      qrPayload,
      apiBaseUrl: DEFAULT_API_BASE_URL,
      expiresAt,
    })
    return { loginId, qrPayload, expiresAt: new Date(expiresAt).toISOString() }
  }

  async pollQrLogin(
    connectionId: string,
    loginId: string,
    verifyCode?: string,
  ): Promise<WeixinQrLoginResult> {
    const login = this.qrLogins.get(connectionId)
    if (login == null || login.loginId !== loginId) {
      return { status: 'expired', message: '微信扫码会话已失效，请刷新二维码。' }
    }
    if (Date.now() >= login.expiresAt) {
      login.pollController?.abort()
      this.qrLogins.delete(connectionId)
      return { status: 'expired', message: '二维码已过期，请重新扫码。' }
    }
    const query = new URLSearchParams({ qrcode: login.qrcode })
    if (verifyCode?.trim()) query.set('verify_code', verifyCode.trim())
    login.pollController?.abort()
    const pollController = new AbortController()
    login.pollController = pollController
    let response: {
      status?: WeixinQrLoginStatus | 'scaned_but_redirect'
      bot_token?: string
      ilink_bot_id?: string
      baseurl?: string
      ilink_user_id?: string
      redirect_host?: string
    }
    try {
      response = await requestJson(
        login.apiBaseUrl,
        `ilink/bot/get_qrcode_status?${query.toString()}`,
        {
          method: 'GET',
          authenticated: false,
          timeoutMs: QR_STATUS_TIMEOUT_MS,
          signal: pollController.signal,
        },
      )
    } catch {
      if (this.qrLogins.get(connectionId) !== login || pollController.signal.aborted) {
        return { status: 'expired', message: '微信扫码授权已取消。' }
      }
      return { status: 'wait', message: '微信服务器暂时不可用，正在重试授权状态…' }
    } finally {
      if (login.pollController === pollController) delete login.pollController
    }

    if (this.qrLogins.get(connectionId) !== login) {
      return { status: 'expired', message: '微信扫码授权已取消。' }
    }

    if (response.status === 'scaned_but_redirect') {
      const redirectHost = response.redirect_host?.replace(/^https?:\/\//i, '').split('/')[0]
      if (redirectHost && /^[a-z0-9.-]+$/i.test(redirectHost)) {
        login.apiBaseUrl = normalizeBaseUrl(`https://${redirectHost}`)
      }
      return { status: 'scaned', message: '已扫码，正在等待微信确认…' }
    }
    if (response.status === 'need_verifycode') {
      return { status: 'need_verifycode', message: '请输入微信客户端显示的数字验证码。' }
    }
    if (response.status === 'verify_code_blocked') {
      this.qrLogins.delete(connectionId)
      return { status: 'verify_code_blocked', message: '验证码尝试次数过多，请刷新二维码后重试。' }
    }
    if (response.status === 'expired') {
      this.qrLogins.delete(connectionId)
      return { status: 'expired', message: '二维码已过期，请重新扫码。' }
    }
    if (response.status === 'binded_redirect') {
      this.qrLogins.delete(connectionId)
      return {
        status: 'binded_redirect',
        message: '该微信机器人已在此 SparkWork 中授权，请使用现有连接；本次没有返回新的凭据。',
      }
    }
    if (response.status === 'confirmed') {
      const botToken = response.bot_token?.trim()
      const botId = response.ilink_bot_id?.trim()
      if (!botToken || !botId) {
        this.qrLogins.delete(connectionId)
        return {
          status: 'expired',
          message: '微信已确认授权，但服务器没有返回完整的机器人凭据，请刷新二维码重试。',
        }
      }
      let baseUrl: string
      try {
        baseUrl = normalizeBaseUrl(response.baseurl)
      } catch {
        this.qrLogins.delete(connectionId)
        return {
          status: 'expired',
          message: '微信已确认授权，但服务器返回了无效的 API 地址，请刷新二维码重试。',
        }
      }
      this.qrLogins.delete(connectionId)
      return {
        status: 'confirmed',
        message: '微信机器人授权成功。',
        botToken,
        botId,
        baseUrl,
        ...(response.ilink_user_id?.trim() ? { userId: response.ilink_user_id.trim() } : {}),
      }
    }
    return {
      status: response.status === 'scaned' ? 'scaned' : 'wait',
      message: response.status === 'scaned' ? '已扫码，正在等待微信确认…' : '正在等待微信扫码授权…',
    }
  }

  cancelQrLogin(connectionId: string, loginId?: string): void {
    const login = this.qrLogins.get(connectionId)
    if (login == null || (loginId != null && login.loginId !== loginId)) return
    login.pollController?.abort()
    this.qrLogins.delete(connectionId)
  }

  startPolling(
    connectionId: string,
    input: { token: string; baseUrl?: string; cursor?: string },
    callbacks: {
      onMessage: (message: WeixinInboundMessage) => Promise<void>
      onCursor: (cursor: string) => void
    },
  ): void {
    const token = input.token.trim()
    const baseUrl = normalizeBaseUrl(input.baseUrl)
    const existing = this.pollers.get(connectionId)
    if (existing?.running && existing.token === token && existing.baseUrl === baseUrl) return
    this.stopPolling(connectionId)
    const state: WeixinPoller = {
      token,
      baseUrl,
      running: true,
      failCount: 0,
      cursor: input.cursor ?? '',
      controller: new AbortController(),
    }
    this.pollers.set(connectionId, state)
    void this.notify(state, 'notifystart')
    void this.runPollLoop(connectionId, state, callbacks)
  }

  stopPolling(connectionId: string): void {
    const state = this.pollers.get(connectionId)
    if (state == null) return
    state.running = false
    state.controller.abort()
    this.pollers.delete(connectionId)
    void this.notify(state, 'notifystop')
  }

  getPollingStatus(): Array<{ connectionId: string; running: boolean; lastError?: string }> {
    return Array.from(this.pollers.entries()).map(([connectionId, state]) => ({
      connectionId,
      running: state.running,
      ...(state.lastError ? { lastError: state.lastError } : {}),
    }))
  }

  async sendText(input: {
    token: string
    baseUrl?: string
    externalId: string
    contextToken: string
    text: string
  }): Promise<void> {
    if (!input.contextToken) throw new Error('微信会话上下文已失效，请先在微信中发送一条新消息')
    const response = await requestJson<{ ret?: number; errmsg?: string }>(
      normalizeBaseUrl(input.baseUrl),
      'ilink/bot/sendmessage',
      {
        method: 'POST',
        token: input.token,
        body: {
          msg: {
            from_user_id: '',
            to_user_id: input.externalId,
            client_id: crypto.randomUUID(),
            message_type: 2,
            message_state: 2,
            context_token: input.contextToken,
            item_list: [{ type: 1, text_item: { text: input.text } }],
          },
          base_info: baseInfo(),
        },
      },
    )
    if (response.ret != null && response.ret !== 0) {
      throw new Error(`微信机器人发送失败：${response.errmsg ?? `ret=${response.ret}`}`)
    }
  }

  private async runPollLoop(
    connectionId: string,
    state: WeixinPoller,
    callbacks: {
      onMessage: (message: WeixinInboundMessage) => Promise<void>
      onCursor: (cursor: string) => void
    },
  ): Promise<void> {
    while (this.pollers.get(connectionId) === state && state.running) {
      try {
        const response = await requestJson<GetUpdatesResponse>(
          state.baseUrl,
          'ilink/bot/getupdates',
          {
            method: 'POST',
            token: state.token,
            body: { get_updates_buf: state.cursor, base_info: baseInfo() },
            signal: state.controller.signal,
            timeoutMs: GET_UPDATES_TIMEOUT_MS,
          },
        )
        if (this.pollers.get(connectionId) !== state || !state.running) break
        const code =
          response.ret != null && response.ret !== 0 ? response.ret : (response.errcode ?? 0)
        if (code !== 0) {
          if (code === -14) throw new Error('微信机器人授权已失效，请重新扫码授权')
          throw new Error(`微信消息拉取失败：${response.errmsg ?? `ret=${code}`}`)
        }
        state.failCount = 0
        delete state.lastError
        for (const raw of response.msgs ?? []) {
          const message = this.toInboundMessage(raw)
          if (message == null) continue
          try {
            await callbacks.onMessage(message)
          } catch (error) {
            state.lastError = error instanceof Error ? error.message : String(error)
          }
        }
        const cursor = response.get_updates_buf
        if (typeof cursor === 'string' && cursor.length > 0 && cursor !== state.cursor) {
          state.cursor = cursor
          callbacks.onCursor(cursor)
        }
      } catch (error) {
        if (!state.running || state.controller.signal.aborted) break
        state.failCount += 1
        state.lastError = error instanceof Error ? error.message : String(error)
        if (state.lastError.includes('授权已失效')) {
          state.running = false
          break
        }
        await this.delay(Math.min(2 ** state.failCount * 1_000, 60_000), state.controller.signal)
      }
    }
  }

  private toInboundMessage(
    raw: NonNullable<GetUpdatesResponse['msgs']>[number],
  ): WeixinInboundMessage | null {
    if ((raw.message_type != null && raw.message_type !== 1) || raw.group_id?.trim()) return null
    const externalId = raw.from_user_id?.trim()
    if (!externalId) return null
    const textItems = (raw.item_list ?? [])
      .filter((item) => item.type === 1)
      .map((item) => item.text_item?.text?.trim() ?? '')
      .filter(Boolean)
    const unsupportedMedia = (raw.item_list ?? []).some((item) =>
      [2, 3, 4, 5].includes(item.type ?? 0),
    )
    const mediaNotice = unsupportedMedia
      ? ['当前微信机器人连接只支持文字消息，暂时无法读取这条图片、语音或文件。']
      : []
    const text = [textItems.join('\n'), ...mediaNotice].filter(Boolean).join('\n')
    if (!text) return null
    return {
      externalId,
      text,
      ...(raw.message_id != null ? { messageId: String(raw.message_id) } : {}),
      ...(raw.context_token ? { contextToken: raw.context_token } : {}),
    }
  }

  private async notify(state: WeixinPoller, action: 'notifystart' | 'notifystop'): Promise<void> {
    try {
      await requestJson(state.baseUrl, `ilink/bot/msg/${action}`, {
        method: 'POST',
        token: state.token,
        body: { base_info: baseInfo() },
      })
    } catch {
      // Lifecycle notifications are best effort and do not affect polling.
    }
  }

  private async delay(ms: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => {
      if (signal.aborted) return resolve()
      const finish = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', finish)
        resolve()
      }
      const timer = setTimeout(finish, ms)
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted) finish()
    })
  }

  private purgeExpiredLogins(): void {
    const now = Date.now()
    for (const [connectionId, login] of this.qrLogins) {
      if (login.expiresAt <= now) {
        login.pollController?.abort()
        this.qrLogins.delete(connectionId)
      }
    }
  }
}
