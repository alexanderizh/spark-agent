/**
 * RegisterForm - 邮箱注册 / 手机号注册
 *
 * 手机号注册复用 /auth/login-sms（短信登录即自动注册），与服务端、edu-web 一致。
 * 手机号入口受 authCapabilities.smsEnabled 控制。
 *
 * 扁平化重设计：邮箱/手机号切换从 Segmented 改为内联文字链；输入框用底线样式；
 * 图片验证码 + 邮箱验证码并排，密码 + 邀请码并排，压缩纵向层级。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AutoComplete, Button, Form, Input } from 'antd'
import { useAuth } from './AuthContext'
import { useToast } from '../components/Toast'
import { CaptchaField, type CaptchaFieldHandle } from './CaptchaField'
import { getRecentEmails, rememberEmail } from './recentEmails'
import { matchFieldError } from './errorMapping'
import { Icons } from '../Icons'

type RegisterMode = 'email' | 'phone'

const PHONE_RE = /^1[3-9]\d{9}$/

export function RegisterForm(): React.ReactElement {
  const auth = useAuth()
  const { toast } = useToast()
  const [form] = Form.useForm()
  const captchaRef = useRef<CaptchaFieldHandle>(null)
  const [submitting, setSubmitting] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [recentEmails, setRecentEmails] = useState<string[]>(() => getRecentEmails())

  const smsEnabled = auth.authCapabilities?.smsEnabled === true
  const [mode, setMode] = useState<RegisterMode>('email')
  // sms 能力未开启时，回退展示 email 模式（渲染期派生，避免 effect 内同步 setState）
  const activeMode: RegisterMode = mode === 'phone' && !smsEnabled ? 'email' : mode

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const handleModeChange = (value: RegisterMode): void => {
    setMode(value)
    form.resetFields(['account', 'emailCode', 'password', 'phone', 'smsCode', 'captchaText'])
  }

  const setFieldError = (name: string, message: string): void => {
    form.setFields([{ name, errors: [message] }])
  }

  const handleSendCode = async (): Promise<void> => {
    try {
      const values = await form.validateFields(['account', 'captchaId', 'captchaText'])
      await auth.sendCode({
        account: values.account,
        type: 'register',
        captchaId: values.captchaId,
        captchaText: values.captchaText,
      })
      toast.success('验证码已发送到邮箱')
      setCountdown(60)
    } catch (e) {
      const msg = (e as Error).message ?? '发送失败'
      const target = matchFieldError(msg, ['account', 'captchaText'])
      if (target) {
        setFieldError(target, msg)
        if (target === 'captchaText') void captchaRef.current?.refresh()
      } else {
        toast.error(msg)
      }
    }
  }

  // ─── 手机号注册：发送短信验证码 ──────────────────────────────────────────────
  const handleSendSms = async (): Promise<void> => {
    try {
      const values = await form.validateFields(['phone', 'captchaId', 'captchaText'])
      const phone = (values.phone ?? '').trim()
      if (!phone) {
        setFieldError('phone', '请填写手机号')
        return
      }
      if (!PHONE_RE.test(phone)) {
        setFieldError('phone', '请填写有效的手机号')
        return
      }
      await auth.sendSmsCode({
        phone,
        type: 'register',
        captchaId: values.captchaId,
        captchaText: values.captchaText,
      })
      toast.success('短信验证码已发送')
      setCountdown(60)
    } catch (e) {
      const msg = (e as Error).message ?? '发送失败'
      const target = matchFieldError(msg, ['phone', 'captchaText'])
      if (target) {
        setFieldError(target, msg)
        if (target === 'captchaText') void captchaRef.current?.refresh()
      } else {
        toast.error(msg)
      }
    }
  }

  const handleSubmit = async (): Promise<void> => {
    try {
      setSubmitting(true)
      const values = await form.validateFields()

      if (activeMode === 'phone') {
        // 手机号注册复用 login-sms（自动注册）
        await auth.loginBySms({
          phone: (values.phone ?? '').trim(),
          smsCode: values.smsCode,
        })
        toast.success('注册成功，已自动登录')
        return
      }

      await auth.register({
        account: values.account,
        password: values.password,
        code: values.emailCode,
        ...(values.inviteCode ? { inviteCode: values.inviteCode } : {}),
      })
      rememberEmail(values.account)
      setRecentEmails(getRecentEmails())
      toast.success('注册成功，已自动登录')
    } catch (e) {
      const msg = (e as Error).message ?? '注册失败'
      const candidates: Array<
        'account' | 'emailCode' | 'password' | 'captchaText' | 'phone' | 'smsCode'
      > =
        activeMode === 'phone'
          ? ['smsCode', 'phone', 'captchaText']
          : ['emailCode', 'password', 'captchaText', 'account']
      const target = matchFieldError(msg, candidates)
      if (target) {
        setFieldError(target, msg)
        if (target === 'captchaText') void captchaRef.current?.refresh()
      } else {
        toast.error(msg)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const accountSuggestions = useMemo(
    () => recentEmails.map((email) => ({ value: email })),
    [recentEmails],
  )

  return (
    <div className="auth-form">
      <div className="auth-form-head">
        <h2 className="auth-form-title">创建账号</h2>
        <p className="auth-form-greet">
          {activeMode === 'phone'
            ? '输入手机号，验证后即完成注册'
            : '填写邮箱与密码，或切换到手机号快速注册'}
        </p>
      </div>

      {/* 注册方式：内联文字链，非 Segmented */}
      <div className="auth-methods">
        <span className="auth-methods-label">方式</span>
        <button
          type="button"
          className={`auth-method ${activeMode === 'email' ? 'active' : ''}`}
          onClick={() => handleModeChange('email')}
        >
          邮箱
        </button>
        {smsEnabled && (
          <button
            type="button"
            className={`auth-method ${activeMode === 'phone' ? 'active' : ''}`}
            onClick={() => handleModeChange('phone')}
          >
            手机号
          </button>
        )}
      </div>

      <Form
        form={form}
        className="auth-form-body auth-form-body--flat"
        layout="vertical"
        requiredMark={false}
        onFinish={handleSubmit}
      >
        {activeMode === 'phone' ? (
          <>
            <Form.Item
              name="phone"
              className="auth-field-row"
              rules={[
                { required: true, message: '请填写手机号' },
                { pattern: PHONE_RE, message: '请填写有效的手机号' },
              ]}
            >
              <div className="auth-input auth-input--flat">
                <Icons.Mail size={17} className="auth-input-icon" />
                <Input placeholder="请输入手机号" maxLength={11} autoComplete="tel" />
              </div>
            </Form.Item>

            <CaptchaField ref={captchaRef} form={form} />

            <Form.Item
              name="smsCode"
              className="auth-field-row"
              rules={[{ required: true, message: '请填写短信验证码' }]}
            >
              <CodeInput
                placeholder="6 位短信验证码"
                countdown={countdown}
                onSend={() => void handleSendSms()}
              />
            </Form.Item>

            <div className="auth-sms-hint">输入手机号验证后即完成注册</div>
          </>
        ) : (
          <>
            <Form.Item
              name="account"
              className="auth-field-row"
              rules={[{ required: true, type: 'email', message: '请填写有效邮箱' }]}
            >
              <div className="auth-input auth-input--flat">
                <Icons.Mail size={17} className="auth-input-icon" />
                <AutoComplete
                  placeholder="example@spark.com"
                  options={accountSuggestions}
                  allowClear
                  {...({ autoComplete: 'email' } as any)}
                  filterOption={(inputValue, option) => {
                    const v = (option as { value?: string })?.value ?? ''
                    return v.toLowerCase().includes(inputValue.toLowerCase())
                  }}
                />
              </div>
            </Form.Item>

            <CaptchaField ref={captchaRef} form={form} />

            {/* 邮箱验证码 + 密码并排 */}
            <div className="auth-field-row auth-field-row--cols2">
              <Form.Item
                name="emailCode"
                className="auth-field"
                rules={[{ required: true, message: '请填写邮箱验证码' }]}
              >
                <CodeInput
                  placeholder="邮箱验证码"
                  countdown={countdown}
                  onSend={() => void handleSendCode()}
                />
              </Form.Item>
              <Form.Item
                name="password"
                className="auth-field"
                rules={[{ required: true, min: 6, message: '至少 6 位' }]}
              >
                <PasswordInput placeholder="设置登录密码" autoComplete="new-password" />
              </Form.Item>
            </div>

            <Form.Item name="inviteCode" className="auth-field-row">
              <div className="auth-input auth-input--flat">
                <Icons.Sparkles size={17} className="auth-input-icon" />
                <Input placeholder="邀请码（选填）" autoComplete="off" />
              </div>
            </Form.Item>
          </>
        )}

        <Form.Item className="auth-submit-row">
          <Button
            className="auth-submit-btn"
            type="primary"
            htmlType="submit"
            loading={submitting}
          >
            {submitting ? '处理中' : '注册并登录'}
            {!submitting && <Icons.ArrowRight size={18} />}
          </Button>
        </Form.Item>

        <div className="auth-tos-line">
          注册即同意 <a href="#">服务协议</a> 与 <a href="#">隐私政策</a>
        </div>
      </Form>
    </div>
  )
}

// ─── 字段子组件：统一扁平底线输入样式 ──────────────────────────────────────────

function PasswordInput({
  placeholder,
  autoComplete,
}: {
  placeholder: string
  autoComplete?: string
}): React.ReactElement {
  const [visible, setVisible] = useState(false)
  return (
    <div className="auth-input auth-input--flat">
      <Icons.Lock size={17} className="auth-input-icon" />
      <Input.Password
        placeholder={placeholder}
        autoComplete={autoComplete ?? 'current-password'}
        visibilityToggle={false}
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
  onSend,
}: {
  placeholder: string
  countdown: number
  onSend: () => void
}): React.ReactElement {
  return (
    <div className="auth-input auth-input--flat auth-input--with-action">
      <Input placeholder={placeholder} maxLength={6} />
      <button
        type="button"
        className={`auth-input-action auth-input-action--send ${countdown > 0 ? 'disabled' : ''}`}
        onClick={() => countdown <= 0 && onSend()}
        disabled={countdown > 0}
      >
        {countdown > 0 ? `${countdown}s` : '发送'}
      </button>
    </div>
  )
}
