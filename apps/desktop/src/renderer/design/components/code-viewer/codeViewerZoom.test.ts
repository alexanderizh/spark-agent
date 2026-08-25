import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CODE_VIEWER_ZOOM_BOUNDS,
  diffFontSizeFor,
  editorFontSizeFor,
  editorLineHeightFor,
  getCodeViewerZoom,
  resetCodeViewerZoom,
  resetCodeViewerZoomForTest,
  setCodeViewerZoom,
  stepCodeViewerZoom,
} from './codeViewerZoom'

// node 环境 stub window.localStorage；resetForTest 触发 readZoom() 重新读取

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubLocalStorage(store: Map<string, string>): void {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  })
}

describe('代码编辑器缩放偏好', () => {
  it('未写入过偏好时默认 100%', () => {
    stubLocalStorage(new Map())
    resetCodeViewerZoomForTest()
    expect(getCodeViewerZoom()).toBe(100)
  })

  it('步进 ±10 并 clamp 到 [50, 200] 边界', () => {
    stubLocalStorage(new Map())
    resetCodeViewerZoomForTest()
    stepCodeViewerZoom(10)
    stepCodeViewerZoom(10)
    expect(getCodeViewerZoom()).toBe(120)
    setCodeViewerZoom(CODE_VIEWER_ZOOM_BOUNDS.max)
    stepCodeViewerZoom(10)
    expect(getCodeViewerZoom()).toBe(200)
    setCodeViewerZoom(CODE_VIEWER_ZOOM_BOUNDS.min)
    stepCodeViewerZoom(-10)
    expect(getCodeViewerZoom()).toBe(50)
    // 边界外写入同样 clamp；非法值回退默认
    setCodeViewerZoom(999)
    expect(getCodeViewerZoom()).toBe(200)
    setCodeViewerZoom(Number.NaN)
    expect(getCodeViewerZoom()).toBe(100)
  })

  it('重置回到 100% 并持久化', () => {
    const store = new Map<string, string>()
    stubLocalStorage(store)
    resetCodeViewerZoomForTest()
    setCodeViewerZoom(150)
    expect(store.get('spark-agent:code-viewer-zoom')).toBe('150')
    resetCodeViewerZoom()
    expect(getCodeViewerZoom()).toBe(100)
  })

  it('重启后从 localStorage 恢复偏好', () => {
    stubLocalStorage(new Map([['spark-agent:code-viewer-zoom', '170']]))
    resetCodeViewerZoomForTest()
    expect(getCodeViewerZoom()).toBe(170)
  })
})

describe('缩放 → 字号映射', () => {
  it('100% 时保持基准（Monaco 13/20，diff 12.5）', () => {
    expect(editorFontSizeFor(100)).toBe(13)
    expect(editorLineHeightFor(13)).toBe(20)
    expect(diffFontSizeFor(100)).toBe(12.5)
  })

  it('放大缩小时按比例映射且下限 9px', () => {
    expect(editorFontSizeFor(150)).toBe(20)
    expect(editorFontSizeFor(200)).toBe(26)
    expect(editorFontSizeFor(50)).toBe(9) // 6.5 → clamp 9
    expect(diffFontSizeFor(150)).toBe(18.8)
    expect(diffFontSizeFor(50)).toBe(9) // 6.25 → clamp 9
    // 行高保持 13→20 比例
    expect(editorLineHeightFor(editorFontSizeFor(150))).toBe(Math.round((20 * 20) / 13))
  })
})
