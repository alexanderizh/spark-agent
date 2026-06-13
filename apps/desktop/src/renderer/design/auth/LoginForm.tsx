/**
 * LoginForm — 邮箱密码登录 + 邮箱验证码登录
 *
 * 字段：
 *   - 账号（邮箱）
 *   - 图片验证码
 *   - 密码（password 模式） / 邮箱验证码（code 模式）
 *
 * 提交流程：
 *   - password 模式：调 login(loginMode=password)
 *   - code 模式：调 send-code 后调 login(loginMode=code)
 *
 * 错误回显：
 *   - 字段级错误（如"密码错误"、"验证码失效"）→ form.setFields，Arco 原生红色 inline
 *   - 网络错误、服务端兜底错误 → toast
 */

import React, { useEffect, useMemo, useState } from 'react'
import { AutoComplete, Button, Form, Input, Tabs } from '@arco-design/web-react'
import TabPane from '@arco-design/web-react/lib/Tabs/tab-pane'
import { useAuth } from './AuthContext'
import { useToast } from '../components/Toast'
import { CaptchaField } from './CaptchaField'
import { getRecentEmails, rememberEmail } from './recentEmails'
import { matchFieldError } from './errorMapping'

const F = Form

type LoginTab = 'password' | 'code'

export function LoginForm(): React.ReactElement {
  const auth = useAuth()
  const { toast } = useToast()
  const [form] = F.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [tab, setTab] = useState<LoginTab>('password')
  const [countdown, setCountdown] = useState(0)
  const [recentEmails, setRecentEmails] = useState<string[]>(() => getRecentEmails())

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  /** 切换登录方式时，清掉另一个分支遗留的字段错误（避免显示错位）*/
  const handleTabChange = (key: string): void => {
    setTab(key as LoginTab)
    form.clearFields(['password', 'emailCode'])
  }

  const refreshCaptcha = (): void => {
    // 服务器拒绝了 captcha 后，CaptchaField 自身刷新按钮也会拉新；这里走同样的逻辑
    void form.setFieldValue('captchaText', '')
  }

  const handleSendCode = async (): Promise<void> => {
    try {
      const values = await form.validate(['account', 'captchaId', 'captchaText'])
      if (!values.account) {
        form.setFields({ account: { error: { message: '请填写邮箱' } } })
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
        form.setFields({ [target]: { error: { message: msg } } })
        if (target === 'captchaText') refreshCaptcha()
      } else if (!msg.includes('captcha')) {
        toast.error(msg)
      }
    }
  }

  const handleSubmit = async (): Promise<void> => {
    try {
      setSubmitting(true)
      const values = await form.validate()

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
      // 401 字段错误（密码/验证码/captcha）回填到 inline，其它走 toast
      const candidates: Array<'account' | 'password' | 'captchaText' | 'emailCode'> =
        tab === 'password'
          ? ['password', 'captchaText', 'account']
          : ['emailCode', 'account']
      const target = matchFieldError(msg, candidates)
      if (target) {
        form.setFields({ [target]: { error: { message: msg } } })
        if (target === 'captchaText') refreshCaptcha()
      } else {
        toast.error(msg)
      }
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
      <Tabs
        className="auth-login-tabs"
        activeTab={tab}
        onChange={handleTabChange}
        type="line"
        size="small"
      >
        <TabPane key="password" title="密码登录" />
        <TabPane key="code" title="邮箱验证码" />
      </Tabs>

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

        {tab === 'password' && (
          <Form.Item
            field="password"
            label="密码"
            rules={[{ required: true, minLength: 6, message: '至少 6 位' }]}
          >
            <Input.Password placeholder="请输入密码" autoComplete="current-password" />
          </Form.Item>
        )}

        <CaptchaField form={form} />

        {tab === 'code' && (
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
        )}

        <Form.Item>
          <Button type="primary" long loading={submitting} onClick={handleSubmit}>
            {tab === 'password' ? '登录' : '验证码登录'}
          </Button>
        </Form.Item>
      </F>
    </div>
  )
}
