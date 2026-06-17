/**
 * 画布 Agent 对话弹窗（重写版，Phase 3）
 *
 * 真正接入应用内会话能力 + 画布工具桥：
 *   - workspace:open 用画布项目 rootPath 创建/复用 workspace
 *   - session:create 绑定 workspace + 默认 provider + agent chatMode
 *   - useCanvasToolHost：声明本 session 绑定到当前画布项目 + 工具 schema 同步给主进程，
 *     此后 agent 调 mcp__spark_canvas__* 工具会被回打到这个 hook 执行 store action
 *   - <ChatPanel>：复用消息流、工具调用卡片、输入区，所有渲染逻辑统一
 *
 * 与旧版差异：
 *   - 旧版只把画布上下文塞首条消息，agent 只能"看到"但无法真正操作画布
 *   - 新版 agent 可以直接调画布工具，编辑节点、查询资产、插入生成结果等
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from 'antd'
import { Icons } from '../../Icons'
import { ChatPanel } from '../../components/ChatPanel'
import { useCanvasToolHost } from './canvas-tool-host'
import type { CanvasToolHostOptions } from './canvas-tool-host'
import type { CanvasSnapshot } from './canvas.types'

interface Props {
  open: boolean
  onClose: () => void
  snapshot: CanvasSnapshot
  /** 画布 store actions（由 CanvasWorkspaceView 把 useCanvasWorkspace 结果传入） */
  workspace: CanvasToolHostOptions['workspace']
}

function buildSystemContext(snapshot: CanvasSnapshot): string {
  const boardCount = snapshot.boards?.length ?? 1
  const activeBoard = snapshot.board.name
  const filmMeta = snapshot.project.metadata?.film as { shotGroups?: unknown[] } | undefined
  const shotGroupCount = filmMeta?.shotGroups?.length ?? 0
  const kindCounts: Record<string, number> = {}
  for (const asset of snapshot.assets) {
    const kind = (asset.metadata?.kind as string) ?? 'other'
    kindCounts[kind] = (kindCounts[kind] ?? 0) + 1
  }
  const kindSummary = Object.entries(kindCounts)
    .map(([k, v]) => `${k}:${v}`)
    .join('、')

  return [
    `你是画布项目"${snapshot.project.title}"的 AI 协作助手。`,
    `项目目录：${snapshot.project.rootPath ?? '(未关联)'}`,
    `当前激活画板：「${activeBoard}」（项目共 ${boardCount} 个画板），${snapshot.nodes.length} 个节点 / ${snapshot.assets.length} 个资产 / ${snapshot.tasks.length} 个任务${shotGroupCount > 0 ? ` / ${shotGroupCount} 个分镜分组` : ''}。`,
    kindSummary ? `影视资产构成：${kindSummary}` : '',
    '',
    '你可以使用 mcp__spark_canvas__* 系列工具直接读写当前画布：',
    '- canvas_get_project_summary / canvas_list_nodes / canvas_get_node / canvas_find_nodes — 获取上下文',
    '- canvas_create_text_node / canvas_create_prompt_node / canvas_update_node_data / canvas_patch_nodes / canvas_delete_nodes — 节点 CRUD',
    '- canvas_create_operation_node / canvas_run_operation / canvas_retry_operation — AI 操作节点',
    '- canvas_create_film_asset / canvas_update_film_asset / canvas_search_assets / canvas_insert_asset_to_board — 资产管理',
    '- canvas_create_shot_group / canvas_create_shot_segment / canvas_update_shot_segment — 分镜编排',
    '- canvas_insert_generated_image / canvas_insert_generated_text — 把你生成的图片/文本作为节点插入画布',
    '',
    '请基于以上画布状态协助用户。涉及编辑前先查询当前状态（避免重复或冲突），不确定时简短确认后再操作。',
  ]
    .filter(Boolean)
    .join('\n')
}

