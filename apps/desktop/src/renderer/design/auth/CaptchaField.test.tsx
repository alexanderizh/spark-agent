// @vitest-environment jsdom

import React, { createRef } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Form } from 'antd'
import type { FormInstance } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CaptchaField, type CaptchaFieldHandle } from './CaptchaField'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
})

const mocks = vi.hoisted(() => ({ fetchCaptcha: vi.fn() }))

vi.mock('./AuthContext', () => {
  const auth = { fetchCaptcha: (...args: unknown[]) => mocks.fetchCaptcha(...args) }
  return { useAuth: () => auth }
})

describe('CaptchaField', () => {
  let container: HTMLDivElement
  let root: Root
  let form: FormInstance

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    mocks.fetchCaptcha
      .mockReset()
      .mockResolvedValueOnce({ id: 'captcha-1', svg: '<svg></svg>' })
      .mockResolvedValueOnce({ id: 'captcha-2', svg: '<svg></svg>' })
  })

  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
  })

  it('clears the previous answer whenever the image is refreshed', async () => {
    const ref = createRef<CaptchaFieldHandle>()
    function Harness(): React.ReactElement {
      const [instance] = Form.useForm()
      form = instance
      return (
        <Form form={instance}>
          <CaptchaField ref={ref} form={instance} />
        </Form>
      )
    }

    await act(async () => {
      root = createRoot(container)
      root.render(<Harness />)
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => form.setFieldValue('captchaText', 'old-answer'))

    await act(async () => {
      await ref.current?.refresh()
    })

    expect(form.getFieldValue('captchaId')).toBe('captcha-2')
    expect(form.getFieldValue('captchaText')).toBe('')
  })
})
