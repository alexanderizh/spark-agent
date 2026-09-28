import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Switch } from 'antd'
import { Button, Input, Modal, Select } from '@lobehub/ui'
import type { ProviderProfile, SessionReasoningEffort } from '@spark/protocol'
import { resolveModelContextWindowForProvider } from '@spark/shared'
import { Icons } from '../../Icons'
import { useIpcInvoke } from '../../hooks/useIpc'
import { useToast } from '../../components/Toast'
import { REASONING_EFFORT_OPTIONS } from '../chat/reasoning-effort-options'
import { ProviderModelContextWindowField } from './ProviderModelContextWindowField'
import {
  buildModelSettingsDraft,
  buildModelSettingsSections,
  buildModelSettingsUpdates,
  countCustomizedModels,
  modelSettingsDraftKey,
  type ModelSettingsDraft,
  type ModelSettingsDraftEntry,
} from './model-settings-draft'
import './ModelSettingsModal.less'

/** 推理强度「跟随默认」哨兵：Select 需要非空字符串值，写入前统一归一为 null。 */
const REASONING_FOLLOW_DEFAULT = '__default__'

const REASONING_SELECT_OPTIONS = [
  { value: REASONING_FOLLOW_DEFAULT, label: '默认' },
  ...REASONING_EFFORT_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
]

export interface ModelSettingsModalProps {
  open: boolean
  /** 对话渠道（多媒体 / 向量 / 路由渠道由调用方过滤，与模型选择器同一真相源） */
  conversationalProviders: ProviderProfile[]
  /** CLI 内置渠道的 spark 覆盖子渠道；按父渠道 id 分组 */
  cliSparkProvidersByPrimaryId?: ReadonlyMap<string, ProviderProfile[]> | undefined
  /** 模型显示名解析（与模型选择器一致）；缺省直接用 modelId */
  resolveModelLabel?: ((provider: ProviderProfile, modelId: string) => string) | undefined
  /** 渠道图标渲染（渠道 logo）；缺省不渲染图标 */
  renderProviderIcon?: ((provider: ProviderProfile) => ReactNode) | undefined
  onClose: () => void
  /** 跳转「模型渠道管理」页 */
  onManageChannels: () => void
  /** 保存成功后回调：父级据此对当前选中模型立即应用推理默认 */
  onSaved?: (() => void | Promise<void>) | undefined
}

/**
 * 「模型设置」弹窗：按模型调整默认推理强度 / 选择器显隐 / 模型级上下文窗口。
 *
 * - 数据源：模型推理默认与显隐读 `modelSettings`，模型级上下文读 `modelContextWindows`
 * - 保存：按渠道循环 `provider:update`（整表下发 modelSettings；上下文由服务层拆写进
 *   modelContextWindows 单一存储），失败不关闭弹窗，保留草稿供重试
 * - 布局：扁平表格（表头吸顶 + 渠道分组 + 行内三控件），不使用卡片式分块
 */
