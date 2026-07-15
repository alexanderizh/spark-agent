/**
 * LoginForm - 邮箱密码登录 + 邮箱验证码登录 + 手机号短信登录
 *
 * 字段：
 *   - 账号（邮箱）- password / code 模式
 *   - 密码（password 模式） / 邮箱验证码（code 模式）
 *   - 手机号 + 图片验证码 + 短信验证码（sms 模式，受 authCapabilities.smsEnabled 控制）
 *
 * 扁平化重设计：登录方式从顶部 Tab 改为内联文字链；输入框用底线样式，
 * 压缩纵向层级。图片验证码复用 CaptchaField 封装组件（挂载拉图/点击刷新/失败换图）。
 */

import React, { useEffect, useRef, useState } from 'react'
import { Button, Form, Input } from 'antd'
import { useAuth } from './AuthContext'
import { useToast } from '../components/Toast'
import { CaptchaField, type CaptchaFieldHandle } from './CaptchaField'
import { rememberEmail } from './recentEmails'
import { matchFieldError } from './errorMapping'
import { EMAIL_RE, inferIdentifierKind, normalizeVerificationTarget, PHONE_RE } from './identifier'
import { useVerificationCodeTimer } from './useVerificationCodeTimer'
import { Icons } from '../Icons'

type LoginTab = 'password' | 'code'

/**
 * 账号校验：邮箱或手机号（用于密码登录，两者均可作为账号）。
 * 返回 Promise 风格，供 antd Form rule 的 validator 使用。
 */
function validateAccount(
  requireEmailOnly: boolean,
): (rule: unknown, value: string) => Promise<void> {
  return (_rule, value) => {
    const v = (value ?? '').trim()
    if (!v) return Promise.reject(new Error('请填写账号'))
    if (!requireEmailOnly && PHONE_RE.test(v)) return Promise.resolve()
    if (EMAIL_RE.test(v)) return Promise.resolve()
    return Promise.reject(
      new Error(requireEmailOnly ? '请填写有效邮箱' : '请填写有效的邮箱或手机号'),
    )
  }
}

