/**
 * BrowserLoginPanel — 「使用浏览器登录」入口与等待态
 *
 * 与既有表单登录互补：点击入口后由主进程拉起系统浏览器打开 edu-web 登录页，
 * 用户在网页端用任意方式（账号密码 / 邮箱验证码 / 短信 / 微信扫码）完成登录，
 * 浏览器再通过 `spark-agent://auth-callback` 拉回桌面端完成登录态初始化。
 *
 * 本组件只负责展示：发起与取消都通过 useAuth().desktopLogin 透传到主进程，
 * 等待/超时/失败状态由主进程 `stream:auth:desktop-login-status` 驱动。
 */

import React from 'react'
import { Button } from 'antd'
import { useI18n } from '../i18n'
import { Icons } from '../Icons'

/** 仅用于展示「浏览器打开的是哪个站点」，不是安全判断依据 */
function resolveWebLoginHost(webLoginUrl?: string): string | null {
  if (!webLoginUrl) return null
  try {
    return new URL(webLoginUrl).host
  } catch {
    return null
  }
}

export function BrowserLoginEntry({
  starting,
  error,
  notice,
  onStart,
}: {
  starting: boolean
  /** 发起失败（未打开浏览器等）原因 */
  error?: string | undefined
  /** 上一次授权未完成的结果说明（超时 / 换取凭证失败） */
  notice?: string | undefined
  onStart: () => void
}): React.ReactElement {
  const { t } = useI18n()
  return (
    <div className="auth-browser-entry">
      <div className="auth-browser-divider" role="separator">
        <span>{t('auth.browser.or')}</span>
      </div>
      <Button
        className="auth-browser-btn"
        icon={<Icons.Globe size={17} />}
        loading={starting}
        disabled={starting}
        onClick={onStart}
      >
        {starting ? t('auth.browser.starting') : t('auth.browser.useBtn')}
      </Button>
      <p className="auth-browser-hint">{t('auth.browser.hint')}</p>
      {error !== undefined && (
        <p className="auth-browser-error" role="alert">
          <Icons.AlertTriangle size={14} />
          <span>{error}</span>
        </p>
      )}
      {error === undefined && notice !== undefined && (
        <p className="auth-browser-notice" role="status">
          <Icons.AlertTriangle size={14} />
          <span>{notice}</span>
        </p>
      )}
    </div>
  )
}

export function BrowserLoginWaiting({
  webLoginUrl,
  onCancel,
}: {
  webLoginUrl?: string | undefined
  onCancel: () => void
}): React.ReactElement {
  const { t, lang } = useI18n()
  const host = resolveWebLoginHost(webLoginUrl)
  // 中文用全角括号、英文用半角括号；无 host 时留空。
  const hostSuffix = host == null ? '' : lang === 'zh' ? `（${host}）` : ` (${host})`
  return (
    <div className="auth-form auth-browser-waiting">
      <div className="auth-browser-waiting-icon" aria-hidden>
        <Icons.Globe size={24} />
      </div>
      <h2 className="auth-form-title">{t('auth.browser.waitingTitle')}</h2>
      <p className="auth-form-greet">{t('auth.browser.waitingDesc', { host: hostSuffix })}</p>
      <ol className="auth-browser-steps">
        <li>{t('auth.browser.step1')}</li>
        <li>{t('auth.browser.step2')}</li>
      </ol>
      <div className="auth-browser-waiting-bar" aria-hidden>
        <span className="auth-browser-waiting-dot" />
        <span className="auth-browser-waiting-dot" />
        <span className="auth-browser-waiting-dot" />
      </div>
      <p className="auth-browser-meta">{t('auth.browser.waitingMeta')}</p>
      <Button className="auth-browser-cancel" type="text" onClick={onCancel}>
        {t('auth.browser.cancelBtn')}
      </Button>
    </div>
  )
}
