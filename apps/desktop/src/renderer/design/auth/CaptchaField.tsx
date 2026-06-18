/**
 * CaptchaField — 图片验证码字段
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Button, Form, Input, Spin } from 'antd'
import { useAuth } from './AuthContext'
import { Icons } from '../Icons'

interface CaptchaFieldProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any
}

export function CaptchaField({ form }: CaptchaFieldProps): React.ReactElement {
  const auth = useAuth()
  const [svg, setSvg] = useState('')
  const [loading, setLoading] = useState(false)
  const isDataImage = svg.startsWith('data:image')

  const stretchSvg = useCallback((raw: string): string => {
    if (!raw) return raw
    return raw
      .replace(/(<svg\b[^>]*?)\s+width\s*=\s*"[^"]*"/i, '$1')
      .replace(/(<svg\b[^>]*?)\s+height\s*=\s*"[^"]*"/i, '$1')
      .replace(/(<svg\b[^>]*?)\s+width\s*=\s*'[^']*'/i, '$1')
      .replace(/(<svg\b[^>]*?)\s+height\s*=\s*'[^']*'/i, '$1')
  }, [])

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      const res = await auth.fetchCaptcha(true)
      form.setFieldValue('captchaId', res.id)
      setSvg(stretchSvg(res.svg))
    } catch {
      setSvg('')
    } finally {
      setLoading(false)
    }
  }, [auth, form, stretchSvg])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <>
      <Form.Item name="captchaId" className="auth-hidden-field">
        <Input type="hidden" />
      </Form.Item>
      <Form.Item
        name="captchaText"
        label="图片验证码"
        rules={[{ required: true, message: '请填写图片验证码' }]}
      >
        <Input
          placeholder="请输入验证码"
          maxLength={8}
          className='captcha-btn-box'
          addonAfter={
            <div
              className="captcha-svg-btn"
              style={{
                cursor: loading ? 'not-allowed': 'pointer',
              }}
              onClick={() => loading ? null : void refresh()}
              aria-label="刷新图片验证码"
            >
              {loading ? (
                <Spin size="small" />
              ) : svg ? (
                <span className="captcha-visual">
                  {isDataImage ? (
                    <img className="captcha-image" src={svg} alt="图片验证码" />
                  ) : (
                    <span
                      className="captcha-inline-svg"
                      dangerouslySetInnerHTML={{ __html: svg }}
                    />
                  )}
                </span>
              ) : (
                <Icons.Refresh size={14} />
              )}
            </div>
          }
        />
      </Form.Item>
    </>
  )
}
