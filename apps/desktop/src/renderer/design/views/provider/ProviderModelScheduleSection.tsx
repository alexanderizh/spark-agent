import { useMemo } from 'react'
import { Select, Switch } from 'antd'
import { Icons } from '../../Icons'
import {
  formatScheduleWindow,
  scheduledBlockedModelIds,
  type ProviderModelSchedule,
} from '@spark/protocol'

/**
 * 模型定时禁用时段编辑区（峰谷定价规避）。
 *
 * 行内扁平编辑：每行一个模型的时段配置（模型 / 周几 / 起止时间 / 开关 / 删除），
 * 当前处于禁用时段内的模型行会显示「禁用中」状态。仅编辑表单状态，
 * 保存时随 provider:update 的 modelSchedules 字段整体下发（空数组 = 清除全部）。
 */

/** 展示顺序：一 ~ 六、日（对齐 Date.getDay()：0=周日）。 */
const DAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' },
]

const DEFAULT_DAYS = [1, 2, 3, 4, 5]
const DEFAULT_START_MINUTE = 14 * 60
const DEFAULT_END_MINUTE = 18 * 60

function minuteToTime(minute: number): string {
  const h = Math.floor(minute / 60)
  const m = minute % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function timeToMinute(value: string): number {
  const [h, m] = value.split(':')
  const hours = Number.parseInt(h ?? '', 10)
  const minutes = Number.parseInt(m ?? '0', 10)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return -1
  return hours * 60 + minutes
}

export interface ProviderModelScheduleSectionProps {
  /** 编辑表单的完整模型列表（含禁用时段内的模型；编辑视图不过滤）。 */
  modelIds: string[]
  schedules: ProviderModelSchedule[]
  onChange: (next: ProviderModelSchedule[]) => void
}

export function ProviderModelScheduleSection({
  modelIds,
  schedules,
  onChange,
}: ProviderModelScheduleSectionProps) {
  const blocked = useMemo(() => scheduledBlockedModelIds(schedules), [schedules])
  const hasAnyModel = modelIds.length > 0

  const updateAt = (index: number, patch: Partial<ProviderModelSchedule>) => {
    const next = schedules.map((schedule, i) =>
      i === index ? { ...schedule, ...patch } : schedule,
    )
    if (next[index] == null) return
    onChange(next)
  }

  const removeAt = (index: number) => {
    onChange(schedules.filter((_, i) => i !== index))
  }

  const addSchedule = () => {
    const firstUsable = modelIds.find((id) => !schedules.some((s) => s.modelId === id))
    const modelId = firstUsable ?? modelIds[0]
    if (modelId == null) return
    onChange([
      ...schedules,
      {
        modelId,
        enabled: true,
        days: [...DEFAULT_DAYS],
        startMinute: DEFAULT_START_MINUTE,
        endMinute: DEFAULT_END_MINUTE,
      },
    ])
  }

  return (
    <div className="pv_section">
      <div className="pv_section_head">
        <span className="pv_section_icon">
          <Icons.Clock size={11} />
        </span>
        <span className="pv_section_title">定时禁用</span>
        <span className="pv_section_hint">
          峰谷定价时段内，模型在全局不可见、不可选、不可用；时段结束自动恢复
        </span>
        <button
          type="button"
          className="pv_section_action"
          disabled={!hasAnyModel}
          title={hasAnyModel ? '为某个模型添加定时禁用时段' : '请先添加模型'}
          onClick={addSchedule}
        >
          <Icons.Plus size={11} />
          <span>添加时段</span>
        </button>
      </div>
      <div className="pv_section_body">
        {schedules.length === 0 ? (
          <div className="pv_ms_empty">未设置定时禁用时段</div>
        ) : (
          <div className="pv_ms_list">
            {schedules.map((schedule, index) => {
              const crossingMidnight = schedule.endMinute < schedule.startMinute
              const invalidWindow =
                schedule.days.length === 0 || schedule.startMinute === schedule.endMinute
              const blocking = blocked.has(schedule.modelId)
              const candidateIds = [
                schedule.modelId,
                ...modelIds.filter((id) => !schedules.some((s) => s.modelId === id)),
              ]
              return (
                <div key={`${schedule.modelId}:${index}`} className="pv_ms_row">
                  <div className="pv_ms_row_main">
                    <div className="pv_ms_model">
                      <Select
                        size="small"
                        value={schedule.modelId}
                        options={candidateIds.map((id) => ({ value: id, label: id }))}
                        onChange={(value) => updateAt(index, { modelId: value })}
                        popupMatchSelectWidth={false}
                        className="pv_ms_model_select"
                      />
                      <Switch
                        size="small"
                        checked={schedule.enabled}
                        onChange={(checked) => updateAt(index, { enabled: checked })}
                        title={schedule.enabled ? '关闭后时段不生效' : '开启后时段生效'}
                      />
                      {blocking && <span className="pv_ms_blocking_badge">禁用中</span>}
                    </div>
                    <div className="pv_ms_days">
                      {DAY_OPTIONS.map((day) => {
                        const active = schedule.days.includes(day.value)
                        return (
                          <button
                            key={day.value}
                            type="button"
                            className={`pv_ms_day${active ? ' is-active' : ''}`}
                            title={`周${day.label}`}
                            onClick={() =>
                              updateAt(index, {
                                days: active
                                  ? schedule.days.filter((d) => d !== day.value)
                                  : [...schedule.days, day.value].sort((a, b) => a - b),
                              })
                            }
                          >
                            {day.label}
                          </button>
                        )
                      })}
                    </div>
                    <div className="pv_ms_times">
                      <input
                        type="time"
                        className="pv_ms_time"
                        value={minuteToTime(schedule.startMinute)}
                        onChange={(e) => {
                          const minute = timeToMinute(e.target.value)
                          if (minute >= 0) updateAt(index, { startMinute: minute })
                        }}
                      />
                      <span className="pv_ms_time_sep">至</span>
                      <input
                        type="time"
                        className="pv_ms_time"
                        value={minuteToTime(schedule.endMinute % 1440)}
                        onChange={(e) => {
                          const minute = timeToMinute(e.target.value)
                          if (minute >= 0) {
                            // 结束时间 00:00 表示 24:00（全天到午夜）；否则保持与起始的先后关系语义
                            updateAt(index, { endMinute: minute === 0 ? 1440 : minute })
                          }
                        }}
                      />
                    </div>
                    <div className="pv_ms_summary">
                      <span className="pv_ms_summary_text">{formatScheduleWindow(schedule)}</span>
                      {crossingMidnight && (
                        <span className="pv_ms_cross_note" title="晚段属起始日，凌晨段继承前一日">
                          跨零点
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="pv_ms_remove"
                    title={`移除 ${schedule.modelId} 的定时禁用`}
                    onClick={() => removeAt(index)}
                  >
                    <Icons.X size={11} />
                  </button>
                  {invalidWindow && (
                    <div className="pv_ms_row_error">
                      {schedule.days.length === 0 ? '请至少选择一个生效日期' : '起止时间不能相同'}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
