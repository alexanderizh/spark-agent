import { useMemo } from 'react'
import { Select, Switch } from 'antd'
import { Icons } from '../../Icons'
import {
  formatScheduleWindow,
  scheduledBlockedModelIds,
  type ProviderModelSchedule,
} from '@spark/protocol'
import {
  candidateModelIdsForRow,
  firstUnusedModelId,
  groupModelSchedules,
  ungroupModelSchedules,
  type ModelScheduleGroupRow,
} from './providerModelScheduleGroups'

/**
 * 模型定时禁用时段编辑区（峰谷定价规避）。
 *
 * 行内扁平编辑：每行可绑定多个模型（窗口配置相同的模型合并展示，保存时按模型
 * 展开回逐条 schedule），行内包含模型多选 / 周几 / 起止时间 / 开关 / 删除，
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
  const rows = useMemo(() => groupModelSchedules(schedules), [schedules])
  const hasAnyModel = modelIds.length > 0

  const updateRows = (next: ModelScheduleGroupRow[]) => {
    onChange(ungroupModelSchedules(next))
  }

  const updateRowAt = (index: number, patch: Partial<ModelScheduleGroupRow>) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
    if (next[index] == null) return
    updateRows(next)
  }

  const removeRowAt = (index: number) => {
    updateRows(rows.filter((_, i) => i !== index))
  }

  const addRow = () => {
    const modelId = firstUnusedModelId(modelIds, rows) ?? modelIds[0]
    if (modelId == null) return
    updateRows([
      ...rows,
      {
        modelIds: [modelId],
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
          title={hasAnyModel ? '为模型添加定时禁用时段（一行可绑定多个模型）' : '请先添加模型'}
          onClick={addRow}
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
            {rows.map((row, index) => {
              const crossingMidnight = row.endMinute < row.startMinute
              const invalidWindow = row.days.length === 0 || row.startMinute === row.endMinute
              const blocking = row.modelIds.some((id) => blocked.has(id))
              const candidates = candidateModelIdsForRow(row, modelIds, rows)
              const removeTitle =
                row.modelIds.length > 1
                  ? `移除 ${row.modelIds.join('、')} 的定时禁用`
                  : `移除 ${row.modelIds[0]} 的定时禁用`
              return (
                <div key={index} className="pv_ms_row">
                  <div className="pv_ms_row_main">
                    <div className="pv_ms_model">
                      <Select
                        mode="multiple"
                        size="small"
                        value={row.modelIds}
                        options={candidates.map((id) => ({ value: id, label: id }))}
                        onChange={(values) => {
                          if (values.length === 0) {
                            // 行内模型清空视为删除整行
                            removeRowAt(index)
                            return
                          }
                          updateRowAt(index, { modelIds: values })
                        }}
                        popupMatchSelectWidth={false}
                        className="pv_ms_model_select"
                        placeholder="选择要禁用的模型"
                      />
                      <Switch
                        size="small"
                        checked={row.enabled}
                        onChange={(checked) => updateRowAt(index, { enabled: checked })}
                        title={row.enabled ? '关闭后时段不生效' : '开启后时段生效'}
                      />
                      {blocking && <span className="pv_ms_blocking_badge">禁用中</span>}
                    </div>
                    <div className="pv_ms_days">
                      {DAY_OPTIONS.map((day) => {
                        const active = row.days.includes(day.value)
                        return (
                          <button
                            key={day.value}
                            type="button"
                            className={`pv_ms_day${active ? ' is-active' : ''}`}
                            title={`周${day.label}`}
                            onClick={() =>
                              updateRowAt(index, {
                                days: active
                                  ? row.days.filter((d) => d !== day.value)
                                  : [...row.days, day.value].sort((a, b) => a - b),
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
                        value={minuteToTime(row.startMinute)}
                        onChange={(e) => {
                          const minute = timeToMinute(e.target.value)
                          if (minute >= 0) updateRowAt(index, { startMinute: minute })
                        }}
                      />
                      <span className="pv_ms_time_sep">至</span>
                      <input
                        type="time"
                        className="pv_ms_time"
                        value={minuteToTime(row.endMinute % 1440)}
                        onChange={(e) => {
                          const minute = timeToMinute(e.target.value)
                          if (minute >= 0) {
                            // 结束时间 00:00 表示 24:00（全天到午夜）；否则保持与起始的先后关系语义
                            updateRowAt(index, { endMinute: minute === 0 ? 1440 : minute })
                          }
                        }}
                      />
                    </div>
                    <div className="pv_ms_summary">
                      <span className="pv_ms_summary_text">
                        {formatScheduleWindow({
                          modelId: row.modelIds[0] ?? '',
                          enabled: row.enabled,
                          days: row.days,
                          startMinute: row.startMinute,
                          endMinute: row.endMinute,
                        })}
                      </span>
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
                    title={removeTitle}
                    onClick={() => removeRowAt(index)}
                  >
                    <Icons.X size={11} />
                  </button>
                  {invalidWindow && (
                    <div className="pv_ms_row_error">
                      {row.days.length === 0 ? '请至少选择一个生效日期' : '起止时间不能相同'}
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
