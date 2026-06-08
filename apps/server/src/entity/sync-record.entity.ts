import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm'

export enum SyncEntityType {
  Agent = 'agent',
  Workflow = 'workflow',
  AppSetting = 'app_setting',
}

export enum SyncAction {
  Create = 'create',
  Update = 'update',
  Delete = 'delete',
}

@Entity('sync_records')
@Index(['userId', 'entityType'])
@Index(['userId', 'syncedAt'])
export class SyncRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string

  @Column({ type: 'enum', enum: SyncEntityType, name: 'entity_type' })
  entityType: SyncEntityType

  @Column({ type: 'varchar', length: 100, name: 'entity_id' })
  entityId: string

  @Column({ type: 'enum', enum: SyncAction })
  action: SyncAction

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>

  @Column({ type: 'int' })
  version: number

  @Column({ type: 'timestamptz', name: 'synced_at' })
  syncedAt: Date

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date
}
