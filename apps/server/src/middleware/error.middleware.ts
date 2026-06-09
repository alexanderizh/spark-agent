import { Middleware } from '@midwayjs/core'
import { Context, NextFunction } from '@midwayjs/koa'

@Middleware()
export class ErrorResponseMiddleware {
  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      try {
        await next()
      } catch (err: any) {
        const status = err.status ?? 500
        ctx.status = status
        ctx.body = {
          code: status,
          message: err.message ?? 'Internal Server Error',
          ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
        }
      }
    }
  }
}
