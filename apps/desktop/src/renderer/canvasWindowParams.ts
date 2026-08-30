export function readCanvasWindowProjectId(search = window.location.search): string | null {
  const params = new URLSearchParams(search)
  if (params.get('window') !== 'canvas') return null
  const projectId = params.get('projectId')?.trim()
  return projectId && projectId.length > 0 ? projectId : null
}

export function getCanvasWindowPlatformClass(platform = window.spark?.platform): string {
  return platform === 'darwin'
    ? 'platform-darwin'
    : platform === 'win32'
      ? 'platform-win32'
      : 'platform-linux'
}
