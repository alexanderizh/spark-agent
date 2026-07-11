import type { ProviderProfileRow } from '@spark/storage'
import * as keystore from '@spark/shared/keystore'

export interface ManagedCredentialRecoveryRequest {
  providerId: string
  managedType: 'newapi'
  ownerUserId: string
  currentSecret: string | null
}

export type ManagedCredentialRecoveryHandler = (
  request: ManagedCredentialRecoveryRequest,
) => Promise<string | null>

let recoveryHandler: ManagedCredentialRecoveryHandler | null = null

export function setManagedCredentialRecoveryHandler(
  handler: ManagedCredentialRecoveryHandler | null,
): void {
  recoveryHandler = handler
}

export async function resolveProviderApiKey(
  provider: Pick<ProviderProfileRow, 'id' | 'config_json' | 'keystore_ref'>,
): Promise<string> {
  const currentSecret = provider.keystore_ref
    ? (await keystore.getSecret(provider.keystore_ref as keystore.KeystoreRef))?.trim() || null
    : null
  const managed = readManagedConfig(provider.config_json)
  if (!managed || !recoveryHandler) return currentSecret ?? ''
  const recovered = await recoveryHandler({
    providerId: provider.id,
    managedType: managed.managedType,
    ownerUserId: managed.ownerUserId,
    currentSecret,
  })
  if (recovered && provider.keystore_ref && recovered !== currentSecret) {
    await keystore.setSecret(provider.keystore_ref as keystore.KeystoreRef, recovered)
  }
  return recovered?.trim() ?? ''
}

export async function resolveProviderApiKeyForProfile(profile: {
  id: string
  keystoreRef?: string
  managed?: boolean
  managedType?: 'newapi'
  managedOwnerUserId?: string
}): Promise<string> {
  return resolveProviderApiKey({
    id: profile.id,
    keystore_ref: profile.keystoreRef ?? null,
    config_json: JSON.stringify({
      managed: profile.managed,
      managedType: profile.managedType,
      managedOwnerUserId: profile.managedOwnerUserId,
    }),
  })
}

function readManagedConfig(configJson: string): { managedType: 'newapi'; ownerUserId: string } | null {
  try {
    const config = JSON.parse(configJson) as {
      managed?: boolean
      managedType?: string
      managedOwnerUserId?: string
    }
    if (config.managed !== true || config.managedType !== 'newapi' || !config.managedOwnerUserId) return null
    return { managedType: 'newapi', ownerUserId: config.managedOwnerUserId }
  } catch {
    return null
  }
}
