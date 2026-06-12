/**
 * RegisterForm — 邮箱注册
 *
 * 流程：
 *   1. 填写邮箱 + 图片验证码 → 发送邮箱验证码
 *   2. 填写密码 + 邮箱验证码 → 提交注册
 *   3. 注册成功后自动登录（后端直接返回 session）
 */

import React, { useEffect, useMemo, useState } from 'react'
import { AutoComplete, Button, Form, Input } from '@arco-design/web-react'
import { useAuth } from './AuthContext'
import { useToast } from '../components/Toast'
import { CaptchaField } from './CaptchaField'
import { getRecentEmails, rememberEmail } from './recentEmails'

const F = Form

export function RegisterForm(): React.ReactElement {
  const auth = useAuth()
  const { toast } = useToast()
  const [form] = F.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [recentEmails, setRecentEmails] = useState<string[]>(() => getRecentEmails())

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const handleSendCode = async (): Promise<void> => {
    try {
      const values = await form.validate(['account', 'captchaId', 'captchaText'])
      await auth.sendCode({
        account: values.account,
        type: 'register',
        captchaId: values.captchaId,
        captchaText: values.captchaText,
      })
      toast.success('验证码已发送到邮箱')
      setCountdown(60)
    } catch (e) {
      const msg = (e as Error).message
      if (msg && !msg.includes('captcha')) toast.error(msg)
    }
  }

  const handleSubmit = async (): Promise<void> => {
    try {
      setSubmitting(true)
      const values = await form.validate()
      await auth.register({
        account: values.account,
        password: values.password,
        code: values.emailCode,
        ...(values.inviteCode ? { inviteCode: values.inviteCode } : {}),
      })
      // 注册即登录：把新邮箱加入历史，下次登录可联想
      rememberEmail(values.account)
      setRecentEmails(getRecentEmails())
      toast.success('注册成功，已自动登录')
    } catch (e) {
      toast.error((e as Error).message || '注册失败')
    } finally {
      setSubmitting(false)
    }
  }

  const accountSuggestions = useMemo(
    () => recentEmails.map((email) => ({ value: email, name: email })),
    [recentEmails],
  )

  return (
    <div className="auth-form">
      <div className="auth-section-intro">
        <h3 className="auth-form-title">注册 Spark 账号</h3>
      </div>

      <div className="auth-subflow-panel">
        <F form={form} className="auth-form-body" layout="vertical" requiredSymbol={false}>
          <Form.Item
            field="account"
            label="邮箱"
            rules={[{ required: true, type: 'email', message: '请填写有效邮箱' }]}
          >
            <AutoComplete
              placeholder="example@spark.com"
              data={accountSuggestions}
              strict={false}
              allowClear
              inputProps={{ autoComplete: 'email' }}
              triggerProps={{ autoAlignPopupWidth: true }}
              filterOption={(inputValue, option) => {
                const v = (option as { value?: string }).value ?? ''
                return v.toLowerCase().includes(inputValue.toLowerCase())
              }}
            />
          </Form.Item>

          <CaptchaField form={form} />

          <Form.Item
            field="emailCode"
            label="邮箱验证码"
            rules={[{ required: true, message: '请填写邮箱验证码' }]}
          >
            <Input
              placeholder="6 位验证码"
              maxLength={6}
              addAfter={
                <Button
                  className="auth-code-action"
                  type="secondary"
                  disabled={countdown > 0}
                  onClick={() => void handleSendCode()}
                >
                  {countdown > 0 ? `${countdown}s 后重试` : '发送验证码'}
                </Button>
              }
            />
          </Form.Item>

          <Form.Item
            field="password"
            label="设置密码"
            rules={[{ required: true, minLength: 6, message: '至少 6 位' }]}
          >
            <Input.Password placeholder="请设置登录密码" autoComplete="new-password" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" long loading={submitting} onClick={handleSubmit}>
              注册
            </Button>
          </Form.Item>
        </F>
      </div>
    </div>
  )
}
