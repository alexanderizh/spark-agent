/**
 * AuthGate - 登录/注册容器
 *
 * 两种形态：
 *   - variant="full"（默认）：登录注册页形态。左品牌叙事区 + 右表单区，
 *     用于 AccountCenterView 未登录态。扁平化横向分栏，避免纵向层级堆叠。
 *   - variant="embed"：引导页嵌入态。只渲染右侧表单区，去掉左侧叙事，
 *     用于 OnboardingView 的 SparkAccountStep。
 *
 * 登录/注册切换：右上角胶囊开关（auth.flow），不再是顶部大 Tab。
 */

import React from 'react'
import { Alert } from 'antd'
import { useAuth } from './AuthContext'
import { LoginForm } from './LoginForm'
import { RegisterForm } from './RegisterForm'
import { Icons } from '../Icons'
import sparkLogo from '../../assets/spark-logo.png'
import './Auth.less'

export interface AuthGateProps {
  /** full = 登录注册页（带左侧品牌叙事）；embed = 引导页嵌入（仅表单） */
  variant?: 'full' | 'embed'
}

export function AuthGate({ variant = 'full' }: AuthGateProps): React.ReactElement {
  const auth = useAuth()
  const isEmbed = variant === 'embed'
  const flowSwitch = isEmbed ? (
    <div className="auth-switch-flow">
      <span>{auth.flow === 'login' ? '没有账号？' : '已有账号？'}</span>
      <button
        type="button"
        className="auth-switch-flow-link"
        onClick={() => auth.setFlow(auth.flow === 'login' ? 'register' : 'login')}
      >
        {auth.flow === 'login' ? '去注册 →' : '去登录 →'}
      </button>
    </div>
  ) : undefined

  return (
    <div className={`auth-page ${isEmbed ? 'auth-page--embed' : 'auth-page--full'}`}>
      <div className="auth-flat">
        {/* 左侧品牌叙事区：仅 full 形态显示 */}
        {!isEmbed && (
          <aside className="auth-brand-side" aria-hidden="true">
            <div className="auth-brand-mark">
              <img src={sparkLogo} alt="" className="auth-brand-logo" draggable={false} />
              <span className="auth-brand-name">SparkWork</span>
            </div>

            <div className="auth-brand-headline">
              <div className="auth-brand-eyebrow">
                <span className="auth-brand-eyebrow-line" />
                {auth.flow === 'login' ? 'Welcome back' : 'Get started'}
              </div>
              <h1 className="auth-brand-h">
                {auth.flow === 'login' ? (
                  <>
                    让 AI <span className="auth-brand-accent">真正</span>
                    <br />
                    为你工作
                  </>
                ) : (
                  <>
                    几秒创建
                    <br />
                    <span className="auth-brand-accent">你的账号</span>
                  </>
                )}
              </h1>
              <p className="auth-brand-sub">
                {auth.flow === 'login'
                  ? '登录后即可使用平台模型，也可接入你已有的第三方模型。'
                  : '注册即享平台模型额度，密钥安全保存在本机。'}
              </p>

              <div className="auth-brand-features">
                <div className="auth-brand-feat">
                  <Icons.Zap size={18} />
                  <div className="auth-brand-feat-text">
                    <strong>3 分钟开箱即用</strong>
                    <span>无需复杂配置</span>
                  </div>
                </div>
                <div className="auth-brand-feat">
                  <Icons.Lock size={18} />
                  <div className="auth-brand-feat-text">
                    <strong>密钥本机安全存储</strong>
                    <span>不上传云端</span>
                  </div>
                </div>
                <div className="auth-brand-feat">
                  <Icons.Sparkles size={18} />
                  <div className="auth-brand-feat-text">
                    <strong>可随时扩展能力</strong>
                    <span>技能 / 工作流 / MCP</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="auth-brand-foot">
              <span className="auth-brand-dot" />
              <span>开箱即用，无需复杂配置</span>
            </div>
          </aside>
        )}

        {/* 右侧表单区 */}
        <div className="auth-form-side">
          {/* 登录/注册胶囊开关：仅 full 形态显示 */}
          {!isEmbed && (
            <div className="auth-mode-switch" role="tablist" aria-label="登录或注册">
              <button
                type="button"
                role="tab"
                aria-selected={auth.flow === 'login'}
                className={auth.flow === 'login' ? 'active' : ''}
                onClick={() => auth.setFlow('login')}
              >
                登录
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={auth.flow === 'register'}
                className={auth.flow === 'register' ? 'active' : ''}
                onClick={() => auth.setFlow('register')}
              >
                注册
              </button>
            </div>
          )}

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

          <div className="auth-form-content">
            {auth.flow === 'login' ? (
              <LoginForm flowSwitch={flowSwitch} />
            ) : (
              <RegisterForm flowSwitch={flowSwitch} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
