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

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AutoComplete, Button, Form, Input } from 'antd'
import { useAuth } from './AuthContext'
import { useToast } from '../components/Toast'
import { CaptchaField, type CaptchaFieldHandle } from './CaptchaField'
import { getRecentEmails, rememberEmail } from './recentEmails'
import { matchFieldError } from './errorMapping'
import { Icons } from '../Icons'

type LoginTab = 'password' | 'code' | 'sms'

const PHONE_RE = /^1[3-9]\d{9}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

export function LoginForm(): React.ReactElement {
  const auth = useAuth()
  const { toast } = useToast()
  const [form] = Form.useForm()
  const captchaRef = useRef<CaptchaFieldHandle>(null)
  const [submitting, setSubmitting] = useState(false)
  const [tab, setTab] = useState<LoginTab>('password')
  const [countdown, setCountdown] = useState(0)
  const [smsCountdown, setSmsCountdown] = useState(0)
  const [recentEmails, setRecentEmails] = useState<string[]>(() => getRecentEmails())

  const smsEnabled = auth.authCapabilities?.smsEnabled === true
  // sms 能力未开启时，回退展示 password tab（渲染期派生，避免 effect 内同步 setState）
  const activeTab: LoginTab = tab === 'sms' && !smsEnabled ? 'password' : tab

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  useEffect(() => {
    if (smsCountdown <= 0) return
    const t = setTimeout(() => setSmsCountdown(smsCountdown - 1), 1000)
    return () => clearTimeout(t)
  }, [smsCountdown])

  const handleTabChange = (key: string): void => {
    setTab(key as LoginTab)
    form.resetFields(['password', 'emailCode', 'phone', 'smsCode'])
  }

  const setFieldError = (name: string, message: string): void => {
    form.setFields([{ name, errors: [message] }])
  }

  const handleSendCode = async (): Promise<void> => {
    try {
      const values = await form.validateFields(['account', 'captchaId', 'captchaText'])
      if (!values.account) {
        setFieldError('account', '请填写邮箱')
        return
      }
      await auth.sendCode({
        account: values.account,
        type: 'login',
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

  // ─── 短信验证码：发送 ────────────────────────────────────────────────────────
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
        type: 'login',
        captchaId: values.captchaId,
        captchaText: values.captchaText,
      })
      toast.success('短信验证码已发送')
      setSmsCountdown(60)
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

      if (activeTab === 'sms') {
        const result = await auth.loginBySms({
          phone: (values.phone ?? '').trim(),
          smsCode: values.smsCode,
        })
        toast.success(result.isNew ? '注册并登录成功' : '登录成功')
        return
      }

      let result
      if (activeTab === 'password') {
        result = await auth.login({
          account: values.account,
          loginMode: 'password',
          password: values.password,
          captchaId: values.captchaId,
          captchaText: values.captchaText,
        })
      } else {
        result = await auth.login({
          account: values.account,
          loginMode: 'code',
          emailCode: values.emailCode,
        })
      }
      rememberEmail(values.account)
      setRecentEmails(getRecentEmails())
      toast.success('登录成功')
      void result
    } catch (e) {
      const msg = (e as Error).message ?? '登录失败'
      const candidates: Array<
        'account' | 'password' | 'captchaText' | 'emailCode' | 'phone' | 'smsCode'
      > =
        activeTab === 'password'
          ? ['password', 'captchaText', 'account']
          : activeTab === 'code'
            ? ['emailCode', 'account']
            : ['smsCode', 'phone', 'captchaText']
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

  const methodItems: Array<{ key: LoginTab; label: string; visible: boolean }> = [
    { key: 'password', label: '密码', visible: true },
    { key: 'code', label: '邮箱验证码', visible: true },
    { key: 'sms', label: '手机号', visible: smsEnabled },
  ]

  return (
    <div className="auth-form">
      <div className="auth-form-head">
        <h2 className="auth-form-title">欢迎回来</h2>
        <p className="auth-form-greet">
          {activeTab === 'sms'
            ? '输入手机号与短信验证码继续'
            : activeTab === 'code'
              ? '输入邮箱，发送验证码登录'
              : '输入账号继续，或切换到验证码 / 手机号登录'}
        </p>
      </div>

      {/* 登录方式：内联文字链，非 Tab */}
      <div className="auth-methods">
        <span className="auth-methods-label">方式</span>
        {methodItems
          .filter((item) => item.visible)
          .map((item) => (
            <button
              key={item.key}
              type="button"
              className={`auth-method ${activeTab === item.key ? 'active' : ''}`}
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
        {activeTab === 'sms' ? (
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
        ) : (
          <Form.Item
            name="account"
            className="auth-field-row"
            rules={[{ required: true, validator: validateAccount(activeTab !== 'password') }]}
          >
            <div className="auth-input auth-input--flat">
              <Icons.Mail size={17} className="auth-input-icon" />
              <AutoComplete
                placeholder={activeTab === 'password' ? '邮箱或手机号' : 'example@spark.com'}
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
        )}

        {/* 密码（仅 password 模式） */}
        {activeTab === 'password' && (
          <Form.Item
            name="password"
            className="auth-field-row"
            rules={[{ required: true, min: 6, message: '至少 6 位' }]}
          >
            <PasswordInput />
          </Form.Item>
        )}

        {/* 图片验证码：复用封装组件（挂载拉图 / 点击刷新 / 失败换图） */}
        <CaptchaField ref={captchaRef} form={form} />

        {/* 邮箱验证码（code 模式） / 短信验证码（sms 模式） */}
        {activeTab === 'code' && (
          <Form.Item
            name="emailCode"
            className="auth-field-row"
            rules={[{ required: true, message: '请填写邮箱验证码' }]}
          >
            <CodeInput
              placeholder="6 位邮箱验证码"
              countdown={countdown}
              onSend={() => void handleSendCode()}
            />
          </Form.Item>
        )}
        {activeTab === 'sms' && (
          <Form.Item
            name="smsCode"
            className="auth-field-row"
            rules={[{ required: true, message: '请填写短信验证码' }]}
          >
            <CodeInput
              placeholder="6 位短信验证码"
              countdown={smsCountdown}
              onSend={() => void handleSendSms()}
            />
          </Form.Item>
        )}

        {activeTab === 'sms' && (
          <div className="auth-sms-hint">首次使用手机号登录将自动完成注册</div>
        )}

        <Form.Item className="auth-submit-row">
          <Button
            className="auth-submit-btn"
            type="primary"
            htmlType="submit"
            loading={submitting}
          >
            {submitting ? '登录中' : '登录'}
            {!submitting && <Icons.ArrowRight size={18} />}
          </Button>
        </Form.Item>

        <div className="auth-foot-line">
          <span>
            {activeTab === 'password' ? (
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
          </span>
        </div>
      </Form>
    </div>
  )
}

// ─── 字段子组件：统一扁平底线输入样式 ──────────────────────────────────────────

function PasswordInput(): React.ReactElement {
  const [visible, setVisible] = useState(false)
  return (
    <div className="auth-input auth-input--flat">
      <Icons.Lock size={17} className="auth-input-icon" />
      <Input.Password
        placeholder="请输入密码"
        autoComplete="current-password"
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
