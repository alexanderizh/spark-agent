import { randomBytes } from 'node:crypto'
import * as keystore from '@spark/shared/keystore'

const INSTALLATION_KEY_REF = 'snapshot-vault-installation-key-v1' as keystore.KeystoreRef
const KEY_BYTES = 32
let installationKeyLoad: Promise<Buffer> | null = null

export interface SnapshotVaultKeySource {
  getKey(): Promise<Buffer>
}

/** Supplies the installation-scoped AES-256 key from the project's sole keystore boundary. */
export class SnapshotVaultKeyProvider implements SnapshotVaultKeySource {
  private keyPromise: Promise<Buffer> | null = null

  async getKey(): Promise<Buffer> {
    if (this.keyPromise == null) {
      const pending = loadOrCreateInstallationKey()
      this.keyPromise = pending
      void pending.catch(() => {
        if (this.keyPromise === pending) this.keyPromise = null
      })
    }
    return Buffer.from(await this.keyPromise)
  }
}

function loadOrCreateInstallationKey(): Promise<Buffer> {
  if (installationKeyLoad != null) return installationKeyLoad
  const pending = readOrGenerateInstallationKey()
  installationKeyLoad = pending
  pending.then(
    () => {
      if (installationKeyLoad === pending) installationKeyLoad = null
    },
    () => {
      if (installationKeyLoad === pending) installationKeyLoad = null
    },
  )
  return pending
}

async function readOrGenerateInstallationKey(): Promise<Buffer> {
  const existing = await keystore.getSecret(INSTALLATION_KEY_REF)
  if (existing != null) return decodeInstallationKey(existing)

  const generated = randomBytes(KEY_BYTES)
  await keystore.setSecret(INSTALLATION_KEY_REF, generated.toString('base64'))
  return generated
}

function decodeInstallationKey(encoded: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('Invalid Snapshot Vault installation key')
  }
  const decoded = Buffer.from(encoded, 'base64')
  if (decoded.length !== KEY_BYTES || decoded.toString('base64') !== encoded) {
    throw new Error('Invalid Snapshot Vault installation key')
  }
  return decoded
}
