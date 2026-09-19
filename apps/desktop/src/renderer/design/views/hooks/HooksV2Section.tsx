/**
 * Hooks V2 设置页主区块（设计方案 §15.1）。
 *
 * 应用总开关 + Hook 定义列表（创建/编辑/删除/启停）+ 定义的作用域绑定与授权 +
 * 运行记录。旧 sound/notification 节点配置保留在下方「经典通知」区块，
 * Phase F 迁移完成前两者并行且不会双发（执行所有权由主进程管理）。
 */

import React, { useCallback, useEffect, useState } from 'react'
import './HooksV2Section.less'
import { Button, Tag } from '@lobehub/ui'
import { Modal as AntdModal, Switch } from 'antd'
import { Icons } from '../../Icons'
import { useToast } from '../../components/Toast'
import type { HookDefinitionV1 } from '@spark/protocol'
import { HOOK_EVENT_LABELS, describeHookAction, hooksV2Api } from './hooksV2Ipc'
import { HookDefinitionEditor } from './HookDefinitionEditor'
import { HookBindingsPanel } from './HookBindingsPanel'
import { HookRunsPanel } from './HookRunsPanel'
import { LegacyHooksSettings } from './LegacyHooksSettings'

export function HooksV2Section() {
  const { toast } = useToast()
  const [definitions, setDefinitions] = useState<HookDefinitionV1[]>([])
  const [loading, setLoading] = useState(false)
  const [systemEnabled, setSystemEnabled] = useState(true)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<HookDefinitionV1 | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [definitionsRes, statusRes] = await Promise.all([
        hooksV2Api.listDefinitions(),
        hooksV2Api.getSystemStatus(),
      ])
      setDefinitions(definitionsRes.definitions)
      setSystemEnabled(statusRes.enabled)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载 Hook 配置失败')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const toggleSystem = async (enabled: boolean): Promise<void> => {
    try {
      const res = await hooksV2Api.setSystemEnabled(enabled)
      setSystemEnabled(res.enabled)
      toast.success(enabled ? '已恢复自动执行' : '已暂停新的自动执行（不撤回已发生的外部副作用）')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新总开关失败')
    }
  }

  const toggleDefinition = async (
    definition: HookDefinitionV1,
    enabled: boolean,
  ): Promise<void> => {
    try {
      await hooksV2Api.updateDefinition(definition.id, { enabled })
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新定义失败')
    }
  }

  const confirmDelete = (definition: HookDefinitionV1): void => {
    Promise.all([
      hooksV2Api.listBindings({ hookId: definition.id }),
      hooksV2Api.listRuns({ hookId: definition.id, limit: 200 }),
    ])
      .then(([bindingsRes, runsRes]) => {
        AntdModal.confirm({
          title: `删除 Hook「${definition.name}」？`,
          content: (
            <div>
              <p>
                将删除 {bindingsRes.bindings.length} 个作用域绑定；历史运行记录（
                {runsRes.runs.length} 条）默认保留定义快照，不随定义删除。
              </p>
              <p className="muted">此操作不可撤销。</p>
            </div>
          ),
          okText: '删除',
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: async () => {
            try {
              await hooksV2Api.deleteDefinition(definition.id)
              toast.success('Hook 定义已删除')
              if (expandedId === definition.id) setExpandedId(null)
              await reload()
              setRefreshKey((key) => key + 1)
            } catch (error) {
              toast.error(error instanceof Error ? error.message : '删除失败')
            }
          },
        })
      })
      .catch(() => toast.error('读取绑定信息失败'))
  }

  const onChanged = (): void => {
    setRefreshKey((key) => key + 1)
    void reload()
  }

  return (
    <div className="settings-section">
      <div className="row section-header-row">
        <div className="flex1">
          <h2 className="section-h2">Hooks</h2>
          <div className="lede section-lede">
            在 Agent
            生命周期的明确节点上自动执行动作：通知、提示音或统一工具目录中受治理的工具调用。
          </div>
        </div>
        <Switch size="middle" checked={systemEnabled} onChange={(v) => void toggleSystem(v)} />
      </div>

      <div className="hookv2-toolbar">
        <Button
          type="primary"
          icon={<Icons.Plus size={12} />}
          onClick={() => {
            setEditing(null)
            setEditorOpen(true)
          }}
        >
          新建 Hook
        </Button>
        <div className="muted hookv2-toolbar-hint">
          总开关关闭时暂停新的自动执行，已入队任务保留待恢复。
        </div>
      </div>

      {loading && definitions.length === 0 && <div className="muted">加载中…</div>}
      {!loading && definitions.length === 0 && (
        <div className="hookv2-empty-block">
          <Icons.Zap size={22} className="faint" />
          <div className="strong">还没有 Hook 定义</div>
          <div className="muted">
            例如：新建一个「回答已提交」Hook，把最终回答正文发送到 Webhook 工具。
          </div>
        </div>
      )}

      <div className="hookv2-def-list">
        {definitions.map((definition) => {
          const expanded = expandedId === definition.id
          return (
            <div key={definition.id} className={`hookv2-def-row ${expanded ? 'expanded' : ''}`}>
              <div className="hookv2-def-line">
                <button
                  type="button"
                  className="hookv2-def-main"
                  onClick={() => setExpandedId(expanded ? null : definition.id)}
                >
                  <Icons.ChevronRight size={12} className={expanded ? 'rot90' : ''} />
                  <div className="flex1 min-w-0">
                    <div className="hookv2-def-name">
                      {definition.name}
                      {!definition.enabled && <Tag>定义已停用</Tag>}
                    </div>
                    <div className="muted hookv2-def-sub">
                      {HOOK_EVENT_LABELS[definition.eventName].label} ·{' '}
                      {describeHookAction(definition)} · rev {definition.revision}
                    </div>
                  </div>
                </button>
                <div className="hookv2-def-actions">
                  <Switch
                    size="small"
                    checked={definition.enabled}
                    onChange={(v) => void toggleDefinition(definition, v)}
                  />
                  <Button
                    size="small"
                    type="text"
                    onClick={() => {
                      setEditing(definition)
                      setEditorOpen(true)
                    }}
                  >
                    编辑
                  </Button>
                  <Button size="small" type="text" onClick={() => confirmDelete(definition)}>
                    删除
                  </Button>
                </div>
              </div>
              {expanded && (
                <div className="hookv2-def-body">
                  <HookBindingsPanel definition={definition} onChanged={onChanged} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <HookRunsPanel hookId={null} refreshKey={refreshKey} />

      <div className="hookv2-legacy">
        <LegacyHooksSettings />
      </div>

      <HookDefinitionEditor
        open={editorOpen}
        definition={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false)
          onChanged()
        }}
      />
    </div>
  )
}
