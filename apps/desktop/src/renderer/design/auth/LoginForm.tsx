/**
 * LoginForm — 邮箱密码登录 + 邮箱验证码登录 + 手机号短信登录
 *
 * 字段：
 *   - 账号（邮箱）— password / code 模式
 *   - 密码（password 模式） / 邮箱验证码（code 模式）
 *   - 手机号 + 图片验证码 + 短信验证码（sms 模式，受 authCapabilities.smsEnabled 控制）
 */

import React, { useEffect, useMemo, useState } from 'react'
import { AutoComplete, Button, Form, Input, Tabs } from 'antd'
import { useAuth } from './AuthContext'
import { useToast } from '../components/Toast'
import { CaptchaField } from './CaptchaField'
import { getRecentEmails, rememberEmail } from './recentEmails'
import { matchFieldError } from './errorMapping'

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

  const refreshCaptcha = (): void => {
    void form.setFieldValue('captchaText', '')
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
        if (target === 'captchaText') refreshCaptcha()
      } else if (!msg.includes('captcha')) {
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
        if (target === 'captchaText') refreshCaptcha()
      } else if (!msg.includes('captcha')) {
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
      const candidates: Array<'account' | 'password' | 'captchaText' | 'emailCode' | 'phone' | 'smsCode'> =
        activeTab === 'password'
          ? ['password', 'captchaText', 'account']
          : activeTab === 'code'
            ? ['emailCode', 'account']
            : ['smsCode', 'phone', 'captchaText']
      const target = matchFieldError(msg, candidates)
      if (target) {
        setFieldError(target, msg)
        if (target === 'captchaText') refreshCaptcha()
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

  const tabItems = [
    { key: 'password', label: '密码登录' },
    { key: 'code', label: '邮箱验证码' },
    ...(smsEnabled ? [{ key: 'sms', label: '手机号登录' }] : []),
  ]

  return (
    <div className="auth-form">
      <Tabs
        className="auth-login-tabs"
        activeKey={activeTab}
        onChange={handleTabChange}
        size="small"
        items={tabItems}
      />

      <Form form={form} className="auth-form-body" layout="vertical" requiredMark={false}>
        {activeTab === 'sms' ? (
          <>
            <Form.Item
              name="phone"
              label="手机号"
              rules={[
                { required: true, message: '请填写手机号' },
                { pattern: PHONE_RE, message: '请填写有效的手机号' },
              ]}
            >
              <Input
                placeholder="请输入手机号"
                maxLength={11}
                autoComplete="tel"
              />
            </Form.Item>

            <CaptchaField form={form} />

            <Form.Item
              name="smsCode"
              label="短信验证码"
              rules={[{ required: true, message: '请填写短信验证码' }]}
            >
              <Input
                placeholder="6 位验证码"
                maxLength={6}
                className='auth-code-box'
                addonAfter={
                  <Button
                    className="auth-code-action"
                    type="default"
                    disabled={smsCountdown > 0}
                    onClick={() => void handleSendSms()}
                  >
                    {smsCountdown > 0 ? `${smsCountdown}s 后重试` : '发送验证码'}
                  </Button>
                }
              />
            </Form.Item>

            <div className="auth-sms-hint">首次使用手机号登录将自动完成注册</div>
          </>
        ) : (
          <>
            <Form.Item
              name="account"
              label={activeTab === 'password' ? '账号' : '邮箱'}
              rules={[
                {
                  required: true,
                  validator: validateAccount(activeTab !== 'password'),
                },
              ]}
            >
              <AutoComplete
                placeholder={
                  activeTab === 'password'
                    ? '邮箱或手机号'
                    : 'example@spark.com'
                }
                options={accountSuggestions}
                allowClear
                {...({ autoComplete: 'email' } as any)}
                filterOption={(inputValue, option) => {
                  const v = (option as { value?: string })?.value ?? ''
                  return v.toLowerCase().includes(inputValue.toLowerCase())
                }}
              />
            </Form.Item>

            {activeTab === 'password' && (
              <Form.Item
                name="password"
                label="密码"
                rules={[{ required: true, min: 6, message: '至少 6 位' }]}
              >
                <Input.Password placeholder="请输入密码" autoComplete="current-password" />
              </Form.Item>
            )}

            <CaptchaField form={form} />

            {activeTab === 'code' && (
              <Form.Item
                name="emailCode"
                label="邮箱验证码"
                rules={[{ required: true, message: '请填写邮箱验证码' }]}
              >
                <Input
                  placeholder="6 位验证码"
                  maxLength={6}
                className='auth-code-box'
                  addonAfter={
                    <Button
                      className="auth-code-action"
                      type="default"
                      disabled={countdown > 0}
                      onClick={() => void handleSendCode()}
                    >
                      {countdown > 0 ? `${countdown}s 后重试` : '发送验证码'}
                    </Button>
                  }
                />
              </Form.Item>
            )}
          </>
        )}

        <Form.Item>
          <Button type="primary" block loading={submitting} onClick={handleSubmit}>
            {activeTab === 'sms' ? '登录' : activeTab === 'password' ? '登录' : '验证码登录'}
          </Button>
        </Form.Item>
      </Form>
    </div>
  )
}

