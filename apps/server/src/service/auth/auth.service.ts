import { Provide, Inject } from '@midwayjs/core'
import { JwtService } from '@midwayjs/jwt'
import { InjectEntityModel } from '@midwayjs/typeorm'
import { Repository } from 'typeorm'
import { v4 as uuid } from 'uuid'
import bcrypt from 'bcryptjs'
import { UserEntity, UserStatus } from '../../entity/user.entity'
import { RedisService } from '../redis.service'

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

interface UserPayload {
  userId: string
  email?: string
  phone?: string
  nickname?: string
}

@Provide()
export class AuthService {
  @Inject()
  jwtService: JwtService

  @Inject()
  redisService: RedisService

  @InjectEntityModel(UserEntity)
  userRepo: Repository<UserEntity>

  private readonly ACCESS_EXPIRY = '15m'
  private readonly REFRESH_EXPIRY_SECONDS = 7 * 24 * 3600

  // ── 邮箱注册 ──────────────────────────────────────────
  async registerByEmail(email: string, password: string, nickname?: string) {
    const existing = await this.userRepo.findOneBy({ email })
    if (existing) {
      throw new Error('Email already registered')
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const user = this.userRepo.create({
      email,
      passwordHash,
      nickname: nickname || email.split('@')[0],
      status: UserStatus.Active,
    })
    await this.userRepo.save(user)
    return this.generateTokenPair(user)
  }

  // ── 邮箱登录 ──────────────────────────────────────────
  async loginByEmail(email: string, password: string): Promise<TokenPair> {
    const user = await this.userRepo.findOneBy({ email })
    if (!user || !user.passwordHash) {
      throw new Error('Invalid email or password')
    }
    if (user.status !== UserStatus.Active) {
      throw new Error('Account is disabled')
    }
    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      throw new Error('Invalid email or password')
    }
    return this.generateTokenPair(user)
  }

  // ── 手机号验证码登录 ──────────────────────────────────
  async loginByPhone(phone: string, code: string): Promise<TokenPair> {
    const cacheKey = `sms:code:${phone}`
    const cached = await this.redisService.get(cacheKey)
    if (!cached || cached !== code) {
      throw new Error('Invalid or expired verification code')
    }
    await this.redisService.del(cacheKey)

    let user = await this.userRepo.findOneBy({ phone })
    if (!user) {
      user = this.userRepo.create({
        phone,
        nickname: `User_${phone.slice(-4)}`,
        status: UserStatus.Active,
      })
      await this.userRepo.save(user)
    }
    if (user.status !== UserStatus.Active) {
      throw new Error('Account is disabled')
    }
    return this.generateTokenPair(user)
  }

