/**
 * RegisterForm — 邮箱注册 / 手机号注册
 *
 * 手机号注册复用 /auth/login-sms（短信登录即自动注册），与服务端、edu-web 一致。
 * 手机号入口受 authCapabilities.smsEnabled 控制。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AutoComplete, Button, Form, Input, Segmented } from 'antd'
import { useAuth } from './AuthContext'
import { useToast } from '../components/Toast'
import { CaptchaField, type CaptchaFieldHandle } from './CaptchaField'
import { getRecentEmails, rememberEmail } from './recentEmails'
import { matchFieldError } from './errorMapping'

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
      const candidates: Array<'account' | 'emailCode' | 'password' | 'captchaText' | 'phone' | 'smsCode'> =
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
      <div className="auth-section-intro">
        <h3 className="auth-form-title">创建你的账号</h3>
      </div>

      {smsEnabled && (
        <Segmented
          className="auth-mode-segmented"
          block
          value={activeMode}
          onChange={(v) => handleModeChange(v as RegisterMode)}
          options={[
            { label: '邮箱注册', value: 'email' },
            { label: '手机号注册', value: 'phone' },
          ]}
        />
      )}

      <Form
        form={form}
        className="auth-form-body"
        layout="vertical"
        requiredMark={false}
        onFinish={handleSubmit}
      >
        {activeMode === 'phone' ? (
          <>
            <Form.Item
              name="phone"
              label="手机号"
              rules={[
                { required: true, message: '请填写手机号' },
                { pattern: PHONE_RE, message: '请填写有效的手机号' },
              ]}
            >
              <Input placeholder="请输入手机号" maxLength={11} autoComplete="tel" />
            </Form.Item>

            <CaptchaField ref={captchaRef} form={form} />

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
                    type="text"
                    disabled={countdown > 0}
                    onClick={() => void handleSendSms()}
                  >
                    {countdown > 0 ? `${countdown}s 后重试` : '发送验证码'}
                  </Button>
                }
              />
            </Form.Item>

            <div className="auth-sms-hint">输入手机号验证后即完成注册</div>
          </>
        ) : (
          <>
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

            <CaptchaField ref={captchaRef} form={form} />

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
                    type="text"
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
          </>
        )}

        <Form.Item>
          <Button type="primary" block htmlType="submit" loading={submitting}>
            注册并登录
          </Button>
        </Form.Item>
      </Form>
    </div>
  )
}

