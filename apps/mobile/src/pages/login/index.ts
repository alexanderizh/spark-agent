/**
 * 登录 / 注册页。
 *
 * 与桌面端、edu-web 共用同一 edu-server 账号体系（/api/v1/auth/*），
 * 同一账户登录后即可与桌面端双向同步（见「同步」页）。
 *
 * 三种登录方式（loginMode）：
 *   password — 账号 + 密码 + 图片验证码
 *   code     — 账号（邮箱）+ 邮箱验证码（发送前需图片验证码）
 *   sms      — 手机号 + 短信验证码（发送前需图片验证码）
 * 注册走 code 模式（account 为邮箱）。
 */

import * as authApi from '../../api/auth'
import { loginWithSession } from '../../store/auth'

type LoginMode = 'password' | 'code' | 'sms'

interface LoginPageData {
  mode: LoginMode
  registering: boolean
  account: string
  password: string
  emailCode: string
  phone: string
  smsCode: string
  inviteCode: string
  captchaId: string
  captchaSvg: string
  captchaText: string
  sendingCode: boolean
  codeCountdown: number
  submitting: boolean
}

const COUNTDOWN_SECONDS = 60

let countdownTimer: ReturnType<typeof setInterval> | null = null

Page({
  data: {
    mode: 'password',
    registering: false,
    account: '',
    password: '',
    emailCode: '',
    phone: '',
    smsCode: '',
    inviteCode: '',
    captchaId: '',
    captchaSvg: '',
    captchaText: '',
    sendingCode: false,
    codeCountdown: 0,
    submitting: false,
  } as LoginPageData,

  onUnload() {
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  },

  // ─── 验证码 ─────────────────────────────────────────────────────────────────

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

  // ─── 表单 ───────────────────────────────────────────────────────────────────

  onModeChange(e: WechatMiniprogram.CustomEvent) {
    const mode = e.currentTarget.dataset.mode as LoginMode
    if (mode === this.data.mode) return
    this.setData({ mode, registering: false, captchaText: '' })
    this.loadCaptcha()
  },

  onToggleRegister() {
    const registering = !this.data.registering
    // 注册必须走邮箱验证码模式
    this.setData({ registering, mode: registering ? 'code' : this.data.mode, captchaText: '' })
    this.loadCaptcha()
  },

  onAccountInput(e: WechatMiniprogram.Input) {
    this.setData({ account: e.detail.value })
  },

  onPasswordInput(e: WechatMiniprogram.Input) {
    this.setData({ password: e.detail.value })
  },

  onEmailCodeInput(e: WechatMiniprogram.Input) {
    this.setData({ emailCode: e.detail.value })
  },

  onPhoneInput(e: WechatMiniprogram.Input) {
    this.setData({ phone: e.detail.value })
  },

  onSmsCodeInput(e: WechatMiniprogram.Input) {
    this.setData({ smsCode: e.detail.value })
  },

  onInviteCodeInput(e: WechatMiniprogram.Input) {
    this.setData({ inviteCode: e.detail.value })
  },

  // ─── 发送验证码 ─────────────────────────────────────────────────────────────

  async onSendCode() {
    const {
      mode,
      registering,
      account,
      phone,
      captchaId,
      captchaText,
      sendingCode,
      codeCountdown,
    } = this.data
    if (sendingCode || codeCountdown > 0) return
    if (!captchaText.trim()) {
      wx.showToast({ title: '请先填写图片验证码', icon: 'none' })
      return
    }
    const isSms = mode === 'sms'
    const target = isSms ? phone.trim() : account.trim()
    if (!target) {
      wx.showToast({ title: isSms ? '请先填写手机号' : '请先填写邮箱账号', icon: 'none' })
      return
    }
    if (isSms && !/^1[3-9]\d{9}$/.test(target)) {
      wx.showToast({ title: '手机号格式不正确', icon: 'none' })
      return
    }
    if (!isSms && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      wx.showToast({ title: '邮箱格式不正确', icon: 'none' })
      return
    }

    this.setData({ sendingCode: true })
    try {
      if (isSms) {
        await authApi.sendSms({
          phone: target,
          type: registering ? 'register' : 'login',
          captchaId,
          captchaText,
        })
      } else {
        await authApi.sendEmailCode({
          account: target,
          type: registering ? 'register' : 'login',
          captchaId,
          captchaText,
        })
      }
      wx.showToast({ title: '验证码已发送', icon: 'success' })
      this.startCountdown()
      // 服务端验证码单次有效，发送后立即换一张
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

  // ─── 提交 ───────────────────────────────────────────────────────────────────

  async onSubmit() {
    if (this.data.submitting) return
    const {
      mode,
      registering,
      account,
      password,
      captchaId,
      captchaText,
      emailCode,
      phone,
      smsCode,
      inviteCode,
    } = this.data

    if (registering) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.trim())) {
        wx.showToast({ title: '请填写正确的邮箱账号', icon: 'none' })
        return
      }
      if (password.length < 6) {
        wx.showToast({ title: '密码至少 6 位', icon: 'none' })
        return
      }
      if (!emailCode.trim()) {
        wx.showToast({ title: '请填写邮箱验证码', icon: 'none' })
        return
      }
      this.setData({ submitting: true })
      try {
        const session = await authApi.register({
          account: account.trim(),
          password,
          code: emailCode.trim(),
          ...(inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {}),
        })
        await this.finishLogin(session)
      } catch (error) {
        wx.showToast({ title: (error as Error).message || '注册失败', icon: 'none' })
        this.loadCaptcha()
      } finally {
        this.setData({ submitting: false })
      }
      return
    }

    if (mode === 'password') {
      if (!account.trim() || !password) {
        wx.showToast({ title: '请填写账号和密码', icon: 'none' })
        return
      }
      if (!captchaText.trim()) {
        wx.showToast({ title: '请填写图片验证码', icon: 'none' })
        return
      }
      this.setData({ submitting: true })
      try {
        const session = await authApi.login({
          account: account.trim(),
          loginMode: 'password',
          password,
          captchaId,
          captchaText,
        })
        await this.finishLogin(session)
      } catch (error) {
        wx.showToast({ title: (error as Error).message || '登录失败', icon: 'none' })
        this.loadCaptcha()
      } finally {
        this.setData({ submitting: false })
      }
      return
    }

    if (mode === 'code') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.trim())) {
        wx.showToast({ title: '请填写正确的邮箱账号', icon: 'none' })
        return
      }
      if (!emailCode.trim()) {
        wx.showToast({ title: '请填写邮箱验证码', icon: 'none' })
        return
      }
      this.setData({ submitting: true })
      try {
        const session = await authApi.login({
          account: account.trim(),
          loginMode: 'code',
          emailCode: emailCode.trim(),
        })
        await this.finishLogin(session)
      } catch (error) {
        wx.showToast({ title: (error as Error).message || '登录失败', icon: 'none' })
      } finally {
        this.setData({ submitting: false })
      }
      return
    }

    // sms
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) {
      wx.showToast({ title: '请填写正确的手机号', icon: 'none' })
      return
    }
    if (!smsCode.trim()) {
      wx.showToast({ title: '请填写短信验证码', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      const session = await authApi.loginBySms({ phone: phone.trim(), smsCode: smsCode.trim() })
      await this.finishLogin(session)
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '登录失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  async finishLogin(session: { token: string; refreshToken: string; userId: string }) {
    await loginWithSession(session)
    wx.showToast({ title: this.data.registering ? '注册成功' : '登录成功', icon: 'success' })
    setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 600)
  },
})
