/**
 * RegisterForm — 邮箱注册
 */

import React, { useEffect, useMemo, useState } from 'react'
import { AutoComplete, Button, Form, Input } from 'antd'
import { useAuth } from './AuthContext'
import { useToast } from '../components/Toast'
import { CaptchaField } from './CaptchaField'
import { getRecentEmails, rememberEmail } from './recentEmails'
import { matchFieldError } from './errorMapping'

export function RegisterForm(): React.ReactElement {
  const auth = useAuth()
  const { toast } = useToast()
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [recentEmails, setRecentEmails] = useState<string[]>(() => getRecentEmails())

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

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
        if (target === 'captchaText') form.setFieldValue('captchaText', '')
      } else if (!msg.includes('captcha')) {
        toast.error(msg)
      }
    }
  }

  const handleSubmit = async (): Promise<void> => {
    try {
      setSubmitting(true)
      const values = await form.validateFields()
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
      const target = matchFieldError(msg, ['emailCode', 'password', 'captchaText', 'account'])
      if (target) {
        setFieldError(target, msg)
        if (target === 'captchaText') form.setFieldValue('captchaText', '')
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
      <div className="auth-section-intro">
        <h3 className="auth-form-title">创建你的账号</h3>
      </div>

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

        <CaptchaField form={form} />

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

        <Form.Item
          name="password"
          label="设置密码"
          rules={[{ required: true, min: 6, message: '至少 6 位' }]}
        >
          <Input.Password placeholder="请设置登录密码" autoComplete="new-password" />
        </Form.Item>

        <Form.Item>
          <Button type="primary" block loading={submitting} onClick={handleSubmit}>
            注册并登录
          </Button>
        </Form.Item>
      </Form>
    </div>
  )
}
