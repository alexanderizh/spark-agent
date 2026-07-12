/**
 * CaptchaField — 图片验证码字段
 *
 * 自带能力：
 *   - 挂载时拉取一次验证码图片
 *   - 点击图片可手动刷新
 *   - 通过 forwardRef 暴露 refresh()，供登录/注册失败时由父组件显式触发换图
 *
 * 注：验证码错误时的换图由父组件（LoginForm / RegisterForm）在收到后端
 *     「图片验证码错误」后显式调用 ref.refresh() 触发；这里不再依赖
 *     字段 errors 文本去驱动刷新，避免「挂 errors 后又改字段值导致 antd
 *     抹掉错误显示」的竞态（旧实现里 refreshCaptcha 会清空 captchaText 值，
 *     把刚挂上的红字一起抹掉，表现为「没报错 + 不换图」）。
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { Form, Input, Spin } from 'antd'
import { useAuth } from './AuthContext'
import { Icons } from '../Icons'

interface CaptchaFieldProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any
  /** 禁止用户手动刷新；父表单发送验证码期间使用。 */
  disabled?: boolean
}

export interface CaptchaFieldHandle {
  /** 重新拉取一张验证码图片（同时更新 captchaId）。 */
  refresh: () => Promise<void>
}

export const CaptchaField = forwardRef<CaptchaFieldHandle, CaptchaFieldProps>(
  function CaptchaField({ form, disabled = false }, ref): React.ReactElement {
    const auth = useAuth()
    const [svg, setSvg] = useState('')
    const [loading, setLoading] = useState(false)
    const refreshingRef = useRef(false)
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
      if (refreshingRef.current) return
      refreshingRef.current = true
      try {
        setLoading(true)
        const res = await auth.fetchCaptcha(true)
        form.setFieldValue('captchaId', res.id)
        setSvg(stretchSvg(res.svg))
      } catch {
        setSvg('')
      } finally {
        refreshingRef.current = false
        setLoading(false)
      }
    }, [auth, form, stretchSvg])

    useImperativeHandle(ref, () => ({ refresh }), [refresh])

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
          className="auth-field-row"
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
                  cursor: loading || disabled ? 'not-allowed': 'pointer',
                }}
                onClick={() => {
                  if (!disabled) void refresh()
                }}
                aria-disabled={loading || disabled}
                aria-label="刷新图片验证码"
              >
                {loading ? (
                  <Spin size="middle" />
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
  },
)