export function LoginForm({ flowSwitch }: { flowSwitch?: React.ReactNode }): React.ReactElement {
  const auth = useAuth()
  const { toast } = useToast()
  const [form] = Form.useForm()
  const captchaRef = useRef<CaptchaFieldHandle>(null)
  const [submitting, setSubmitting] = useState(false)
  const [tab, setTab] = useState<LoginTab>('password')
  const [emailCodeTarget, setEmailCodeTarget] = useState('')
  const [smsCodeTarget, setSmsCodeTarget] = useState('')
  const [sendingEmailCode, setSendingEmailCode] = useState(false)
  const [sendingSmsCode, setSendingSmsCode] = useState(false)
  const sendingEmailRef = useRef(false)
  const sendingSmsRef = useRef(false)
  const submittingRef = useRef(false)
  const {
    resendCountdown: countdown,
    isCodeActive: isEmailCodeActive,
    isExpired: isEmailCodeExpired,
    isActiveNow: isEmailCodeActiveNow,
    start: startEmailCodeTimer,
    reset: resetEmailCodeTimer,
  } = useVerificationCodeTimer()
  const {
    resendCountdown: smsCountdown,
    isCodeActive: isSmsCodeActive,
    isExpired: isSmsCodeExpired,
    isActiveNow: isSmsCodeActiveNow,
    start: startSmsCodeTimer,
    reset: resetSmsCodeTimer,
  } = useVerificationCodeTimer()

  const smsEnabled = auth.authCapabilities?.smsEnabled === true
  const account = Form.useWatch('account', form)
  const password = Form.useWatch('password', form)
  const emailCode = Form.useWatch('emailCode', form)
  const smsCode = Form.useWatch('smsCode', form)
  const captchaId = Form.useWatch('captchaId', form)
  const captchaText = Form.useWatch('captchaText', form)
  const identifierKind = inferIdentifierKind(account, smsEnabled)
  const usesSmsCode = tab === 'code' && identifierKind === 'phone'
  const normalizedAccount = String(account ?? '').trim()
  const verificationTarget = normalizeVerificationTarget(account)
  const accountValid =
    EMAIL_RE.test(normalizedAccount) ||
    ((tab === 'password' || usesSmsCode) && PHONE_RE.test(normalizedAccount))
  const captchaReady = Boolean(captchaId && String(captchaText ?? '').trim())
  const hasActiveEmailCode = Boolean(
    emailCodeTarget && emailCodeTarget === verificationTarget && isEmailCodeActive,
  )
  const hasActiveSmsCode = Boolean(
    smsCodeTarget && smsCodeTarget === verificationTarget && isSmsCodeActive,
  )
  const canSubmit =
    accountValid &&
    (tab === 'password'
      ? captchaReady && String(password ?? '').length >= 6
      : usesSmsCode
        ? hasActiveSmsCode && String(smsCode ?? '').trim().length === 6
        : hasActiveEmailCode && String(emailCode ?? '').trim().length === 6)

  const handleAccountChange = (nextValue: string): void => {
    const nextTarget = normalizeVerificationTarget(nextValue)
    if (emailCodeTarget && emailCodeTarget !== nextTarget) {
      setEmailCodeTarget('')
      resetEmailCodeTimer()
      form.setFields([{ name: 'emailCode', value: '', errors: [] }])
    }
    if (smsCodeTarget && smsCodeTarget !== nextTarget) {
      setSmsCodeTarget('')
      resetSmsCodeTimer()
      form.setFields([{ name: 'smsCode', value: '', errors: [] }])
    }
  }

  useEffect(() => {
    if (!isEmailCodeExpired || !emailCodeTarget) return
    form.setFields([{ name: 'emailCode', errors: ['验证码已过期，请重新获取'] }])
  }, [emailCodeTarget, form, isEmailCodeExpired])

  useEffect(() => {
    if (!isSmsCodeExpired || !smsCodeTarget) return
    form.setFields([{ name: 'smsCode', errors: ['验证码已过期，请重新获取'] }])
  }, [form, isSmsCodeExpired, smsCodeTarget])

  const handleTabChange = (key: string): void => {
    setTab(key as LoginTab)
    form.resetFields(['password', 'emailCode', 'smsCode'])
  }

  const setFieldError = (name: string, message: string): void => {
    form.setFields([{ name, errors: [message] }])
  }

  const setCaptchaError = async (message: string): Promise<void> => {
    await captchaRef.current?.refresh()
    setFieldError('captchaText', message)
  }

  const handleSendCode = async (): Promise<void> => {
    if (sendingEmailRef.current || countdown > 0) return
    sendingEmailRef.current = true
    setSendingEmailCode(true)
    try {
      const values = await form.validateFields(['account', 'captchaId', 'captchaText'])
      if (!values.account) {
        setFieldError('account', '请填写邮箱')
        return
      }
      if (!values.captchaId || !String(values.captchaText ?? '').trim()) {
        setFieldError('captchaText', '请填写图片验证码')
        return
      }
      const requestedAt = Date.now()
      const result = await auth.sendCode({
        account: values.account.trim(),
        type: 'login',
        captchaId: values.captchaId,
        captchaText: values.captchaText,
      })
      const sentTarget = normalizeVerificationTarget(values.account)
      const isStillCurrentTarget =
        normalizeVerificationTarget(form.getFieldValue('account')) === sentTarget
      if (isStillCurrentTarget) {
        setEmailCodeTarget(sentTarget)
        startEmailCodeTimer(result.expire_in, requestedAt)
        form.setFields([{ name: 'emailCode', value: '', errors: [] }])
      }
      toast.success(
        isStillCurrentTarget ? '验证码已发送到邮箱' : '验证码已发送到原邮箱，请重新获取',
      )
    } catch (e) {
      const msg = (e as Error).message ?? '发送失败'
      const target = matchFieldError(msg, ['account', 'captchaText'])
      if (target) {
        if (target === 'captchaText') await setCaptchaError(msg)
        else setFieldError(target, msg)
      } else {
        toast.error(msg)
      }
    } finally {
      sendingEmailRef.current = false
      setSendingEmailCode(false)
    }
  }

  // ─── 短信验证码：发送 ────────────────────────────────────────────────────────
  const handleSendSms = async (): Promise<void> => {
    if (sendingSmsRef.current || smsCountdown > 0) return
    sendingSmsRef.current = true
    setSendingSmsCode(true)
    try {
      const values = await form.validateFields(['account', 'captchaId', 'captchaText'])
      const phone = (values.account ?? '').trim()
      if (!phone) {
        setFieldError('account', '请填写手机号')
        return
      }
      if (!PHONE_RE.test(phone)) {
        setFieldError('account', '请填写有效的手机号')
        return
      }
      if (!values.captchaId || !String(values.captchaText ?? '').trim()) {
        setFieldError('captchaText', '请填写图片验证码')
        return
      }
      const requestedAt = Date.now()
      const result = await auth.sendSmsCode({
        phone,
        captchaId: values.captchaId,
        captchaText: values.captchaText,
      })
      const sentTarget = normalizeVerificationTarget(phone)
      const isStillCurrentTarget =
        normalizeVerificationTarget(form.getFieldValue('account')) === sentTarget
      if (isStillCurrentTarget) {
        setSmsCodeTarget(sentTarget)
        startSmsCodeTimer(result.expire_in, requestedAt)
        form.setFields([{ name: 'smsCode', value: '', errors: [] }])
      }
      toast.success(
        isStillCurrentTarget ? '短信验证码已发送' : '验证码已发送到原手机号，请重新获取',
      )
    } catch (e) {
      const msg = (e as Error).message ?? '发送失败'
      const target = matchFieldError(msg, ['account', 'captchaText'])
      if (target) {
        if (target === 'captchaText') await setCaptchaError(msg)
        else setFieldError(target, msg)
      } else {
        toast.error(msg)
      }
    } finally {
      sendingSmsRef.current = false
      setSendingSmsCode(false)
    }
  }

  const handleSubmit = async (): Promise<void> => {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      setSubmitting(true)
      const values = await form.validateFields()

      if (usesSmsCode) {
        if (!hasActiveSmsCode || !isSmsCodeActiveNow()) {
          setFieldError('smsCode', '请先获取有效验证码')
          return
        }
        const result = await auth.loginBySms({
          phone: (values.account ?? '').trim(),
          smsCode: values.smsCode,
        })
        toast.success(result.isNew ? '注册并登录成功' : '登录成功')
        return
      }

      let result
      if (tab === 'password') {
        result = await auth.login({
          account: values.account.trim(),
          loginMode: 'password',
          password: values.password,
          captchaId: values.captchaId,
          captchaText: values.captchaText,
        })
      } else {
        if (!hasActiveEmailCode || !isEmailCodeActiveNow()) {
          setFieldError('emailCode', '请先获取有效验证码')
          return
        }
        result = await auth.login({
          account: values.account.trim(),
          loginMode: 'code',
          emailCode: values.emailCode,
        })
      }
      const normalizedAccount = values.account.trim()
      if (EMAIL_RE.test(normalizedAccount)) {
        rememberEmail(normalizedAccount)
      }
      toast.success('登录成功')
      void result
    } catch (e) {
      const msg = (e as Error).message ?? '登录失败'
      const candidates: Array<
        'account' | 'password' | 'captchaText' | 'emailCode' | 'phone' | 'smsCode'
      > =
        tab === 'password'
          ? ['password', 'captchaText', 'account']
          : usesSmsCode
            ? ['smsCode', 'account', 'captchaText']
            : ['emailCode', 'account', 'captchaText']
      const target = matchFieldError(msg, candidates)
      if (target) {
        if (target === 'captchaText') await setCaptchaError(msg)
        else setFieldError(target, msg)
      } else {
        toast.error(msg)
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const methodItems: Array<{ key: LoginTab; label: string; visible: boolean }> = [
    { key: 'password', label: '密码', visible: true },
    { key: 'code', label: '验证码', visible: true },
  ]

  return (
    <div className="auth-form">
      <div className="auth-form-head">
        <h2 className="auth-form-title">欢迎回来</h2>
        <p className="auth-form-greet">
          {tab === 'code'
            ? '输入邮箱或手机号，系统会自动选择验证码方式'
            : '输入邮箱或手机号继续，也可以使用验证码登录'}
        </p>
      </div>

      {/* 登录方式：内联文字链，非 Tab */}
      <div className="auth-methods">
        {methodItems
          .filter((item) => item.visible)
          .map((item) => (
            <button
              key={item.key}
              type="button"
              className={`auth-method ${tab === item.key ? 'active' : ''}`}
              onClick={() => handleTabChange(item.key)}
            >
              {item.label}
            </button>
          ))}
      </div>

      <Form
        form={form}
        className="auth-form-body auth-form-body--flat"
        layout="vertical"
        requiredMark={false}
        onFinish={handleSubmit}
      >
        <Form.Item
          name="account"
          className="auth-field-row"
          rules={[
            {
              required: true,
              validator:
                tab === 'password'
                  ? validateAccount(false)
                  : validateAccount(identifierKind === 'email'),
            },
          ]}
        >
          <AccountInput onAccountChange={handleAccountChange} />
        </Form.Item>

        {/* 密码（仅 password 模式） */}
        {tab === 'password' && (
          <Form.Item
            name="password"
            className="auth-field-row"
            rules={[{ required: true, min: 6, message: '至少 6 位' }]}
          >
            <PasswordInput />
          </Form.Item>
        )}

        {/* 图片验证码：复用封装组件（挂载拉图 / 点击刷新 / 失败换图） */}
        <CaptchaField
          ref={captchaRef}
          form={form}
          disabled={sendingEmailCode || sendingSmsCode}
          required={tab === 'password' || (usesSmsCode ? !hasActiveSmsCode : !hasActiveEmailCode)}
        />

        {/* 邮箱验证码（code 模式） / 短信验证码（sms 模式） */}
        {tab === 'code' && !usesSmsCode && (
          <Form.Item
            name="emailCode"
            className="auth-field-row"
            rules={[{ required: true, message: '请填写邮箱验证码' }]}
          >
            <CodeInput
              placeholder="6 位邮箱验证码"
              countdown={countdown}
              sending={sendingEmailCode}
              onSend={() => void handleSendCode()}
            />
          </Form.Item>
        )}
        {usesSmsCode && (
          <Form.Item
            name="smsCode"
            className="auth-field-row"
            rules={[{ required: true, message: '请填写短信验证码' }]}
          >
            <CodeInput
              placeholder="6 位短信验证码"
              countdown={smsCountdown}
              sending={sendingSmsCode}
              onSend={() => void handleSendSms()}
            />
          </Form.Item>
        )}

        <Form.Item className="auth-submit-row">
          <Button
            className="auth-submit-btn"
            type="primary"
            htmlType="submit"
            loading={submitting}
            disabled={!canSubmit || submitting}
          >
            {submitting ? '登录中' : '登录'}
            {!submitting && <Icons.ArrowRight size={18} />}
          </Button>
        </Form.Item>

        <div className={`auth-footer-row ${flowSwitch ? 'auth-footer-row--split' : ''}`}>
          <div className="auth-foot-line">
            {tab === 'password' ? (
              <>
                <span className="auth-foot-muted">忘记密码？</span>{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    handleTabChange('code')
                  }}
                >
                  用验证码登录
                </a>
              </>
            ) : (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  handleTabChange('password')
                }}
              >
                返回密码登录
              </a>
            )}
          </div>
          {flowSwitch}
        </div>
      </Form>
    </div>
  )
}

