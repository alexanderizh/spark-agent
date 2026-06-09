import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'

@Entity('cloud_agents')
@Index(['userId', 'localId'], { unique: true })
export class CloudAgentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string

  @Column({ type: 'varchar', length: 100, name: 'local_id' })
  localId: string

  @Column({ type: 'varchar', length: 200 })
  name: string

  @Column({ type: 'text', default: '' })
  description: string

  @Column({ type: 'boolean', default: false, name: 'built_in' })
  builtIn: boolean

  @Column({ type: 'boolean', default: true })
  enabled: boolean

  @Column({ type: 'boolean', default: false, name: 'is_default' })
  isDefault: boolean

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'provider_profile_id' })
  providerProfileId: string

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'model_id' })
  modelId: string

  @Column({ type: 'varchar', length: 50, default: 'claude-sdk', name: 'agent_adapter' })
  agentAdapter: string

  @Column({ type: 'varchar', length: 50, default: 'claude-ask', name: 'permission_mode' })
  permissionMode: string

  @Column({ type: 'varchar', length: 20, default: 'medium', name: 'reasoning_effort' })
  reasoningEffort: string

  @Column({ type: 'text', default: '' })
  prompt: string

  @Column({ type: 'jsonb', default: '[]', name: 'rule_ids' })
  ruleIds: string[]

  @Column({ type: 'jsonb', default: '[]', name: 'skill_ids' })
  skillIds: string[]

  @Column({ type: 'jsonb', default: '[]', name: 'disabled_skill_ids' })
  disabledSkillIds: string[]

  @Column({ type: 'jsonb', default: '[]', name: 'mcp_server_ids' })
  mcpServerIds: string[]

  @Column({ type: 'jsonb', default: '{}', name: 'hook_config' })
  hookConfig: Record<string, unknown>

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'workflow_id' })
  workflowId: string

  @Column({ type: 'jsonb', default: '{}' })
  metadata: Record<string, unknown>

  @Column({ type: 'int', default: 1 })
  version: number

  @Column({ type: 'timestamptz', nullable: true, name: 'local_updated_at' })
  localUpdatedAt: Date

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date
}
