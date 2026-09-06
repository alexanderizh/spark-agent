// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { resolveImageSrc } from './MarkdownImage'

/** 与主进程 SafeFileProtocol.decodeSafeFileUrl 同逻辑，把 safe-file URL 解回绝对路径 */
function decodeSafeFileUrl(url: string): string {
  const rest = url.slice('safe-file://'.length)
  const encoded = rest.slice(rest.indexOf('/') + 1)
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
  return decodeURIComponent(escape(atob(base64 + padding)))
}

describe('resolveImageSrc 相对路径按基准目录解析', () => {
  it('解析 ./ 前缀的相对路径', () => {
    expect(decodeSafeFileUrl(resolveImageSrc('./images/a.png', '/tmp/docs'))).toBe(
      '/tmp/docs/images/a.png',
    )
  })

  it('解析不带前缀的相对路径', () => {
    expect(decodeSafeFileUrl(resolveImageSrc('images/a.png', '/tmp/docs'))).toBe(
      '/tmp/docs/images/a.png',
    )
  })

  it('解析 ../ 回退到上级目录', () => {
    expect(decodeSafeFileUrl(resolveImageSrc('../assets/a.png', '/tmp/docs/sub'))).toBe(
      '/tmp/docs/assets/a.png',
    )
  })

  it('还原相对路径中的 %XX 转义', () => {
    expect(decodeSafeFileUrl(resolveImageSrc('./assets/my%20img.png', '/tmp/docs'))).toBe(
      '/tmp/docs/assets/my img.png',
    )
  })

  it('Windows 基准目录按反斜杠拼接', () => {
    expect(decodeSafeFileUrl(resolveImageSrc('img/a.png', 'C:\\Users\\demo\\docs'))).toBe(
      'C:\\Users\\demo\\docs\\img\\a.png',
    )
  })

  it('绝对路径忽略基准目录，保持原有 safe-file 转换', () => {
    expect(decodeSafeFileUrl(resolveImageSrc('/other/a.png', '/tmp/docs'))).toBe('/other/a.png')
  })

  it('http(s) URL 原样返回，不受基准目录影响', () => {
    expect(resolveImageSrc('https://example.com/a.png', '/tmp/docs')).toBe(
      'https://example.com/a.png',
    )
  })

  it('data: URL 原样返回', () => {
    expect(resolveImageSrc('data:image/png;base64,AAAA', '/tmp/docs')).toBe(
      'data:image/png;base64,AAAA',
    )
  })

  it('未提供基准目录时相对路径保持原样透传（旧行为）', () => {
    expect(resolveImageSrc('./images/a.png')).toBe('./images/a.png')
    expect(resolveImageSrc('images/a.png', null)).toBe('images/a.png')
  })

  it('.. 越过基准根目录时回退为原样透传', () => {
    expect(resolveImageSrc('../../a.png', '/')).toBe('../../a.png')
  })

  it('非法 % 转义不抛错，按字面量处理', () => {
    expect(decodeSafeFileUrl(resolveImageSrc('./100%.png', '/tmp/docs'))).toBe(
      '/tmp/docs/100%.png',
    )
  })
})