  // ── 发送短信验证码 ────────────────────────────────────
  async sendSmsCode(phone: string): Promise<void> {
    const rateKey = `sms:rate:${phone}`
    const sent = await this.redisService.incr(rateKey)
    if (sent === 1) {
      await this.redisService.expire(rateKey, 60)
    }
    if (sent > 1) {
      throw new Error('Please wait 60 seconds before requesting another code')
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const cacheKey = `sms:code:${phone}`
    await this.redisService.set(cacheKey, code, 300)

    // TODO: 接入阿里云 SMS API
    console.log(`[SMS] Code for ${phone}: ${code}`)
  }

  // ── 刷新 Token ────────────────────────────────────────
  async refreshTokens(oldRefreshToken: string): Promise<TokenPair> {
    const prefix = 'auth:refresh:'
    const userId = await this.redisService.get(prefix + oldRefreshToken)
    if (!userId) {
      throw new Error('Invalid or expired refresh token')
    }

    await this.redisService.del(prefix + oldRefreshToken)

    const user = await this.userRepo.findOneBy({ id: userId })
    if (!user || user.status !== UserStatus.Active) {
      throw new Error('User not found or disabled')
    }
    return this.generateTokenPair(user)
  }

  // ── 登出 ──────────────────────────────────────────────
  async logout(userId: string, accessToken: string): Promise<void> {
    const decoded = await this.jwtService.verify(accessToken) as any
    const ttl = Math.max((decoded.exp - Date.now() / 1000), 0)
    if (ttl > 0) {
      await this.redisService.set(`auth:blacklist:${accessToken}`, '1', Math.ceil(ttl))
    }
  }

  // ── OAuth 登录（GitHub / 微信）─────────────────────────
  async findOrCreateByOAuth(
    provider: 'github' | 'wechat',
    providerId: string,
    extra: { email?: string; nickname?: string; avatarUrl?: string; openid?: string; unionid?: string },
  ): Promise<TokenPair> {
    const field = provider === 'github' ? 'githubId' : 'wechatOpenid'
    let user = await this.userRepo.findOneBy({ [field]: providerId })

    if (!user) {
      user = this.userRepo.create({
        ...(provider === 'github' ? { githubId: providerId } : {
          wechatOpenid: extra.openid || providerId,
          wechatUnionid: extra.unionid,
        }),
        email: extra.email || null,
        nickname: extra.nickname || `User_${providerId.slice(0, 6)}`,
        avatarUrl: extra.avatarUrl || null,
        status: UserStatus.Active,
      })
      await this.userRepo.save(user)
    }

    return this.generateTokenPair(user)
  }

  // ── Token 验证 ────────────────────────────────────────
  async verifyAccessToken(token: string): Promise<UserPayload> {
    const blacklisted = await this.isTokenBlacklisted(token)
    if (blacklisted) {
      throw new Error('Token has been revoked')
    }
    return this.jwtService.verify(token) as unknown as UserPayload
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    return this.redisService.exists(`auth:blacklist:${token}`)
  }

  // ── GitHub OAuth ──────────────────────────────────────
  getGitHubAuthUrl(clientId: string, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'read:user user:email',
      state,
    })
    return `https://github.com/login/oauth/authorize?${params}`
  }

  async getGitHubUserInfo(code: string, clientId: string, clientSecret: string) {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    })
    const tokenData = await tokenRes.json()
    if (tokenData.error) throw new Error(`GitHub OAuth error: ${tokenData.error_description}`)

    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' },
    })
    if (!userRes.ok) throw new Error('Failed to fetch GitHub user info')
    return userRes.json()
  }

  // ── 微信 OAuth ────────────────────────────────────────
  getWeChatQrCodeUrl(appId: string, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      appid: appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'snsapi_login',
      state,
    })
    return `https://open.weixin.qq.com/connect/qrconnect?${params}#wechat_redirect`
  }

  async getWeChatAccessToken(code: string, appId: string, appSecret: string) {
    const url = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${appId}&secret=${appSecret}&code=${code}&grant_type=authorization_code`
    const res = await fetch(url)
    const data = await res.json()
    if (data.errcode) throw new Error(`WeChat OAuth error: ${data.errmsg}`)
    return data
  }

  async getWeChatUserInfo(accessToken: string, openid: string) {
    const url = `https://api.weixin.qq.com/sns/userinfo?access_token=${accessToken}&openid=${openid}`
    const res = await fetch(url)
    const data = await res.json()
    if (data.errcode) throw new Error(`WeChat user info error: ${data.errmsg}`)
    return data
  }

  // ── 内部方法 ──────────────────────────────────────────
  private async generateTokenPair(user: UserEntity): Promise<TokenPair> {
    const payload: UserPayload = {
      userId: user.id,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      nickname: user.nickname ?? undefined,
    }

    const accessToken = await this.jwtService.sign(payload, { expiresIn: this.ACCESS_EXPIRY })
    const refreshToken = uuid()
    await this.redisService.set(
      `auth:refresh:${refreshToken}`,
      user.id,
      this.REFRESH_EXPIRY_SECONDS,
    )

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60,
    }
  }
}
