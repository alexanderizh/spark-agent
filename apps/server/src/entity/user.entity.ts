import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

export enum UserStatus {
  Active = 'active',
  Disabled = 'disabled',
}

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  email: string

  @Column({ type: 'varchar', length: 20, unique: true, nullable: true })
  phone: string

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'password_hash' })
  passwordHash: string

  @Column({ type: 'varchar', length: 100, nullable: true })
  nickname: string

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'avatar_url' })
  avatarUrl: string

  @Column({ type: 'varchar', length: 100, unique: true, nullable: true, name: 'github_id' })
  githubId: string

  @Column({ type: 'varchar', length: 100, unique: true, nullable: true, name: 'wechat_openid' })
  wechatOpenid: string

  @Column({ type: 'varchar', length: 100, unique: true, nullable: true, name: 'wechat_unionid' })
  wechatUnionid: string

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.Active })
  status: UserStatus

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date
}
