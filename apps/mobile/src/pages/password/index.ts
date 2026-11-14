/**
 * 修改密码页。
 *
 * 走 edu-server 的短信改密链路（/auth/send-change-password-sms + /auth/change-password-by-sms）：
 *   1. 短信发送到「账号绑定的手机号」（账号本身是手机号时即该账号）
 *   2. 新密码至少 8 位
 *   3. 修改成功后服务端吊销所有 session（含本机），需重新登录
 */

import * as authApi from '../../api/auth'
import { clearSession } from '../../api/request'
import { getState } from '../../store/auth'
import { syncPageTheme } from '../../utils/theme'

interface PasswordPageData {
  phone: string
  captchaId: string
  captchaSvg: string
  captchaText: string
  smsCode: string
  newPassword: string
  /** 密码强度提示文案（WXML 不能调 Page 方法，输入时预计算） */
  passwordLevel: string
  confirmPassword: string
  sendingCode: boolean
  codeCountdown: number
  submitting: boolean
  /** 短信服务停用期间：整页短信改密链路禁用，展示引导空状态（client-config 下发，默认禁用） */
  smsDisabled: boolean
}

const COUNTDOWN_SECONDS = 60

let countdownTimer: ReturnType<typeof setInterval> | null = null

/** 密码强度提示（仅展示用；空串表示不展示） */
function passwordLevelOf(pwd: string): string {
  if (pwd.length === 0) return ''
  if (pwd.length < 8) return '至少 8 位'
  let score = 1
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score += 1
  if (/\d/.test(pwd)) score += 1
  if (/[^a-zA-Z0-9]/.test(pwd)) score += 1
  if (score >= 4) return '强'
  if (score >= 3) return '中'
  return '弱'
}

Page({
  data: {
    phone: '',
    captchaId: '',
    captchaSvg: '',
    captchaText: '',
    smsCode: '',
    newPassword: '',
    passwordLevel: '',
    confirmPassword: '',
    sendingCode: false,
    codeCountdown: 0,
    submitting: false,
    smsDisabled: true,
  } as PasswordPageData,

  onLoad() {
    syncPageTheme(this)
    // 拉取认证能力开关：短信服务停用期间整页禁用，仅展示引导提示（配置未到达前按禁用处理）
    authApi
      .getClientConfig()
      .then((cfg) => {
        this.setData({ smsDisabled: cfg.authCapabilities?.smsEnabled !== true })
      })
      .catch(() => undefined)
    // 账号本身是手机号时预填（短信发到绑定手机号 = 账号手机号）
    const account = getState().user?.account ?? ''
    if (/^1[3-9]\d{9}$/.test(account)) {
      this.setData({ phone: account })
    }
    this.loadCaptcha()
  },

  onUnload() {
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  },

  loadCaptcha() {
    authApi
      .getCaptcha()
      .then((captcha) => {
        this.setData({ captchaId: captcha.id, captchaSvg: captcha.svg, captchaText: '' })
      })
      .catch(() => {
        wx.showToast({ title: '验证码加载失败', icon: 'none' })
      })
  },

  onRefreshCaptcha() {
    this.loadCaptcha()
  },

  onCaptchaInput(e: WechatMiniprogram.Input) {
    this.setData({ captchaText: e.detail.value })
  },

  onPhoneInput(e: WechatMiniprogram.Input) {
    this.setData({ phone: e.detail.value })
  },

  onSmsCodeInput(e: WechatMiniprogram.Input) {
    this.setData({ smsCode: e.detail.value })
  },

  onNewPasswordInput(e: WechatMiniprogram.Input) {
    this.setData({ newPassword: e.detail.value, passwordLevel: passwordLevelOf(e.detail.value) })
  },

  onConfirmPasswordInput(e: WechatMiniprogram.Input) {
    this.setData({ confirmPassword: e.detail.value })
  },

  async onSendCode() {
    const { phone, captchaId, captchaText, sendingCode, codeCountdown, smsDisabled } = this.data
    if (sendingCode || codeCountdown > 0) return
    // 兜底：短信服务停用期间不允许触发发送（正常情况下页面已展示禁用态）
    if (smsDisabled) {
      wx.showToast({ title: '短信服务升级中，请前往官网或桌面端修改密码', icon: 'none' })
      return
    }
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) {
      wx.showToast({ title: '请填写账号绑定的手机号', icon: 'none' })
      return
    }
    if (!captchaText.trim()) {
      wx.showToast({ title: '请先填写图片验证码', icon: 'none' })
      return
    }
    this.setData({ sendingCode: true })
    try {
      await authApi.sendChangePasswordSms({ captchaId, captchaText })
      wx.showToast({ title: '验证码已发送', icon: 'success' })
      this.startCountdown()
      this.loadCaptcha()
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '发送失败', icon: 'none' })
      this.loadCaptcha()
    } finally {
      this.setData({ sendingCode: false })
    }
  },

  startCountdown() {
    this.setData({ codeCountdown: COUNTDOWN_SECONDS })
    countdownTimer = setInterval(() => {
      const next = this.data.codeCountdown - 1
      if (next <= 0) {
        if (countdownTimer) clearInterval(countdownTimer)
        countdownTimer = null
        this.setData({ codeCountdown: 0 })
      } else {
        this.setData({ codeCountdown: next })
      }
    }, 1000)
  },

  async onSubmit() {
    const { phone, smsCode, newPassword, confirmPassword, submitting, smsDisabled } = this.data
    if (submitting) return
    // 兜底：短信服务停用期间不允许提交（正常情况下页面已展示禁用态）
    if (smsDisabled) {
      wx.showToast({ title: '短信服务升级中，请前往官网或桌面端修改密码', icon: 'none' })
      return
    }
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) {
      wx.showToast({ title: '请填写账号绑定的手机号', icon: 'none' })
      return
    }
    if (!smsCode.trim()) {
      wx.showToast({ title: '请填写短信验证码', icon: 'none' })
      return
    }
    if (newPassword.length < 8) {
      wx.showToast({ title: '新密码至少 8 位', icon: 'none' })
      return
    }
    if (newPassword !== confirmPassword) {
      wx.showToast({ title: '两次输入的密码不一致', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    try {
      await authApi.changePasswordBySms({
        phone: phone.trim(),
        smsCode: smsCode.trim(),
        newPassword,
      })
      wx.showToast({ title: '密码已修改，请重新登录', icon: 'success' })
      // 服务端已吊销所有 session：清本地态并回登录页
      clearSession()
      setTimeout(() => wx.reLaunch({ url: '/pages/login/index' }), 800)
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '修改失败', icon: 'none' })
      this.loadCaptcha()
    } finally {
      this.setData({ submitting: false })
    }
  },
})
