/**
 * AuthGate — 登录/注册的页面容器（直接嵌入到设置-账号页）
 *
 * 不再是 Modal：登录表单直接在页面里渲染，用户从侧边栏"登录"菜单项
 * 跳到设置-账号页时，看到的就是这个组件。
 *
 * 流程：
 *   - 未登录 → 显示 LoginForm / RegisterForm / WechatQrPanel / WechatBindPanel
 *   - 已登录 → 不渲染此组件（由父组件切换到 profile 卡片）
 *
 * 当 keytar 不可用时（dev 模式 native binding 不匹配等），显示一条黄色提示，
 * 告知用户登录态不会持久化，并给出修复指引。
 */

import React from 'react'
import { Alert, Tabs } from '@arco-design/web-react'
import TabPane from '@arco-design/web-react/lib/Tabs/tab-pane'
import { useAuth } from './AuthContext'
import { LoginForm } from './LoginForm'
import { RegisterForm } from './RegisterForm'
import { WechatQrPanel } from './WechatQrPanel'
import { WechatBindPanel } from './WechatBindPanel'
import { AuthBaseUrlBadge } from './AuthBaseUrlBadge'
import { Icons } from '../Icons'
import './Auth.less'

export function AuthGate(): React.ReactElement {
  const auth = useAuth()
  const activeFlow = auth.flow === 'wechat-bind' ? 'wechat' : auth.flow

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-panel-head">
            <div className="auth-panel-title">登录你的账号</div>
            <div className="auth-panel-subtitle">
              登录后可同步云端会话、模型供应商与团队配置
            </div>
          </div>

          {auth.keytarAvailable === false && (
            <Alert
              type="warning"
              content={
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
            activeTab={activeFlow}
            onChange={(value) => auth.setFlow(value as 'login' | 'register' | 'wechat')}
            type="rounded"
          >
            <TabPane
              key="login"
              title={
                <span className="auth-flow-tab-label">
                  <Icons.User size={14} />
                  <span>登录</span>
                </span>
              }
            />
            <TabPane
              key="register"
              title={
                <span className="auth-flow-tab-label">
                  <Icons.Edit size={14} />
                  <span>注册</span>
                </span>
              }
            />
            <TabPane
              key="wechat"
              title={
                <span className="auth-flow-tab-label">
                  <Icons.Chat size={14} />
                  <span>微信扫码</span>
                </span>
              }
            />
          </Tabs>

          <div className="auth-content">
            {auth.flow === 'login' && <LoginForm />}
            {auth.flow === 'register' && <RegisterForm />}
            {auth.flow === 'wechat' && <WechatQrPanel />}
            {auth.flow === 'wechat-bind' && (
              <WechatBindPanel bindSession={auth.bindSession ?? ''} />
            )}
          </div>

          <AuthBaseUrlBadge />
        </div>
      </div>
    </div>
  )
}
