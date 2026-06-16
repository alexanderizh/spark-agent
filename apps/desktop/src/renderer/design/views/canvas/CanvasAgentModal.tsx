import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Modal, Spin, message } from 'antd'
import { Icons } from '../../Icons'
import type { CanvasSnapshot } from './canvas.types'
import type { AgentEvent } from '@spark/protocol'

/**
 * 画布 Agent 对话弹窗（文档：将画布接入 agent 上下文）。
 *
 * 复用平台 session 机制：
 *   - workspace:open 用画布项目 rootPath 创建/复用 workspace
 *   - session:create 绑定 workspace + 默认 provider/agent
 *   - session:send-turn 发送消息（多轮）
 *   - stream:session:agent-event 监听 agent 回复（assistant_message delta/complete）
 *
 * 画布上下文注入：首条消息自动附带当前画布结构摘要（项目名/节点/资产/分镜数 + rootPath），
 * 让 agent 理解当前画布状态，可通过文件系统（项目目录 snapshots JSON）+ shell 工具操作画布。
 */

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 流式未完成 */
  streaming?: boolean
}

/** 构造画布上下文摘要，作为首条 system context 注入 */
function buildCanvasContext(snapshot: CanvasSnapshot): string {
  const boardCount = snapshot.boards?.length ?? 1
  const activeBoard = snapshot.board.name
  const filmMeta = snapshot.project.metadata?.film as { shotGroups?: unknown[] } | undefined
  const shotGroupCount = filmMeta?.shotGroups?.length ?? 0
  // 影视公用资产按 kind 分类计数
  const kindCounts: Record<string, number> = {}
  for (const asset of snapshot.assets) {
    const kind = (asset.metadata?.kind as string) ?? 'other'
    kindCounts[kind] = (kindCounts[kind] ?? 0) + 1
  }
  const kindSummary = Object.entries(kindCounts)
    .map(([k, v]) => `${k}:${v}`)
    .join('、')

  return [
    `当前正在编辑画布项目：${snapshot.project.title}`,
    `项目目录：${snapshot.project.rootPath ?? '(默认位置)'}`,
    `画布概览：${boardCount} 个画布，当前「${activeBoard}」，${snapshot.nodes.length} 个节点、${snapshot.assets.length} 个资产、${snapshot.tasks.length} 个任务。`,
    shotGroupCount > 0 ? `分镜分组：${shotGroupCount} 组。` : '',
    kindSummary ? `资产构成：${kindSummary}` : '',
    '',
    '你可以通过项目目录内的文件和命令操作这个画布项目。',
    `- 项目快照保存在 ${snapshot.project.rootPath ?? '<项目目录>'}/snapshots/ 目录`,
    `- 资产文件保存在 ${snapshot.project.rootPath ?? '<项目目录>'}/assets/ 目录`,
    '请基于以上画布上下文协助用户完成创作任务。',
  ].filter(Boolean).join('\n')
}

