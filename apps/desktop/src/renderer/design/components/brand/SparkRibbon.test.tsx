// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SparkBootSplash, SparkRibbon } from './SparkRibbon'
const mocks = vi.hoisted(() => ({ mount: vi.fn() }))
vi.mock('./spark-ribbon', () => ({ mountSparkRibbon: mocks.mount }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('Spark startup', () => {
  it('shows the supplied version without a brand name or fabricated version', () => {
    const markup = renderToStaticMarkup(<SparkBootSplash version="0.11.52" label="正在启动" />)
    expect(markup).toContain('v0.11.52')
    expect(markup).not.toContain('>Spark<')
    expect(renderToStaticMarkup(<SparkBootSplash version={null} label="正在启动" />)).not.toContain(
      'spark-boot-version',
    )
  })
  it('falls back to the brand asset when WebGL is unavailable', () => {
    mocks.mount.mockImplementation(() => {
      throw new Error('WebGL unavailable')
    })
    const element = document.createElement('div'),
      root = createRoot(element)
    act(() => root.render(<SparkRibbon />))
    expect(element.querySelector('img')).not.toBeNull()
    expect(element.querySelector('canvas')?.style.display).toBe('none')
    act(() => root.unmount())
  })
  it('releases resources on context loss and does not release them twice', () => {
    const dispose = vi.fn()
    mocks.mount.mockReturnValue(dispose)
    const element = document.createElement('div'),
      root = createRoot(element)
    act(() => root.render(<SparkRibbon />))
    act(() => element.querySelector('canvas')!.dispatchEvent(new Event('webglcontextlost')))
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(element.querySelector('img')).not.toBeNull()
    act(() => root.unmount())
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
