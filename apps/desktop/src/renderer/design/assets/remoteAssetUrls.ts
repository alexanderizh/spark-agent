/**
 * Large, non-critical artwork lives in the Spark artifact bucket instead of the
 * renderer bundle. Keep the path stable so browser/CDN caching works across app
 * updates; filenames are already versioned (for example `*-v1.png`).
 */
export const DESKTOP_REMOTE_ASSET_BASE_URL =
  'https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/assets/desktop'

export function remoteDesktopAssetUrl(relativePath: string): string {
  return `${DESKTOP_REMOTE_ASSET_BASE_URL}/${relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}

export function onboardingPosterUrl(fileName: string): string {
  return remoteDesktopAssetUrl(`onboarding-posters/${fileName}`)
}

export function canvasPromptExampleUrl(fileName: string): string {
  return remoteDesktopAssetUrl(`canvas-prompt-examples/${fileName}`)
}

export function canvasGeneratedPromptExampleUrl(fileName: string): string {
  return remoteDesktopAssetUrl(`canvas-prompt-examples/generated/${fileName}`)
}