export function CanvasAgentModal({
  open,
  onClose,
  snapshot,
}: {
  open: boolean
  onClose: () => void
  snapshot: CanvasSnapshot
}) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const streamingBufferRef = useRef<string>('')
  const streamingMsgIdRef = useRef<string | null>(null)
  const initializedRef = useRef(false)

  // 初始化：打开 workspace + 创建 session（仅在 open 且未初始化时）
  useEffect(() => {
    if (!open || initializedRef.current) return
    const rootPath = snapshot.project.rootPath
    if (!rootPath) {
      setError('画布项目未关联目录，无法启动 agent。请先保存项目。')
      return
    }

    let cancelled = false
    setInitializing(true)
    setError(null)

    void (async () => {
      try {
        // 1. 用项目 rootPath 打开/创建 workspace
        const wsRes = await window.spark.invoke('workspace:open', { rootPath })
        if (cancelled) return
        const wsId = wsRes.workspace.id
        setWorkspaceId(wsId)

        // 2. 获取可用 provider（取第一个）
        const providerRes = await window.spark.invoke('provider:list', {})
        if (cancelled) return
        const profiles = providerRes.profiles ?? []
        if (profiles.length === 0) {
          setError('未配置任何模型供应商，请先在设置中配置。')
          return
        }
        const providerId = profiles[0]!.id

        // 3. 创建 session
        const sessionRes = await window.spark.invoke('session:create', {
          providerProfileId: providerId,
          workspaceId: wsId,
          title: `画布助手 · ${snapshot.project.title}`,
          chatMode: 'agent',
        })
        if (cancelled) return
        setSessionId(sessionRes.sessionId)
        initializedRef.current = true

        // 4. 注入画布上下文
        const ctx = buildCanvasContext(snapshot)
        await window.spark.invoke('session:send-turn', {
          sessionId: sessionRes.sessionId,
          message: `[画布上下文]\n${ctx}\n\n请确认你已理解当前画布项目状态，简短回复"已就绪"即可。`,
        } as never)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, snapshot.project.rootPath, snapshot.project.title])

  // 监听 agent 事件流
  useEffect(() => {
    if (!sessionId) return
    const unsubscribe = window.spark.on(
      'stream:session:agent-event',
      (event: AgentEvent) => {
        if (!event || typeof event !== 'object') return
        const evt = event as { sessionId?: string; type?: string }
        if (evt.sessionId !== sessionId) return

        // assistant 回复：增量 + 完成
        if (evt.type === 'assistant_message') {
          const e = event as { mode?: string; content?: string }
          if (e.mode === 'delta' && e.content) {
            // 增量拼接
            if (!streamingMsgIdRef.current) {
              streamingMsgIdRef.current = `asst_${Date.now()}`
              streamingBufferRef.current = ''
            }
            streamingBufferRef.current += e.content
            const id = streamingMsgIdRef.current
            const buffered = streamingBufferRef.current
            setMessages((prev) => {
              const existing = prev.find((m) => m.id === id)
              if (existing) {
                return prev.map((m) => (m.id === id ? { ...m, content: buffered, streaming: true } : m))
              }
              return [...prev, { id, role: 'assistant', content: buffered, streaming: true }]
            })
          } else if (e.mode === 'complete' && e.content) {
            // 完整消息：替换或追加
            const id = streamingMsgIdRef.current ?? `asst_${Date.now()}`
            streamingBufferRef.current = e.content
            setMessages((prev) => {
              const existing = prev.find((m) => m.id === id)
              if (existing) {
                return prev.map((m) => (m.id === id ? { ...m, content: e.content!, streaming: false } : m))
              }
              return [...prev, { id, role: 'assistant', content: e.content!, streaming: false }]
            })
            streamingMsgIdRef.current = null
            streamingBufferRef.current = ''
            setSending(false)
          }
        }

        // agent 出错
        if (evt.type === 'agent_error') {
          const e = event as { message?: string }
          setSending(false)
          setError(e.message ?? 'agent 执行出错')
        }
      },
    )
    return unsubscribe
  }, [sessionId])

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 重置（关闭弹窗后重新打开时重新初始化）
  useEffect(() => {
    if (!open) {
      initializedRef.current = false
      setSessionId(null)
      setWorkspaceId(null)
      setMessages([])
      setInput('')
      setSending(false)
      setError(null)
      streamingMsgIdRef.current = null
      streamingBufferRef.current = ''
    }
  }, [open])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || !sessionId || sending) return
    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setSending(true)
    setError(null)
    streamingMsgIdRef.current = null
    streamingBufferRef.current = ''

    try {
      await window.spark.invoke('session:send-turn', {
        sessionId,
        message: text,
      } as never)
    } catch (err) {
      setSending(false)
      setError(err instanceof Error ? err.message : '发送失败')
    }
  }, [input, sessionId, sending])

  const contextSummary = useMemo(() => buildCanvasContext(snapshot), [snapshot])

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={680}
      title={
        <span className="canvas-agent-title">
          <Icons.Sparkles size={16} />
          画布 Agent 助手
        </span>
      }
      styles={{ body: { padding: 0, height: '72vh', display: 'flex', flexDirection: 'column' } }}
      destroyOnHidden
    >
      <div className="canvas-agent-modal">
        {initializing && (
          <div className="canvas-agent-loading">
            <Spin tip="正在初始化 agent..." />
          </div>
        )}

        {error && !initializing && (
          <div className="canvas-agent-error">
            <Icons.X size={14} />
            <span>{error}</span>
          </div>
        )}

        {!initializing && (
          <>
            <div className="canvas-agent-context">
              <Icons.Layers size={13} />
              <span title={contextSummary}>已接入画布：{snapshot.project.title}</span>
            </div>

            <div className="canvas-agent-messages">
              {messages.length === 0 && (
                <div className="canvas-agent-empty">
                  <Icons.Sparkles size={32} />
                  <p>agent 已就绪，可以开始对话</p>
                  <p className="canvas-agent-empty-hint">
                    试试：「帮我梳理当前画布的节点结构」「优化第一幕的镜头描述」「为角色生成定妆图提示词」
                  </p>
                </div>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className={`canvas-agent-message canvas-agent-message-${msg.role}`}>
                  <div className="canvas-agent-message-avatar">
                    {msg.role === 'user' ? <Icons.MousePointer size={14} /> : <Icons.Sparkles size={14} />}
                  </div>
                  <div className="canvas-agent-message-body">
                    <div className="canvas-agent-message-text">{msg.content}</div>
                    {msg.streaming && <span className="canvas-agent-cursor">▋</span>}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="canvas-agent-input-area">
              <textarea
                className="canvas-agent-input"
                value={input}
                placeholder={sending ? 'agent 正在回复...' : '输入消息，与 agent 协作操作画布（Enter 发送，Shift+Enter 换行）'}
                disabled={sending || !sessionId}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void handleSend()
                  }
                }}
                rows={3}
              />
              <Button
                type="primary"
                icon={<Icons.Sparkles size={14} />}
                disabled={!input.trim() || sending || !sessionId}
                loading={sending}
                onClick={() => void handleSend()}
              >
                发送
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
