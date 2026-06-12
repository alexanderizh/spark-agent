/**
 * LoginForm — 邮箱密码登录 + 邮箱验证码登录
 *
 * 字段：
 *   - 账号（邮箱）
 *   - 图片验证码（password 模式）
 *   - 密码（password 模式）
 *   - 邮箱验证码（code 模式；点击"发送验证码"按钮触发 send-code）
 *
 * 提交流程：
 *   - password 模式：先校验 captcha，调 login(loginMode=password)
 *   - code 模式：先调 send-code，调 login(loginMode=code)
 */

import React, { useEffect, useMemo, useState } from 'react'
import { AutoComplete, Button, Form, Input, Tabs } from '@arco-design/web-react'
import TabPane from '@arco-design/web-react/lib/Tabs/tab-pane'
import { useAuth } from './AuthContext'
import { useToast } from '../components/Toast'
import { CaptchaField } from './CaptchaField'
import { getRecentEmails, rememberEmail } from './recentEmails'

const F = Form

export function LoginForm(): React.ReactElement {
  const auth = useAuth()
  const { toast } = useToast()
  const [form] = F.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [tab, setTab] = useState<'password' | 'code'>('password')
  const [countdown, setCountdown] = useState(0)
  // 联想邮箱：组件挂载时同步读一次即可，不需要响应外部状态变化
  const [recentEmails, setRecentEmails] = useState<string[]>(() => getRecentEmails())

  // 倒计时
  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const handleSendCode = async (): Promise<void> => {
    try {
      const values = await form.validate(['account', 'captchaId', 'captchaText'])
      if (!values.account) {
        toast.error('请填写邮箱')
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
      const msg = (e as Error).message
      if (msg && !msg.includes('captcha')) toast.error(msg)
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
      // 登录成功：记住邮箱，下次进入可联想
      rememberEmail(values.account)
      setRecentEmails(getRecentEmails())
      toast.success('登录成功')
      void result
    } catch (e) {
      toast.error((e as Error).message || '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * 邮箱联想：根据当前 input 过滤 recent emails。
   * Arco AutoComplete 默认对 data 做 startsWith 过滤；我们传 `strict:false`
   * 让它大小写不敏感，同时把列表限定在最近使用过的邮箱里（不暴露任何不在历史的值）。
   */
  const accountSuggestions = useMemo(() => {
    return recentEmails.map((email) => ({
      value: email,
      name: email,
    }))
  }, [recentEmails])

  return (
    <div className="auth-form">
      <div className="auth-section-intro">
        <h3 className="auth-form-title">欢迎回来</h3>
      </div>

      <Tabs
        className="auth-login-tabs"
        activeTab={tab}
        onChange={(k) => setTab(k as 'password' | 'code')}
        type="rounded"
      >
        <TabPane key="password" title="密码登录" />
        <TabPane key="code" title="邮箱验证码" />
      </Tabs>

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

          {tab === 'password' && (
            <>
              <CaptchaField form={form} />
              <Form.Item
                field="password"
                label="密码"
                rules={[{ required: true, minLength: 6, message: '至少 6 位' }]}
              >
                <Input.Password placeholder="请输入密码" autoComplete="current-password" />
              </Form.Item>
            </>
          )}

          {tab === 'code' && (
            <>
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
            </>
          )}

          <Form.Item>
            <Button type="primary" long loading={submitting} onClick={handleSubmit}>
              {tab === 'password' ? '登录' : '验证码登录'}
            </Button>
          </Form.Item>
        </F>
      </div>
    </div>
  )
}