export function CanvasAgentModal({ open, onClose, snapshot, workspace }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [systemSent, setSystemSent] = useState(false)

  // useCanvasToolHost 在 sessionId 就绪时 attach、卸载/切换时 detach
  useCanvasToolHost({
    sessionId,
    projectId: snapshot.project.id,
    getSnapshot: useCallback(() => snapshot, [snapshot]),
    workspace,
  })

  // 初始化：workspace:open → session:create → 注入系统上下文
  useEffect(() => {
    if (!open || sessionId != null || initializing) return
    const rootPath = snapshot.project.rootPath
    if (!rootPath) {
      setError('画布项目未关联目录，无法启动 agent。请先保存项目到磁盘。')
      return
    }

    let cancelled = false
    setInitializing(true)
    setError(null)

    void (async () => {
      try {
        const wsRes = await window.spark.invoke('workspace:open', { rootPath })
        if (cancelled) return

        const providerRes = await window.spark.invoke('provider:list', {})
        if (cancelled) return
        const profiles = providerRes.profiles ?? []
        if (profiles.length === 0) {
          setError('未配置任何模型供应商，请先到「Providers」中添加。')
          return
        }
        const providerId = profiles[0]!.id

        const sessionRes = await window.spark.invoke('session:create', {
          providerProfileId: providerId,
          workspaceId: wsRes.workspace.id,
          title: `画布助手 · ${snapshot.project.title}`,
          chatMode: 'agent',
        })
        if (cancelled) return
        setSessionId(sessionRes.sessionId)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '初始化 agent 失败')
        }
      } finally {
        if (!cancelled) setInitializing(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, snapshot.project.rootPath, snapshot.project.title, sessionId, initializing])

  // 弹窗关闭：清理 session（避免后台残留）
  useEffect(() => {
    if (open) return
    if (sessionId != null) {
      void window.spark.invoke('session:delete', { sessionId: sessionId as never }).catch(() => {})
    }
    setSessionId(null)
    setSystemSent(false)
    setError(null)
  }, [open])
  // sessionId intentionally not in deps; it's cleaned up here

  // session 就绪后注入系统上下文（首轮自动）
  useEffect(() => {
    if (sessionId == null || systemSent) return
    setSystemSent(true)
    const ctx = buildSystemContext(snapshot)
    void window.spark
      .invoke('session:send-turn', {
        sessionId: sessionId as never,
        message: `[系统] ${ctx}\n\n请回复"已就绪"开始对话。`,
      })
      .catch(() => {
        // 注入失败不致命；agent 仍可工作
      })
  }, [sessionId, systemSent, snapshot])

  const contextSummary = useMemo(() => buildSystemContext(snapshot), [snapshot])

  if (!open) return null

  return (
    <section
      className="canvas-bottom-floating-panel canvas-agent-panel"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="canvas-bottom-floating-head">
        <div>
          <strong className="canvas-agent-title">
            <Icons.Sparkles size={15} />
            画布 Agent 助手
          </strong>
          <span title={contextSummary}>对话操作画布 · 工具已就绪</span>
        </div>
        <Button
          size="small"
          type="text"
          icon={<Icons.X size={14} />}
          aria-label="关闭画布 Agent 助手"
          onClick={onClose}
        />
      </div>

      <div className="canvas-agent-modal">
        <ChatPanel
          sessionId={sessionId}
          loading={initializing}
          error={error}
          contextBadge={
            <>
              <Icons.Layers size={13} />
              <span>已接入画布：{snapshot.project.title} · {snapshot.board.name}</span>
            </>
          }
          emptyState={
            <>
              <Icons.Sparkles size={32} />
              <p>agent 已就绪，可以开始对话</p>
              <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                试试：「列出当前画板的所有节点」「为第一幕创建 3 个镜头片段」「把图片节点 X 的标题改成 Y」「生成一张赛博朋克风格的角色定妆图并插入画布」
              </p>
            </>
          }
          placeholder="输入消息，让 agent 操作画布（Enter 发送，Shift+Enter 换行）"
          toolNamePrefixFilter="mcp__spark_canvas__"
        />
      </div>
    </section>
  )
}
