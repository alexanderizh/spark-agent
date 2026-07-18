import type { PlaywrightStatusResponse } from '@spark/protocol'

export function getBrowserDescription(
  browserSource: PlaywrightStatusResponse['browserSource'],
): string {
  if (browserSource === 'bundled') {
    return '与当前 Playwright 匹配的 Chromium 已就绪'
  }
  if (browserSource === 'system') {
    return '系统 Chrome/Edge 当前可用；如遇兼容性问题，可下载与 Playwright 匹配的 Chromium'
  }
  return '未检测到可用浏览器，可点击右侧按钮手动下载约 150MB 的 Chromium'
}
