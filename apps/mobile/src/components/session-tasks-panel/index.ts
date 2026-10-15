/**
 * 会话内定时任务面板（session 作用域）。
 *
 * 任务到达时间后在**当前会话**内自动发回合（保留会话配置），执行体固定为当前会话，
 * 无 Agent/Team 选择问题。表单只暴露名称/提示词/触发方式三要素 + 时间，
 * 高级项（超时/重试/并发策略）沿用桌面端默认值。
 */

import * as bridge from '../../api/bridge'
import { formatRelativeTime } from '../../utils/format'

interface TaskView {
  id: string
  name: string
  prompt: string
  enabled: boolean
  triggerLabel: string
  nextLabel: string
  lastLabel: string
  lastError: string
}

interface TaskForm {
  name: string
  prompt: string
  triggerType: 'once' | 'interval' | 'cron'
  date: string
  time: string
  intervalMinutes: string
  cron: string
}

function emptyForm(): TaskForm {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return {
    name: '',
    prompt: '',
    triggerType: 'once',
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    intervalMinutes: '30',
    cron: '',
  }
}

function describeTrigger(task: bridge.BridgeScheduledTask): {
  triggerLabel: string
  nextLabel: string
  lastLabel: string
} {
  let triggerLabel: string
  if (task.triggerType === 'once') triggerLabel = '单次'
  else if (task.triggerType === 'interval')
    triggerLabel = `每 ${Math.max(1, Math.round((task.intervalSeconds ?? 60) / 60))} 分钟`
  else triggerLabel = `Cron ${task.cronExpression ?? ''}`
  return {
    triggerLabel,
    nextLabel: task.nextRunAt != null ? formatRelativeTime(task.nextRunAt) : '',
    lastLabel: task.lastRunAt != null ? formatRelativeTime(task.lastRunAt) : '',
  }
}

Component({
  properties: {
    show: { type: Boolean, value: false },
    sessionId: { type: String, value: '' },
    /** 定向的桌面端 deviceId（'' = 主桌面端；由聊天页透传） */
    deviceId: { type: String, value: '' },
  },

  data: {
    loading: false,
    tasks: [] as TaskView[],
    creating: false,
    formSubmitting: false,
    form: emptyForm(),
  },

  observers: {
    show(visible: boolean) {
      if (visible) void this.reload()
    },
  },

  methods: {
    noop() {
      /* 阻止冒泡 */
    },

    onClose() {
      this.triggerEvent('close')
    },

    /** 定向的 deviceId（'' → undefined = 主桌面端） */
    targetDeviceId(): string | undefined {
      const deviceId = (this as unknown as { properties: { deviceId: string } }).properties
        .deviceId
      return deviceId || undefined
    },

    async reload() {
      const sessionId = (this as unknown as { properties: { sessionId: string } }).properties
        .sessionId
      if (!sessionId) return
      this.setData({ loading: true })
      try {
        const { tasks } = await bridge.listSessionTasks(sessionId, this.targetDeviceId())
        this.setData({
          tasks: tasks.map((task) => ({
            id: task.id,
            name: task.name,
            prompt: task.prompt,
            enabled: task.enabled,
            ...describeTrigger(task),
            lastError: task.lastError ?? '',
          })),
        })
      } catch (error) {
        wx.showToast({ title: (error as Error).message || '任务加载失败', icon: 'none' })
      } finally {
        this.setData({ loading: false })
      }
    },

    onToggleCreate() {
      this.setData({ creating: !this.data.creating, form: emptyForm() })
    },

    onFieldInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
      const field = e.currentTarget.dataset.field as keyof TaskForm | undefined
      if (field == null) return
      this.setData({ [`form.${field}`]: e.detail.value } as unknown as Record<string, unknown>)
    },

    onTriggerType(e: WechatMiniprogram.BaseEvent) {
      const type = e.currentTarget.dataset.type as TaskForm['triggerType'] | undefined
      if (type == null) return
      this.setData({ 'form.triggerType': type })
    },

    onDateChange(e: WechatMiniprogram.PickerChange) {
      this.setData({ 'form.date': String(e.detail.value) })
    },

    onTimeChange(e: WechatMiniprogram.PickerChange) {
      this.setData({ 'form.time': String(e.detail.value) })
    },

    async onCreate() {
      const sessionId = (this as unknown as { properties: { sessionId: string } }).properties
        .sessionId
      const { form } = this.data
      if (!form.name.trim() || !form.prompt.trim()) {
        wx.showToast({ title: '请填写任务名称和提示词', icon: 'none' })
        return
      }
      const input: bridge.BridgeCreateTaskInput = {
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        triggerType: form.triggerType,
      }
      if (form.triggerType === 'once') {
        const runAt = new Date(`${form.date}T${form.time}:00`)
        if (Number.isNaN(runAt.getTime()) || runAt.getTime() <= Date.now()) {
          wx.showToast({ title: '执行时间必须晚于当前', icon: 'none' })
          return
        }
        input.runAt = runAt.toISOString()
      } else if (form.triggerType === 'interval') {
        const minutes = Number(form.intervalMinutes)
        if (!Number.isFinite(minutes) || minutes < 1) {
          wx.showToast({ title: '间隔至少 1 分钟', icon: 'none' })
          return
        }
        input.intervalSeconds = Math.round(minutes * 60)
      } else {
        if (!form.cron.trim()) {
          wx.showToast({ title: '请填写 Cron 表达式', icon: 'none' })
          return
        }
        input.cronExpression = form.cron.trim()
      }
      this.setData({ formSubmitting: true })
      try {
        await bridge.createSessionTask(sessionId, input, this.targetDeviceId())
        wx.showToast({ title: '任务已创建', icon: 'success' })
        this.setData({ creating: false, form: emptyForm() })
        await this.reload()
      } catch (error) {
        wx.showToast({ title: (error as Error).message || '创建失败', icon: 'none' })
      } finally {
        this.setData({ formSubmitting: false })
      }
    },

    async onToggle(e: WechatMiniprogram.BaseEvent) {
      const id = e.currentTarget.dataset.id as string | undefined
      const enabled = e.currentTarget.dataset.enabled === true
      if (id == null) return
      try {
        await bridge.toggleSessionTask(id, !enabled, this.targetDeviceId())
        await this.reload()
      } catch (error) {
        wx.showToast({ title: (error as Error).message || '操作失败', icon: 'none' })
      }
    },

    async onRunNow(e: WechatMiniprogram.BaseEvent) {
      const id = e.currentTarget.dataset.id as string | undefined
      if (id == null) return
      try {
        await bridge.runSessionTaskNow(id, this.targetDeviceId())
        wx.showToast({ title: '已触发执行', icon: 'success' })
        setTimeout(() => void this.reload(), 1500)
      } catch (error) {
        wx.showToast({ title: (error as Error).message || '执行失败', icon: 'none' })
      }
    },

    onDelete(e: WechatMiniprogram.BaseEvent) {
      const id = e.currentTarget.dataset.id as string | undefined
      if (id == null) return
      wx.showModal({
        title: '删除任务',
        content: '删除后该定时任务不再执行，确定删除？',
        confirmColor: '#dc2626',
        success: async (res) => {
          if (!res.confirm || id == null) return
          try {
            await bridge.deleteSessionTask(id, this.targetDeviceId())
            await this.reload()
          } catch (error) {
            wx.showToast({ title: (error as Error).message || '删除失败', icon: 'none' })
          }
        },
      })
    },
  },
})
