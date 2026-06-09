import { Controller, Post, Get, Inject, Body, Query } from '@midwayjs/core'
import { Context } from '@midwayjs/koa'
import { SyncService } from '../service/sync.service'
import { SyncPushDTO, SyncPullQuery } from '../dto/sync.dto'

@Controller('/sync')
export class SyncController {
  @Inject()
  syncService: SyncService

  @Inject()
  ctx: Context

  @Post('/push')
  async push(@Body() body: SyncPushDTO) {
    const userId = (this.ctx as any).state.user.userId
    const result = await this.syncService.push(userId, body.items)
    this.ctx.status = result.success ? 200 : 409
    return { code: result.success ? 200 : 409, data: result }
  }

  @Get('/pull')
  async pull(@Query() query: SyncPullQuery) {
    const userId = (this.ctx as any).state.user.userId
    const result = await this.syncService.pull(userId, query.since, query.entityTypes)
    return { code: 200, data: result }
  }

  @Get('/status')
  async status() {
    const userId = (this.ctx as any).state.user.userId
    const status = await this.syncService.getSyncStatus(userId)
    return { code: 200, data: status }
  }
}
