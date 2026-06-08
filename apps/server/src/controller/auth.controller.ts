import { Controller, Post, Inject, Body, Query, Get } from '@midwayjs/core'
import { Context } from '@midwayjs/koa'
import { AuthService } from '../service/auth/auth.service'
import { GitHubStrategy } from '../service/auth/github.strategy'
import { WeChatStrategy } from '../service/auth/wechat.strategy'
import { RegisterDTO, LoginDTO, SendSmsDTO, PhoneLoginDTO, RefreshTokenDTO } from '../dto/auth.dto'
import { v4 as uuid } from 'uuid'

@Controller('/auth')
export class AuthController {
  @Inject()
  authService: AuthService

  @Inject()
  githubStrategy: GitHubStrategy

  @Inject()
  wechatStrategy: WeChatStrategy

  @Inject()
  ctx: Context

  @Post('/register')
  async register(@Body() body: RegisterDTO) {
    const tokens = await this.authService.registerByEmail(body.email, body.password, body.nickname)
    return { code: 200, data: tokens }
  }

  @Post('/login')
  async login(@Body() body: LoginDTO) {
    if (body.type === 'phone') {
      throw new Error('Use /auth/phone-login for phone login')
    }
    const tokens = await this.authService.loginByEmail(body.account, body.password)
    return { code: 200, data: tokens }
  }

  @Post('/sms/send')
  async sendSms(@Body() body: SendSmsDTO) {
    await this.authService.sendSmsCode(body.phone)
    return { code: 200, message: 'Verification code sent' }
  }

  @Post('/phone-login')
  async phoneLogin(@Body() body: PhoneLoginDTO) {
    const tokens = await this.authService.loginByPhone(body.phone, body.code)
    return { code: 200, data: tokens }
  }

  @Get('/oauth/github')
  async githubOAuth(@Query('redirect_uri') redirectUri?: string) {
    const config = (this.ctx as any).app.config.oauth?.github
    const state = uuid()
    const url = this.githubStrategy.getAuthorizeUrl(
      config.clientId,
      redirectUri || config.callbackUrl,
      state,
    )
    return { code: 200, data: { url, state } }
  }

  @Get('/oauth/github/callback')
  async githubCallback(@Query('code') code: string) {
    const config = (this.ctx as any).app.config.oauth?.github
    const ghUser = await this.githubStrategy.getUserInfo(code, config.clientId, config.clientSecret)
    const tokens = await this.authService.findOrCreateByOAuth('github', String(ghUser.id), {
      email: ghUser.email ?? undefined,
      nickname: ghUser.name || ghUser.login,
      avatarUrl: ghUser.avatar_url,
    })
    return { code: 200, data: tokens }
  }

  @Get('/oauth/wechat')
  async wechatOAuth() {
    const config = (this.ctx as any).app.config.oauth?.wechat
    const state = uuid()
    const url = this.wechatStrategy.getQrCodeUrl(config.appId, config.callbackUrl, state)
    return { code: 200, data: { url, state } }
  }

  @Get('/oauth/wechat/callback')
  async wechatCallback(@Query('code') code: string) {
    const config = (this.ctx as any).app.config.oauth?.wechat
    const tokenData = await this.wechatStrategy.getAccessToken(code, config.appId, config.appSecret)
    const wxUser = await this.wechatStrategy.getUserInfo(tokenData.access_token, tokenData.openid)
    const tokens = await this.authService.findOrCreateByOAuth('wechat', tokenData.openid, {
      nickname: wxUser.nickname,
      avatarUrl: wxUser.headimgurl,
      openid: tokenData.openid,
      unionid: tokenData.unionid,
    })
    return { code: 200, data: tokens }
  }

  @Post('/refresh')
  async refresh(@Body() body: RefreshTokenDTO) {
    const tokens = await this.authService.refreshTokens(body.refreshToken)
    return { code: 200, data: tokens }
  }

  @Post('/logout')
  async logout() {
    const user = (this.ctx as any).state?.user
    const token = String(this.ctx.get('authorization') ?? '').replace('Bearer ', '')
    if (user && token) {
      await this.authService.logout(user.userId, token)
    }
    return { code: 200, message: 'Logged out' }
  }
}
