/**
 * ToolchainGroupCard — 工具链清单的单个分组卡片。
 *
 * 只读展示：组标题 + 工具数 + 引擎可用性徽标（Claude SDK / Codex / Spark）+
 * 连接状态/挂载条件/引擎差异说明 + 可折叠工具行。无任何写操作。
 */
import { useMemo } from 'react'
import type {
  ToolchainAdapterKind,
  ToolchainInventoryGroup,
  ToolchainInventoryTool,
} from '@spark/protocol'
import { Icons } from '../../Icons'

const ADAPTER_LABELS: Record<ToolchainAdapterKind, string> = {
  'claude-sdk': 'Claude SDK',
  codex: 'Codex',
  spark: 'Spark',
}
const ALL_ADAPTERS: ToolchainAdapterKind[] = ['claude-sdk', 'codex', 'spark']

const STATUS_META: Record<
  NonNullable<ToolchainInventoryGroup['serverStatus']>,
  { label: string; cls: string }
> = {
  connected: { label: '已连接', cls: 'ok' },
  'not-connected': { label: '未连接', cls: 'idle' },
  disabled: { label: '已停用', cls: 'off' },
}

export interface ToolchainGroupCardProps {
  group: ToolchainInventoryGroup
  expanded: boolean
  onToggle: () => void
}

export function ToolchainGroupCard({ group, expanded, onToggle }: ToolchainGroupCardProps) {
  const adapterBadges = useMemo(
    () =>
      ALL_ADAPTERS.map((adapter) => ({
        key: adapter,
        label: ADAPTER_LABELS[adapter],
        available: group.adapters.includes(adapter),
      })),
    [group.adapters],
  )

  return (
    <div className={`tc-card${expanded ? ' expanded' : ''}`}>
      <button type="button" className="tc-card-head" onClick={onToggle} aria-expanded={expanded}>
        <span className={`tc-chevron${expanded ? ' open' : ''}`}>
          <Icons.ChevronRight size={12} />
        </span>
        <span className="tc-card-title">{group.title}</span>
        <span className="tc-count">{group.toolCount}</span>
        {group.serverStatus != null && (
          <span className={`tc-status ${STATUS_META[group.serverStatus].cls}`}>
            {STATUS_META[group.serverStatus].label}
          </span>
        )}
        <span className="tc-adapter-badges">
          {adapterBadges.map((badge) => (
            <span key={badge.key} className={`tc-adapter${badge.available ? ' on' : ''}`}>
              {badge.label}
            </span>
          ))}
        </span>
      </button>

      {(group.adapterNote != null || group.mountNote != null) && (
        <div className="tc-card-notes">
          {group.adapterNote != null && (
            <div className="tc-note">
              <span className="tc-note-tag">引擎</span>
              {group.adapterNote}
            </div>
          )}
          {group.mountNote != null && (
            <div className="tc-note">
              <span className="tc-note-tag">挂载</span>
              {group.mountNote}
            </div>
          )}
        </div>
      )}

      {expanded && (
        <div className="tc-card-body">
          {group.tools.length === 0 ? (
            <div className="tc-empty-hint">
              {group.toolCount > 0
                ? `共 ${group.toolCount} 个工具，由运行时动态注入，静态清单不在此展开。`
                : '当前没有可用工具。'}
            </div>
          ) : (
            group.tools.map((tool) => <ToolRow key={tool.name} tool={tool} />)
          )}
        </div>
      )}
    </div>
  )
}

function ToolRow({ tool }: { tool: ToolchainInventoryTool }) {
  return (
    <div className="tc-tool" title={tool.name}>
      <div className="tc-tool-name-row">
        <code className="tc-tool-name">{tool.name}</code>
        {tool.sparkEngineName != null && (
          <code className="tc-tool-alt" title="Spark 引擎映射名">
            {tool.sparkEngineName}
          </code>
        )}
        {tool.autoApproved && <span className="tc-auto-allow">免审批</span>}
      </div>
      {tool.description != null && tool.description.length > 0 && (
        <div className="tc-tool-desc">{tool.description}</div>
      )}
    </div>
  )
}
