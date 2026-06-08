import { Provide, Inject } from '@midwayjs/core'
import { InjectEntityModel } from '@midwayjs/typeorm'
import { Repository } from 'typeorm'
import { CloudAgentEntity } from '../entity/cloud-agent.entity'
import { CloudWorkflowEntity } from '../entity/cloud-workflow.entity'
import { CloudAppSettingEntity } from '../entity/cloud-app-setting.entity'
import { SyncRecordEntity, SyncEntityType, SyncAction } from '../entity/sync-record.entity'

interface SyncPushItem {
  entityType: string
  entityId: string
  action: string
  payload: Record<string, unknown>
  version: number
  localUpdatedAt: string
}

export interface SyncPushResult {
  success: boolean
  conflicts?: Array<{
    entityId: string
    serverVersion: number
    clientVersion: number
  }>
}

export interface SyncPullResult {
  changes: Array<{
    entityType: string
    entityId: string
    action: string
    payload: Record<string, unknown>
    version: number
    updatedAt: string
  }>
  hasMore: boolean
}

@Provide()
export class SyncService {
  @InjectEntityModel(CloudAgentEntity)
  agentRepo: Repository<CloudAgentEntity>

  @InjectEntityModel(CloudWorkflowEntity)
  workflowRepo: Repository<CloudWorkflowEntity>

  @InjectEntityModel(CloudAppSettingEntity)
  settingRepo: Repository<CloudAppSettingEntity>

  @InjectEntityModel(SyncRecordEntity)
  syncRecordRepo: Repository<SyncRecordEntity>

  async push(userId: string, items: SyncPushItem[]): Promise<SyncPushResult> {
    const conflicts: SyncPushResult['conflicts'] = []

    for (const item of items) {
      const repo = this.getRepo(item.entityType)
      if (!repo) continue

      const existing = await repo.findOne({
        where: { userId, localId: item.entityId } as any,
      })

      if (existing && (existing as any).version > item.version) {
        conflicts.push({
          entityId: item.entityId,
          serverVersion: (existing as any).version,
          clientVersion: item.version,
        })
        continue
      }

      if (item.action === 'delete') {
        if (existing) {
          await repo.remove(existing)
        }
      } else {
        const entity = existing || (repo as any).create()
        Object.assign(entity, {
          ...this.mapPayload(item.entityType, item.payload),
          userId,
          localId: item.entityId,
          version: existing ? (existing as any).version + 1 : 1,
          localUpdatedAt: new Date(item.localUpdatedAt),
        })
        await repo.save(entity)
      }

      await this.syncRecordRepo.save(
        this.syncRecordRepo.create({
          userId,
          entityType: item.entityType as SyncEntityType,
          entityId: item.entityId,
          action: item.action as SyncAction,
          payload: item.payload,
          version: item.version,
          syncedAt: new Date(),
        }),
      )
    }

    return {
      success: conflicts.length === 0,
      ...(conflicts.length > 0 && { conflicts }),
    }
  }

  async pull(userId: string, since: string, entityTypes?: string[]): Promise<SyncPullResult> {
    const qb = this.syncRecordRepo
      .createQueryBuilder('r')
      .where('r.userId = :userId', { userId })
      .andWhere('r.syncedAt > :since', { since: new Date(since) })
      .orderBy('r.syncedAt', 'ASC')
      .limit(200)

    if (entityTypes?.length) {
      qb.andWhere('r.entityType IN (:...entityTypes)', { entityTypes })
    }

    const records = await qb.getMany()

    return {
      changes: records.map((r) => ({
        entityType: r.entityType,
        entityId: r.entityId,
        action: r.action,
        payload: r.payload,
        version: r.version,
        updatedAt: r.syncedAt.toISOString(),
      })),
      hasMore: records.length === 200,
    }
  }

  async getSyncStatus(userId: string): Promise<Record<string, { count: number; lastSync: string | null }>> {
    const types = [SyncEntityType.Agent, SyncEntityType.Workflow, SyncEntityType.AppSetting]
    const result: Record<string, any> = {}

    for (const type of types) {
      const count = await this.syncRecordRepo.count({
        where: { userId, entityType: type },
      })
      const last = await this.syncRecordRepo.findOne({
        where: { userId, entityType: type },
        order: { syncedAt: 'DESC' },
      })
      result[type] = {
        count,
        lastSync: last?.syncedAt?.toISOString() ?? null,
      }
    }

    return result
  }

  private getRepo(entityType: string): Repository<any> | null {
    switch (entityType) {
      case 'agent': return this.agentRepo
      case 'workflow': return this.workflowRepo
      case 'app_setting': return this.settingRepo
      default: return null
    }
  }

  private mapPayload(entityType: string, payload: Record<string, unknown>): Record<string, unknown> {
    return payload
  }
}
