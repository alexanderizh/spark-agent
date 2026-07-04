/**
 * AccountSection — 设置页"账号"区
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, Modal } from 'antd'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { AuthGate } from '../auth/AuthGate'
import { AvatarImage } from '../components/AvatarImage'
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
      title: '退出登录',
      content: '确定要退出当前账号吗？本机的同步数据不会被删除。',
      okText: '退出',
      cancelText: '取消',
      onOk: async () => {
        await auth.logout()
        toast.success('已退出登录')
      },
    })
  }

  const displayName = auth.user?.nickname || auth.user?.account || '用户'
  const displayAccount = auth.user?.account || '未绑定账号'
  const userRoleLabel = formatRoleLabel(auth.user?.role)
  const lastLoginLabel = formatTimeLabel(auth.user?.lastLoginAt)
  const baseUrlLabel = useMemo(() => {
    try {
      const url = new URL(auth.baseUrl)
      return url.host
    } catch {
      return auth.baseUrl
    }
  }, [auth.baseUrl])
  const bindItems = [
    { label: '邮箱', value: bindStatus?.hasEmail ? '已绑定' : '未绑定' },
    { label: '手机号', value: bindStatus?.hasPhone ? '已绑定' : '未绑定' },
  ]

  return (
    <div className="account-section">
      <h3 className="settings-section-title">账号</h3>

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
                修改密码
              </Button>
            )}
            <Button size="middle" onClick={handleLogout}>
              退出登录
            </Button>
          </div>
        </div>
        <div className="account-profile-meta">
          <div className="account-profile-meta-item">
            <span className="account-profile-meta-label">当前账号</span>
            <span className="account-profile-meta-value">{displayAccount}</span>
          </div>
          <div className="account-profile-meta-item">
            <span className="account-profile-meta-label">身份角色</span>
            <span className="account-profile-meta-value">{userRoleLabel}</span>
          </div>
          <div className="account-profile-meta-item">
            <span className="account-profile-meta-label">最近登录</span>
            <span className="account-profile-meta-value">{lastLoginLabel}</span>
          </div>
        </div>
      </div>

      <div className="account-panel">
        <div className="account-panel-head">
          <div>
            <h4>绑定方式</h4>
            <p>查看当前账号的绑定状态，便于后续找回和登录。</p>
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
            <span>密码</span>
            <span>
              {bindStatus?.hasPassword ? (
                <button
                  type="button"
                  className="account-inline-action"
                  onClick={() => setPasswordModal(true)}
                >
                  修改密码
                </button>
              ) : (
                '未设置'
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="account-panel">
        <div className="account-panel-head">
          <div>
            <h4>云端服务地址</h4>
            <p>当前桌面端连接的账号服务地址。</p>
          </div>
        </div>
        <div className="account-baseurl-row">
          <code>{auth.baseUrl}</code>
        </div>
      </div>

      <Modal
        title="修改密码"
        open={passwordModal}
        onCancel={() => setPasswordModal(false)}
        footer={null}
        destroyOnHidden
      >
        <ChangePasswordForm
          onClose={() => setPasswordModal(false)}
          onSuccess={() => {
            setPasswordModal(false)
            toast.success('密码已修改')
          }}
        />
      </Modal>
    </div>
  )
}

function formatRoleLabel(value: string | undefined): string {
  if (value == null || value.trim().length === 0) return '普通用户'
  if (value === 'admin') return '管理员'
  if (value === 'user') return '普通用户'
  return value
}

function formatTimeLabel(value: string | null | undefined): string {
  if (value == null || value.trim().length === 0) return '首次登录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
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
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const { toast } = useToast()

  const handleSubmit = async (): Promise<void> => {
    try {
      setSubmitting(true)
      const values = await form.validateFields()
      if (values.newPassword !== values.confirmPassword) {
        toast.error('两次输入的新密码不一致')
        return
      }
      await window.spark!.invoke('auth:change-password', {
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      })
      onSuccess()
    } catch (e) {
      toast.error((e as Error).message || '修改失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Form form={form} layout="vertical">
      <Form.Item
        name="oldPassword"
        label="当前密码"
        rules={[{ required: true, message: '请输入当前密码' }]}
      >
        <Input.Password />
      </Form.Item>
      <Form.Item
        name="newPassword"
        label="新密码"
        rules={[{ required: true, min: 6, message: '至少 6 位' }]}
      >
        <Input.Password />
      </Form.Item>
      <Form.Item
        name="confirmPassword"
        label="确认新密码"
        rules={[{ required: true, message: '请再次输入新密码' }]}
      >
        <Input.Password />
      </Form.Item>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" loading={submitting} onClick={() => void handleSubmit()}>
          确认
        </Button>
      </div>
    </Form>
  )
}
