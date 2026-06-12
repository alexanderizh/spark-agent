/**
 * AuthBaseUrlBadge — 登录页底部显示当前 edu-server 地址（点击可切换）
 */

import React, { useState } from 'react'
import { Modal, Input, Button } from '@arco-design/web-react'
import { useAuth } from './AuthContext'
import { Icons } from '../Icons'

export function AuthBaseUrlBadge(): React.ReactElement {
  const auth = useAuth()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(auth.baseUrl)

  const handleSave = async (): Promise<void> => {
    try {
      await auth.setBaseUrl(value.trim())
      setEditing(false)
    } catch {
      // ignore
    }
  }

  return (
    <div className="auth-baseurl-badge">
      <span className="auth-baseurl-label">云端服务</span>
      <code className="auth-baseurl-value" onClick={() => setEditing(true)} title="点击切换">
        {auth.baseUrl}
      </code>

      <Modal
        title="切换云端服务地址"
        visible={editing}
        onCancel={() => setEditing(false)}
        footer={null}
        unmountOnExit
      >
        <div className="auth-baseurl-edit">
          <p>输入同步服务的 API URL：</p>
          <Input
            value={value}
            onChange={setValue}
            placeholder="http://localhost:7002"
            autoFocus
          />
          <div className="auth-baseurl-actions">
            <Button onClick={() => setEditing(false)}>取消</Button>
            <Button type="primary" onClick={() => void handleSave()}>
              保存
            </Button>
          </div>
        </div>
      </Modal>

      <span
        role="button"
        aria-label="切换云端服务地址"
        onClick={() => setEditing(true)}
        className="auth-baseurl-icon"
      >
        <Icons.Settings size={12} />
      </span>
    </div>
  )
}
