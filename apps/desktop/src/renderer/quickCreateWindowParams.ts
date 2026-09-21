export function isQuickCreateWindowMode(search = window.location.search): boolean {
  return new URLSearchParams(search).get('window') === 'quick-create'
}

export function getQuickCreateWindowPlatformClass(platform = window.spark?.platform): string {
  return platform === 'darwin'
    ? 'platform-darwin'
    : platform === 'win32'
      ? 'platform-win32'
      : 'platform-linux'
}
