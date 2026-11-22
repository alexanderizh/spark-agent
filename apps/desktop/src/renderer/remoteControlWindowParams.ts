export function isRemoteControlWindowMode(search = window.location.search): boolean {
  return new URLSearchParams(search).get('window') === 'remote-control'
}

export function getRemoteControlWindowPlatformClass(platform = window.spark?.platform): string {
  return platform === 'darwin'
    ? 'platform-darwin'
    : platform === 'win32'
      ? 'platform-win32'
      : 'platform-linux'
}
