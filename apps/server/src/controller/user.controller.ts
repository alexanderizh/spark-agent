import { Controller, Get, Put, Inject, Body } from '@midwayjs/core'
import { Context } from '@midwayjs/koa'
import { UserService } from '../service/user.service'
import { UpdateProfileDTO, ChangePasswordDTO } from '../dto/user.dto'

@Controller('/user')
export class UserController {
  @Inject()
  userService: UserService

  @Inject()
  ctx: Context

  @Get('/profile')
  async getProfile() {
    const userId = (this.ctx as any).state.user.userId
    const profile = await this.userService.getProfile(userId)
    return { code: 200, data: profile }
  }

  @Put('/profile')
  async updateProfile(@Body() body: UpdateProfileDTO) {
    const userId = (this.ctx as any).state.user.userId
    const profile = await this.userService.updateProfile(userId, body)
    return { code: 200, data: profile }
  }

  @Put('/password')
  async changePassword(@Body() body: ChangePasswordDTO) {
    const userId = (this.ctx as any).state.user.userId
    await this.userService.changePassword(userId, body.oldPassword, body.newPassword)
    return { code: 200, message: 'Password changed' }
  }
}
