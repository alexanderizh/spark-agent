/**
 * WechatQrPanel — 微信扫码登录
 */

import React, { useEffect, useRef, useState } from 'react'
import { Button } from 'antd'
import { QRCodeSVG } from '@rc-component/qrcode'
import { useAuth } from './AuthContext'
import { useToast } from '../components/Toast'
import { Icons } from '../Icons'

type PollStatus = 'pending' | 'success' | 'pending_bind' | 'error'

interface PollResult {
  status: PollStatus
  token?: string
  refreshToken?: string
  userId?: string
  isNew?: boolean
  bindSession?: string
  message?: string
}

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 180_000 // 3 分钟超时

export function WechatQrPanel(): React.ReactElement {
  const auth = useAuth()
  const { toast } = useToast()
  const [qrValue, setQrValue] = useState('')
  const [state, setState] = useState('')
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<PollStatus>('pending')
  const [message, setMessage] = useState<string>('')
  const [elapsed, setElapsed] = useState(0)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setLoading(true)
        const res = await auth.wechatQr()
        if (cancelled) return
        setState(res.state)
        setQrValue(res.qrUrl || res.state)
        setStatus('pending')
        setMessage('请使用微信扫描二维码登录')
        setElapsed(0)
      } catch (e) {
        if (!cancelled) {
          setStatus('error')
          setMessage((e as Error).message || '获取二维码失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      stopRef.current = true
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!state || status !== 'pending') return

    const tick = async () => {
      if (stopRef.current) return
      if (elapsed > POLL_TIMEOUT_MS) {
        setStatus('error')
        setMessage('二维码已过期，请刷新重试')
        return
      }
      try {
        const res: PollResult = await auth.wechatPoll(state)
        if (stopRef.current) return
        if (res.status === 'success') {
          const me = await auth.refreshMe()
          if (me) {
            toast.success('微信登录成功')
            stopRef.current = true
          } else {
            setStatus('error')
            setMessage('登录成功但获取用户信息失败')
          }
        } else if (res.status === 'pending_bind') {
          auth.setBindSession(res.bindSession ?? null)
          auth.setFlow('wechat-bind')
          stopRef.current = true
        } else if (res.status === 'error') {
          setStatus('error')
          setMessage(res.message ?? '扫码失败')
        } else {
          setElapsed((e) => e + POLL_INTERVAL_MS)
          pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS)
        }
      } catch (e) {
        if (!stopRef.current) {
          setStatus('error')
          setMessage((e as Error).message || '扫码失败')
        }
      }
    }

    pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS)
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [state, status, elapsed, auth, toast])

  const refresh = async (): Promise<void> => {
    stopRef.current = false
    setElapsed(0)
    setStatus('pending')
    setMessage('正在加载二维码…')
    setLoading(true)
    try {
      const res = await auth.wechatQr()
      setState(res.state)
      setQrValue(res.qrUrl || res.state)
      setMessage('请使用微信扫描二维码登录')
    } catch (e) {
      setStatus('error')
      setMessage((e as Error).message || '获取二维码失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-wechat">
      <div className="auth-section-intro auth-section-intro--center">
        <h3 className="auth-form-title">微信扫码登录</h3>
      </div>

      <div className="auth-subflow-panel auth-subflow-panel--wechat">
        <div className="auth-wechat-qr">
          {loading ? (
            <div className="auth-wechat-loading">
              <Icons.Refresh size={28} className="auth-spin" />
            </div>
          ) : status === 'pending' && qrValue ? (
            <QRCodeSVG value={qrValue} size={200} level="M" includeMargin />
          ) : status === 'error' ? (
            <div className="auth-wechat-error">
              <Icons.AlertTriangle size={28} />
            </div>
          ) : null}
        </div>
      </div>

      <div className="auth-wechat-status">
        {status === 'error' && (
          <>
            <p className="auth-wechat-error-text">{message}</p>
            <Button className="auth-wechat-refresh" type="text" onClick={() => void refresh()}>
              刷新二维码
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
