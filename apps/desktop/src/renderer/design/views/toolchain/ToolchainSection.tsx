/**
 * ToolchainSection — 设置 → Agent → 工具链（只读清单）。
 *
 * 展示本应用所有 agent 可用工具的统一目录，为后续「工作流节点 / Agent 限制
 * 工具调用权限」提供配置底座：
 *  - SDK 内置工具（Claude Agent SDK；含 Spark 引擎映射名；Codex 用自身工具集）
 *  - 平台内置服务器（spark_* 系列，含条件挂载与引擎差异标注）
 *  - MCP 扩展（外部服务器；未连接不拉起，仅展示状态与已连接时的工具清单）
 *  - 统一目录（自定义工具 / 工具包 / 连接器，经 spark_plugins 投影）
 *
 * 仅查看：本页面不提供任何启停 / 编辑操作。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Input } from 'antd'
import type { ToolchainInventoryGroup, ToolchainInventoryResponse } from '@spark/protocol'
import { Icons } from '../../Icons'
import { useIpcInvoke } from '../../hooks/useIpc'
import { ToolchainGroupCard } from './ToolchainGroupCard'
import './toolchain.less'

const KIND_SECTIONS: Array<{
  kind: ToolchainInventoryGroup['kind']
  title: string
  desc: string
}> = [
  {
    kind: 'sdk-builtin',
    title: 'SDK 内置工具',
    desc: '引擎原生工具：Claude SDK 使用原名，Spark 引擎使用映射名（展示于工具行右侧），Codex 引擎使用自身内置工具集、不消费此清单命名。',
  },
  {
    kind: 'platform-server',
    title: '平台内置服务器',
    desc: '应用随会话自动挂载的 spark_* 系列 MCP 服务器；部分为条件挂载（语音/画布/团队/调试等），详见各分组说明。',
  },
  {
    kind: 'mcp-extension',
    title: 'MCP 扩展',
    desc: '外部配置的 MCP 服务器。仅查看语义下不主动拉起进程：已连接的展示实时工具清单，未连接的展示状态。',
  },
  {
    kind: 'unified-catalog',
    title: '统一目录',
    desc: '自定义工具、工具包与连接器，会话内经 spark_plugins 服务器投影为 mcp__spark_plugins__* 工具。',
  },
]

export function ToolchainSection() {
  const { invoke, loading } = useIpcInvoke('toolchain:inventory')
  const [data, setData] = useState<ToolchainInventoryResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await invoke({})
      setData(res)
      // 首次加载全部折叠，只看分组概览；搜索时自动展开命中分组。
      setCollapsed(new Set(res.groups.map((group) => group.key)))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '读取工具链清单失败')
    }
  }, [invoke])

  useEffect(() => {
    void load()
  }, [load])

  const q = query.trim().toLowerCase()
  const searching = q.length > 0

  const { filteredGroups, totalTools } = useMemo(() => {
    const groups = (data?.groups ?? []).filter((group) => {
      if (!searching) return true
      if (group.title.toLowerCase().includes(q)) return true
      return group.tools.some(
        (tool) =>
          tool.name.toLowerCase().includes(q) ||
          (tool.sparkEngineName ?? '').toLowerCase().includes(q) ||
          (tool.description ?? '').toLowerCase().includes(q),
      )
    })
    // 搜索态下组内也过滤工具行，只保留命中项（标题命中的组保留全部行）。
    const refined = searching
      ? groups.map((group) => {
          if (group.title.toLowerCase().includes(q)) return group
          const tools = group.tools.filter(
            (tool) =>
              tool.name.toLowerCase().includes(q) ||
              (tool.sparkEngineName ?? '').toLowerCase().includes(q) ||
              (tool.description ?? '').toLowerCase().includes(q),
          )
          return { ...group, tools, toolCount: tools.length }
        })
      : groups
    const tools = refined.reduce((sum, group) => sum + group.toolCount, 0)
    return { filteredGroups: refined, totalTools: tools }
  }, [data, q, searching])

  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const isExpanded = useCallback(
    (key: string) => (searching ? true : !collapsed.has(key)),
    [searching, collapsed],
  )

  const summary = useMemo(() => {
    if (data == null) return null
    const counts = {
      sdk: data.groups.find((g) => g.kind === 'sdk-builtin')?.toolCount ?? 0,
      platform: data.groups
        .filter((g) => g.kind === 'platform-server')
        .reduce((sum, g) => sum + g.toolCount, 0),
      mcp: data.groups.filter((g) => g.kind === 'mcp-extension').length,
      unified: data.groups
        .filter((g) => g.kind === 'unified-catalog')
        .reduce((sum, g) => sum + g.toolCount, 0),
    }
    return counts
  }, [data])

  return (
    <div className="settings-section toolchain-section">
      <h2>工具链</h2>
      <div className="lede">
        本应用所有 agent 可用工具的只读目录，为后续工作流节点与 Agent 的工具调用权限配置做准备。
      </div>

      <div className="settings-card tc-toolbar">
        <div className="settings-card-row">
          <div className="flex1 min-w-0">
            <div className="row-title">工具总览</div>
            <div className="row-desc">
              {summary != null
                ? `SDK 内置 ${summary.sdk} · 平台服务器 ${summary.platform} · MCP 扩展 ${summary.mcp} 个服务器 · 统一目录 ${summary.unified}`
                : loading
                  ? '加载中…'
                  : '暂无数据'}
            </div>
          </div>
          <div className="row-action tc-toolbar-actions">
            <Input
              size="middle"
              allowClear
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索工具名 / 描述…"
              prefix={<Icons.Search size={14} />}
              className="tc-search"
            />
            <button type="button" className="tc-refresh" onClick={() => void load()} title="刷新">
              <Icons.Refresh size={13} />
            </button>
          </div>
        </div>
      </div>

      {loadError != null && (
        <div className="settings-card">
          <div className="settings-card-row error">
            <div className="flex1 min-w-0">
              <div className="row-title">读取失败</div>
              <div className="row-desc">{loadError}</div>
            </div>
            <div className="row-action">
              <button type="button" className="tc-refresh" onClick={() => void load()}>
                重试
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && data == null && <div className="tc-state">正在聚合工具面…</div>}
      {!loading && data != null && filteredGroups.length === 0 && (
        <div className="tc-state">{searching ? '没有匹配的工具。' : '当前没有可用工具。'}</div>
      )}

      {data != null &&
        KIND_SECTIONS.map((section) => {
          const groups = filteredGroups.filter((group) => group.kind === section.kind)
          if (groups.length === 0) return null
          return (
            <div key={section.kind} className="tc-kind">
              <div className="tc-kind-head">
                <div className="tc-kind-title">{section.title}</div>
                <div className="tc-kind-desc">{section.desc}</div>
              </div>
              {groups.map((group) => (
                <ToolchainGroupCard
                  key={group.key}
                  group={group}
                  expanded={isExpanded(group.key)}
                  onToggle={() => toggleGroup(group.key)}
                />
              ))}
            </div>
          )
        })}

      {data != null && (
        <div className="tc-footer">
          共 {filteredGroups.length} 个分组 · {totalTools} 个工具 · 生成于{' '}
          {new Date(data.generatedAt).toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