export function ModelSettingsModal({
  open,
  conversationalProviders,
  cliSparkProvidersByPrimaryId,
  resolveModelLabel,
  renderProviderIcon,
  onClose,
  onManageChannels,
  onSaved,
}: ModelSettingsModalProps) {
  const { invoke: updateProvider } = useIpcInvoke('provider:update')
  const { toast } = useToast()
  const sections = useMemo(
    () =>
      buildModelSettingsSections({
        conversationalProviders,
        cliSparkProvidersByPrimaryId,
        ...(resolveModelLabel != null ? { resolveModelLabel } : {}),
      }),
    [cliSparkProvidersByPrimaryId, conversationalProviders, resolveModelLabel],
  )
  // 草稿基线 = 弹窗挂载那一刻的落库值。弹窗只在打开时挂载（`settingsOpen && ...`），
  // 因此不需要用 effect 重置：保存后 providers 刷新也不会覆盖用户正在编辑的草稿。
  const [draft, setDraft] = useState<ModelSettingsDraft>(() => buildModelSettingsDraft(sections))
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  const normalizedSearch = search.trim().toLowerCase()
  const visibleSections = useMemo(() => {
    if (normalizedSearch === '') return sections
    return sections
      .map((section) => {
        const providerMatches =
          section.provider.name.toLowerCase().includes(normalizedSearch) ||
          (section.parentProviderName ?? '').toLowerCase().includes(normalizedSearch)
        return {
          ...section,
          models: providerMatches
            ? section.models
            : section.models.filter(
                (model) =>
                  model.label.toLowerCase().includes(normalizedSearch) ||
                  model.modelId.toLowerCase().includes(normalizedSearch),
              ),
        }
      })
      .filter((section) => section.models.length > 0)
  }, [normalizedSearch, sections])

  const customizedCount = useMemo(() => countCustomizedModels(sections, draft), [draft, sections])
  const pendingUpdates = useMemo(
    () => (open ? buildModelSettingsUpdates(sections, draft) : []),
    [draft, open, sections],
  )
  const hasChanges = pendingUpdates.length > 0

  const patchEntry = (key: string, patch: Partial<ModelSettingsDraftEntry>) => {
    setDraft((current) => {
      const entry = current[key]
      if (entry == null) return current
      return { ...current, [key]: { ...entry, ...patch } }
    })
  }

  const handleSave = async () => {
    if (saving || !hasChanges) {
      onClose()
      return
    }
    setSaving(true)
    try {
      for (const update of pendingUpdates) {
        await updateProvider({ id: update.id, modelSettings: update.modelSettings })
      }
      toast.success(
        pendingUpdates.length > 1
          ? `模型设置已保存（${pendingUpdates.length} 个渠道）`
          : '模型设置已保存',
      )
      await onSaved?.()
      onClose()
    } catch (error) {
      // 失败不关闭：草稿保留在弹窗内，用户可修正后重试
      toast.error(error instanceof Error ? error.message : '模型设置保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={
        <div className="mv_settings_title">
          <Icons.Settings size={16} />
          <span>模型设置</span>
        </div>
      }
      width="min(1080px, 94vw)"
      className="mv_settings_modal"
      // lobehub Modal 的 body 水平 padding 内联固定 16px，1080px 宽弹窗下太贴边；
      // 走官方 paddings prop 提到 28px（内联样式无法用 class 覆盖）
      paddings={{ desktop: 28 }}
      onCancel={onClose}
      footer={
        <div className="mv_settings_footer">
          <Button size="small" icon={<Icons.Link size={14} />} onClick={onManageChannels}>
            管理模型渠道
          </Button>
          <div className="mv_settings_footer_spacer" />
          <Button size="small" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button
            size="small"
            type="primary"
            loading={saving}
            disabled={!hasChanges && !saving}
            onClick={() => void handleSave()}
          >
            保存设置
          </Button>
        </div>
      }
    >
      <div className="mv_settings_toolbar">
        <Input
          className="mv_settings_search"
          size="middle"
          value={search}
          placeholder="搜索模型或渠道"
          allowClear
          prefix={<Icons.Search size={13} />}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span className="mv_settings_summary">
          {customizedCount > 0 ? `${customizedCount} 个模型已自定义` : '全部模型使用默认设置'}
        </span>
      </div>

      <div className="mv_settings_head" aria-hidden="true">
        <span>模型名称</span>
        <span>思考强度</span>
        <span>显示状态</span>
        <span>上下文窗口</span>
      </div>

      <div className="mv_settings_body">
        {visibleSections.length === 0 && (
          <div className="mv_settings_empty">
            {sections.length === 0 ? '还没有可配置的对话渠道' : '没有匹配的模型'}
          </div>
        )}
        {visibleSections.map((section) => {
          const provider = section.provider
          return (
            <div className="mv_settings_group" key={provider.id}>
              <div className="mv_settings_group_title">
                <span className="mv_settings_group_icon">
                  {renderProviderIcon?.(provider) ?? (
                    <span className="mv_settings_group_dot" aria-hidden="true" />
                  )}
                </span>
                <span className="mv_settings_group_name">{provider.name}</span>
                {section.parentProviderName != null && (
                  <span className="mv_settings_group_parent">
                    · 来自 {section.parentProviderName}
                  </span>
                )}
              </div>
              {section.models.map(({ modelId, label }) => {
                const key = modelSettingsDraftKey(provider.id, modelId)
                const entry = draft[key]
                if (entry == null) return null
                const channelWindow = resolveModelContextWindowForProvider(
                  modelId,
                  provider.supportsMillionContext,
                  provider.contextWindow,
                  undefined,
                )
                return (
                  <div className="mv_settings_row" key={key}>
                    <span className="mv_settings_model" title={modelId}>
                      {label}
                    </span>
                    <Select
                      size="small"
                      className="mv_settings_reasoning"
                      value={entry.reasoningEffort ?? REASONING_FOLLOW_DEFAULT}
                      options={REASONING_SELECT_OPTIONS}
                      disabled={saving}
                      popupMatchSelectWidth={false}
                      onChange={(value) =>
                        patchEntry(key, {
                          reasoningEffort:
                            value === REASONING_FOLLOW_DEFAULT
                              ? null
                              : (value as SessionReasoningEffort),
                        })
                      }
                    />
                    <span className="mv_settings_visibility">
                      <Switch
                        size="small"
                        checked={!entry.hidden}
                        disabled={saving}
                        aria-label={`${label} 在选择器中显示`}
                        onChange={(checked) => patchEntry(key, { hidden: !checked })}
                      />
                    </span>
                    <ProviderModelContextWindowField
                      value={entry.contextWindow}
                      fallbackValue={channelWindow}
                      disabled={saving}
                      onChange={(contextWindow) => patchEntry(key, { contextWindow })}
                    />
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
