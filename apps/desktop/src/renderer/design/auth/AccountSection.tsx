/**
 * AccountSection — 设置页"账号"区
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, Modal } from 'antd'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { AuthGate } from '../auth/AuthGate'
import { AvatarImage } from '../components/AvatarImage'
import { useI18n, type Lang, type TranslateFn } from '../i18n'
import './AccountSection.less'

interface BindStatus {
  hasEmail: boolean
  hasPhone: boolean
  hasPassword: boolean
  account: string
}

export function AccountSection(): React.ReactElement {
  const auth = useAuth()

  if (!auth.isAuthenticated) {
    return (
      <div className="account-section">
        <AuthGate />
      </div>
    )
  }

  return <AuthenticatedAccountView />
}

function AuthenticatedAccountView(): React.ReactElement {
  const auth = useAuth()
  const { toast } = useToast()
  const { t, lang } = useI18n()
  const [bindStatus, setBindStatus] = useState<BindStatus | null>(null)
  const [passwordModal, setPasswordModal] = useState(false)

  useEffect(() => {
    void window.spark
      ?.invoke('auth:bind-status', {})
      .then((res) => setBindStatus(res as BindStatus))
      .catch(() => undefined)
  }, [])

  const handleLogout = async (): Promise<void> => {
    Modal.confirm({
      title: t('auth.account.logoutConfirmTitle'),
      content: t('auth.account.logoutConfirmDesc'),
      okText: t('auth.account.logoutOk'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        await auth.logout()
        toast.success(t('auth.account.loggedOut'))
      },
    })
  }

  const displayName = auth.user?.nickname || auth.user?.account || t('auth.account.defaultUserName')
  const displayAccount = auth.user?.account || t('auth.account.unboundAccount')
  const userRoleLabel = formatRoleLabel(auth.user?.role, t)
  const lastLoginLabel = formatTimeLabel(auth.user?.lastLoginAt, t, lang)
  const baseUrlLabel = useMemo(() => {
    try {
      const url = new URL(auth.baseUrl)
      return url.host
    } catch {
      return auth.baseUrl
    }
  }, [auth.baseUrl])
  const bindItems = [
    { label: t('auth.account.email'), value: bindStatus?.hasEmail ? t('auth.account.bound') : t('auth.account.unbound') },
    { label: t('auth.account.phone'), value: bindStatus?.hasPhone ? t('auth.account.bound') : t('auth.account.unbound') },
  ]

  return (
    <div className="account-section">
      <h3 className="settings-section-title">{t('auth.account.title')}</h3>

      <div className="account-profile-card">
        <div className="account-profile">
          <div className="account-profile-avatar">
            <AvatarImage
              src={auth.user?.avatarUrl || ''}
              seed={auth.user?.account || displayName}
              name={displayName}
              alt={displayName}
              className="account-profile-avatar-image"
            />
          </div>
          <div className="account-profile-info">
            <div className="account-profile-nickname">{displayName}</div>
            <div className="account-profile-account">{displayAccount}</div>
            <div className="account-profile-tags">
              {auth.user?.tier && (
                <span className={`account-tier ${auth.user.tier.isPaid ? 'paid' : 'free'}`}>
                  {auth.user.tier.name}
                </span>
              )}
              <span className="account-role">{userRoleLabel}</span>
              <span className="account-service-chip">{baseUrlLabel}</span>
            </div>
          </div>
          <div className="account-profile-actions">
            {bindStatus?.hasPassword && (
              <Button size="middle" onClick={() => setPasswordModal(true)}>
                {t('auth.account.changePassword')}
              </Button>
            )}
            <Button size="middle" onClick={handleLogout}>
              {t('auth.account.logout')}
            </Button>
          </div>
        </div>
        <div className="account-profile-meta">
          <div className="account-profile-meta-item">
            <span className="account-profile-meta-label">{t('auth.account.currentAccount')}</span>
            <span className="account-profile-meta-value">{displayAccount}</span>
          </div>
          <div className="account-profile-meta-item">
            <span className="account-profile-meta-label">{t('auth.account.role')}</span>
            <span className="account-profile-meta-value">{userRoleLabel}</span>
          </div>
          <div className="account-profile-meta-item">
            <span className="account-profile-meta-label">{t('auth.account.lastLogin')}</span>
            <span className="account-profile-meta-value">{lastLoginLabel}</span>
          </div>
        </div>
      </div>

      <div className="account-panel">
        <div className="account-panel-head">
          <div>
            <h4>{t('auth.account.bindSectionTitle')}</h4>
            <p>{t('auth.account.bindSectionDesc')}</p>
          </div>
        </div>
        <div className="account-bind-list">
          {bindItems.map((item) => (
            <div className="account-bind-item" key={item.label}>
              <span>{item.label}</span>
              <span>{item.value}</span>
            </div>
          ))}
          <div className="account-bind-item">
            <span>{t('auth.account.password')}</span>
            <span>
              {bindStatus?.hasPassword ? (
                <button
                  type="button"
                  className="account-inline-action"
                  onClick={() => setPasswordModal(true)}
                >
                  {t('auth.account.changePassword')}
                </button>
              ) : (
                t('auth.account.notSet')
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="account-panel">
        <div className="account-panel-head">
          <div>
            <h4>{t('auth.account.baseUrlTitle')}</h4>
            <p>{t('auth.account.baseUrlDesc')}</p>
          </div>
        </div>
        <div className="account-baseurl-row">
          <code>{auth.baseUrl}</code>
        </div>
      </div>

      <Modal
        title={t('auth.account.changePassword')}
        open={passwordModal}
        onCancel={() => setPasswordModal(false)}
        footer={null}
        destroyOnHidden
      >
        <ChangePasswordForm
          onClose={() => setPasswordModal(false)}
          onSuccess={() => {
            setPasswordModal(false)
            toast.success(t('auth.account.passwordChanged'))
          }}
        />
      </Modal>
    </div>
  )
}

function formatRoleLabel(value: string | undefined, t: TranslateFn): string {
  if (value == null || value.trim().length === 0) return t('auth.account.roleUser')
  if (value === 'admin') return t('auth.account.roleAdmin')
  if (value === 'user') return t('auth.account.roleUser')
  return value
}

function formatTimeLabel(
  value: string | null | undefined,
  t: TranslateFn,
  lang: Lang,
): string {
  if (value == null || value.trim().length === 0) return t('auth.account.firstLogin')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function ChangePasswordForm({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const { toast } = useToast()

  const handleSubmit = async (): Promise<void> => {
    try {
      setSubmitting(true)
      const values = await form.validateFields()
      if (values.newPassword !== values.confirmPassword) {
        toast.error(t('auth.account.newPasswordMismatch'))
        return
      }
      await window.spark!.invoke('auth:change-password', {
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      })
      onSuccess()
    } catch (e) {
      toast.error((e as Error).message || t('auth.account.changeFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Form form={form} layout="vertical">
      <Form.Item
        name="oldPassword"
        label={t('auth.account.oldPassword')}
        rules={[{ required: true, message: t('auth.account.oldPasswordRequired') }]}
      >
        <Input.Password />
      </Form.Item>
      <Form.Item
        name="newPassword"
        label={t('auth.account.newPassword')}
        rules={[{ required: true, min: 6, message: t('auth.common.minPasswordHint') }]}
      >
        <Input.Password />
      </Form.Item>
      <Form.Item
        name="confirmPassword"
        label={t('auth.account.confirmNewPassword')}
        rules={[{ required: true, message: t('auth.account.confirmNewPasswordRequired') }]}
      >
        <Input.Password />
      </Form.Item>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="primary" loading={submitting} onClick={() => void handleSubmit()}>
          {t('common.confirm')}
        </Button>
      </div>
    </Form>
  )
}
