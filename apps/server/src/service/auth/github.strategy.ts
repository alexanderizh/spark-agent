import { Provide } from '@midwayjs/core'

export interface GitHubUser {
  id: number
  login: string
  email: string | null
  avatar_url: string
  name: string | null
}

@Provide()
export class GitHubStrategy {
  private readonly tokenUrl = 'https://github.com/login/oauth/access_token'
  private readonly userApiUrl = 'https://api.github.com/user'

  async getUserInfo(code: string, clientId: string, clientSecret: string): Promise<GitHubUser> {
    const tokenRes = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    })

    const tokenData = await tokenRes.json()
    if (tokenData.error) {
      throw new Error(`GitHub OAuth error: ${tokenData.error_description}`)
    }

    const userRes = await fetch(this.userApiUrl, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/json',
      },
    })

    if (!userRes.ok) {
      throw new Error('Failed to fetch GitHub user info')
    }

    return userRes.json()
  }

  getAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'read:user user:email',
      state,
    })
    return `https://github.com/login/oauth/authorize?${params}`
  }
}
