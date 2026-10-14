/**
 * LoginForm - 邮箱密码登录 + 邮箱验证码登录 + 手机号短信登录 + 浏览器登录
 *
 * 字段：
 *   - 账号（邮箱）- password / code 模式
 *   - 密码（password 模式） / 邮箱验证码（code 模式）
 *   - 手机号 + 图片验证码 + 短信验证码（sms 模式，受 authCapabilities.smsEnabled 控制）
 *   - 浏览器登录（默认推荐入口，覆盖含微信扫码在内的全部方式）：发起后整卡切换为等待态
 *
 * 扁平化重设计：登录方式从顶部 Tab 改为内联文字链；输入框用底线样式，
 * 压缩纵向层级。图片验证码复用 CaptchaField 封装组件（挂载拉图/点击刷新/失败换图）。
 */

import React, { useEffect, useRef, useState } from 'react'
import { Button, Form, Input } from 'antd'
import { useAuth } from './AuthContext'
import { useToast } from '../components/Toast'
import { CaptchaField, type CaptchaFieldHandle } from './CaptchaField'
import { BrowserLoginEntry, BrowserLoginWaiting } from './BrowserLoginPanel'
import { rememberEmail } from './recentEmails'
import { matchFieldError } from './errorMapping'
import { EMAIL_RE, inferIdentifierKind, normalizeVerificationTarget, PHONE_RE } from './identifier'
import { useVerificationCodeTimer } from './useVerificationCodeTimer'
import { useI18n, type TranslateFn } from '../i18n'
import { Icons } from '../Icons'

type LoginTab = 'password' | 'code'

/**
 * 账号校验：邮箱或手机号（用于密码登录，两者均可作为账号）。
 * 返回 Promise 风格，供 antd Form rule 的 validator 使用。
 */
function validateAccount(
  t: TranslateFn,
  requireEmailOnly: boolean,
): (rule: unknown, value: string) => Promise<void> {
  return (_rule, value) => {
    const v = (value ?? '').trim()
    if (!v) return Promise.reject(new Error(t('auth.login.accountRequired')))
    if (!requireEmailOnly && PHONE_RE.test(v)) return Promise.resolve()
    if (EMAIL_RE.test(v)) return Promise.resolve()
    return Promise.reject(
      new Error(
        requireEmailOnly ? t('auth.login.validEmail') : t('auth.login.validEmailOrPhone'),
      ),
    )
  }
}

