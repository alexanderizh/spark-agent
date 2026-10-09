import { useMemo, useState } from 'react'
import { Modal, Checkbox, Button, Tag, Tooltip, Empty } from '@lobehub/ui'
import { Input as AntdInput } from 'antd'
import { Icons } from '../Icons'
import type { McpServerItem } from '@spark/protocol'
import '../views/AgentsView.less' // mcp-picker-* 样式挂在 AgentsView.less（与 agent-config 面板同域）

/**
 * Agent 级 MCP 选择器（「空=全量、部分点选=白名单」）。
 *
 * 三组内容：
 *  1. 会话基础能力（必需档）：锁定态展示，不可摘除；
 *  2. 内置服务（可选档）：可勾选，提交 builtin:spark_* 合成 id；
 *  3. 自定义 MCP 服务器：可勾选（停用的禁选），提交 DB 行 id。
 *
 * 清空/未选择 = 全部可用（默认）；勾满全部可选项由父组件归一化为 []（D6）。
 * 内置清单与 packages/agent-runtime/src/services/agent-mcp-policy.ts 的
 * REQUIRED/OPTIONAL 分级表双向注释锚定，两侧同时改时必须保持同步。
 */

/** 必需档（恒挂载，锁定展示）。↔ agent-mcp-policy.ts REQUIRED_BUILTIN_MCP_NAMES */
const REQUIRED_BUILTIN_MCPS: Array<{ name: string; label: string; desc: string }> = [
  { name: 'spark_files', label: '文件交付', desc: '文件卡片与产物呈现' },
  { name: 'spark_tool_results', label: '结果回读', desc: '超长工具结果分页读取' },
  { name: 'spark_memory', label: '记忆检索', desc: '长期记忆搜索与回溯' },
  { name: 'spark_session', label: '会话服务', desc: '会话运行时轻量控制' },
]

/** 可选档（重型，可摘除）。↔ agent-mcp-policy.ts OPTIONAL_HEAVY_BUILTIN_MCP_NAMES */
const OPTIONAL_BUILTIN_MCPS: Array<{
  name: string
  label: string
  desc: string
}> = [
  {
    name: 'spark_platform',
    label: '平台管理',
    desc: 'Skills / MCP / Provider 等 80+ 管理工具；Spark / Codex 引擎下强制挂载',
  },
  { name: 'spark_plugins', label: '插件工具', desc: '已安装插件包暴露的工具' },
  { name: 'spark_app', label: '子应用', desc: '内置子应用的创建与发布' },
  { name: 'spark_media', label: '多媒体生成', desc: '图片 / 音频 / 视频生成' },
  { name: 'spark_image', label: '图片生成', desc: '兼容图片生成通道' },
  { name: 'spark_browser', label: '浏览器自动化', desc: '应用内可见浏览器控制' },
  { name: 'spark_computer', label: '桌面控制', desc: '受治理的本机桌面操作' },
  { name: 'spark_search', label: '联网搜索', desc: '网页搜索与正文抓取' },
]

/** 内置合成 id 前缀。↔ agent-mcp-policy.ts BUILTIN_MCP_ID_PREFIX */
const BUILTIN_MCP_ID_PREFIX = 'builtin:spark_'

/** 可选档内置 id → 展示名（AgentsView 的 chips 预览共用）。 */
export const MCP_OPTIONAL_BUILTIN_LABELS: ReadonlyMap<string, string> = new Map(
  OPTIONAL_BUILTIN_MCPS.map((m) => [builtinMcpId(m.name), m.label] as const),
)

/** 解析 MCP 选择 id 的展示名（内置合成 id 或用户 server 名）。 */
export function resolveMcpSelectionLabel(id: string, userServers: McpServerItem[]): string {
  const builtin = MCP_OPTIONAL_BUILTIN_LABELS.get(id)
  if (builtin != null) return builtin
  return userServers.find((s) => s.id === id)?.name ?? id
}

/** 全部可选项 id（enabled 用户 server + 可选内置）——「勾满 → 提交 []」归一化用。 */
export function allSelectableMcpIds(userServers: McpServerItem[]): string[] {
  return [
    ...OPTIONAL_BUILTIN_MCPS.map((m) => builtinMcpId(m.name)),
    ...userServers.filter((s) => s.enabled).map((s) => s.id),
  ]
}

