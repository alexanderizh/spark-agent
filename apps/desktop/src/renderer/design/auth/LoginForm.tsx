/**
 * LoginForm — 邮箱密码登录 + 邮箱验证码登录
 *
 * 字段：
 *   - 账号（邮箱）
 *   - 图片验证码
 *   - 密码（password 模式） / 邮箱验证码（code 模式）
 */

import React, { useEffect, useMemo, useState } from 'react'
import { AutoComplete, Button, Form, Input, Tabs } from 'antd'
import { useAuth } from './AuthContext'
import { useToast } from '../components/Toast'
import { CaptchaField } from './CaptchaField'
import { getRecentEmails, rememberEmail } from './recentEmails'
import { matchFieldError } from './errorMapping'

type LoginTab = 'password' | 'code'

export function LoginForm(): React.ReactElement {
  const auth = useAuth()
  const { toast } = useToast()
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [tab, setTab] = useState<LoginTab>('password')
  const [countdown, setCountdown] = useState(0)
  const [recentEmails, setRecentEmails] = useState<string[]>(() => getRecentEmails())

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const handleTabChange = (key: string): void => {
    setTab(key as LoginTab)
    form.resetFields(['password', 'emailCode'])
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

  const handleSubmit = async (): Promise<void> => {
    try {
      setSubmitting(true)
      const values = await form.validateFields()

      let result
      if (tab === 'password') {
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
      const candidates: Array<'account' | 'password' | 'captchaText' | 'emailCode'> =
        tab === 'password'
          ? ['password', 'captchaText', 'account']
          : ['emailCode', 'account']
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

  return (
    <div className="auth-form">
      <Tabs
        className="auth-login-tabs"
        activeKey={tab}
        onChange={handleTabChange}
        size="small"
        items={[
          { key: 'password', label: '密码登录' },
          { key: 'code', label: '邮箱验证码' },
        ]}
      />

      <Form form={form} className="auth-form-body" layout="vertical" requiredMark={false}>
        <Form.Item
          name="account"
          label="邮箱"
          rules={[{ required: true, type: 'email', message: '请填写有效邮箱' }]}
        >
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
        </Form.Item>

        {tab === 'password' && (
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, min: 6, message: '至少 6 位' }]}
          >
            <Input.Password placeholder="请输入密码" autoComplete="current-password" />
          </Form.Item>
        )}

        <CaptchaField form={form} />

        {tab === 'code' && (
          <Form.Item
            name="emailCode"
            label="邮箱验证码"
            rules={[{ required: true, message: '请填写邮箱验证码' }]}
          >
            <Input
              placeholder="6 位验证码"
              maxLength={6}
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

        <Form.Item>
          <Button type="primary" block loading={submitting} onClick={handleSubmit}>
            {tab === 'password' ? '登录' : '验证码登录'}
          </Button>
        </Form.Item>
      </Form>
    </div>
  )
}
