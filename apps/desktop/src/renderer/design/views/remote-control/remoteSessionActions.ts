/**
 * 远程会话/项目的管理动作。
 *
 * 目标端 MobileBridgeService 已经具备完整写接口，这里只做转发 + 本地回写：
 *   PATCH  /v1/sessions/:id   { title } | { pinned } | { sessionLabel }
 *   DELETE /v1/sessions/:id
 *   POST   /v1/sessions       { projectId }
 *   PATCH  /v1/projects/:id   { name } | { pinned }
 *   DELETE /v1/projects/:id
 *
 * 写成功后就地改本地缓存而不是重拉列表：用户主动操作一次，没必要再付一次流量，
 * 也不会有列表闪一下的观感。排序若受影响（置顶）由 sortSessionRows 近似处理，
 * 30s 后的定期刷新会以服务端结果为准。
 */
import { useCallback, useState } from 'react'
import type {
  MobileBridgeProjectSummary,
  MobileBridgeSessionSummary,
  SessionLabelKey,
} from '@spark/protocol'
import { useAppOptional } from '../../AppContext'
import { useOptionalToast } from '../../components/Toast'
import {
  insertSessionInStore,
  patchProjectInStore,
  patchSessionInStore,
  removeProjectFromStore,
  removeSessionFromStore,
  UNASSIGNED_PROJECT_ID,
  type RemoteProjectRow,
} from './remoteSessionStore'
import { useRemoteCall, type RemoteCall } from './useRemoteBridge'
import { resolveComposerPrefsPatch } from './remoteComposerPrefs'
import { readCachedCatalog } from './useRemoteComposerConfig'
import { forgetLastSession, forgetProjectSessions, readComposerPrefs } from './remoteViewState'

/** 会话标记（顺序与桌面端侧栏右键菜单一致） */
export const REMOTE_SESSION_LABELS: ReadonlyArray<{ key: SessionLabelKey; label: string }> = [
  { key: 'suspended', label: '挂起' },
  { key: 'not-started', label: '未开始' },
  { key: 'pending-review', label: '待审查' },
  { key: 'pending-advance', label: '待推进' },
  { key: 'undelivered', label: '未交付' },
]

export function sessionLabelText(key: SessionLabelKey | null | undefined): string | null {
  if (key == null) return null
  return REMOTE_SESSION_LABELS.find((meta) => meta.key === key)?.label ?? null
}

interface UpdateSessionResponse {
  session?: MobileBridgeSessionSummary
}

interface UpdateProjectResponse {
  project?: MobileBridgeProjectSummary
}

interface CreateSessionResponse {
  session?: { id: string }
}

/**
 * 新建会话后套用「上次用的助手 / 模型 / 权限」。
 *
 * 目标端 POST /v1/sessions 只接受 title / projectId，所以分两步：先建、再 PATCH。
 * 记忆里的旧值可能已经失效（渠道被删、换了 adapter），先按目录收敛；
 * 失败一律静默——新会话已经建好，不该因为套用偏好把用户拦在报错里。
 */
async function applyRememberedPrefs(
  deviceId: string,
  call: RemoteCall,
  sessionId: string,
): Promise<void> {
  const patch = resolveComposerPrefsPatch(readComposerPrefs(deviceId), readCachedCatalog(deviceId))
  if (Object.keys(patch).length === 0) return
  try {
    await call(deviceId, 'PATCH', `/v1/sessions/${encodeURIComponent(sessionId)}`, patch)
  } catch {
    /* 目标端拒绝：退回它的默认配置，下一次在输入区重选会重新记忆 */
  }
}

export interface RemoteSessionActions {
  /** 正在写的那一行（行上显示 spinner） */
  busyId: string | null
  renameSession: (session: MobileBridgeSessionSummary) => Promise<void>
  toggleSessionPin: (session: MobileBridgeSessionSummary) => Promise<void>
  setSessionLabel: (
    session: MobileBridgeSessionSummary,
    label: SessionLabelKey | null,
  ) => Promise<void>
  /** 返回是否真的删掉了（取消 / 失败为 false） */
  deleteSession: (session: MobileBridgeSessionSummary) => Promise<boolean>
  /** 返回新会话 id（失败或用户取消时 null） */
  createSession: (projectId: string) => Promise<string | null>
  renameProject: (row: RemoteProjectRow) => Promise<void>
  toggleProjectPin: (projectId: string, pinned: boolean) => Promise<void>
  deleteProject: (row: RemoteProjectRow) => Promise<boolean>
}

