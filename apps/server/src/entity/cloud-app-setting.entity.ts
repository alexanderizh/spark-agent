import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'

@Entity('cloud_app_settings')
@Index(['userId', 'category', 'key'], { unique: true })
export class CloudAppSettingEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string

  @Column({ type: 'varchar', length: 100 })
  category: string

  @Column({ type: 'varchar', length: 200 })
  key: string

  @Column({ type: 'jsonb', default: '{}' })
  value: unknown

  @Column({ type: 'int', default: 1 })
  syncVersion: number

  @Column({ type: 'timestamptz', nullable: true, name: 'local_updated_at' })
  localUpdatedAt: Date

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date
}
