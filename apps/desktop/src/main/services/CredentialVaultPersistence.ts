import { app, safeStorage } from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CredentialVaultPersistence } from '@spark/shared/keystore'

const CREDENTIAL_VAULT_FILE = 'credential-vault-v1.enc'

/**
 * 将集中凭据 vault 保存为 Electron safeStorage 加密文件。
 *
 * macOS Keychain 仅在本文件尚不存在时作为一次性导入源；成功导入后，
 * 应用启动和运行期的普通凭据读取都不会再触碰 spark-agent Keychain 项。
 */
export function createCredentialVaultPersistence(): CredentialVaultPersistence | null {
  if (process.platform !== 'darwin' || !safeStorage.isEncryptionAvailable()) return null

  const directory = app.getPath('userData')
  const filePath = join(directory, CREDENTIAL_VAULT_FILE)
  return {
    async load() {
      try {
        return safeStorage.decryptString(await readFile(filePath))
      } catch (error) {
        if (isMissingFileError(error)) return null
        throw error
      }
    },
    async save(value) {
      await mkdir(directory, { recursive: true })
      const temporaryPath = `${filePath}.${process.pid}.tmp`
      try {
        await writeFile(temporaryPath, safeStorage.encryptString(value), { mode: 0o600 })
        await rename(temporaryPath, filePath)
      } finally {
        await rm(temporaryPath, { force: true }).catch(() => undefined)
      }
    },
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