export function useRemoteSessionActions(deviceId: string): RemoteSessionActions {
  const call = useRemoteCall()
  const toastCtx = useOptionalToast()
  const app = useAppOptional()
  const [busyId, setBusyId] = useState<string | null>(null)

  const toast = toastCtx?.toast ?? null

  const reportError = useCallback(
    (cause: unknown, fallback: string) => {
      const message = cause instanceof Error ? cause.message : String(cause)
      toast?.error(message.length > 0 ? message : fallback)
    },
    [toast],
  )

  /** 桌面端全局输入弹窗；预览壳（无 Provider）退到原生 prompt，行为不丢 */
  const askText = useCallback(
    async (options: {
      title: string
      value: string
      placeholder?: string
    }): Promise<string | null> => {
      if (app != null) {
        const answer = await app.requestPrompt({
          title: options.title,
          value: options.value,
          ...(options.placeholder != null ? { placeholder: options.placeholder } : {}),
        })
        return answer == null ? null : answer.trim()
      }
      if (typeof window === 'undefined') return null
      const answer = window.prompt(options.title, options.value)
      return answer == null ? null : answer.trim()
    },
    [app],
  )

  const askConfirm = useCallback(
    async (options: {
      title: string
      description: string
      confirmText: string
    }): Promise<boolean> => {
      if (app != null) {
        return app.requestConfirm({
          title: options.title,
          description: options.description,
          confirmText: options.confirmText,
          danger: true,
        })
      }
      if (typeof window === 'undefined') return false
      return window.confirm(`${options.title}\n\n${options.description}`)
    },
    [app],
  )

  const renameSession = useCallback(
    async (session: MobileBridgeSessionSummary) => {
      const title = await askText({
        title: '重命名会话',
        value: session.title ?? '',
        placeholder: '会话标题',
      })
      if (title == null || title.length === 0 || title === session.title) return
      setBusyId(session.id)
      try {
        await call<UpdateSessionResponse>(
          deviceId,
          'PATCH',
          `/v1/sessions/${encodeURIComponent(session.id)}`,
          { title },
        )
        patchSessionInStore(deviceId, session.id, { title })
        toast?.success('已重命名')
      } catch (cause) {
        reportError(cause, '重命名失败')
      } finally {
        setBusyId(null)
      }
    },
    [askText, call, deviceId, reportError, toast],
  )

  const toggleSessionPin = useCallback(
    async (session: MobileBridgeSessionSummary) => {
      const pinned = session.pinnedAt == null
      setBusyId(session.id)
      try {
        const result = await call<UpdateSessionResponse>(
          deviceId,
          'PATCH',
          `/v1/sessions/${encodeURIComponent(session.id)}`,
          { pinned },
        )
        patchSessionInStore(deviceId, session.id, {
          pinnedAt: result.session?.pinnedAt ?? (pinned ? new Date().toISOString() : null),
        })
        toast?.success(pinned ? '已置顶' : '已取消置顶')
      } catch (cause) {
        reportError(cause, '操作失败')
      } finally {
        setBusyId(null)
      }
    },
    [call, deviceId, reportError, toast],
  )

  const setSessionLabel = useCallback(
    async (session: MobileBridgeSessionSummary, label: SessionLabelKey | null) => {
      if ((session.sessionLabel ?? null) === label) {
        toast?.info(label == null ? '尚未打标' : '已是该标记')
        return
      }
      setBusyId(session.id)
      try {
        const result = await call<UpdateSessionResponse>(
          deviceId,
          'PATCH',
          `/v1/sessions/${encodeURIComponent(session.id)}`,
          { sessionLabel: label },
        )
        patchSessionInStore(deviceId, session.id, {
          sessionLabel: result.session?.sessionLabel ?? label,
          labeledAt: result.session?.labeledAt ?? (label != null ? new Date().toISOString() : null),
        })
        toast?.success(label == null ? '已清除标记' : `已标记为「${sessionLabelText(label)}」`)
      } catch (cause) {
        reportError(cause, '设置标记失败')
      } finally {
        setBusyId(null)
      }
    },
    [call, deviceId, reportError, toast],
  )

  const deleteSession = useCallback(
    async (session: MobileBridgeSessionSummary) => {
      const confirmed = await askConfirm({
        title: '删除会话',
        description: `「${session.title || '未命名会话'}」将在目标电脑上删除，无法恢复。`,
        confirmText: '删除',
      })
      if (!confirmed) return false
      setBusyId(session.id)
      try {
        await call(deviceId, 'DELETE', `/v1/sessions/${encodeURIComponent(session.id)}`)
        removeSessionFromStore(deviceId, session)
        // 记住的「上次会话」如果正是它，下次进来就会 404，一起清掉
        forgetLastSession(deviceId, session.id)
        toast?.success('已删除')
        return true
      } catch (cause) {
        reportError(cause, '删除失败')
        return false
      } finally {
        setBusyId(null)
      }
    },
    [askConfirm, call, deviceId, reportError, toast],
  )

  const createSession = useCallback(
    async (projectId: string): Promise<string | null> => {
      setBusyId(`create:${projectId}`)
      try {
        // 未归属不是真实项目：不带 projectId 让目标端落到默认归属
        const body = projectId === UNASSIGNED_PROJECT_ID ? {} : { projectId }
        const result = await call<CreateSessionResponse>(deviceId, 'POST', '/v1/sessions', body)
        const created = result.session
        if (created?.id == null) {
          toast?.error('创建会话失败')
          return null
        }
        insertSessionInStore(deviceId, {
          id: created.id,
          title: '新会话',
          status: 'idle',
          updatedAt: new Date().toISOString(),
          preview: '',
          projectId,
          pinnedAt: null,
          sessionLabel: null,
          labeledAt: null,
        })
        await applyRememberedPrefs(deviceId, call, created.id)
        toast?.success('已新建会话')
        return created.id
      } catch (cause) {
        reportError(cause, '创建会话失败')
        return null
      } finally {
        setBusyId(null)
      }
    },
    [call, deviceId, reportError, toast],
  )

  const renameProject = useCallback(
    async (row: RemoteProjectRow) => {
      if (row.kind === 'unassigned') return
      const name = await askText({
        title: '重命名项目',
        value: row.name,
        placeholder: '项目名',
      })
      if (name == null || name.length === 0 || name === row.name) return
      setBusyId(row.id)
      try {
        const result = await call<UpdateProjectResponse>(
          deviceId,
          'PATCH',
          `/v1/projects/${encodeURIComponent(row.id)}`,
          { name },
        )
        patchProjectInStore(deviceId, row.id, { name: result.project?.name ?? name })
        toast?.success('已重命名')
      } catch (cause) {
        reportError(cause, '重命名失败')
      } finally {
        setBusyId(null)
      }
    },
    [askText, call, deviceId, reportError, toast],
  )

  const toggleProjectPin = useCallback(
    async (projectId: string, pinned: boolean) => {
      if (projectId === UNASSIGNED_PROJECT_ID) return
      setBusyId(projectId)
      try {
        const result = await call<UpdateProjectResponse>(
          deviceId,
          'PATCH',
          `/v1/projects/${encodeURIComponent(projectId)}`,
          { pinned },
        )
        patchProjectInStore(deviceId, projectId, {
          pinnedAt: result.project?.pinnedAt ?? (pinned ? new Date().toISOString() : null),
        })
        toast?.success(pinned ? '已置顶项目' : '已取消置顶')
      } catch (cause) {
        reportError(cause, '操作失败')
      } finally {
        setBusyId(null)
      }
    },
    [call, deviceId, reportError, toast],
  )

  const deleteProject = useCallback(
    async (row: RemoteProjectRow) => {
      if (row.kind === 'unassigned') return false
      const confirmed = await askConfirm({
        title: '删除项目',
        description: `「${row.name}」及其下 ${row.sessionCount} 个会话会一并删除，无法恢复。`,
        confirmText: '删除项目',
      })
      if (!confirmed) return false
      setBusyId(row.id)
      try {
        await call(deviceId, 'DELETE', `/v1/projects/${encodeURIComponent(row.id)}`)
        removeProjectFromStore(deviceId, row.id)
        forgetProjectSessions(deviceId, row.id)
        toast?.success('已删除项目')
        return true
      } catch (cause) {
        reportError(cause, '删除失败')
        return false
      } finally {
        setBusyId(null)
      }
    },
    [askConfirm, call, deviceId, reportError, toast],
  )

  return {
    busyId,
    renameSession,
    toggleSessionPin,
    setSessionLabel,
    deleteSession,
    createSession,
    renameProject,
    toggleProjectPin,
    deleteProject,
  }
}