function builtinMcpId(name: string): string {
  return `${BUILTIN_MCP_ID_PREFIX}${name.slice('spark_'.length)}`
}

export interface McpServersPickerModalProps {
  visible: boolean
  userServers: McpServerItem[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  onConfirm: () => void
  onClose: () => void
}

type StatusFilter = 'all' | 'configured' | 'unconfigured'

interface SelectableRow {
  id: string
  name: string
  desc: string
  enabled: boolean
  scope: 'builtin' | 'user'
}

export function McpServersPickerModal({
  visible,
  userServers,
  selectedIds,
  onChange,
  onConfirm,
  onClose,
}: McpServersPickerModalProps) {
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const selectable: SelectableRow[] = useMemo(
    () => [
      ...OPTIONAL_BUILTIN_MCPS.map((m) => ({
        id: builtinMcpId(m.name),
        name: m.label,
        desc: m.desc,
        enabled: true,
        scope: 'builtin' as const,
      })),
      ...userServers.map((s) => ({
        id: s.id,
        name: s.name,
        desc: s.scope === 'user' ? '自定义 MCP 服务器' : `${s.scope} 作用域`,
        enabled: s.enabled,
        scope: 'user' as const,
      })),
    ],
    [userServers],
  )

  const counts = useMemo(() => {
    const configured = selectable.filter((row) => selectedSet.has(row.id)).length
    return {
      all: selectable.length,
      configured,
      unconfigured: selectable.length - configured,
    }
  }, [selectable, selectedSet])

  const filtered = useMemo(() => {
    const lower = searchText.trim().toLowerCase()
    return selectable.filter((row) => {
      if (statusFilter === 'configured' && !selectedSet.has(row.id)) return false
      if (statusFilter === 'unconfigured' && selectedSet.has(row.id)) return false
      if (
        lower &&
        !row.name.toLowerCase().includes(lower) &&
        !row.desc.toLowerCase().includes(lower)
      )
        return false
      return true
    })
  }, [selectable, searchText, statusFilter, selectedSet])

  const handleSelect = (id: string, checked: boolean) => {
    if (checked) onChange([...selectedIds, id])
    else onChange(selectedIds.filter((sid) => sid !== id))
  }

  const handleSelectAll = (checked: boolean) => {
    const visibleIds = filtered.filter((row) => row.enabled).map((row) => row.id)
    if (checked) {
      onChange(Array.from(new Set([...selectedIds, ...visibleIds])))
    } else {
      const visibleIdSet = new Set(visibleIds)
      onChange(selectedIds.filter((id) => !visibleIdSet.has(id)))
    }
  }

  const checkable = filtered.filter((row) => row.enabled)
  const allSelected = checkable.length > 0 && checkable.every((row) => selectedSet.has(row.id))
  const someSelected = checkable.some((row) => selectedSet.has(row.id)) && !allSelected

  const requiredFiltered = useMemo(() => {
    const lower = searchText.trim().toLowerCase()
    if (!lower) return REQUIRED_BUILTIN_MCPS
    return REQUIRED_BUILTIN_MCPS.filter(
      (m) => m.label.toLowerCase().includes(lower) || m.desc.toLowerCase().includes(lower),
    )
  }, [searchText])

  return (
    <Modal
      open={visible}
      title={null}
      closable={false}
      onCancel={onClose}
      footer={null}
      className="skills-picker-modal"
      style={{ width: 720 }}
      centered
      destroyOnHidden
    >
      <div className="skills-picker-header">
        <div className="skills-picker-title">
          <span>配置 MCP 服务</span>
          <span className="skills-picker-subtitle">
            未选择 = 全部可用（默认）；部分选择后该 Agent 仅挂载所选 MCP，会话基础能力始终保留
          </span>
        </div>
        <button className="skills-picker-close-btn" onClick={onClose} aria-label="关闭">
          <Icons.X size={14} />
        </button>
      </div>

      <div className="skills-picker-toolbar">
        <AntdInput.Search
          className="skills-picker-search"
          placeholder="搜索 MCP 服务..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          size="middle"
        />
        <div className="skills-picker-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'all'}
            className={`skills-picker-tab ${statusFilter === 'all' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            全部 <span className="skills-picker-tab-count">{counts.all}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'configured'}
            className={`skills-picker-tab ${statusFilter === 'configured' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('configured')}
          >
            已配置 <span className="skills-picker-tab-count">{counts.configured}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'unconfigured'}
            className={`skills-picker-tab ${statusFilter === 'unconfigured' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('unconfigured')}
          >
            未配置 <span className="skills-picker-tab-count">{counts.unconfigured}</span>
          </button>
        </div>
      </div>

      <div className="skills-picker-table-wrap mcp-picker-groups">
        {/* 会话基础能力（必需档）：锁定态，不参与页签过滤但参与搜索 */}
        {requiredFiltered.length > 0 && (
          <div className="mcp-picker-group">
            <div className="mcp-picker-group-head">
              会话基础能力
              <span className="mcp-picker-group-note">始终挂载，不可摘除</span>
            </div>
            {requiredFiltered.map((m) => (
              <div key={m.name} className="mcp-picker-row mcp-picker-row--locked">
                <div className="mcp-picker-cell mcp-picker-cell--lock">
                  <Icons.Lock size={12} />
                </div>
                <div className="mcp-picker-cell mcp-picker-cell--name">
                  <Tooltip title={`${m.name} · ${m.desc}`}>
                    <span className="skills-picker-name-text">{m.label}</span>
                  </Tooltip>
                </div>
                <div className="mcp-picker-cell mcp-picker-cell--status">{m.desc}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mcp-picker-group">
          <div className="mcp-picker-group-head">
            可选服务
            <span className="mcp-picker-group-note">按需勾选，未勾选即不挂载</span>
            {checkable.length > 0 && (
              <span className="mcp-picker-cell mcp-picker-cell--checkbox">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={(checked) => handleSelectAll(checked)}
                />
              </span>
            )}
          </div>
          <div className="skills-picker-table-body">
            {filtered.length === 0 ? (
              <div className="skills-picker-empty">
                <Empty description={searchText ? '没有匹配的 MCP 服务' : '暂无可选 MCP 服务'} />
              </div>
            ) : (
              filtered.map((row) => {
                const checked = selectedSet.has(row.id)
                const locked = !row.enabled
                return (
                  <div
                    key={row.id}
                    role="row"
                    className={`skills-picker-row mcp-picker-row ${checked ? 'is-checked' : ''} ${locked ? 'is-locked' : ''}`}
                    onClick={() => !locked && handleSelect(row.id, !checked)}
                    title={locked ? '该 MCP 服务已停用，启用后可选择' : undefined}
                  >
                    <div
                      className="skills-picker-cell skills-picker-cell--checkbox"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={locked}
                        onChange={(c) => handleSelect(row.id, c)}
                      />
                    </div>
                    <div className="skills-picker-cell skills-picker-cell--name">
                      <Tooltip title={`${row.name} · ${row.desc}`}>
                        <span className="skills-picker-name-text">
                          {row.name}
                          {row.scope === 'user' && <span className="mcp-picker-scope">自定义</span>}
                        </span>
                      </Tooltip>
                    </div>
                    <div className="mcp-picker-cell mcp-picker-cell--status">
                      {locked ? (
                        <span className="skills-picker-status skills-picker-status--disabled">
                          <span className="skills-picker-dot skills-picker-dot--gray" />
                          停用
                        </span>
                      ) : (
                        row.desc
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      <div className="skills-picker-footer">
        <div className="skills-picker-footer-left">
          {selectedIds.length > 0 ? (
            <Tag color="blue" size="middle">
              {selectedIds.length} 已选
            </Tag>
          ) : (
            <span className="skills-picker-footer-hint">未选择 = 全部可用（默认）</span>
          )}
          {(searchText || statusFilter !== 'all') && (
            <span className="skills-picker-footer-hint">
              筛选结果 {filtered.length} / {selectable.length}
            </span>
          )}
        </div>
        <div className="skills-picker-footer-right">
          <Button
            type="text"
            size="middle"
            disabled={selectedIds.length === 0}
            onClick={() => onChange([])}
          >
            清空
          </Button>
          <Button type="primary" size="middle" onClick={onConfirm}>
            完成
          </Button>
        </div>
      </div>
    </Modal>
  )
}
