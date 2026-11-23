export const SERVICE_ORIGIN = 'https://www.yiqibyte.com'

export interface AuthSession {
  token: string
  refreshToken?: string
}

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

interface Captcha {
  id: string
  svg: string
}

interface Credentials {
  account: string
  password: string
  captchaId: string
  captchaText: string
}

async function request(
  path: string,
  data?: object | null,
  token?: string,
  method = data === undefined ? 'GET' : 'POST',
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(`${SERVICE_ORIGIN}/api/v1${path}`, {
      method,
      headers: {
        ...(data == null ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: data == null ? undefined : JSON.stringify(data),
      signal: controller.signal,
    })
    const body: { code?: unknown; data?: unknown; message?: unknown } | null = await response
      .json()
      .catch(() => null)
    if (!response.ok || body?.code !== 0) {
      throw new AccountError(
        typeof body?.message === 'string' ? body.message : `账号服务请求失败 (${response.status})`,
        response.status,
      )
    }
    return body.data
  } finally {
    clearTimeout(timer)
  }
}

export async function getCaptcha(): Promise<Captcha> {
  const data = await request('/auth/captcha')
  if (
    typeof data !== 'object' ||
    data === null ||
    !('id' in data) ||
    !('svg' in data) ||
    typeof data.id !== 'string' ||
    typeof data.svg !== 'string' ||
    !/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(data.svg) ||
    data.svg.length > 128_000
  ) {
    throw new Error('验证码格式异常')
  }
  return { id: data.id, svg: data.svg }
}

function readSession(data: unknown): AuthSession {
  if (
    !data ||
    typeof data !== 'object' ||
    !('token' in data) ||
    typeof data.token !== 'string' ||
    !data.token
  ) {
    throw new Error('登录响应缺少有效凭据')
  }
  return {
    token: data.token,
    refreshToken:
      'refreshToken' in data && typeof data.refreshToken === 'string'
        ? data.refreshToken
        : undefined,
  }
}

export async function login(input: Credentials) {
  return readSession(await request('/auth/login', { ...input, loginMode: 'password' }))
}

export async function refreshSession(refreshToken: string) {
  return readSession(await request('/auth/refresh', { refreshToken }))
}

export async function logout(token: string): Promise<void> {
  await request('/auth/logout', null, token)
}

export async function me(token: string) {
  const data = await request('/me', undefined, token)
  if (
    !data ||
    typeof data !== 'object' ||
    !('account' in data) ||
    typeof data.account !== 'string'
  ) {
    throw new Error('账号信息格式异常')
  }
  return {
    account: data.account,
    nickname: 'nickname' in data && typeof data.nickname === 'string' ? data.nickname : '',
    avatarUrl:
      'avatarUrl' in data &&
      typeof data.avatarUrl === 'string' &&
      data.avatarUrl.startsWith('https://')
        ? data.avatarUrl
        : undefined,
  }
}

export async function updateNickname(token: string, nickname: string) {
  await request('/me', { nickname }, token, 'PUT')
}

export async function accountData(path: string, token: string) {
  return request(path, undefined, token)
}

export async function revokeDesktop(deviceId: string, token: string) {
  await request(`/mobile-bridge/devices/${encodeURIComponent(deviceId)}/revoke`, null, token)
}

export async function smsEnabled() {
  const body = await request('/client-config/')
  return (
    !!body &&
    typeof body === 'object' &&
    'authCapabilities' in body &&
    !!body.authCapabilities &&
    typeof body.authCapabilities === 'object' &&
    'smsEnabled' in body.authCapabilities &&
    body.authCapabilities.smsEnabled === true
  )
}

type CodeMode = 'email' | 'sms' | 'register'

export async function sendAuthCode(
  mode: CodeMode,
  account: string,
  captchaId: string,
  captchaText: string,
) {
  await request(mode === 'sms' ? '/auth/send-sms' : '/auth/send-code', {
    ...(mode === 'sms' ? { phone: account } : { account }),
    type: mode === 'register' ? 'register' : 'login',
    captchaId,
    captchaText,
  })
}

export async function authenticateWithCode(
  mode: CodeMode,
  account: string,
  code: string,
  password: string,
  inviteCode: string,
): Promise<AuthSession> {
  const data =
    mode === 'sms'
      ? await request('/auth/login-sms', { phone: account, smsCode: code })
      : mode === 'register'
        ? await request('/auth/register', {
            account,
            password,
            code,
            ...(inviteCode ? { inviteCode } : {}),
          })
        : await request('/auth/login', { account, loginMode: 'code', emailCode: code })
  return readSession(data)
}

export async function sendPasswordCode(token: string, captchaId: string, captchaText: string) {
  await request('/auth/send-change-password-sms', { captchaId, captchaText }, token)
}

export async function changePassword(
  token: string,
  phone: string,
  smsCode: string,
  newPassword: string,
) {
  await request('/auth/change-password-by-sms', { phone, smsCode, newPassword }, token)
}

export async function updateAvatar(token: string, uri: string, name: string, mimeType: string) {
  const data = new FormData()
  data.append('file', { uri, name, type: mimeType } as unknown as Blob)
  const response = await fetch(`${SERVICE_ORIGIN}/api/v1/me/avatar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: data,
  })
  const body: { code?: number; data?: { avatarUrl?: string } } | null = await response
    .json()
    .catch(() => null)
  if (!response.ok || body?.code !== 0 || !body.data?.avatarUrl?.startsWith('https://'))
    throw new Error('头像上传失败')
  return body.data.avatarUrl
}
