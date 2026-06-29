/**
 * CaptchaField — 图片验证码字段
 *
 * 自带能力：
 *   - 挂载时拉取一次验证码图片
 *   - 点击图片可手动刷新
 *   - 当 captchaText 字段被设置错误（后端返回「图片验证码已过期 / 验证码错误」等）时，
 *     自动重新拉取图片，避免用户对着过期的同一张图反复试错
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Form, Input, Spin } from 'antd'
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

  // 验证码字段报错时自动换图。用 useRef 记录上一次错误内容，只在错误真正变化时触发一次刷新。
  const lastErrorRef = useRef<string>('')
  const maybeRefreshOnError = useCallback(
    (errors: readonly string[]) => {
      const first = errors[0] ?? ''
      if (first && first !== lastErrorRef.current) {
        lastErrorRef.current = first
        void refresh()
      } else if (!first) {
        // 错误被清空（用户重新输入）：重置哨兵，下次报错可再次触发
        lastErrorRef.current = ''
      }
    },
    [refresh],
  )

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
      {/* 哨兵 Form.Item：与上方共享 name="captchaText"，noStyle 不渲染标签/错误。
          antd v6 的 render-prop children 签名为 (form) => ReactNode，
          在该字段状态（值/错误）变化时重新执行；据此读取最新 errors 触发自动刷新
          （已用 lastErrorRef 去重）。返回 null 不占 UI。 */}
      <Form.Item name="captchaText" noStyle>
        {() => {
          maybeRefreshOnError(form.getFieldError('captchaText'))
          return null
        }}
      </Form.Item>
    </>
  )
}