export function LoginForm({ flowSwitch }: { flowSwitch?: React.ReactNode }): React.ReactElement {
  const auth = useAuth()
  const { toast } = useToast()
  const { t } = useI18n()
  const [form] = Form.useForm()
  const captchaRef = useRef<CaptchaFieldHandle>(null)
  const [submitting, setSubmitting] = useState(false)
  const [tab, setTab] = useState<LoginTab>('password')
  const [emailCodeTarget, setEmailCodeTarget] = useState('')
  const [smsCodeTarget, setSmsCodeTarget] = useState('')
  const [sendingEmailCode, setSendingEmailCode] = useState(false)
  const [sendingSmsCode, setSendingSmsCode] = useState(false)
  const sendingEmailRef = useRef(false)
  const sendingSmsRef = useRef(false)
  const submittingRef = useRef(false)
  const {
    resendCountdown: countdown,
    isCodeActive: isEmailCodeActive,
    isExpired: isEmailCodeExpired,
    isActiveNow: isEmailCodeActiveNow,
    start: startEmailCodeTimer,
    reset: resetEmailCodeTimer,
  } = useVerificationCodeTimer()
  const {
    resendCountdown: smsCountdown,
    isCodeActive: isSmsCodeActive,
    isExpired: isSmsCodeExpired,
    isActiveNow: isSmsCodeActiveNow,
    start: startSmsCodeTimer,
    reset: resetSmsCodeTimer,
  } = useVerificationCodeTimer()

  const smsEnabled = auth.authCapabilities?.smsEnabled === true
  const account = Form.useWatch('account', form)
  const password = Form.useWatch('password', form)
  const emailCode = Form.useWatch('emailCode', form)
  const smsCode = Form.useWatch('smsCode', form)
  const captchaId = Form.useWatch('captchaId', form)
  const captchaText = Form.useWatch('captchaText', form)
  const identifierKind = inferIdentifierKind(account, smsEnabled)
  const usesSmsCode = tab === 'code' && identifierKind === 'phone'
  const normalizedAccount = String(account ?? '').trim()
  const verificationTarget = normalizeVerificationTarget(account)
  const accountValid =
    EMAIL_RE.test(normalizedAccount) ||
    ((tab === 'password' || usesSmsCode) && PHONE_RE.test(normalizedAccount))
  const captchaReady = Boolean(captchaId && String(captchaText ?? '').trim())
  const hasActiveEmailCode = Boolean(
    emailCodeTarget && emailCodeTarget === verificationTarget && isEmailCodeActive,
  )
  const hasActiveSmsCode = Boolean(
    smsCodeTarget && smsCodeTarget === verificationTarget && isSmsCodeActive,
  )
  const canSubmit =
    accountValid &&
    (tab === 'password'
      ? captchaReady && String(password ?? '').length >= 6
      : usesSmsCode
        ? hasActiveSmsCode && String(smsCode ?? '').trim().length === 6
        : hasActiveEmailCode && String(emailCode ?? '').trim().length === 6)

  const handleAccountChange = (nextValue: string): void => {
    const nextTarget = normalizeVerificationTarget(nextValue)
    if (emailCodeTarget && emailCodeTarget !== nextTarget) {
      setEmailCodeTarget('')
      resetEmailCodeTimer()
      form.setFields([{ name: 'emailCode', value: '', errors: [] }])
    }
    if (smsCodeTarget && smsCodeTarget !== nextTarget) {
      setSmsCodeTarget('')
      resetSmsCodeTimer()
      form.setFields([{ name: 'smsCode', value: '', errors: [] }])
    }
  }

  useEffect(() => {
    if (!isEmailCodeExpired || !emailCodeTarget) return
    form.setFields([{ name: 'emailCode', errors: [t('auth.common.codeExpired')] }])
  }, [emailCodeTarget, form, isEmailCodeExpired, t])

  useEffect(() => {
    if (!isSmsCodeExpired || !smsCodeTarget) return
    form.setFields([{ name: 'smsCode', errors: [t('auth.common.codeExpired')] }])
  }, [form, isSmsCodeExpired, smsCodeTarget, t])

  const handleTabChange = (key: string): void => {
    setTab(key as LoginTab)
    form.resetFields(['password', 'emailCode', 'smsCode'])
  }

  const setFieldError = (name: string, message: string): void => {
    form.setFields([{ name, errors: [message] }])
  }

  const setCaptchaError = async (message: string): Promise<void> => {
    await captchaRef.current?.refresh()
    setFieldError('captchaText', message)
  }

  const handleSendCode = async (): Promise<void> => {
    if (sendingEmailRef.current || countdown > 0) return
    sendingEmailRef.current = true
    setSendingEmailCode(true)
    try {
      const values = await form.validateFields(['account', 'captchaId', 'captchaText'])
      if (!values.account) {
        setFieldError('account', t('auth.login.emailRequired'))
        return
      }
      if (!values.captchaId || !String(values.captchaText ?? '').trim()) {
        setFieldError('captchaText', t('auth.common.captchaRequired'))
        return
      }
      const requestedAt = Date.now()
      const result = await auth.sendCode({
        account: values.account.trim(),
        type: 'login',
        captchaId: values.captchaId,
        captchaText: values.captchaText,
      })
      const sentTarget = normalizeVerificationTarget(values.account)
      const isStillCurrentTarget =
        normalizeVerificationTarget(form.getFieldValue('account')) === sentTarget
      if (isStillCurrentTarget) {
        setEmailCodeTarget(sentTarget)
        startEmailCodeTimer(result.expire_in, requestedAt)
        form.setFields([{ name: 'emailCode', value: '', errors: [] }])
      }
      toast.success(
        isStillCurrentTarget
          ? t('auth.common.emailCodeSent')
          : t('auth.common.emailCodeSentStale'),
      )
    } catch (e) {
      const msg = (e as Error).message ?? t('auth.common.sendFailed')
      const target = matchFieldError(msg, ['account', 'captchaText'])
      if (target) {
        if (target === 'captchaText') await setCaptchaError(msg)
        else setFieldError(target, msg)
      } else {
        toast.error(msg)
      }
    } finally {
      sendingEmailRef.current = false
      setSendingEmailCode(false)
    }
  }

  // ─── 短信验证码：发送 ────────────────────────────────────────────────────────
  const handleSendSms = async (): Promise<void> => {
    if (sendingSmsRef.current || smsCountdown > 0) return
    sendingSmsRef.current = true
    setSendingSmsCode(true)
    try {
      const values = await form.validateFields(['account', 'captchaId', 'captchaText'])
      const phone = (values.account ?? '').trim()
      if (!phone) {
        setFieldError('account', t('auth.common.phoneRequired'))
        return
      }
      if (!PHONE_RE.test(phone)) {
        setFieldError('account', t('auth.common.validPhone'))
        return
      }
      if (!values.captchaId || !String(values.captchaText ?? '').trim()) {
        setFieldError('captchaText', t('auth.common.captchaRequired'))
        return
      }
      const requestedAt = Date.now()
      const result = await auth.sendSmsCode({
        phone,
        captchaId: values.captchaId,
        captchaText: values.captchaText,
      })
      const sentTarget = normalizeVerificationTarget(phone)
      const isStillCurrentTarget =
        normalizeVerificationTarget(form.getFieldValue('account')) === sentTarget
      if (isStillCurrentTarget) {
        setSmsCodeTarget(sentTarget)
        startSmsCodeTimer(result.expire_in, requestedAt)
        form.setFields([{ name: 'smsCode', value: '', errors: [] }])
      }
      toast.success(
        isStillCurrentTarget ? t('auth.common.smsSent') : t('auth.common.smsSentStale'),
      )
    } catch (e) {
      const msg = (e as Error).message ?? t('auth.common.sendFailed')
      const target = matchFieldError(msg, ['account', 'captchaText'])
      if (target) {
        if (target === 'captchaText') await setCaptchaError(msg)
        else setFieldError(target, msg)
      } else {
        toast.error(msg)
      }
    } finally {
      sendingSmsRef.current = false
      setSendingSmsCode(false)
    }
  }

  const handleSubmit = async (): Promise<void> => {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      setSubmitting(true)
      const values = await form.validateFields()

      if (usesSmsCode) {
        if (!hasActiveSmsCode || !isSmsCodeActiveNow()) {
          setFieldError('smsCode', t('auth.common.codeRequired'))
          return
        }
        const result = await auth.loginBySms({
          phone: (values.account ?? '').trim(),
          smsCode: values.smsCode,
        })
        toast.success(result.isNew ? t('auth.login.successRegistered') : t('auth.login.success'))
        return
      }

      let result
      if (tab === 'password') {
        result = await auth.login({
          account: values.account.trim(),
          loginMode: 'password',
          password: values.password,
          captchaId: values.captchaId,
          captchaText: values.captchaText,
        })
      } else {
        if (!hasActiveEmailCode || !isEmailCodeActiveNow()) {
          setFieldError('emailCode', t('auth.common.codeRequired'))
          return
        }
        result = await auth.login({
          account: values.account.trim(),
          loginMode: 'code',
          emailCode: values.emailCode,
        })
      }
      const normalizedAccount = values.account.trim()
      if (EMAIL_RE.test(normalizedAccount)) {
        rememberEmail(normalizedAccount)
      }
      toast.success(t('auth.login.success'))
      void result
    } catch (e) {
      const msg = (e as Error).message ?? t('auth.login.failed')
      const candidates: Array<
        'account' | 'password' | 'captchaText' | 'emailCode' | 'phone' | 'smsCode'
      > =
        tab === 'password'
          ? ['password', 'captchaText', 'account']
          : usesSmsCode
            ? ['smsCode', 'account', 'captchaText']
            : ['emailCode', 'account', 'captchaText']
      const target = matchFieldError(msg, candidates)
      if (target) {
        if (target === 'captchaText') await setCaptchaError(msg)
        else setFieldError(target, msg)
      } else {
        toast.error(msg)
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  // 上一次授权未走完（超时 / 换取凭证失败）后的说明：
  // 主进程推送的 message 必须落地展示，否则用户只会看到表单悄悄恢复而不知原因
  const desktopLoginNotice =
    auth.desktopLogin.phase === 'expired' || auth.desktopLogin.phase === 'failed'
      ? (auth.desktopLogin.message ?? t('auth.login.browserIncomplete'))
      : undefined

  // 等待浏览器授权时整卡切换（成功由主进程登录态事件驱动，无需额外跳转）
  if (auth.desktopLogin.phase === 'waiting') {
    return (
      <BrowserLoginWaiting
        webLoginUrl={auth.desktopLogin.webLoginUrl}
        onCancel={() => void auth.desktopLogin.cancel()}
      />
    )
  }

  const methodItems: Array<{ key: LoginTab; label: string; visible: boolean }> = [
    { key: 'password', label: t('auth.login.methodPassword'), visible: true },
    { key: 'code', label: t('auth.login.methodCode'), visible: true },
  ]

  return (
    <div className="auth-form">
      <div className="auth-form-head">
        <h2 className="auth-form-title">{t('auth.login.title')}</h2>
        <p className="auth-form-greet">
          {tab === 'code' ? t('auth.login.subtitleCode') : t('auth.login.subtitlePassword')}
        </p>
      </div>

      {/* 登录方式：内联文字链，非 Tab */}
      <div className="auth-methods">
        {methodItems
          .filter((item) => item.visible)
          .map((item) => (
            <button
              key={item.key}
              type="button"
              className={`auth-method ${tab === item.key ? 'active' : ''}`}
              onClick={() => handleTabChange(item.key)}
            >
              {item.label}
            </button>
          ))}
      </div>

      <Form
        form={form}
        className="auth-form-body auth-form-body--flat"
        layout="vertical"
        requiredMark={false}
        onFinish={handleSubmit}
      >
        <Form.Item
          name="account"
          className="auth-field-row"
          rules={[
            {
              required: true,
              validator:
                tab === 'password'
                  ? validateAccount(t, false)
                  : validateAccount(t, identifierKind === 'email'),
            },
          ]}
        >
          <AccountInput onAccountChange={handleAccountChange} />
        </Form.Item>

        {/* 密码（仅 password 模式） */}
        {tab === 'password' && (
          <Form.Item
            name="password"
            className="auth-field-row"
            rules={[{ required: true, min: 6, message: t('auth.common.minPasswordHint') }]}
          >
            <PasswordInput />
          </Form.Item>
        )}

        {/* 图片验证码：复用封装组件（挂载拉图 / 点击刷新 / 失败换图） */}
        <CaptchaField
          ref={captchaRef}
          form={form}
          disabled={sendingEmailCode || sendingSmsCode}
          required={tab === 'password' || (usesSmsCode ? !hasActiveSmsCode : !hasActiveEmailCode)}
        />

        {/* 邮箱验证码（code 模式） / 短信验证码（sms 模式） */}
        {tab === 'code' && !usesSmsCode && (
          <Form.Item
            name="emailCode"
            className="auth-field-row"
            rules={[{ required: true, message: t('auth.common.emailCodeRequired') }]}
          >
            <CodeInput
              placeholder={t('auth.login.emailCodePlaceholder')}
              countdown={countdown}
              sending={sendingEmailCode}
              onSend={() => void handleSendCode()}
            />
          </Form.Item>
        )}
        {usesSmsCode && (
          <Form.Item
            name="smsCode"
            className="auth-field-row"
            rules={[{ required: true, message: t('auth.common.smsCodeRequired') }]}
          >
            <CodeInput
              placeholder={t('auth.login.smsCodePlaceholder')}
              countdown={smsCountdown}
              sending={sendingSmsCode}
              onSend={() => void handleSendSms()}
            />
          </Form.Item>
        )}

        <Form.Item className="auth-submit-row">
          <Button
            className="auth-submit-btn"
            type="primary"
            htmlType="submit"
            loading={submitting}
            disabled={!canSubmit || submitting}
          >
            {submitting ? t('auth.login.submitLoading') : t('auth.login.submitBtn')}
            {!submitting && <Icons.ArrowRight size={18} />}
          </Button>
        </Form.Item>

        <BrowserLoginEntry
          starting={auth.desktopLogin.starting}
          error={auth.desktopLogin.startError}
          notice={desktopLoginNotice}
          onStart={() => void auth.desktopLogin.start()}
        />

        <div className={`auth-footer-row ${flowSwitch ? 'auth-footer-row--split' : ''}`}>
          <div className="auth-foot-line">
            {tab === 'password' ? (
              <>
                <span className="auth-foot-muted">{t('auth.login.forgotPassword')}</span>{' '}
                <button
                  type="button"
                  className="auth-foot-link"
                  onClick={() => handleTabChange('code')}
                >
                  {t('auth.login.useCode')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="auth-foot-link"
                onClick={() => handleTabChange('password')}
              >
                {t('auth.login.backToPassword')}
              </button>
            )}
          </div>
          {flowSwitch}
        </div>
      </Form>
    </div>
  )
}

// ─── 字段子组件：统一扁平底线输入样式 ──────────────────────────────────────────

type ControlledInputProps = Pick<React.ComponentProps<typeof Input>, 'value' | 'onChange'>

function AccountInput({
  value,
  onChange,
  onAccountChange,
}: ControlledInputProps & { onAccountChange?: (value: string) => void }): React.ReactElement {
  const { t } = useI18n()
  return (
    <div className="auth-input auth-input--flat">
      <Icons.Mail size={17} className="auth-input-icon" />
      <Input
        value={value}
        onChange={(event) => {
          onAccountChange?.(event.target.value)
          onChange?.(event)
        }}
        placeholder={t('auth.common.emailOrPhone')}
        allowClear
        autoComplete="username"
      />
    </div>
  )
}

function PasswordInput({ value, onChange }: ControlledInputProps): React.ReactElement {
  const { t } = useI18n()
  const [visible, setVisible] = useState(false)
  return (
    <div className="auth-input auth-input--flat">
      <Icons.Lock size={17} className="auth-input-icon" />
      <Input
        placeholder={t('auth.login.passwordPlaceholder')}
        value={value}
        onChange={onChange}
        autoComplete="current-password"
        type={visible ? 'text' : 'password'}
      />
      <button
        type="button"
        className="auth-input-action"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t('auth.common.hidePassword') : t('auth.common.showPassword')}
      >
        {visible ? <Icons.EyeOff size={16} /> : <Icons.Eye size={16} />}
      </button>
    </div>
  )
}

function CodeInput({
  placeholder,
  countdown,
  sending,
  onSend,
  value,
  onChange,
}: {
  placeholder: string
  countdown: number
  sending: boolean
  onSend: () => void
} & ControlledInputProps): React.ReactElement {
  const { t } = useI18n()
  return (
    <div className="auth-input auth-input--flat auth-input--with-action">
      <Input value={value} onChange={onChange} placeholder={placeholder} maxLength={6} />
      <button
        type="button"
        className={`auth-input-action auth-input-action--send ${countdown > 0 || sending ? 'disabled' : ''}`}
        onClick={() => countdown <= 0 && !sending && onSend()}
        disabled={countdown > 0 || sending}
      >
        {sending ? t('auth.common.sending') : countdown > 0 ? `${countdown}s` : t('auth.common.sendBtn')}
      </button>
    </div>
  )
}
