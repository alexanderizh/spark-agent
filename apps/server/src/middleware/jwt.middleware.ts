import { Inject, Middleware } from '@midwayjs/core'
import { Context, NextFunction } from '@midwayjs/koa'
import { JwtService } from '@midwayjs/jwt'

const PUBLIC_PATHS = [
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/phone-login',
  '/api/auth/sms/send',
  '/api/auth/oauth/',
  '/api/auth/refresh',
]

@Middleware()
export class JwtMiddleware {
  @Inject()
  jwtService: JwtService

  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      if (this.isPublicPath(ctx.path)) {
        return next()
      }

      const authHeader = ctx.get('authorization')
      if (!authHeader) {
        ctx.status = 401
        ctx.body = { code: 401, message: 'Missing authorization header' }
        return
      }

      const parts = authHeader.trim().split(' ')
      if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) {
        ctx.status = 401
        ctx.body = { code: 401, message: 'Invalid authorization format' }
        return
      }

      try {
        const decoded = await this.jwtService.verify(parts[1], { complete: true })
        ;(ctx as any).state = (ctx as any).state || {}
        ;(ctx as any).state.user = decoded
        await next()
      } catch {
        ctx.status = 401
        ctx.body = { code: 401, message: 'Token expired or invalid' }
      }
    }
  }

  private isPublicPath(path: string): boolean {
    return PUBLIC_PATHS.some((p) => path.startsWith(p))
  }
}
