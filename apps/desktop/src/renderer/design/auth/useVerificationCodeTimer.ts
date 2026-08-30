import { useCallback, useEffect, useState } from 'react'

const RESEND_COOLDOWN_SECONDS = 60
const DEFAULT_CODE_EXPIRE_SECONDS = 300
const MAX_CODE_EXPIRE_SECONDS = 3600

function normalizeExpireSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CODE_EXPIRE_SECONDS
  return Math.min(Math.max(Math.floor(value), 0), MAX_CODE_EXPIRE_SECONDS)
}

/**
 * 验证码计时状态。
 *
 * 重发冷却和验证码有效期是两个不同概念：前者固定 60 秒，后者使用服务端
 * 返回的 expire_in。使用绝对截止时间而不是逐秒递减，避免应用休眠后倒计时漂移。
 */
export function useVerificationCodeTimer(): {
  resendCountdown: number
  isCodeActive: boolean
  isExpired: boolean
  isActiveNow: () => boolean
  start: (expireIn: number, requestedAt?: number) => void
  reset: () => void
} {
  const [resendAvailableAt, setResendAvailableAt] = useState(0)
  const [expiresAt, setExpiresAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const activeUntil = Math.max(resendAvailableAt, expiresAt)
    if (activeUntil <= Date.now()) return

    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= activeUntil) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt, resendAvailableAt])

  const start = useCallback((expireIn: number, requestedAt?: number) => {
    const current = Date.now()
    const startedAt =
      typeof requestedAt === 'number' && Number.isFinite(requestedAt)
        ? Math.min(requestedAt, current)
        : current
    setNow(current)
    setResendAvailableAt(startedAt + RESEND_COOLDOWN_SECONDS * 1000)
    setExpiresAt(startedAt + normalizeExpireSeconds(expireIn) * 1000)
  }, [])

  const reset = useCallback(() => {
    setResendAvailableAt(0)
    setExpiresAt(0)
    setNow(Date.now())
  }, [])

  const isActiveNow = useCallback(() => expiresAt > Date.now(), [expiresAt])

  return {
    resendCountdown: Math.max(0, Math.ceil((resendAvailableAt - now) / 1000)),
    isCodeActive: expiresAt > now,
    isExpired: expiresAt > 0 && expiresAt <= now,
    isActiveNow,
    start,
    reset,
  }
}
