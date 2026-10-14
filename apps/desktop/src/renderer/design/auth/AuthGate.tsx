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
import { useI18n } from '../i18n'
import { Icons } from '../Icons'
import sparkLogo from '../../assets/spark-logo.png'
import './Auth.less'

export interface AuthGateProps {
  /** full = 登录注册页（带左侧品牌叙事）；embed = 引导页嵌入（仅表单） */
  variant?: 'full' | 'embed'
}

export function AuthGate({ variant = 'full' }: AuthGateProps): React.ReactElement {
  const auth = useAuth()
  const { t } = useI18n()
  const isEmbed = variant === 'embed'
  const flowSwitch = isEmbed ? (
    <div className="auth-switch-flow">
      <span>{auth.flow === 'login' ? t('auth.gate.noAccount') : t('auth.gate.hasAccount')}</span>
      <button
        type="button"
        className="auth-switch-flow-link"
        onClick={() => auth.setFlow(auth.flow === 'login' ? 'register' : 'login')}
      >
        {auth.flow === 'login' ? t('auth.gate.goRegister') : t('auth.gate.goLogin')}
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
                {auth.flow === 'login'
                  ? t('auth.gate.eyebrowLogin')
                  : t('auth.gate.eyebrowRegister')}
              </div>
              <h1 className="auth-brand-h">
                {auth.flow === 'login' ? (
                  <>
                    {t('auth.gate.headlineLoginPrefix')}{' '}
                    <span className="auth-brand-accent">{t('auth.gate.headlineLoginAccent')}</span>
                    <br />
                    {t('auth.gate.headlineLoginSuffix')}
                  </>
                ) : (
                  <>
                    {t('auth.gate.headlineRegisterPrefix')}
                    <br />
                    <span className="auth-brand-accent">
                      {t('auth.gate.headlineRegisterAccent')}
                    </span>
                  </>
                )}
              </h1>
              <p className="auth-brand-sub">
                {auth.flow === 'login' ? t('auth.gate.subLogin') : t('auth.gate.subRegister')}
              </p>

              <div className="auth-brand-features">
                <div className="auth-brand-feat">
                  <Icons.Zap size={18} />
                  <div className="auth-brand-feat-text">
                    <strong>{t('auth.gate.feat1Title')}</strong>
                    <span>{t('auth.gate.feat1Desc')}</span>
                  </div>
                </div>
                <div className="auth-brand-feat">
                  <Icons.Lock size={18} />
                  <div className="auth-brand-feat-text">
                    <strong>{t('auth.gate.feat2Title')}</strong>
                    <span>{t('auth.gate.feat2Desc')}</span>
                  </div>
                </div>
                <div className="auth-brand-feat">
                  <Icons.Sparkles size={18} />
                  <div className="auth-brand-feat-text">
                    <strong>{t('auth.gate.feat3Title')}</strong>
                    <span>{t('auth.gate.feat3Desc')}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="auth-brand-foot">
              <span className="auth-brand-dot" />
              <span>{t('auth.gate.foot')}</span>
            </div>
          </aside>
        )}

        {/* 右侧表单区 */}
        <div className="auth-form-side">
          {/* 登录/注册胶囊开关：仅 full 形态显示 */}
          {!isEmbed && (
            <div
              className="auth-mode-switch"
              role="tablist"
              aria-label={t('auth.gate.modeSwitchAriaLabel')}
            >
              <button
                type="button"
                role="tab"
                aria-selected={auth.flow === 'login'}
                className={auth.flow === 'login' ? 'active' : ''}
                onClick={() => auth.setFlow('login')}
              >
                {t('auth.gate.loginTab')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={auth.flow === 'register'}
                className={auth.flow === 'register' ? 'active' : ''}
                onClick={() => auth.setFlow('register')}
              >
                {t('auth.gate.registerTab')}
              </button>
            </div>
          )}

          {auth.keytarAvailable === false && (
            <Alert
              type="warning"
              showIcon
              message={
                <div className="auth-keytar-warn">
                  <div>{t('auth.gate.keytarWarn')}</div>
                  <div className="auth-keytar-warn-fix">
                    {t('auth.gate.keytarFixPrefix')}{' '}
                    <code>pnpm --filter @spark/desktop rebuild keytar</code>{' '}
                    {t('auth.gate.keytarFixOr')}{' '}
                    <code>npx electron-rebuild -f -w keytar</code>{' '}
                    {t('auth.gate.keytarFixSuffix')}
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
