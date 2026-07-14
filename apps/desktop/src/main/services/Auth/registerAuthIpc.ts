/**
 * registerAuthIpc — 注册所有 auth:* IPC handlers
 *
 * 在 registerAllIpcHandlers() 末尾调用。
 * 每个 handler 直接调用 AuthService 的对应方法（薄包装）。
 */

import { typedIpcHandle } from '../../ipc/typed-ipc.js'
import { createLogger, SparkError } from '@spark/shared'
import { getAuthService } from './AuthService'
import { app, dialog } from 'electron'
import {
  ConnectorConnectionRepository,
  ProviderProfileRepository,
  SettingsRepository,
} from '@spark/storage'
import { getDatabase } from '../../db.js'
import {
  configureCredentialVaultPersistence,
  preloadSecrets,
  type KeystoreRef,
} from '@spark/shared/keystore'
import { createCredentialVaultPersistence } from '../CredentialVaultPersistence.js'

const KEYCHAIN_DISCLOSURE_VERSION = 1
const log = createLogger('auth:keychain-preload')

async function showKeychainDisclosureOnce(): Promise<void> {
  if (process.platform !== 'darwin') return
  const settings = new SettingsRepository(getDatabase())
  if (settings.get('privacy', 'keychain-disclosure-version') === KEYCHAIN_DISCLOSURE_VERSION) return

  await dialog.showMessageBox({
    type: 'info',
    title: '为什么 SparkWork 需要访问钥匙串？',
    message: '您的模型密钥只保存在这台电脑上',
    detail:
      'SparkWork 不会把您的 API Key 上传或保存到平台服务器。为了避免明文保存，安装版会使用 macOS“登录”钥匙串保护这些机密信息。\n\n接下来如果 macOS 询问访问“spark-agent”机密信息，请选择“始终允许”，这样以后启动时就不会重复询问。',
    buttons: ['我知道了，继续'],
    defaultId: 0,
    noLink: true,
  })
  settings.set('privacy', 'keychain-disclosure-version', KEYCHAIN_DISCLOSURE_VERSION)
}

function configuredSecretRefs(): KeystoreRef[] {
  const database = getDatabase()
  const providerRefs = new ProviderProfileRepository(database)
    .listAll()
    .map(row => row.keystore_ref)
    .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
  const connectorRefs = new ConnectorConnectionRepository(database)
    .listAll()
    .map(row => row.keystore_ref)
    .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
  return [...new Set([...providerRefs, ...connectorRefs])] as KeystoreRef[]
}

export function registerAuthIpc(): void {
  configureCredentialVaultPersistence(createCredentialVaultPersistence())
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
      throw new SparkError('UNKNOWN', '续期失败，请重新登录')
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

  typedIpcHandle('auth:send-sms', async (req) =>
    auth().sendSmsCode({
      phone: req.phone,
      captchaId: req.captchaId,
      captchaText: req.captchaText,
    }),
  )

  typedIpcHandle('auth:login-sms', async (req) =>
    auth().loginBySms({ phone: req.phone, smsCode: req.smsCode }),
  )

  typedIpcHandle('auth:client-config', async () => auth().getClientConfig())

  typedIpcHandle('auth:update-me', async (req) =>
    auth().updateMe({ nickname: req.nickname }),
  )

  typedIpcHandle('auth:upload-avatar', async (req) =>
    auth().uploadAvatar({
      dataUrl: req.dataUrl,
      ...(req.fileName !== undefined ? { fileName: req.fileName } : {}),
      ...(req.mimeType !== undefined ? { mimeType: req.mimeType } : {}),
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

  typedIpcHandle('auth:set-base-url', async () => auth().setBaseUrl(''))

  typedIpcHandle('auth:get-base-url', async () => auth().getBaseUrl())

  typedIpcHandle('auth:bootstrap', async () => {
    try {
      const refs = configuredSecretRefs()
      const willReadSecrets = refs.length > 0 || auth().getCurrentUserId() != null
      if (app.isPackaged && willReadSecrets) await showKeychainDisclosureOnce()
      await preloadSecrets(refs)
    } catch (error) {
      // 用户可以拒绝 macOS Keychain 授权；本地 DB/系统凭证库暂不可用也不应阻断 Spark 登录。
      log.warn(`credential startup preparation skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
    return auth().bootstrap()
  })

  typedIpcHandle('auth:upload-file', async (req) =>
    auth().uploadFile({
      ...(req.dataUrl !== undefined ? { dataUrl: req.dataUrl } : {}),
      ...(req.filePath !== undefined ? { filePath: req.filePath } : {}),
      ...(req.fileName !== undefined ? { fileName: req.fileName } : {}),
      ...(req.mimeType !== undefined ? { mimeType: req.mimeType } : {}),
    }),
  )
}
