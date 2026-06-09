import { Rule, RuleType } from '@midwayjs/validate'

export class SyncPushDTO {
  @Rule(RuleType.array().items(
    RuleType.object({
      entityType: RuleType.string().valid('agent', 'workflow', 'app_setting').required(),
      entityId: RuleType.string().required(),
      action: RuleType.string().valid('create', 'update', 'delete').required(),
      payload: RuleType.object().required(),
      version: RuleType.number().integer().min(1).required(),
      localUpdatedAt: RuleType.string().isoDate().required(),
    }),
  ).min(1).required())
  items: Array<{
    entityType: string
    entityId: string
    action: string
    payload: Record<string, unknown>
    version: number
    localUpdatedAt: string
  }>
}

export class SyncPullQuery {
  @Rule(RuleType.string().isoDate().required())
  since: string

  @Rule(RuleType.array().items(RuleType.string().valid('agent', 'workflow', 'app_setting')).optional())
  entityTypes?: string[]
}
