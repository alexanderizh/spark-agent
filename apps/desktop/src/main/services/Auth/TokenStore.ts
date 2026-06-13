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
 *
 * 诊断：
 *   - keytar 是 native module，必须用 electron-rebuild 重编才能在 Electron 中加载
 *   - 若启动时 import keytar 失败（NODE_MODULE_VERSION 不匹配等），自动降级到内存
 *   - 通过 `isPersistent()` 暴露降级状态，bootstrap 会带回渲染端供 UI 提示
 */

import { createLogger } from '@spark/shared'
import type { AuthSession } from '@spark/protocol'

const log = createLogger('auth:token-store')

const KEY_TOKEN = 'auth_token'
const KEY_REFRESH = 'refresh_token'
const KEY_USER_ID = 'user_id'

export class TokenStore {
  /** 内存缓存（避免每次都调 keytar）*/
  private cache: Partial<AuthSession> = {}

  /** keytar 不可用时的兜底（Linux 桌面无 libsecret 时降级为内存）*/
  private fallbackMemory = false

  /** 最近一次 keytar 错误（供诊断；不包含敏感数据）*/
  private lastError: string | null = null

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
      this.fallbackMemory = false
      this.lastError = null
      log.info(
        `token store loaded from keytar (service=${this.service}, hasToken=${Boolean(
          token,
        )}, hasRefresh=${Boolean(refreshToken)}, hasUserId=${Boolean(userId)})`,
      )
    } catch (e) {
      // keytar 不可用：通常是 electron-rebuild 没跑、Linux 缺 libsecret
      this.fallbackMemory = true
      this.lastError = (e as Error).message ?? String(e)
      this.cache = {}
      log.error(
        `keytar unavailable, falling back to memory-only (tokens will NOT persist across restarts). ` +
          `Cause: ${this.lastError}. Run \`pnpm --filter @spark/desktop rebuild keytar\` or \`npx electron-rebuild -f -w keytar\` to fix.`,
      )
    }
    return { ...this.cache }
  }

  /** 保存完整会话（登录成功 / refresh 成功）*/
  async save(session: AuthSession): Promise<void> {
    this.cache = { ...session }
    if (this.fallbackMemory) {
      log.warn('save() called in fallback-memory mode — token will not survive restart')
      return
    }
    try {
      const keytar = await importKeytar()
      await Promise.all([
        keytar.setPassword(this.service, KEY_TOKEN, session.token),
        keytar.setPassword(this.service, KEY_REFRESH, session.refreshToken),
        keytar.setPassword(this.service, KEY_USER_ID, session.userId),
      ])
    } catch (e) {
      this.fallbackMemory = true
      this.lastError = (e as Error).message ?? String(e)
      log.error(
        `keytar.setPassword failed, switching to memory-only mode: ${this.lastError}. ` +
          `Token will be lost on restart.`,
      )
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
    } catch (e) {
      // 删除失败通常是因为 keytar 不可用；记录但不切换 fallback（已无数据可丢）
      log.warn(`keytar.deletePassword failed: ${(e as Error).message ?? String(e)}`)
    }
  }

  /** 当前是否已登录（有完整会话）*/
  isAuthenticated(): boolean {
    return Boolean(this.cache.token && this.cache.refreshToken && this.cache.userId)
  }

  /** 当前 keytar 是否可用（false 表示 token 仅在内存，重启会丢）*/
  isPersistent(): boolean {
    return !this.fallbackMemory
  }

  /** keytar 最近一次错误（仅诊断，不含敏感数据）*/
  getLastError(): string | null {
    return this.lastError
  }
}

/** keytar 是 native module，延迟加载避免启动阻塞 */
async function importKeytar(): Promise<typeof import('keytar')> {
  // keytar 在 Linux 上需要 libsecret；缺少时 import 会抛错
  // 主进程在 Linux 桌面环境启动时偶尔会失败
  return await import('keytar')
}
