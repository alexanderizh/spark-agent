/**
 * WechatBindPanel — 微信扫码后绑定邮箱（首次扫码用户）
 *
 * 流程：
 *   1. 用户扫码后 edu-server 发现该微信号未绑定账号 → 返回 bindSession + status=pending_bind
 *   2. 前端跳转到这里，用户填写邮箱 + 图片验证码
 *   3. 调 wechat:bind-email-send-code 发验证码
 *   4. 用户输入验证码，调 wechat:bind-email 完成绑定 + 自动登录
 */

import React, { useEffect, useState } from 'react'
import { Button, Form, Input } from '@arco-design/web-react'
import { useAuth } from './AuthContext'
import { useToast } from '../components/Toast'
import { CaptchaField } from './CaptchaField'

const F = Form

interface WechatBindPanelProps {
  bindSession: string
}

export function WechatBindPanel({ bindSession }: WechatBindPanelProps): React.ReactElement {
  const auth = useAuth()
  const { toast } = useToast()
  const [form] = F.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const handleSendCode = async (): Promise<void> => {
    try {
      const values = await form.validate(['account', 'captchaId', 'captchaText'])
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
      const values = await form.validate()
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

        <F form={form} layout="vertical" requiredSymbol={false}>
        <Form.Item
          field="account"
          label="邮箱"
          rules={[{ required: true, type: 'email', message: '请填写有效邮箱' }]}
        >
          <Input placeholder="example@spark.com" />
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
          <Button type="primary" long loading={submitting} onClick={handleSubmit}>
            绑定并登录
          </Button>
        </Form.Item>

        <div className="auth-form-footer">
          <Button type="text" onClick={() => auth.setFlow('wechat')}>
            返回重新扫码
          </Button>
        </div>
        </F>
      </div>
    </div>
  )
}
