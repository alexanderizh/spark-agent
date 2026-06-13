/**
 * WechatBindPanel — 微信扫码后绑定邮箱
 */

import React, { useEffect, useState } from 'react'
import { Button, Form, Input } from 'antd'
import { useAuth } from './AuthContext'
import { useToast } from '../components/Toast'
import { CaptchaField } from './CaptchaField'

interface WechatBindPanelProps {
  bindSession: string
}

export function WechatBindPanel({ bindSession }: WechatBindPanelProps): React.ReactElement {
  const auth = useAuth()
  const { toast } = useToast()
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const handleSendCode = async (): Promise<void> => {
    try {
      const values = await form.validateFields(['account', 'captchaId', 'captchaText'])
      await auth.wechatBindEmailSendCode({
        bindSession,
        email: values.account,
        captchaId: values.captchaId,
        captchaText: values.captchaText,
      })
      toast.success('验证码已发送')
      setCountdown(60)
    } catch (e) {
      const msg = (e as Error).message
      if (msg && !msg.includes('captcha')) toast.error(msg)
    }
  }

  const handleSubmit = async (): Promise<void> => {
    try {
      setSubmitting(true)
      const values = await form.validateFields()
      await auth.wechatBindEmail({
        bindSession,
        code: values.emailCode,
      })
      toast.success('绑定成功，已登录')
    } catch (e) {
      toast.error((e as Error).message || '绑定失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-form">
      <div className="auth-section-intro">
        <div className="auth-section-kicker">Wechat Binding</div>
        <h3 className="auth-form-title">绑定邮箱完成登录</h3>
        <p className="auth-form-subtitle">首次扫码登录需要补充一个邮箱账号，用来创建并绑定你的 Spark 身份。</p>
      </div>

      <div className="auth-subflow-panel">
        <div className="auth-subflow-head">
          <div className="auth-subflow-title">补充邮箱信息</div>
          <div className="auth-subflow-desc">完成邮箱验证后，会自动把当前微信身份绑定到这个 Spark 账号。</div>
        </div>

        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            name="account"
            label="邮箱"
            rules={[{ required: true, type: 'email', message: '请填写有效邮箱' }]}
          >
            <Input placeholder="example@spark.com" />
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
                  size="small"
                  disabled={countdown > 0}
                  onClick={() => void handleSendCode()}
                >
                  {countdown > 0 ? `${countdown}s 后重试` : '发送验证码'}
                </Button>
              }
            />
          </Form.Item>

          <Form.Item>
            <Button type="primary" block loading={submitting} onClick={handleSubmit}>
              绑定并登录
            </Button>
          </Form.Item>

          <div className="auth-form-footer">
            <Button type="text" onClick={() => auth.setFlow('wechat')}>
              返回重新扫码
            </Button>
          </div>
        </Form>
      </div>
    </div>
  )
}
