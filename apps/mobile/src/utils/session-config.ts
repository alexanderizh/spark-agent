/**
 * 新建会话配置（首页 / 项目页等「发送首条消息时建会话」的入口共用）。
 *
 * 选项来自桌面端目录 bridge.getCatalog。权限与推理只列目标端真实支持的档位，
 * 不再塞一个「电脑默认」合成项——初始档位取默认助手在电脑上的当前设置
 * （catalog.agents[].permissionMode / reasoningEffort），用户不改就不会改变行为。
 */

import type { BridgeCatalog } from '../api/bridge'
import { PERMISSION_LABELS, REASONING_LABELS } from './session-config-labels'

export { PERMISSION_LABELS, REASONING_LABELS } from './session-config-labels'

export interface SessionConfigOption {
  id: string
  label: string
  /** 模型选项专用：渠道 id（patch 时写入 providerProfileId） */
  providerProfileId?: string
  /** 模型选项专用：null = 渠道自动路由 / 渠道默认模型 */
  modelId?: string | null
  /** 推理强度档位原值 */
  value?: string
}

/** 新会话的默认模型档（用户未选择时沿用电脑端默认，不 patch） */
export const DEFAULT_MODEL_OPTION: SessionConfigOption = { id: 'default', label: '电脑默认模型' }

/** 目录未就绪时的占位，不是可选项：加载完立刻被真实档位替换 */
export const PENDING_PERMISSION_OPTION: SessionConfigOption = { id: 'pending', label: '读取中…' }
export const PENDING_REASONING_OPTION: SessionConfigOption = { id: 'pending', label: '读取中…' }

/** 新会话将使用的 adapter：取默认助手的 adapter，目录缺失时按 claude 兜底 */
export function defaultCatalogAdapter(catalog: BridgeCatalog): string {
  return catalog.agents.find((agent) => agent.isDefault)?.agentAdapter ?? 'claude'
}

/** 默认助手在电脑上的权限档；没配或不被支持时回到第一档（不存在的返回空串） */
export function defaultPermissionId(catalog: BridgeCatalog): string {
  const agent = catalog.agents.find((item) => item.isDefault)
  const modes = catalog.permissionModes?.[agent?.agentAdapter ?? 'claude'] ?? []
  const preferred = agent?.permissionMode
  if (preferred != null && modes.includes(preferred)) return preferred
  return modes[0] ?? ''
}

/** 默认助手在电脑上的推理档；没配时按 medium 再退回第一档（不存在的返回空串） */
export function defaultReasoningId(catalog: BridgeCatalog): string {
  const agent = catalog.agents.find((item) => item.isDefault)
  const efforts = catalog.reasoningEfforts ?? []
  const preferred = agent?.reasoningEffort
  if (preferred != null && efforts.includes(preferred)) return preferred
  if (efforts.includes('medium')) return 'medium'
  return efforts[0] ?? ''
}

/** 模型渠道选项：电脑默认 + 各渠道（自动路由/默认模型/具体模型） */
export function buildModelOptions(catalog: BridgeCatalog): SessionConfigOption[] {
  const options: SessionConfigOption[] = [DEFAULT_MODEL_OPTION]
  for (const provider of catalog.providers) {
    if (provider.isAutoRouter || provider.models.length === 0) {
      options.push({
        id: `${provider.id}::`,
        label: provider.isAutoRouter
          ? `${provider.name} · 自动路由`
          : `${provider.name} · 默认模型`,
        providerProfileId: provider.id,
        modelId: null,
      })
      continue
    }
    for (const model of provider.models) {
      options.push({
        id: `${provider.id}::${model.id}`,
        label: `${provider.name} · ${model.name}`,
        providerProfileId: provider.id,
        modelId: model.id,
      })
    }
  }
  return options
}

/** 权限策略选项：默认助手 adapter 下的全部合法档位（不再有「电脑默认」合成项） */
export function buildPermissionOptions(catalog: BridgeCatalog): SessionConfigOption[] {
  const modes = catalog.permissionModes[defaultCatalogAdapter(catalog)] ?? []
  return modes.map((mode) => ({ id: mode, label: PERMISSION_LABELS[mode] ?? mode }))
}

/** 推理强度选项：全部档位（不再有「电脑默认」合成项） */
export function buildReasoningOptions(catalog: BridgeCatalog): SessionConfigOption[] {
  return (catalog.reasoningEfforts ?? []).map((effort) => ({
    id: effort,
    label: REASONING_LABELS[effort] ?? effort,
    value: effort,
  }))
}
