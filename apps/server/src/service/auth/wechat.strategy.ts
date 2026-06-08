import { Provide } from '@midwayjs/core'

export interface WeChatAccessTokenResponse {
  access_token: string
  openid: string
  unionid?: string
}

export interface WeChatUserInfo {
  openid: string
  nickname: string
  headimgurl: string
  unionid?: string
}

@Provide()
export class WeChatStrategy {
  private readonly apiUrl = 'https://api.weixin.qq.com'

  getQrCodeUrl(appId: string, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      appid: appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'snsapi_login',
      state,
    })
    return `https://open.weixin.qq.com/connect/qrconnect?${params}#wechat_redirect`
  }

  async getAccessToken(code: string, appId: string, appSecret: string): Promise<WeChatAccessTokenResponse> {
    const url = `${this.apiUrl}/sns/oauth2/access_token?appid=${appId}&secret=${appSecret}&code=${code}&grant_type=authorization_code`
    const res = await fetch(url)
    const data = await res.json()

    if (data.errcode) {
      throw new Error(`WeChat OAuth error: ${data.errmsg}`)
    }

    return data
  }

  async getUserInfo(accessToken: string, openid: string): Promise<WeChatUserInfo> {
    const url = `${this.apiUrl}/sns/userinfo?access_token=${accessToken}&openid=${openid}`
    const res = await fetch(url)
    const data = await res.json()

    if (data.errcode) {
      throw new Error(`WeChat user info error: ${data.errmsg}`)
    }

    return data
  }
}
