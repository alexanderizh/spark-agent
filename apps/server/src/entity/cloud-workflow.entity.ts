import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'

@Entity('cloud_workflows')
@Index(['userId', 'localId'], { unique: true })
export class CloudWorkflowEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string

  @Column({ type: 'varchar', length: 100, name: 'local_id' })
  localId: string

  @Column({ type: 'varchar', length: 50 })
  scope: string

  @Column({ type: 'varchar', length: 200 })
  name: string

  @Column({ type: 'varchar', length: 20, default: '1.0.0' })
  version: string

  @Column({ type: 'text', default: '' })
  description: string

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: string

  @Column({ type: 'jsonb', default: '[]' })
  tags: string[]

  @Column({ type: 'boolean', default: true })
  enabled: boolean

  @Column({ type: 'jsonb', default: '{}' })
  graph: Record<string, unknown>

  @Column({ type: 'int', default: 1 })
  syncVersion: number

  @Column({ type: 'timestamptz', nullable: true, name: 'local_updated_at' })
  localUpdatedAt: Date

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date
}
