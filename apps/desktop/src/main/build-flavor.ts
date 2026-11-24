/** Packaged identity is selected by extraMetadata.name in electron-builder.dev.yml. */
export const APP_BUNDLE_ID = 'com.spark-agent.desktop'
export const DEV_APP_BUNDLE_ID = 'com.spark-agent.desktop.dev'
export const DEV_PACKAGE_NAME = '@spark/desktop-dev'
export const PRODUCTION_DEEP_LINK_SCHEME = 'spark-agent'
export const DEV_DEEP_LINK_SCHEME = 'spark-agent-dev'
export type DeepLinkScheme = typeof PRODUCTION_DEEP_LINK_SCHEME | typeof DEV_DEEP_LINK_SCHEME

export function isDevFlavoredPackage(appName: string): boolean {
  return appName === DEV_PACKAGE_NAME
}

export function resolveDeepLinkScheme(appName: string, isPackaged = true): DeepLinkScheme {
  return !isPackaged || isDevFlavoredPackage(appName)
    ? DEV_DEEP_LINK_SCHEME
    : PRODUCTION_DEEP_LINK_SCHEME
}

export function resolveAppBundleId(appName: string): string {
  return isDevFlavoredPackage(appName) ? DEV_APP_BUNDLE_ID : APP_BUNDLE_ID
}
