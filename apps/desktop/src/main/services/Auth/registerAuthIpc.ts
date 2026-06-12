/**
 * registerAuthIpc — 注册所有 auth:* IPC handlers
 *
 * 在 registerAllIpcHandlers() 末尾调用。
 * 每个 handler 直接调用 AuthService 的对应方法（薄包装）。
 */

import { typedIpcHandle } from '../../ipc/typed-ipc.js'
import { getAuthService } from './AuthService'

export function registerAuthIpc(): void {
  const auth = () => getAuthService()

  typedIpcHandle('auth:captcha', async () => auth().getCaptcha())

  typedIpcHandle('auth:send-code', async (req) =>
    auth().sendCode({
      account: req.account,
      type: req.type,
      captchaId: req.captchaId,
      captchaText: req.captchaText,
    }),
  )

  typedIpcHandle('auth:register', async (req) =>
    auth().register({
      account: req.account,
      password: req.password,
      code: req.code,
      ...(req.inviteCode ? { inviteCode: req.inviteCode } : {}),
    }),
  )

  typedIpcHandle('auth:login', async (req) =>
    auth().login({
      account: req.account,
      loginMode: req.loginMode,
      ...(req.password ? { password: req.password } : {}),
      ...(req.captchaId ? { captchaId: req.captchaId } : {}),
      ...(req.captchaText ? { captchaText: req.captchaText } : {}),
      ...(req.emailCode ? { emailCode: req.emailCode } : {}),
    }),
  )

  typedIpcHandle('auth:refresh', async () => {
    // 通常不需要调用（EduServerClient 收到 401 会自动续期）
    // 这里保留供设置页等场景"手动刷新"
    const session = await auth().forceRefresh()
    if (!session) {
      throw new Error('续期失败，请重新登录')
    }
    return session
  })

  typedIpcHandle('auth:logout', async () => auth().logout())

  typedIpcHandle('auth:me', async () => auth().getMe())

  typedIpcHandle('auth:bind-status', async () => auth().getBindStatus())

  typedIpcHandle('auth:change-password', async (req) =>
    auth().changePassword({
      oldPassword: req.oldPassword,
      newPassword: req.newPassword,
    }),
  )

  typedIpcHandle('auth:wechat-qr', async () => auth().wechatQr())

  typedIpcHandle('auth:wechat-poll', async (req) => auth().wechatPoll(req.state))

  typedIpcHandle('auth:wechat-bind-email-send-code', async (req) =>
    auth().wechatBindEmailSendCode({
      bindSession: req.bindSession,
      email: req.email,
      captchaId: req.captchaId,
      captchaText: req.captchaText,
    }),
  )

  typedIpcHandle('auth:wechat-bind-email', async (req) =>
    auth().wechatBindEmail({
      bindSession: req.bindSession,
      code: req.code,
    }),
  )

  typedIpcHandle('auth:set-base-url', async (req) => auth().setBaseUrl(req.baseUrl))

  typedIpcHandle('auth:get-base-url', async () => auth().getBaseUrl())

  typedIpcHandle('auth:bootstrap', async () => auth().bootstrap())
}
