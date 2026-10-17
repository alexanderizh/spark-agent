/**
 * 会话定时任务管理页（独立页面，替代旧 session-tasks-panel 半屏面板）。
 *
 * 路由：/pages/session-tasks/index?sessionId=…&deviceId=…&title=…
 * 三态：加载中 / 空态 / 列表；新建与编辑共用页内表单态（mode 切换，无弹层）。
 * 端点全部复用既有桥接 API（桌面端零改动）：tasks 5 端点 + toggle/run。
 * 表单逻辑在 utils/task-form.ts（校验/互转/PATCH null 清除语义）。
 */

import * as bridge from '../../api/bridge'
import { formatRelativeTime } from '../../utils/format'
import {
  describeTrigger,
  emptyForm,
  formToCreateInput,
  formToUpdatePatch,
  taskToForm,
  validateForm,
  TRIGGER_TYPE_LABELS,
  type TaskForm,
  type TaskTriggerType,
} from '../../utils/task-form'

/** 列表卡片视图（表单无关的派生字段一次算好，WXML 零逻辑） */
interface TaskCardView {
  task: bridge.BridgeScheduledTask
  triggerLabel: string
  nextRunLabel: string
  lastRunLabel: string
}

interface SessionTasksPageData {
  sessionId: string
  deviceId: string
  loading: boolean
  loadError: string
  cards: TaskCardView[]
  /** 页面形态：list 列表 / form 新建编辑表单 */
  mode: 'list' | 'form'
  /** 编辑中的任务 id（null = 新建） */
  editingTaskId: string | null
  editingTaskName: string
  form: TaskForm
  triggerTypes: TaskTriggerType[]
  triggerTypeLabels: Record<TaskTriggerType, string>
  saving: boolean
  /** 高级选项折叠态 */
  advancedOpen: boolean
}

Page({
  data: {
    sessionId: '',
    deviceId: '',
    loading: true,
    loadError: '',
    cards: [],
    mode: 'list',
    editingTaskId: null,
    editingTaskName: '',
    form: emptyForm(),
    triggerTypes: ['once', 'interval', 'cron'] as TaskTriggerType[],
    triggerTypeLabels: TRIGGER_TYPE_LABELS,
    saving: false,
    advancedOpen: false,
  } as SessionTasksPageData,

  onLoad(options: Record<string, string | undefined>) {
    const sessionId = options.sessionId ?? ''
    const deviceId = options.deviceId ?? ''
    if (!sessionId || !deviceId) {
      wx.showToast({ title: '缺少会话上下文', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 600)
      return
    }
    this.setData({
      sessionId,
      deviceId,
    } as Partial<SessionTasksPageData> as Record<string, unknown>)
    void this.loadTasks()
  },

  async loadTasks() {
    this.setData({ loading: true, loadError: '' })
    try {
      const { tasks } = await bridge.listSessionTasks(this.data.sessionId, this.data.deviceId)
      this.setData({ cards: tasks.map((task) => this.toCardView(task)), loading: false })
    } catch (error) {
      this.setData({
        loading: false,
        loadError: (error as Error).message || '任务列表加载失败',
      })
    }
  },

  toCardView(task: bridge.BridgeScheduledTask): TaskCardView {
    return {
      task,
      triggerLabel: describeTrigger(task),
      nextRunLabel: task.nextRunAt != null ? formatRelativeTime(task.nextRunAt) : '',
      lastRunLabel: task.lastRunAt != null ? formatRelativeTime(task.lastRunAt) : '',
    }
  },

  // ─── 列表操作 ────────────────────────────────────────────────────────────────

  async onToggle(e: WechatMiniprogram.SwitchChange) {
    const id = e.currentTarget.dataset.id as string | undefined
    if (!id) return
    const enabled = e.detail.value !== false
    try {
      await bridge.toggleSessionTask(id, enabled, this.data.deviceId)
      await this.loadTasks()
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '切换失败', icon: 'none' })
      await this.loadTasks()
    }
  },

  async onRunNow(e: WechatMiniprogram.BaseEvent<WechatMiniprogram.IAnyObject, { id: string }>) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    try {
      await bridge.runSessionTaskNow(id, this.data.deviceId)
      wx.showToast({ title: '已触发执行', icon: 'success' })
      setTimeout(() => void this.loadTasks(), 1500)
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '执行失败', icon: 'none' })
    }
  },

  onDelete(
    e: WechatMiniprogram.BaseEvent<WechatMiniprogram.IAnyObject, { id: string; name: string }>,
  ) {
    const { id, name } = e.currentTarget.dataset
    if (!id) return
    wx.showModal({
      title: '删除任务',
      content: `确定删除「${name}」吗？`,
      confirmColor: '#dc2626',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await bridge.deleteSessionTask(id, this.data.deviceId)
          wx.showToast({ title: '已删除', icon: 'success' })
          await this.loadTasks()
        } catch (error) {
          wx.showToast({ title: (error as Error).message || '删除失败', icon: 'none' })
        }
      },
    })
  },

  // ─── 表单态 ──────────────────────────────────────────────────────────────────

  onCreate() {
    this.setData({
      mode: 'form',
      editingTaskId: null,
      editingTaskName: '',
      form: emptyForm(),
      advancedOpen: false,
    })
  },

  onEdit(e: WechatMiniprogram.BaseEvent<WechatMiniprogram.IAnyObject, { id: string }>) {
    const id = e.currentTarget.dataset.id
    const card = this.data.cards.find((item) => item.task.id === id)
    if (card == null) return
    this.setData({
      mode: 'form',
      editingTaskId: card.task.id,
      editingTaskName: card.task.name,
      form: taskToForm(card.task),
      advancedOpen: false,
    })
  },

  onCancelForm() {
    this.setData({ mode: 'list' })
  },

  onFormName(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'form.name': e.detail.value })
  },

  onFormPrompt(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'form.prompt': e.detail.value })
  },

  onTriggerSelect(
    e: WechatMiniprogram.BaseEvent<WechatMiniprogram.IAnyObject, { type: TaskTriggerType }>,
  ) {
    const type = e.currentTarget.dataset.type
    if (type !== 'once' && type !== 'interval' && type !== 'cron') return
    this.setData({ 'form.triggerType': type })
  },

  onRunDate(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'form.runDate': e.detail.value })
  },

  onRunTime(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'form.runTime': e.detail.value })
  },

  onIntervalMinutes(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'form.intervalMinutes': e.detail.value })
  },

  onCronExpression(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'form.cronExpression': e.detail.value })
  },

  onTimeoutSeconds(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'form.timeoutSeconds': e.detail.value })
  },

  onMaxRetries(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ 'form.maxRetries': e.detail.value })
  },

  onToggleAdvanced() {
    this.setData({ advancedOpen: !this.data.advancedOpen })
  },

  async onSave() {
    if (this.data.saving) return
    const form = this.data.form
    const invalid = validateForm(form)
    if (invalid != null) {
      wx.showToast({ title: invalid, icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      if (this.data.editingTaskId != null) {
        await bridge.updateSessionTask(
          this.data.editingTaskId,
          formToUpdatePatch(form),
          this.data.deviceId,
        )
        wx.showToast({ title: '已保存', icon: 'success' })
      } else {
        await bridge.createSessionTask(
          this.data.sessionId,
          formToCreateInput(form),
          this.data.deviceId,
        )
        wx.showToast({ title: '已创建', icon: 'success' })
      }
      this.setData({ mode: 'list' })
      await this.loadTasks()
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },
})
