/**
 * RegisterForm - 邮箱注册 / 手机号注册
 *
 * 手机号注册复用 /auth/login-sms（短信登录即自动注册），与服务端、edu-web 一致。
 * 手机号入口受 authCapabilities.smsEnabled 控制。
 *
 * 扁平化重设计：邮箱/手机号切换从 Segmented 改为内联文字链；输入框用底线样式；
 * 图片验证码 + 邮箱验证码并排，密码 + 邀请码并排，压缩纵向层级。
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

export function RegisterForm({ flowSwitch }: { flowSwitch?: React.ReactNode }): React.ReactElement {
  const auth = useAuth()
  const { toast } = useToast()
  const [form] = Form.useForm()
  const captchaRef = useRef<CaptchaFieldHandle>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sentTarget, setSentTarget] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const sendingCodeRef = useRef(false)
  const submittingRef = useRef(false)
  const {
    resendCountdown: countdown,
    isCodeActive,
    isExpired,
    isActiveNow,
    start: startCodeTimer,
    reset: resetCodeTimer,
  } = useVerificationCodeTimer()

  const smsEnabled = auth.authCapabilities?.smsEnabled === true
  const account = Form.useWatch('account', form)
  const emailCode = Form.useWatch('emailCode', form)
  const smsCode = Form.useWatch('smsCode', form)
  const password = Form.useWatch('password', form)
  const confirmPassword = Form.useWatch('confirmPassword', form)
  const identifierKind = inferIdentifierKind(account, smsEnabled)
  const usesPhone = identifierKind === 'phone'
  const normalizedAccount = String(account ?? '').trim()
  const verificationTarget = normalizeVerificationTarget(account)
  const accountValid = usesPhone
    ? PHONE_RE.test(normalizedAccount)
    : EMAIL_RE.test(normalizedAccount)
  const hasActiveCode = Boolean(sentTarget && sentTarget === verificationTarget && isCodeActive)
  const canSubmit =
    accountValid &&
    hasActiveCode &&
    (usesPhone
      ? String(smsCode ?? '').trim().length === 6
      : String(emailCode ?? '').trim().length === 6 &&
        String(password ?? '').length >= 6 &&
        password === confirmPassword)

  const handleAccountChange = (nextValue: string): void => {
    const nextTarget = normalizeVerificationTarget(nextValue)
    if (!sentTarget || sentTarget === nextTarget) return
    setSentTarget('')
    resetCodeTimer()
    form.setFields([
      { name: 'emailCode', value: '', errors: [] },
      { name: 'smsCode', value: '', errors: [] },
    ])
  }

  useEffect(() => {
    if (!isExpired || !sentTarget) return
    const field = PHONE_RE.test(sentTarget) ? 'smsCode' : 'emailCode'
    form.setFields([{ name: field, errors: ['验证码已过期，请重新获取'] }])
  }, [form, isExpired, sentTarget])

  const setFieldError = (name: string, message: string): void => {
    form.setFields([{ name, errors: [message] }])
  }

  const setCaptchaError = async (message: string): Promise<void> => {
    await captchaRef.current?.refresh()
    setFieldError('captchaText', message)
  }

  const handleSendCode = async (): Promise<void> => {
    if (sendingCodeRef.current || countdown > 0) return
    sendingCodeRef.current = true
    setSendingCode(true)
    try {
      const values = await form.validateFields(['account', 'captchaId', 'captchaText'])
      if (!values.captchaId || !String(values.captchaText ?? '').trim()) {
        setFieldError('captchaText', '请填写图片验证码')
        return
      }
      const requestedAt = Date.now()
      const result = await auth.sendCode({
        account: values.account.trim(),
        type: 'register',
        captchaId: values.captchaId,
        captchaText: values.captchaText,
      })
      const sentTarget = normalizeVerificationTarget(values.account)
      const isStillCurrentTarget =
        normalizeVerificationTarget(form.getFieldValue('account')) === sentTarget
      if (isStillCurrentTarget) {
        setSentTarget(sentTarget)
        startCodeTimer(result.expire_in, requestedAt)
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
      sendingCodeRef.current = false
      setSendingCode(false)
    }
  }

  // ─── 手机号注册：发送短信验证码 ──────────────────────────────────────────────
  const handleSendSms = async (): Promise<void> => {
    if (sendingCodeRef.current || countdown > 0) return
    sendingCodeRef.current = true
    setSendingCode(true)
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
        setSentTarget(sentTarget)
        startCodeTimer(result.expire_in, requestedAt)
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
      sendingCodeRef.current = false
      setSendingCode(false)
    }
  }

  const handleSubmit = async (): Promise<void> => {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      setSubmitting(true)
      const values = await form.validateFields()

      if (!hasActiveCode || !isActiveNow()) {
        setFieldError(usesPhone ? 'smsCode' : 'emailCode', '请先获取有效验证码')
        return
      }

      if (usesPhone) {
        // 手机号注册复用 login-sms（自动注册）
        await auth.loginBySms({
          phone: (values.account ?? '').trim(),
          smsCode: values.smsCode,
        })
        toast.success('注册成功，已自动登录')
        return
      }

      await auth.register({
        account: values.account.trim(),
        password: values.password,
        code: values.emailCode,
        ...(values.inviteCode ? { inviteCode: values.inviteCode } : {}),
      })
      const normalizedAccount = values.account.trim()
      if (EMAIL_RE.test(normalizedAccount)) {
        rememberEmail(normalizedAccount)
      }
      toast.success('注册成功，已自动登录')
    } catch (e) {
      const msg = (e as Error).message ?? '注册失败'
      const candidates: Array<
        'account' | 'emailCode' | 'password' | 'captchaText' | 'phone' | 'smsCode'
      > = usesPhone
        ? ['smsCode', 'account', 'captchaText']
        : ['emailCode', 'password', 'captchaText', 'account']
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

  return (
    <div className="auth-form">
      <div className="auth-form-head">
        <h2 className="auth-form-title">创建账号</h2>
        <p className="auth-form-greet">输入邮箱或手机号，系统会自动选择注册方式</p>
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
              validator: async (_rule, value: string) => {
                const normalized = (value ?? '').trim()
                if (!normalized) throw new Error('请填写邮箱或手机号')
                if (usesPhone ? PHONE_RE.test(normalized) : EMAIL_RE.test(normalized)) return
                throw new Error(usesPhone ? '请填写有效的手机号' : '请填写有效邮箱')
              },
            },
          ]}
        >
          <AccountInput onAccountChange={handleAccountChange} />
        </Form.Item>

        {usesPhone ? (
          <>
            <CaptchaField
              ref={captchaRef}
              form={form}
              disabled={sendingCode}
              required={!hasActiveCode}
            />

            <Form.Item
              name="smsCode"
              className="auth-field-row"
              rules={[{ required: true, message: '请填写短信验证码' }]}
            >
              <CodeInput
                placeholder="6 位短信验证码"
                countdown={countdown}
                sending={sendingCode}
                onSend={() => void handleSendSms()}
              />
            </Form.Item>

            <div className="auth-sms-hint">
              {hasActiveCode ? '验证码已发送，请在有效期内完成验证' : '输入手机号验证后即完成注册'}
            </div>
          </>
        ) : (
          <>
            <CaptchaField
              ref={captchaRef}
              form={form}
              disabled={sendingCode}
              required={!hasActiveCode}
            />

            <Form.Item
              name="emailCode"
              className="auth-field-row"
              rules={[{ required: true, message: '请填写邮箱验证码' }]}
            >
              <CodeInput
                placeholder="邮箱验证码"
                countdown={countdown}
                sending={sendingCode}
                onSend={() => void handleSendCode()}
              />
            </Form.Item>

            <Form.Item
              name="password"
              className="auth-field-row"
              rules={[{ required: true, min: 6, message: '至少 6 位' }]}
            >
              <PasswordInput placeholder="设置登录密码" autoComplete="new-password" />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              className="auth-field-row"
              dependencies={['password']}
              rules={[
                { required: true, message: '请再次输入登录密码' },
                ({ getFieldValue }) => ({
                  validator: async (_rule, value: string) => {
                    if (!value || getFieldValue('password') === value) return
                    throw new Error('两次输入的密码不一致')
                  },
                }),
              ]}
            >
              <PasswordInput placeholder="再次输入登录密码" autoComplete="new-password" />
            </Form.Item>

            {/* <Form.Item name="inviteCode" className="auth-field-row">
              <InviteCodeInput />
            </Form.Item> */}
          </>
        )}

        <Form.Item className="auth-submit-row">
          <Button
            className="auth-submit-btn"
            type="primary"
            htmlType="submit"
            loading={submitting}
            disabled={!canSubmit || submitting}
          >
            {submitting ? '处理中' : '注册并登录'}
            {!submitting && <Icons.ArrowRight size={18} />}
          </Button>
        </Form.Item>

        <div className={`auth-footer-row ${flowSwitch ? 'auth-footer-row--split' : ''}`}>
          <div className="auth-tos-line">
            注册即同意 <a href="#">服务协议</a> 与 <a href="#">隐私政策</a>
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

function InviteCodeInput({ value, onChange }: ControlledInputProps): React.ReactElement {
  return (
    <div className="auth-input auth-input--flat">
      <Icons.Sparkles size={17} className="auth-input-icon" />
      <Input value={value} onChange={onChange} placeholder="邀请码（选填）" autoComplete="off" />
    </div>
  )
}

function PasswordInput({
  placeholder,
  autoComplete,
  value,
  onChange,
}: {
  placeholder: string
  autoComplete?: string
} & ControlledInputProps): React.ReactElement {
  const [visible, setVisible] = useState(false)
  return (
    <div className="auth-input auth-input--flat">
      <Icons.Lock size={17} className="auth-input-icon" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete ?? 'current-password'}
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