// ─── 字段子组件：统一扁平底线输入样式 ──────────────────────────────────────────

type ControlledInputProps = Pick<React.ComponentProps<typeof Input>, 'value' | 'onChange'>

function AccountInput({
  value,
  onChange,
  onAccountChange,
}: ControlledInputProps & { onAccountChange?: (value: string) => void }): React.ReactElement {
  return (
    <div className="auth-input auth-input--flat">
      <Icons.Mail size={17} className="auth-input-icon" />
      <Input
        value={value}
        onChange={(event) => {
          onAccountChange?.(event.target.value)
          onChange?.(event)
        }}
        placeholder="邮箱或手机号"
        allowClear
        autoComplete="username"
      />
    </div>
  )
}

function PasswordInput({ value, onChange }: ControlledInputProps): React.ReactElement {
  const [visible, setVisible] = useState(false)
  return (
    <div className="auth-input auth-input--flat">
      <Icons.Lock size={17} className="auth-input-icon" />
      <Input
        placeholder="请输入密码"
        value={value}
        onChange={onChange}
        autoComplete="current-password"
        type={visible ? 'text' : 'password'}
      />
      <button
        type="button"
        className="auth-input-action"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? '隐藏密码' : '显示密码'}
      >
        {visible ? <Icons.EyeOff size={16} /> : <Icons.Eye size={16} />}
      </button>
    </div>
  )
}

function CodeInput({
  placeholder,
  countdown,
  sending,
  onSend,
  value,
  onChange,
}: {
  placeholder: string
  countdown: number
  sending: boolean
  onSend: () => void
} & ControlledInputProps): React.ReactElement {
  return (
    <div className="auth-input auth-input--flat auth-input--with-action">
      <Input value={value} onChange={onChange} placeholder={placeholder} maxLength={6} />
      <button
        type="button"
        className={`auth-input-action auth-input-action--send ${countdown > 0 || sending ? 'disabled' : ''}`}
        onClick={() => countdown <= 0 && !sending && onSend()}
        disabled={countdown > 0 || sending}
      >
        {sending ? '发送中' : countdown > 0 ? `${countdown}s` : '发送'}
      </button>
    </div>
  )
}
