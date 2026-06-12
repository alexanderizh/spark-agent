import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Configuration, App, IMidwayApplication } from '@midwayjs/core'
import * as koa from '@midwayjs/koa'
import * as typeorm from '@midwayjs/typeorm'
import { ErrorResponseMiddleware } from './middleware/error.middleware'

const __dirname = dirname(fileURLToPath(import.meta.url))

@Configuration({
  imports: [
    koa,
    typeorm,
  ],
  importConfigs: [
    join(__dirname, './config/'),
  ],
})
export class MainConfiguration {
  @App()
  app: IMidwayApplication

  async onReady() {
    // 注意：auth/jwt 能力已迁到 spark-edugen/edu-server，本服务仅保留同步 / 数据通道
    this.app.useMiddleware([ErrorResponseMiddleware])
  }
}
