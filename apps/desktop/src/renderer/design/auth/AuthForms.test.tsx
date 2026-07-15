// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Form, Input } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginForm } from './LoginForm'
import { RegisterForm } from './RegisterForm'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  sendCode: vi.fn(),
  sendSmsCode: vi.fn(),
  loginBySms: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  smsEnabled: true,
  captchaRefresh: vi.fn(),
}))

vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    authCapabilities: { smsEnabled: mocks.smsEnabled },
    login: mocks.login,
    register: mocks.register,
    sendCode: mocks.sendCode,
    sendSmsCode: mocks.sendSmsCode,
    loginBySms: mocks.loginBySms,
  }),
}))

vi.mock('../components/Toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))

vi.mock('./CaptchaField', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    CaptchaField: ReactActual.forwardRef(function CaptchaFieldMock(
      props: { form: { setFieldsValue: (values: Record<string, string>) => void } },
      ref: React.ForwardedRef<{ refresh: () => Promise<void> }>,
    ) {
      ReactActual.useImperativeHandle(
        ref,
        () => ({
          refresh: async () => {
            mocks.captchaRefresh()
            props.form.setFieldsValue({ captchaId: 'captcha-id-next', captchaText: '' })
          },
        }),
        [props.form],
      )
      ReactActual.useEffect(() => {
        props.form.setFieldsValue({ captchaId: 'captcha-id', captchaText: 'abcd' })
      }, [props.form])
      return (
        <>
          <Form.Item name="captchaId">
            <Input type="hidden" />
          </Form.Item>
          <Form.Item name="captchaText">
            <Input />
          </Form.Item>
        </>
      )
    }),
  }
})

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function inputByPlaceholder(container: HTMLElement, placeholder: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)
  if (!input) throw new Error(`Input not found: ${placeholder}`)
  return input
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('authentication forms', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    mocks.login.mockReset().mockResolvedValue({})
    mocks.register.mockReset().mockResolvedValue({})
    mocks.sendCode.mockReset().mockResolvedValue({ expire_in: 60 })
    mocks.sendSmsCode.mockReset().mockResolvedValue({ expire_in: 60 })
    mocks.loginBySms.mockReset().mockResolvedValue({ isNew: false })
    mocks.captchaRefresh.mockReset()
  })

  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
  })

  it('binds account and password, toggles visibility, and submits password login', async () => {
    act(() => {
      root = createRoot(container)
      root.render(<LoginForm />)
    })
    const account = inputByPlaceholder(container, '邮箱或手机号')
    const password = inputByPlaceholder(container, '请输入密码')
    act(() => {
      setInput(account, ' user@example.com ')
      setInput(password, 'secret1')
    })
    await flush()

    expect(password.type).toBe('password')
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="显示密码"]')?.click())
    expect(password.type).toBe('text')

    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      false,
    )
    act(() => container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click())
    await flush()
    expect(mocks.login).toHaveBeenCalledWith(
      expect.objectContaining({
        account: 'user@example.com',
        password: 'secret1',
        loginMode: 'password',
      }),
    )
  })

  it('prevents duplicate email-code sends while the request is pending', async () => {
    let resolveSend: ((value: { expire_in: number }) => void) | undefined
    mocks.sendCode.mockReturnValue(
      new Promise<{ expire_in: number }>((resolve) => {
        resolveSend = resolve
      }),
    )
    act(() => {
      root = createRoot(container)
      root.render(<LoginForm />)
    })
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === '验证码')
        ?.click(),
    )
    act(() => setInput(inputByPlaceholder(container, '邮箱或手机号'), 'user@example.com'))
    const send = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '发送',
    )
    if (!send) throw new Error('Send button not found')
    act(() => {
      send.click()
      send.click()
    })
    await flush()
    expect(mocks.sendCode).toHaveBeenCalledTimes(1)
    expect(send.disabled).toBe(true)
    await act(async () => {
      resolveSend?.({ expire_in: 300 })
      await Promise.resolve()
    })
  })

  it('does not apply a pending send cooldown to a newly entered account', async () => {
    let resolveSend: ((value: { expire_in: number }) => void) | undefined
    mocks.sendCode.mockReturnValue(
      new Promise<{ expire_in: number }>((resolve) => {
        resolveSend = resolve
      }),
    )
    act(() => {
      root = createRoot(container)
      root.render(<LoginForm />)
    })
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === '验证码')
        ?.click(),
    )
    const account = inputByPlaceholder(container, '邮箱或手机号')
    act(() => setInput(account, 'first@example.com'))
    const send = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '发送',
    )
    act(() => send?.click())
    await flush()
    act(() => setInput(account, 'second@example.com'))
    await act(async () => {
      resolveSend?.({ expire_in: 300 })
      await Promise.resolve()
    })

    expect(send?.disabled).toBe(false)
    expect(send?.textContent).toBe('发送')
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
  })

  it('keeps login disabled until complete and submits a complete email-code login', async () => {
    act(() => {
      root = createRoot(container)
      root.render(<LoginForm />)
    })
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')
    if (!submit) throw new Error('Submit button not found')
    expect(submit.disabled).toBe(true)

    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === '验证码')
        ?.click(),
    )
    act(() => setInput(inputByPlaceholder(container, '邮箱或手机号'), 'user@example.com'))
    const send = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '发送',
    )
    act(() => send?.click())
    await flush()
    expect(mocks.captchaRefresh).not.toHaveBeenCalled()
    act(() => setInput(inputByPlaceholder(container, '6 位邮箱验证码'), '123456'))
    await flush()
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      false,
    )

    act(() => submit.click())
    await flush()
    expect(mocks.login).toHaveBeenCalledWith(
      expect.objectContaining({
        account: 'user@example.com',
        loginMode: 'code',
        emailCode: '123456',
      }),
    )
  })

  it('binds registration passwords and confirmation after sending a code', async () => {
    act(() => {
      root = createRoot(container)
      root.render(<RegisterForm />)
    })
    act(() => {
      setInput(inputByPlaceholder(container, '邮箱或手机号'), 'user@example.com')
      setInput(inputByPlaceholder(container, '设置登录密码'), 'secret1')
      setInput(inputByPlaceholder(container, '再次输入登录密码'), 'secret1')
    })
    const send = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '发送',
    )
    act(() => send?.click())
    await flush()
    expect(mocks.captchaRefresh).not.toHaveBeenCalled()
    act(() => setInput(inputByPlaceholder(container, '邮箱验证码'), '123456'))
    await flush()
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      false,
    )
    act(() => submit?.click())
    await flush()
    expect(mocks.register).toHaveBeenCalledWith({
      account: 'user@example.com',
      password: 'secret1',
      code: '123456',
    })
  })

  it('uses the login SMS contract for phone registration without refreshing a valid captcha', async () => {
    act(() => {
      root = createRoot(container)
      root.render(<RegisterForm />)
    })
    act(() => setInput(inputByPlaceholder(container, '邮箱或手机号'), '13800138000'))
    await flush()

    const send = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '发送',
    )
    act(() => send?.click())
    await flush()

    expect(mocks.sendSmsCode).toHaveBeenCalledWith({
      phone: '13800138000',
      captchaId: 'captcha-id',
      captchaText: 'abcd',
    })
    expect(mocks.captchaRefresh).not.toHaveBeenCalled()

    act(() => setInput(inputByPlaceholder(container, '6 位短信验证码'), '123456'))
    await flush()
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')
    expect(submit?.disabled).toBe(false)
    act(() => submit?.click())
    await flush()
    expect(mocks.loginBySms).toHaveBeenCalledWith({ phone: '13800138000', smsCode: '123456' })
  })

  it('sends and submits a phone SMS login with the same target', async () => {
    act(() => {
      root = createRoot(container)
      root.render(<LoginForm />)
    })
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === '验证码')
        ?.click(),
    )
    act(() => setInput(inputByPlaceholder(container, '邮箱或手机号'), '13800138000'))
    await flush()

    const send = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '发送',
    )
    act(() => send?.click())
    await flush()
    expect(mocks.sendSmsCode).toHaveBeenCalledWith({
      phone: '13800138000',
      captchaId: 'captcha-id',
      captchaText: 'abcd',
    })
    expect(mocks.captchaRefresh).not.toHaveBeenCalled()

    act(() => setInput(inputByPlaceholder(container, '6 位短信验证码'), '654321'))
    await flush()
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')
    expect(submit?.disabled).toBe(false)
    act(() => submit?.click())
    await flush()
    expect(mocks.loginBySms).toHaveBeenCalledWith({ phone: '13800138000', smsCode: '654321' })
  })

  it('keeps the captcha when sending a verification code fails for another reason', async () => {
    mocks.sendCode.mockRejectedValue(new Error('邮件服务暂时不可用'))
    act(() => {
      root = createRoot(container)
      root.render(<LoginForm />)
    })
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === '验证码')
        ?.click(),
    )
    act(() => setInput(inputByPlaceholder(container, '邮箱或手机号'), 'user@example.com'))
    const send = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '发送',
    )
    act(() => send?.click())
    await flush()

    expect(mocks.captchaRefresh).not.toHaveBeenCalled()
    expect(mocks.toast.error).toHaveBeenCalledWith('邮件服务暂时不可用')
  })

  it('refreshes the captcha only when the server rejects the captcha itself', async () => {
    mocks.sendCode.mockRejectedValue(new Error('图片验证码错误'))
    act(() => {
      root = createRoot(container)
      root.render(<LoginForm />)
    })
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === '验证码')
        ?.click(),
    )
    act(() => setInput(inputByPlaceholder(container, '邮箱或手机号'), 'user@example.com'))
    const send = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '发送',
    )
    act(() => send?.click())
    await flush()

    expect(mocks.captchaRefresh).toHaveBeenCalledOnce()
  })

  it('invalidates a sent code when the account changes', async () => {
    act(() => {
      root = createRoot(container)
      root.render(<LoginForm />)
    })
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === '验证码')
        ?.click(),
    )
    const account = inputByPlaceholder(container, '邮箱或手机号')
    act(() => setInput(account, 'first@example.com'))
    const send = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '发送',
    )
    act(() => send?.click())
    await flush()
    act(() => {
      setInput(inputByPlaceholder(container, '6 位邮箱验证码'), '123456')
      setInput(account, 'second@example.com')
    })
    await flush()

    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
    expect(inputByPlaceholder(container, '6 位邮箱验证码').value).toBe('')
  })
})
