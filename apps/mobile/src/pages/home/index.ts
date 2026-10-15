/**
 * 首页 — Inbox 枢纽页（Cursor 移动端式）。
 *
 * 页面即应用入口：状态仪表盘（2×2 卡）→ 项目分组 → 最近会话分组，
 * 底部悬浮胶囊输入框随时发起新对话（创建会话并直接发送首条消息）。
 *
 * 云端中继是唯一传输：登录即达（无需填地址/配对），
 * 会话与项目按「远程会话页选中的电脑」加载；链路失败（如电脑离线）内嵌为本页引导态。
 */

import * as bridge from '../../api/bridge'
import { describeBridgeError } from '../../api/bridge'
import { getItem, StorageKeys } from '../../utils/storage'
import { getState as getAuthState } from '../../store/auth'
import { formatRelativeTime } from '../../utils/format'
import type { BridgeProjectSummary, BridgeSessionSummary } from '../../api/bridge'

type Gate = 'ok' | 'error'

interface SessionRow extends BridgeSessionSummary {
  statusLabel: string
  dotClass: string
  timeLabel: string
}

/** 会话分组：项目组可跳转项目页；临时/其他组仅作容器 */
interface SessionGroup {
  key: string
  name: string
  /** 项目组=项目 id；临时/其他组为 null（组头不可跳转） */
  projectId: string | null
  isTemp: boolean
  sessions: SessionRow[]
}

interface HomeData {
  statusBarHeight: number
  /** 顶部工具行右侧让位宽度（避开微信胶囊） */
  navClearance: number
  gate: Gate
  loading: boolean
  errorText: string
  errorHint: string
  avatarUrl: string
  accountLabel: string
  stats: { total: number; running: number; error: number; projects: number }
  projects: BridgeProjectSummary[]
  /** 项目列表加载失败（多为桌面端未更新重启），列表区展示重试提示 */
  projectsError: boolean
  /** 按项目分组的会话（临时会话/未知归属单独成组，置底） */
  sessionGroups: SessionGroup[]
  /** 本页会话总数（空态判断用） */
  sessionTotal: number
  quickText: string
  quickSending: boolean
}

function sessionRow(item: BridgeSessionSummary): SessionRow {
  const statusLabel =
    item.status === 'running' ? '进行中' : item.status === 'error' ? '异常' : '空闲'
  const dotClass =
    item.status === 'running' ? 'dot-info' : item.status === 'error' ? 'dot-danger' : 'dot-neutral'
  return { ...item, statusLabel, dotClass, timeLabel: formatRelativeTime(item.updatedAt) }
}

/** 未归属项目的会话：桌面端 project_id = 'default'，旧版桌面端不返回该字段 */
function isTempSession(item: SessionRow): boolean {
  return item.projectId == null || item.projectId === '' || item.projectId === 'default'
}

const TEMP_GROUP_KEY = '__temp__'
const UNKNOWN_GROUP_KEY = '__unknown__'

/**
 * 会话按项目分组：项目组顺序与项目列表一致，
 * 无归属会话归「临时会话」、归属项目不在列表（已归档/加载失败）归「其他会话」，两组置底。
 */
function buildSessionGroups(
  sessions: SessionRow[],
  projects: BridgeProjectSummary[],
): SessionGroup[] {
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const buckets = new Map<string, SessionRow[]>()
  for (const row of sessions) {
    const key = isTempSession(row)
      ? TEMP_GROUP_KEY
      : projectById.has(row.projectId as string)
        ? (row.projectId as string)
        : UNKNOWN_GROUP_KEY
    const bucket = buckets.get(key)
    if (bucket) bucket.push(row)
    else buckets.set(key, [row])
  }
  const groups: SessionGroup[] = []
  for (const project of projects) {
    const bucket = buckets.get(project.id)
    if (bucket?.length) {
      groups.push({
        key: project.id,
        name: project.name,
        projectId: project.id,
        isTemp: false,
        sessions: bucket,
      })
    }
  }
  const temp = buckets.get(TEMP_GROUP_KEY)
  if (temp?.length) {
    groups.push({
      key: TEMP_GROUP_KEY,
      name: '临时会话',
      projectId: null,
      isTemp: true,
      sessions: temp,
    })
  }
  const unknown = buckets.get(UNKNOWN_GROUP_KEY)
  if (unknown?.length) {
    groups.push({
      key: UNKNOWN_GROUP_KEY,
      name: '其他会话',
      projectId: null,
      isTemp: false,
      sessions: unknown,
    })
  }
  return groups
}

