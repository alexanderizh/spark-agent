/**
 * 认证 API（镜像 edu-server auth.controller.ts）。
 */

import { request, uploadFile } from './request'
import type { AuthCaptcha, AuthLoginMode, AuthSession, AuthUserInfo } from '../types'

/** GET /auth/captcha — 图片验证码（SVG data URI） */
export function getCaptcha(): Promise<AuthCaptcha> {
  return request<AuthCaptcha>('/auth/captcha')
}

/** POST /auth/send-code — 发送邮箱验证码（需先过图片验证码） */
export function sendEmailCode(input: {
  account: string
  type: 'register' | 'login'
  captchaId: string
  captchaText: string
}): Promise<{ expire_in: number }> {
  return request<{ expire_in: number }>('/auth/send-code', {
    method: 'POST',
    data: { ...input },
    skipAuth: true,
  })
}

/** POST /auth/login — 登录（password 需 captchaId+captchaText；code 需 emailCode） */
export function login(input: {
  account: string
  loginMode: 'password' | 'code'
  password?: string
  captchaId?: string
  captchaText?: string
  emailCode?: string
}): Promise<AuthSession> {
  return request<AuthSession>('/auth/login', { method: 'POST', data: { ...input }, skipAuth: true })
}

/** POST /auth/login-sms — 短信验证码登录 */
export function loginBySms(input: { phone: string; smsCode: string }): Promise<AuthSession> {
  return request<AuthSession>('/auth/login-sms', {
    method: 'POST',
    data: { ...input },
    skipAuth: true,
  })
}

/** POST /auth/send-sms — 发送短信验证码（需先过图片验证码） */
export function sendSms(input: {
  phone: string
  type?: 'login' | 'register'
  captchaId: string
  captchaText: string
}): Promise<{ expire_in: number }> {
  return request<{ expire_in: number }>('/auth/send-sms', {
    method: 'POST',
    data: { ...input },
    skipAuth: true,
  })
}

/** POST /auth/register — 注册（图片验证码已在 send-code 时消耗） */
export function register(input: {
  account: string
  password: string
  code: string
  inviteCode?: string
}): Promise<AuthSession> {
  return request<AuthSession>('/auth/register', {
    method: 'POST',
    data: { ...input },
    skipAuth: true,
  })
}

/** POST /auth/logout — 退出登录（需携带有效 Token） */
export function logout(): Promise<void> {
  return request<void>('/auth/logout', { method: 'POST' })
}

/** GET /me — 当前用户信息 */
export function getMe(): Promise<AuthUserInfo> {
  return request<AuthUserInfo>('/me')
}

/** PUT /me — 更新昵称 */
export function updateMe(input: { nickname: string }): Promise<void> {
  return request<void>('/me', { method: 'PUT', data: { ...input } })
}

/** POST /me/avatar — 上传头像（multipart，服务端直接落库并返回完整 URL） */
export function uploadAvatar(filePath: string): Promise<{ avatarUrl: string }> {
  return uploadFile<{ avatarUrl: string }>('/me/avatar', filePath)
}

/** POST /auth/send-change-password-sms — 修改密码短信验证码（需图片验证码） */
export function sendChangePasswordSms(input: {
  captchaId: string
  captchaText: string
}): Promise<{ expire_in: number }> {
  return request<{ expire_in: number }>('/auth/send-change-password-sms', {
    method: 'POST',
    data: { ...input },
  })
}

/** POST /auth/change-password-by-sms — 短信验证码设置/修改密码 */
export function changePasswordBySms(input: {
  phone: string
  smsCode: string
  newPassword: string
}): Promise<void> {
  return request<void>('/auth/change-password-by-sms', { method: 'POST', data: { ...input } })
}

export type { AuthLoginMode }
