/**
 * AccountCenterView — 独立的「账号中心」页面
 *
 * 入口：左下角用户菜单顶部「账号」项。
 * 取代设置页中曾经的「账号」tab。
 *
 * 功能：
 *  - 未登录：渲染 AuthGate（登录/注册）
 *  - 已登录：左右双栏响应式
 *    · 左栏：大头像（可点击上传）+ 昵称（内联编辑）+ account + 注册/最近登录 + 账号与安全
 *    · 右栏：平台模型、退出登录
 *
 * 参考实现：edu-web 的 ProfilePage.tsx；头像裁剪复用 AvatarCropperModal。
 */

import React, { useEffect, useRef, useState } from 'react'
import { Form, Input, Modal } from 'antd'
import { Button } from '@lobehub/ui'
import { Icons } from '../Icons'
import { useApp } from '../AppContext'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { AuthGate } from '../auth/AuthGate'
import { AvatarImage } from '../components/AvatarImage'
import { AvatarCropperModal } from '../components/AvatarCropperModal'
import { PlatformModelAccountPanel } from './platform-model/PlatformModelAccountPanel'
import './AccountCenterView.less'

interface BindStatus {
  hasEmail: boolean
  hasPhone: boolean
  hasWechat: boolean
  hasPassword: boolean
  account: string
}

/** 单个图片允许的最大体积（与 edu-server 一致：5MB）*/
const AVATAR_MAX_BYTES = 5 * 1024 * 1024

export function AccountCenterView(): React.ReactElement {
  const auth = useAuth()

  if (!auth.isAuthenticated) {
    return (
      <div className="account-center account-center--gate">
        <AuthGate />
      </div>
    )
  }

  return <AccountCenter />
}

