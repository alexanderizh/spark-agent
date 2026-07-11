import type { ProviderProfile, VendorMeta } from '@spark/protocol'

const SPARK_PLATFORM_VENDOR: VendorMeta = {
  id: 'spark-platform',
  name: 'Spark 平台模型',
  emoji: 'SP',
  color: '#ffffff',
  desc: '',
  logoPath: 'providers/spark-platform.png',
}

export function resolveManagedPlatformVendor(
  provider: ProviderProfile | null | undefined,
): VendorMeta | null {
  return provider?.managed === true ? SPARK_PLATFORM_VENDOR : null
}

export function prioritizeManagedProviderGroups<T extends { provider: ProviderProfile }>(
  groups: T[],
): T[] {
  return [...groups].sort(
    (left, right) => Number(right.provider.managed === true) - Number(left.provider.managed === true),
  )
}

export function getProviderPickerLogoSize(provider: ProviderProfile): number {
  return provider.managed === true ? 18 : 14
}
