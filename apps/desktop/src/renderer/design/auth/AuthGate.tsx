/**
 * AuthGate — 登录/注册的页面容器
 */

import React from 'react'
import { Alert, Tabs } from 'antd'
import { useAuth } from './AuthContext'
import { LoginForm } from './LoginForm'
import { RegisterForm } from './RegisterForm'
import { AuthBaseUrlBadge } from './AuthBaseUrlBadge'
import { Icons } from '../Icons'
import sparkLogo from '../../assets/spark-logo.png'
import './Auth.less'

export function AuthGate(): React.ReactElement {
  const auth = useAuth()

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-panel-head">
            <div className="auth-panel-brand">
              <img src={sparkLogo} alt="" className="auth-panel-logo" />
              <div>
                <div className="auth-panel-product">Spark Agent</div>
                <div className="auth-panel-title">
                  {auth.flow === 'login' ? '欢迎回来' : '创建 Spark 账号'}
                </div>
              </div>
            </div>
            <div className="auth-panel-subtitle">
              登录后可直接使用 Spark 平台模型，也可以继续使用你配置的第三方模型。
            </div>
          </div>

          {auth.keytarAvailable === false && (
            <Alert
              type="warning"
              showIcon
              message={
                <div className="auth-keytar-warn">
                  <div>本地凭证库不可用（keytar 加载失败），登录态不会保存到下次启动。</div>
                  <div className="auth-keytar-warn-fix">
                    请在仓库根目录执行 <code>pnpm --filter @spark/desktop rebuild keytar</code> 或
                    <code> npx electron-rebuild -f -w keytar</code> 重新编译原生模块后重启应用。
                  </div>
                </div>
              }
            />
          )}

          <Tabs
            className="auth-flow-tabs"
            activeKey={auth.flow}
            onChange={(value) => auth.setFlow(value as 'login' | 'register')}
            items={[
              {
                key: 'login',
                label: (
                  <span className="auth-flow-tab-label">
                    <Icons.User size={14} />
                    <span>登录</span>
                  </span>
                ),
              },
              {
                key: 'register',
                label: (
                  <span className="auth-flow-tab-label">
                    <Icons.Edit size={14} />
                    <span>注册</span>
                  </span>
                ),
              },
            ]}
          />

          <div className="auth-content">
            {auth.flow === 'login' && <LoginForm />}
            {auth.flow === 'register' && <RegisterForm />}
          </div>

          <AuthBaseUrlBadge />
        </div>
      </div>
    </div>
  )
}