function AccountCenter(): React.ReactElement {
  const auth = useAuth()
  const { setTweak, requestConfirm } = useApp()
  const { toast } = useToast()

  const [bindStatus, setBindStatus] = useState<BindStatus | null>(null)

  // 昵称内联编辑
  const [editingNickname, setEditingNickname] = useState(false)
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [savingNickname, setSavingNickname] = useState(false)

  // 头像上传
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null)
  const [cropperOpen, setCropperOpen] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  // 修改密码
  const [passwordModal, setPasswordModal] = useState(false)

  useEffect(() => {
    void window.spark
      ?.invoke('auth:bind-status', {})
      .then((res) => setBindStatus(res as BindStatus))
      .catch(() => undefined)
  }, [])

  const handleBack = (): void => {
    setTweak('view', 'chat')
  }

  // ─── 昵称 ────────────────────────────────────────────────────────────────────
  const startEditNickname = (): void => {
    setNicknameDraft(auth.user?.nickname || '')
    setEditingNickname(true)
  }

  const handleSaveNickname = async (): Promise<void> => {
    const trimmed = nicknameDraft.trim()
    if (trimmed.length === 0) {
      toast.error('昵称不能为空')
      return
    }
    if (trimmed.length > 20) {
      toast.error('昵称最多 20 个字符')
      return
    }
    if (trimmed === auth.user?.nickname) {
      setEditingNickname(false)
      return
    }
    try {
      setSavingNickname(true)
      await auth.updateNickname(trimmed)
      toast.success('昵称已更新')
      setEditingNickname(false)
    } catch (e) {
      toast.error((e as Error).message || '更新失败')
    } finally {
      setSavingNickname(false)
    }
  }

  // ─── 头像 ────────────────────────────────────────────────────────────────────
  const triggerPickAvatar = (): void => {
    fileInputRef.current?.click()
  }

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    // 清空 input value 以便重复选择同一文件
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件')
      return
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error('图片不能超过 5MB')
      return
    }
    setPendingAvatarFile(file)
    setCropperOpen(true)
  }

  const handleCropConfirm = async (blob: Blob): Promise<void> => {
    // 把 blob 转成 base64 dataUrl 走 IPC（主进程再转 multipart）
    const dataUrl = await blobToDataUrl(blob)
    try {
      setUploadingAvatar(true)
      await auth.uploadAvatar(dataUrl, 'avatar.jpg', 'image/jpeg')
      toast.success('头像已更新')
      setCropperOpen(false)
      setPendingAvatarFile(null)
    } catch (e) {
      toast.error((e as Error).message || '头像上传失败')
    } finally {
      setUploadingAvatar(false)
    }
  }

  // ─── 退出登录 ────────────────────────────────────────────────────────────────
  const handleLogout = async (): Promise<void> => {
    const ok = await requestConfirm({
      title: '退出登录',
      description: '确定要退出当前账号吗？本机的同步数据不会被删除。',
      confirmText: '退出',
      cancelText: '取消',
      danger: true,
    })
    if (!ok) return
    try {
      await auth.logout()
      toast.success('已退出登录')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // ─── 派生展示数据 ────────────────────────────────────────────────────────────
  const displayName = auth.user?.nickname || auth.user?.account || '用户'
  const displayAccount = auth.user?.account || '未绑定账号'
  const userRoleLabel = formatRoleLabel(auth.user?.role)
  const lastLoginLabel = formatTimeLabel(auth.user?.lastLoginAt)
  const createdLabel = formatTimeLabel(auth.user?.createdAt) || '—'
  return (
    <div className="account-center">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={handlePickFile}
        style={{ display: 'none' }}
      />

      {/* 顶部栏 */}
      <div className="account-center-topbar">
        <button className="account-center-back" onClick={handleBack} title="返回">
          <Icons.ArrowLeft size={16} />
        </button>
        <h2 className="account-center-title">账号中心</h2>
      </div>

      <div className="account-center-body scroll">
        <div className="account-center-grid">
          {/* ── 左栏：资料卡 ── */}
          <aside className="account-center-left">
            <div className="account-profile-card">
              <button
                type="button"
                className="account-profile-avatar-wrap"
                onClick={triggerPickAvatar}
                title="更换头像"
                disabled={uploadingAvatar}
              >
                <AvatarImage
                  src={auth.user?.avatarUrl || ''}
                  seed={auth.user?.account || displayName}
                  name={displayName}
                  alt={displayName}
                  className="account-profile-avatar-image"
                />
                <span className="account-profile-avatar-overlay">
                  {uploadingAvatar ? <Icons.Spinner size={16} className="spin" /> : <Icons.Upload size={16} />}
                </span>
              </button>

              <div className="account-profile-name-row">
                {editingNickname ? (
                  <div className="account-profile-name-edit">
                    <Input
                      size="middle"
                      value={nicknameDraft}
                      maxLength={20}
                      autoFocus
                      onChange={(e) => setNicknameDraft(e.target.value)}
                      onPressEnter={() => void handleSaveNickname()}
                    />
                    <Button
                      type="text"
                      loading={savingNickname}
                      disabled={savingNickname}
                      icon={<Icons.Check size={14} />}
                      onClick={() => void handleSaveNickname()}
                      title="保存"
                    />
                    <Button
                      type="text"
                      icon={<Icons.X size={14} />}
                      onClick={() => setEditingNickname(false)}
                      title="取消"
                    />
                  </div>
                ) : (
                  <div className="account-profile-name-display">
                    <span className="account-profile-nickname" title={displayName}>
                      {displayName}
                    </span>
                    <Button
                      type="text"
                      icon={<Icons.Edit size={14} />}
                      onClick={startEditNickname}
                      title="修改昵称"
                    />
                  </div>
                )}
              </div>

              <div className="account-profile-account" title={displayAccount}>
                {displayAccount}
              </div>

              <div className="account-profile-tags">
                <span className="account-role">{userRoleLabel}</span>
              </div>

              <div className="account-profile-meta">
                <div className="account-profile-meta-item">
                  <span className="account-profile-meta-label">注册时间</span>
                  <span className="account-profile-meta-value">{createdLabel}</span>
                </div>
                <div className="account-profile-meta-item">
                  <span className="account-profile-meta-label">最近登录</span>
                  <span className="account-profile-meta-value">{lastLoginLabel}</span>
                </div>
              </div>
            </div>

            {/* 账号与安全：合并原账号安全与绑定方式 */}
            <div className="account-panel account-security-panel">
              <div className="account-panel-head">
                <div>
                  <h4>账号与安全</h4>
                  <p>管理登录密码与账号绑定。</p>
                </div>
              </div>
              <div className="account-bind-list">
                <div className="account-bind-item">
                  <span className="account-bind-label">
                    <Icons.Chat size={14} /> 邮箱
                  </span>
                  <span className="account-bind-value">
                    {bindStatus?.hasEmail ? bindStatus.account || '已绑定' : '未绑定'}
                  </span>
                </div>
                <div className="account-bind-item">
                  <span className="account-bind-label">
                    <Icons.Phone size={14} /> 手机号
                  </span>
                  <span className="account-bind-value">
                    {bindStatus?.hasPhone ? '已绑定' : '未绑定'}
                  </span>
                </div>
                <div className="account-bind-item">
                  <span className="account-bind-label">
                    <Icons.Users size={14} /> 微信
                  </span>
                  <span className="account-bind-value">
                    {bindStatus?.hasWechat ? '已绑定' : '未绑定'}
                  </span>
                </div>
                <div className="account-bind-item">
                  <span className="account-bind-label">
                    <Icons.Lock size={14} /> 密码
                  </span>
                  <span className="account-bind-value">
                    {bindStatus?.hasPassword ? (
                      <Button type="text" onClick={() => setPasswordModal(true)}>
                        修改密码
                      </Button>
                    ) : (
                      '未设置'
                    )}
                  </span>
                </div>
              </div>
            </div>
          </aside>

          {/* ── 右栏：设置区块 ── */}
          <section className="account-center-right">
            <PlatformModelAccountPanel />

            {/* 退出登录 */}
            <div className="account-panel account-panel--danger">
              <div className="account-panel-head">
                <div>
                  <h4>退出登录</h4>
                  <p>退出当前账号，本机的本地数据不会被删除。</p>
                </div>
                <Button danger type="text" onClick={() => void handleLogout()}>
                  退出登录
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* 头像裁剪模态 */}
      <AvatarCropperModal
        open={cropperOpen}
        file={pendingAvatarFile}
        onConfirm={handleCropConfirm}
        onCancel={() => {
          setCropperOpen(false)
          setPendingAvatarFile(null)
        }}
      />

      {/* 修改密码模态 */}
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
            toast.success('密码已修改，其他设备的登录已失效')
          }}
        />
      </Modal>
    </div>
  )
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
        rules={[{ required: true, min: 8, message: '至少 8 位' }]}
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
        <Button type="text" onClick={onClose}>取消</Button>
        <Button type="primary" loading={submitting} onClick={() => void handleSubmit()}>
          确认
        </Button>
      </div>
    </Form>
  )
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })
}

function formatRoleLabel(value: string | undefined): string {
  if (value == null || value.trim().length === 0) return '普通用户'
  if (value === 'admin') return '管理员'
  if (value === 'user') return '普通用户'
  return value
}

function formatTimeLabel(value: string | null | undefined): string {
  if (value == null || value.trim().length === 0) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
