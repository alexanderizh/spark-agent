import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Configuration, App, IMidwayApplication } from '@midwayjs/core'
import * as koa from '@midwayjs/koa'
import * as typeorm from '@midwayjs/typeorm'
import * as jwt from '@midwayjs/jwt'
import * as validate from '@midwayjs/validate'
import { JwtMiddleware } from './middleware/jwt.middleware'
import { ErrorResponseMiddleware } from './middleware/error.middleware'

const __dirname = dirname(fileURLToPath(import.meta.url))

@Configuration({
  imports: [
    koa,
    typeorm,
    jwt,
    validate,
  ],
  importConfigs: [
    join(__dirname, './config/'),
  ],
})
export class MainConfiguration {
  @App()
  app: IMidwayApplication

  async onReady() {
    this.app.useMiddleware([ErrorResponseMiddleware, JwtMiddleware])
  }
}
