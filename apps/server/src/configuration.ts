import { Configuration, App, IMidwayApplication } from '@midwayjs/core'
import * as koa from '@midwayjs/koa'
import * as typeorm from '@midwayjs/typeorm'
import * as jwt from '@midwayjs/jwt'
import * as validate from '@midwayjs/validate'
import { JwtMiddleware } from './middleware/jwt.middleware'
import { ErrorResponseMiddleware } from './middleware/error.middleware'

@Configuration({
  imports: [
    koa,
    typeorm,
    jwt,
    validate,
  ],
  importConfigs: [
    './config/',
  ],
})
export class MainConfiguration {
  @App()
  app: IMidwayApplication

  async onReady() {
    this.app.useMiddleware([ErrorResponseMiddleware, JwtMiddleware])
  }
}
