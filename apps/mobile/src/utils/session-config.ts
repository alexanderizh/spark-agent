/**
 * 新建会话配置（首页 / 项目页等「发送首条消息时建会话」的入口共用）。
 *
 * 选项来自桌面端目录 bridge.getCatalog；id 为 'default' 表示沿用电脑端默认，
 * 发送时不向 updateSession patch 对应字段。
 */

import type { BridgeCatalog } from '../api/bridge'

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

export const REASONING_LABELS: Record<string, string> = {
  minimal: '最省',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '极致',
}

export const PERMISSION_LABELS: Record<string, string> = {
  'claude-ask': '每步确认',
  'claude-auto-edits': '自动编辑',
  'claude-plan': '规划模式',
  'claude-auto': '自动',
  'claude-bypass': '免确认',
  'codex-default': '默认',
  'codex-auto-review': '自动审查',
  'codex-full-access': '完全访问',
  'spark-default': '默认',
  'spark-accept-edits': '接受编辑',
  'spark-plan': '规划模式',
  'spark-bypass': '免确认',
  'spark-auto': '自动',
}

/** 新会话的默认模型档（用户未选择时沿用电脑端默认，不 patch） */
export const DEFAULT_MODEL_OPTION: SessionConfigOption = { id: 'default', label: '电脑默认模型' }
/** 新会话的默认权限档（用户未选择时沿用电脑端默认，不 patch） */
export const DEFAULT_PERMISSION_OPTION: SessionConfigOption = { id: 'default', label: '电脑默认' }
/** 新会话的默认推理档 */
export const DEFAULT_REASONING_OPTION: SessionConfigOption = { id: 'default', label: '电脑默认' }

/** 新会话将使用的 adapter：取默认助手的 adapter，目录缺失时按 claude 兜底 */
export function defaultCatalogAdapter(catalog: BridgeCatalog): string {
  return catalog.agents.find((agent) => agent.isDefault)?.agentAdapter ?? 'claude'
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

/** 权限策略选项：电脑默认 + 默认助手 adapter 下的全部合法档位 */
export function buildPermissionOptions(catalog: BridgeCatalog): SessionConfigOption[] {
  const modes = catalog.permissionModes[defaultCatalogAdapter(catalog)] ?? []
  return [
    DEFAULT_PERMISSION_OPTION,
    ...modes.map((mode) => ({ id: mode, label: PERMISSION_LABELS[mode] ?? mode })),
  ]
}

/** 推理强度选项：电脑默认 + 全部档位 */
export function buildReasoningOptions(catalog: BridgeCatalog): SessionConfigOption[] {
  return [
    DEFAULT_REASONING_OPTION,
    ...catalog.reasoningEfforts.map((effort) => ({
      id: effort,
      label: REASONING_LABELS[effort] ?? effort,
      value: effort,
    })),
  ]
}
