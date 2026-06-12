/**
 * TokenStore — 安全存储 access token / refresh token / userId
 *
 * 存储位置：
 *   - macOS: Keychain
 *   - Windows: Credential Manager
 *   - Linux: libsecret (gnome-keyring / kwallet)
 *
 * 为什么不放 SQLite / localStorage：
 *   - keytar 走系统级凭证库，应用卸载时凭证自动清理
 *   - 不易被其他应用/进程读取，安全性更高
 *   - 项目 package.json 已依赖 keytar
 *
 * 内存缓存：
 *   - 启动后第一次访问会从 keytar 读取并缓存到内存
 *   - 每次写入（登录/refresh/logout）同时更新 keytar 和内存
 *   - 内存缓存的好处：高频访问不走系统调用，性能好
 */

import type { AuthSession } from '@spark/protocol'

const KEY_TOKEN = 'auth_token'
const KEY_REFRESH = 'refresh_token'
const KEY_USER_ID = 'user_id'

export class TokenStore {
  /** 内存缓存（避免每次都调 keytar）*/
  private cache: Partial<AuthSession> = {}

  /** keytar 不可用时的兜底（Linux 桌面无 libsecret 时降级为内存）*/
  private fallbackMemory = false

  constructor(private readonly service: string) {}

  /** 从 keytar 加载到内存缓存 */
  async load(): Promise<Partial<AuthSession>> {
    try {
      const keytar = await importKeytar()
      const [token, refreshToken, userId] = await Promise.all([
        keytar.getPassword(this.service, KEY_TOKEN),
        keytar.getPassword(this.service, KEY_REFRESH),
        keytar.getPassword(this.service, KEY_USER_ID),
      ])
      this.cache = {
        ...(token ? { token } : {}),
        ...(refreshToken ? { refreshToken } : {}),
        ...(userId ? { userId } : {}),
      }
    } catch {
      // keytar 不可用（Linux 无 libsecret 等），降级为内存缓存
      this.fallbackMemory = true
      this.cache = {}
    }
    return { ...this.cache }
  }

  /** 保存完整会话（登录成功 / refresh 成功）*/
  async save(session: AuthSession): Promise<void> {
    this.cache = { ...session }
    if (this.fallbackMemory) return
    try {
      const keytar = await importKeytar()
      await Promise.all([
        keytar.setPassword(this.service, KEY_TOKEN, session.token),
        keytar.setPassword(this.service, KEY_REFRESH, session.refreshToken),
        keytar.setPassword(this.service, KEY_USER_ID, session.userId),
      ])
    } catch {
      this.fallbackMemory = true
    }
  }

  /** 读取当前会话 */
  get(): Partial<AuthSession> {
    return { ...this.cache }
  }

  /** 清空会话（退出登录 / session 过期）*/
  async clear(): Promise<void> {
    this.cache = {}
    if (this.fallbackMemory) return
    try {
      const keytar = await importKeytar()
      await Promise.all([
        keytar.deletePassword(this.service, KEY_TOKEN),
        keytar.deletePassword(this.service, KEY_REFRESH),
        keytar.deletePassword(this.service, KEY_USER_ID),
      ])
    } catch {
      // 忽略：可能是 keytar 不可用，内存已经清空
    }
  }

  /** 当前是否已登录（有完整会话）*/
  isAuthenticated(): boolean {
    return Boolean(this.cache.token && this.cache.refreshToken && this.cache.userId)
  }
}

/** keytar 是 native module，延迟加载避免启动阻塞 */
async function importKeytar(): Promise<typeof import('keytar')> {
  // keytar 在 Linux 上需要 libsecret；缺少时 import 会抛错
  // 主进程在 Linux 桌面环境启动时偶尔会失败
  return await import('keytar')
}
