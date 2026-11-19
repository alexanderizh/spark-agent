export const SERVICE_ORIGIN = 'https://www.yiqibyte.com'

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

async function request(path: string, data?: Credentials | null, token?: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(`${SERVICE_ORIGIN}/api/v1${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        ...(data == null ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: data == null ? undefined : JSON.stringify({ ...data, loginMode: 'password' }),
      signal: controller.signal,
    })
    const body: { code?: unknown; data?: unknown; message?: unknown } | null = await response
      .json()
      .catch(() => null)
    if (!response.ok || body?.code !== 0) {
      throw new Error(
        typeof body?.message === 'string' ? body.message : `账号服务请求失败 (${response.status})`,
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

export async function login(input: Credentials): Promise<string> {
  const data = await request('/auth/login', input)
  if (
    typeof data !== 'object' ||
    data === null ||
    !('token' in data) ||
    typeof data.token !== 'string' ||
    !data.token
  ) {
    throw new Error('登录响应缺少有效凭据')
  }
  return data.token
}

export async function logout(token: string): Promise<void> {
  await request('/auth/logout', null, token)
}
