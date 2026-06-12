/**
 * CaptchaField — 图片验证码字段
 *
 * 后端返回 raw SVG 或 data:image/svg+xml;base64，两种都兼容。
 * 字段：
 *   - captchaId（隐藏，记录本次验证码 ID）
 *   - captchaText（用户输入）
 *   - 右侧"换一张"按钮重新拉取
 *
 * 撑满盒子：
 *   - 后端 SVG 通常带 width/height（如 `<svg width="80" height="30">`），
 *     这些 presentation attributes 会盖过 CSS 的 100%，让图片看起来很小。
 *   - 这里在渲染前正则去掉 svg 标签上的 width / height，让 CSS 完全控制尺寸。
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Button, Form, Input, Spin } from '@arco-design/web-react'
import { useAuth } from './AuthContext'
import { Icons } from '../Icons'

// CaptchaField 只用到 setFieldValue 和 validate，这里用宽类型避免 Arco 的
// KeyType 泛型推导出 unknown（Form.useForm 默认 any/string|number|symbol）。
interface CaptchaFieldProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any
}

export function CaptchaField({ form }: CaptchaFieldProps): React.ReactElement {
  const auth = useAuth()
  const [svg, setSvg] = useState('')
  const [loading, setLoading] = useState(false)
  const isDataImage = svg.startsWith('data:image')

  /**
   * 让 SVG 真正撑满盒子：去掉根 svg 标签上的 width / height 属性。
   * SVG 的这些属性优先级高于 CSS 100%，是导致图片看起来很小的根因。
   */
  const stretchSvg = useCallback((raw: string): string => {
    if (!raw) return raw
    return raw
      .replace(/(<svg\b[^>]*?)\s+width\s*=\s*"[^"]*"/i, '$1')
      .replace(/(<svg\b[^>]*?)\s+height\s*=\s*"[^"]*"/i, '$1')
      // 兼容 width='x' / width=x 这类单引号 / 无引号写法
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

  // 首次挂载自动拉一次
  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <>
      <Form.Item field="captchaId" className="auth-hidden-field">
        <Input type="hidden" />
      </Form.Item>
      <Form.Item
        field="captchaText"
        label="图片验证码"
        rules={[{ required: true, message: '请填写图片验证码' }]}
      >
        <Input
          placeholder="请输入验证码"
          maxLength={8}
          addAfter={
            <Button
              className="captcha-svg-btn"
              type="secondary"
              onClick={() => void refresh()}
              disabled={loading}
              aria-label="刷新图片验证码"
            >
              {loading ? (
                <Spin size={12} />
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
            </Button>
          }
        />
      </Form.Item>
    </>
  )
}
