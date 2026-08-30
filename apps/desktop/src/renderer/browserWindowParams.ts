/**
 * 读取独立浏览器窗口的 URL 参数。
 *
 * 开发环境使用 `#window=browser&url=…`，避免参数被 Vite dev server 当作
 * 文件请求处理；同时继续兼容已打包版本和旧调用使用的 query 参数。
 */

function readBrowserWindowParams(search: string, hash: string): URLSearchParams {
  const queryParams = new URLSearchParams(search)
  if (queryParams.get('window') === 'browser') return queryParams

  const hashValue = hash.replace(/^#\??/, '')
  return new URLSearchParams(hashValue)
}

export function isBrowserWindowMode(
  search = window.location.search,
  hash = window.location.hash,
): boolean {
  return readBrowserWindowParams(search, hash).get('window') === 'browser'
}

/** 窗口初始要打开的页面地址（可选）。 */
export function readBrowserWindowInitialUrl(
  search = window.location.search,
  hash = window.location.hash,
): string | undefined {
  const url = readBrowserWindowParams(search, hash).get('url')?.trim()
  return url != null && url.length > 0 ? url : undefined
}