Page({
  data: {
    statusBarHeight: 44,
    navClearance: 100,
    gate: 'ok',
    loading: true,
    errorText: '',
    errorHint: '',
    avatarUrl: '',
    accountLabel: '',
    stats: { total: 0, running: 0, error: 0, projects: 0 },
    projects: [],
    projectsError: false,
    sessionGroups: [],
    sessionTotal: 0,
    quickText: '',
    quickSending: false,
  } as HomeData,

  onShow() {
    this.applyStatusBar()
    const token = getItem<string>(StorageKeys.token)
    if (!token) {
      wx.reLaunch({ url: '/pages/login/index' })
      return
    }
    const user = getAuthState().user
    this.setData({
      avatarUrl: user?.avatarUrl ?? '',
      accountLabel: user?.nickname ?? user?.account ?? '',
    })
    // 云端中继：登录同一个账号即达，不需要「填地址 + 配对」两步
    void this.load()
  },

  onPullDownRefresh() {
    void this.load().finally(() => wx.stopPullDownRefresh())
  },

  applyStatusBar() {
    try {
      const win = wx.getWindowInfo()
      const menu = wx.getMenuButtonBoundingClientRect()
      this.setData({
        statusBarHeight: win.statusBarHeight,
        navClearance: Math.max(win.windowWidth - menu.left + 8, 100),
      })
    } catch {
      /* 保底 44px + 100px 让位 */
    }
  },

  /** 当前定向的 deviceId（与远程会话页电脑切换共享，'' → undefined = 主桌面端） */
  targetDeviceId(): string | undefined {
    return bridge.getSelectedDeviceId() || undefined
  },

  async load() {
    this.setData({ loading: true })
    const deviceId = this.targetDeviceId()
    try {
      const sessionsResult = await bridge.listSessions(50, undefined, deviceId)
      const sessions = sessionsResult.sessions.map(sessionRow)
      // 项目列表单独容错：失败不阻塞会话展示，但要显式提示（多为桌面端未更新重启、无新端点）
      const projectsResult = await bridge
        .listProjects(100, deviceId)
        .then((result) => ({ projects: result.projects, ok: true as const }))
        .catch(() => ({ projects: [] as BridgeProjectSummary[], ok: false as const }))
      const running = sessions.filter((item) => item.status === 'running').length
      const error = sessions.filter((item) => item.status === 'error').length
      const projects = projectsResult.projects
      const statsProjects = projectsResult.ok
        ? projects.length
        : // 回退：按本页会话的项目归属去重计数（列表拉不到时兜底，只统计可见页，比恒 0 诚实）
          new Set(sessions.filter((item) => !isTempSession(item)).map((item) => item.projectId))
            .size
      this.setData({
        gate: 'ok',
        errorText: '',
        errorHint: '',
        stats: { total: sessionsResult.total, running, error, projects: statsProjects },
        projectsError: !projectsResult.ok,
        projects,
        sessionGroups: buildSessionGroups(sessions, projects),
        sessionTotal: sessions.length,
      })
    } catch (error) {
      const { message, hint } = describeBridgeError(error)
      this.setData({
        gate: 'error',
        projects: [],
        projectsError: false,
        sessionGroups: [],
        sessionTotal: 0,
        errorText: message,
        errorHint: hint,
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  // ─── 桥接链路 ───────────────────────────────────────────────────────────────

  onRetryLoad() {
    void this.load()
  },

  // ─── 导航 ───────────────────────────────────────────────────────────────────

  onGoProfile() {
    wx.navigateTo({ url: '/pages/profile/index' })
  },
  onOpenProject(e: WechatMiniprogram.CustomEvent) {
    const { id, name } = e.currentTarget.dataset as { id: string; name: string }
    wx.navigateTo({
      url: `/pages/project-sessions/index?projectId=${encodeURIComponent(id)}&projectName=${encodeURIComponent(name)}`,
    })
  },
  /** 分组头点击：项目组跳项目会话列表；临时/其他组无项目页可去，忽略 */
  onOpenGroup(e: WechatMiniprogram.CustomEvent) {
    const { projectId, name } = e.currentTarget.dataset as {
      projectId: string | null
      name: string
    }
    if (!projectId) return
    wx.navigateTo({
      url: `/pages/project-sessions/index?projectId=${encodeURIComponent(projectId)}&projectName=${encodeURIComponent(name)}`,
    })
  },
  onOpenAll() {
    wx.navigateTo({ url: '/pages/project-sessions/index' })
  },
  onOpenSearch() {
    wx.navigateTo({ url: '/pages/project-sessions/index?search=1' })
  },
  onNewProjectHint() {
    wx.showToast({
      title: '项目在桌面端创建（打开文件夹），移动端即将支持',
      icon: 'none',
    })
  },
  onOpenSession(e: WechatMiniprogram.CustomEvent) {
    const { id, title } = e.currentTarget.dataset as { id: string; title: string }
    const deviceId = bridge.getSelectedDeviceId()
    wx.navigateTo({
      url: `/pages/chat/index?sessionId=${encodeURIComponent(id)}&title=${encodeURIComponent(title)}&deviceId=${encodeURIComponent(deviceId)}`,
    })
  },

  // ─── 快速发起（底部胶囊） ────────────────────────────────────────────────────

  onQuickInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ quickText: e.detail.value })
  },

  async onQuickSend() {
    const text = this.data.quickText.trim()
    if (!text || this.data.quickSending || this.data.gate !== 'ok') return
    this.setData({ quickSending: true })
    try {
      const deviceId = this.targetDeviceId()
      const created = await bridge.createSession(text.slice(0, 30), undefined, deviceId)
      await bridge.submitTurn(created.session.id, text, undefined, deviceId)
      this.setData({ quickText: '' })
      wx.navigateTo({
        url: `/pages/chat/index?sessionId=${encodeURIComponent(created.session.id)}&title=${encodeURIComponent(created.session.title)}&deviceId=${encodeURIComponent(deviceId ?? '')}`,
      })
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '发起失败', icon: 'none' })
    } finally {
      this.setData({ quickSending: false })
    }
  },
})
