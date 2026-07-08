/**
 * TokenStore - secure storage for cloud auth access token, refresh token and userId.
 *
 * Primary storage is keytar (Keychain / Windows Credential Manager / libsecret).
 * A secondary encrypted backup is kept with Electron safeStorage so login state
 * survives restarts even when keytar is temporarily unavailable or empty.
 */

import { createLogger } from '@spark/shared'
import type { AuthSession } from '@spark/protocol'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'

const log = createLogger('auth:token-store')

const KEY_TOKEN = 'auth_token'
const KEY_REFRESH = 'refresh_token'
const KEY_USER_ID = 'user_id'
const BACKUP_FILE_NAME = 'cloud-auth-session.enc'
const BACKUP_VERSION = 1

interface EncryptedBackupPayload {
  version: number
  service: string
  session: AuthSession
}

export class TokenStore {
  private cache: Partial<AuthSession> = {}
  private keytarUnavailable = false
  private encryptedBackupAvailable = false
  private lastError: string | null = null

  constructor(private readonly service: string) {}

  async load(): Promise<Partial<AuthSession>> {
    const backup = await this.loadEncryptedBackup()
    if (backup) {
      this.cache = backup
      this.lastError = null
      log.info(`token store loaded from encrypted backup (service=${this.service})`)
      return { ...this.cache }
    }

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
      this.keytarUnavailable = false
      this.lastError = null
      log.info(
        `token store loaded from keytar (service=${this.service}, hasToken=${Boolean(
          token,
        )}, hasRefresh=${Boolean(refreshToken)}, hasUserId=${Boolean(userId)})`,
      )

      if (isCompleteSession(this.cache)) {
        await this.saveEncryptedBackup(this.cache)
      }
    } catch (e) {
      this.keytarUnavailable = true
      this.lastError = (e as Error).message ?? String(e)
      this.cache = {}
      log.error(
        `keytar unavailable and no encrypted backup was found; falling back to memory-only ` +
          `(tokens will NOT persist across restarts). Cause: ${this.lastError}. ` +
          `Run \`pnpm --filter @spark/desktop rebuild keytar\` or \`npx electron-rebuild -f -w keytar\` to fix keytar.`,
      )
    }
    return { ...this.cache }
  }

  async save(session: AuthSession): Promise<void> {
    this.cache = { ...session }
    const backupSaved = await this.saveEncryptedBackup(session)

    if (this.keytarUnavailable) {
      if (!backupSaved) {
        log.warn(
          'save() called with keytar unavailable and encrypted backup unavailable; token will not survive restart',
        )
      }
      return
    }

    try {
      await this.saveKeytar(session)
      this.keytarUnavailable = false
      this.lastError = null
    } catch (e) {
      this.keytarUnavailable = true
      this.lastError = (e as Error).message ?? String(e)
      log.error(
        backupSaved
          ? `keytar.setPassword failed, using encrypted backup for persistence: ${this.lastError}.`
          : `keytar.setPassword failed and encrypted backup is unavailable, switching to memory-only mode: ${this.lastError}. ` +
              `Token will be lost on restart.`,
      )
    }
  }

  get(): Partial<AuthSession> {
    return { ...this.cache }
  }

  async clear(): Promise<void> {
    this.cache = {}
    await this.deleteEncryptedBackup()

    if (this.keytarUnavailable) return
    try {
      const keytar = await importKeytar()
      await Promise.all([
        keytar.deletePassword(this.service, KEY_TOKEN),
        keytar.deletePassword(this.service, KEY_REFRESH),
        keytar.deletePassword(this.service, KEY_USER_ID),
      ])
    } catch (e) {
      log.warn(`keytar.deletePassword failed: ${(e as Error).message ?? String(e)}`)
    }
  }

  isAuthenticated(): boolean {
    return Boolean(this.cache.token && this.cache.refreshToken && this.cache.userId)
  }

  isPersistent(): boolean {
    return !this.keytarUnavailable || this.encryptedBackupAvailable
  }

  getLastError(): string | null {
    return this.lastError
  }

  private async saveKeytar(session: AuthSession): Promise<void> {
    const keytar = await importKeytar()
    await Promise.all([
      keytar.setPassword(this.service, KEY_TOKEN, session.token),
      keytar.setPassword(this.service, KEY_REFRESH, session.refreshToken),
      keytar.setPassword(this.service, KEY_USER_ID, session.userId),
    ])
  }

  private async loadEncryptedBackup(): Promise<AuthSession | null> {
    try {
      const persistence = await getEncryptedBackupPersistence()
      if (!persistence) {
        this.encryptedBackupAvailable = false
        return null
      }

      const bytes = await readFile(persistence.filePath)
      const json = persistence.decrypt(bytes)
      const payload = JSON.parse(json) as Partial<EncryptedBackupPayload>
      if (
        payload.version !== BACKUP_VERSION ||
        payload.service !== this.service ||
        !payload.session ||
        !isCompleteSession(payload.session)
      ) {
        return null
      }

      this.encryptedBackupAvailable = true
      return payload.session
    } catch (e) {
      if (isMissingFileError(e)) return null
      log.warn(`failed to load encrypted auth backup: ${(e as Error).message ?? String(e)}`)
      return null
    }
  }

  private async saveEncryptedBackup(session: AuthSession): Promise<boolean> {
    try {
      const persistence = await getEncryptedBackupPersistence()
      if (!persistence) {
        this.encryptedBackupAvailable = false
        return false
      }

      const payload: EncryptedBackupPayload = {
        version: BACKUP_VERSION,
        service: this.service,
        session,
      }
      await mkdir(persistence.dirPath, { recursive: true })
      await writeFile(persistence.filePath, persistence.encrypt(JSON.stringify(payload)))
      this.encryptedBackupAvailable = true
      return true
    } catch (e) {
      this.encryptedBackupAvailable = false
      log.warn(`failed to save encrypted auth backup: ${(e as Error).message ?? String(e)}`)
      return false
    }
  }

  private async deleteEncryptedBackup(): Promise<void> {
    try {
      const persistence = await getEncryptedBackupPersistence()
      if (!persistence) {
        this.encryptedBackupAvailable = false
        return
      }
      await rm(persistence.filePath, { force: true })
      this.encryptedBackupAvailable = false
    } catch (e) {
      if (!isMissingFileError(e)) {
        log.warn(`failed to delete encrypted auth backup: ${(e as Error).message ?? String(e)}`)
      }
    }
  }
}

interface EncryptedBackupPersistence {
  dirPath: string
  filePath: string
  encrypt: (value: string) => Buffer
  decrypt: (value: Buffer) => string
}

async function getEncryptedBackupPersistence(): Promise<EncryptedBackupPersistence | null> {
  try {
    const electron = await import('electron')
    const electronApp = electron.app
    const electronSafeStorage = electron.safeStorage
    if (!electronApp?.getPath || !electronSafeStorage?.isEncryptionAvailable?.()) {
      return null
    }

    const dirPath = electronApp.getPath('userData')
    return {
      dirPath,
      filePath: join(dirPath, BACKUP_FILE_NAME),
      encrypt: (value) => electronSafeStorage.encryptString(value),
      decrypt: (value) => electronSafeStorage.decryptString(value),
    }
  } catch {
    return null
  }
}

function isCompleteSession(session: Partial<AuthSession>): session is AuthSession {
  return Boolean(session.token && session.refreshToken && session.userId)
}

function isMissingFileError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && e.code === 'ENOENT'
}

async function importKeytar(): Promise<typeof import('keytar')> {
  return await import('keytar')
}
