import { Provide, Inject } from '@midwayjs/core'
import { InjectEntityModel } from '@midwayjs/typeorm'
import { Repository } from 'typeorm'
import bcrypt from 'bcryptjs'
import { UserEntity, UserStatus } from '../entity/user.entity'

@Provide()
export class UserService {
  @InjectEntityModel(UserEntity)
  userRepo: Repository<UserEntity>

  async getProfile(userId: string) {
    const user = await this.userRepo.findOneBy({ id: userId })
    if (!user) throw new Error('User not found')
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }
  }

  async updateProfile(userId: string, updates: { nickname?: string; avatarUrl?: string }) {
    const user = await this.userRepo.findOneBy({ id: userId })
    if (!user) throw new Error('User not found')

    if (updates.nickname !== undefined) user.nickname = updates.nickname
    if (updates.avatarUrl !== undefined) user.avatarUrl = updates.avatarUrl

    await this.userRepo.save(user)
    return this.getProfile(userId)
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.userRepo.findOneBy({ id: userId })
    if (!user) throw new Error('User not found')
    if (!user.passwordHash) throw new Error('No password set for this account (OAuth user)')

    const valid = await bcrypt.compare(oldPassword, user.passwordHash)
    if (!valid) throw new Error('Incorrect current password')

    user.passwordHash = await bcrypt.hash(newPassword, 12)
    await this.userRepo.save(user)
  }
}
