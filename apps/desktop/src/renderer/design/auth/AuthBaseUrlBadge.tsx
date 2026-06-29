/**
 * AuthBaseUrlBadge — 登录页底部显示当前 edu-server 地址
 */

import React from 'react'
import { useAuth } from './AuthContext'

export function AuthBaseUrlBadge(): React.ReactElement {
  const auth = useAuth()

  return (
    <div className="auth-baseurl-badge">
      <span className="auth-baseurl-label">云端服务</span>
      <code className="auth-baseurl-value" title="云端服务地址由桌面端内置配置管理">
        {auth.baseUrl}
      </code>
    </div>
  )
}
