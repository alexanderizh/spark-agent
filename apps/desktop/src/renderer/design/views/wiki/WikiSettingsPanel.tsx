/**
 * WikiSettingsPanel — 设置页「知识库」分区（设计稿 v2 §13）。
 *
 * 单一事实源：控件类型 / 范围 / 分组 / 文案全部来自 @spark/protocol 的
 * 知识库设置定义（WIKI_SETTING_DEFINITIONS），渲染端不另写一份键名表。
 *
 * 写入纪律（方案 §12.2）：保存即生效；越界值在客户端先拦（避免无谓 IPC），
 * 主进程 settings:set 侧同一校验兜底——两条路径共用 validateWikiSettingValue。
 * 尚未生效分组（S2/S4）标注「随 XX 启用」并禁用控件，不制造假开关。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@lobehub/ui'
import { InputNumber, Select, Spin, Switch } from 'antd'
import {
  WIKI_SETTING_DEFINITIONS,
  WIKI_SETTING_GROUPS,
  WIKI_SETTINGS_CATEGORY,
  isWikiSettingActive,
  validateWikiSettingValue,
} from '@spark/protocol'
import type { WikiSettingDefinition } from '@spark/protocol'
import { Icons } from '../../Icons'
import { useToast } from '../../components/Toast'
import './wiki.less'

type SettingValue = boolean | number | string

const PHASE_LABEL: Record<WikiSettingDefinition['phase'], string> = {
  S1: '',
  S2: '随自动沉淀（S2）启用',
  S4: '随 Repo Wiki（S4）启用',
}

function defaultValue(def: WikiSettingDefinition): SettingValue {
  return def.default
}

export function WikiSettingsPanel() {
  const { toast } = useToast()
  const [values, setValues] = useState<Record<string, SettingValue>>({})
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await window.spark.invoke('settings:get-category', {
          category: WIKI_SETTINGS_CATEGORY,
        })
        if (cancelled) return
        const stored = res.settings ?? {}
        const next: Record<string, SettingValue> = {}
        for (const def of WIKI_SETTING_DEFINITIONS) {
          const raw = stored[def.key]
          if (raw === undefined || raw === null) {
            next[def.key] = defaultValue(def)
            continue
          }
          const check = validateWikiSettingValue(def.key, raw)
          next[def.key] = check.ok ? check.value : defaultValue(def)
        }
        setValues(next)
      } catch (err) {
        if (!cancelled) {
          toast.error(`知识库设置加载失败：${err instanceof Error ? err.message : String(err)}`)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [toast])

  const commit = useCallback(
    async (def: WikiSettingDefinition, raw: SettingValue) => {
      const check = validateWikiSettingValue(def.key, raw)
      if (!check.ok) {
        toast.error(check.message ?? '取值无效')
        return
      }
      const previous = values[def.key]
      setValues((prev) => ({ ...prev, [def.key]: check.value }))
      setSavingKey(def.key)
      try {
        await window.spark.invoke('settings:set', {
          category: WIKI_SETTINGS_CATEGORY,
          key: def.key,
          value: check.value,
        })
      } catch (err) {
        setValues((prev) => ({ ...prev, [def.key]: previous ?? defaultValue(def) }))
        toast.error(`${def.label}保存失败：${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setSavingKey(null)
      }
    },
    [values, toast],
  )

  const resetOne = useCallback(
    async (def: WikiSettingDefinition) => {
      try {
        await window.spark.invoke('settings:set', {
          category: WIKI_SETTINGS_CATEGORY,
          key: def.key,
          value: null,
        })
        setValues((prev) => ({ ...prev, [def.key]: defaultValue(def) }))
        toast.success(`${def.label}已恢复默认`)
      } catch (err) {
        toast.error(`恢复默认失败：${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [toast],
  )

  const groups = useMemo(
    () =>
      WIKI_SETTING_GROUPS.map((group) => ({
        group,
        defs: WIKI_SETTING_DEFINITIONS.filter((d) => d.group === group.id),
      })),
    [],
  )

  if (loading) {
    return (
      <div className="wiki_set_root">
        <Spin />
      </div>
    )
  }

  return (
    <div className="wiki_set_root">
      {groups.map(({ group, defs }) => {
        if (defs.length === 0) return null
        // 分组级待生效标记：S1 已生效，S2/S4 分组整体标注（与逐项 def.phase 同源）
        const pending = group.phase !== 'S1'
        return (
          <div className="wiki_set_group" key={group.id}>
            <div className="wiki_set_group_head">
              <div className="wiki_set_group_title">
                {group.label}
                {pending && <span className="wiki_set_phase"> {PHASE_LABEL[group.phase]}</span>}
              </div>
              <div className="wiki_set_group_desc">{group.description}</div>
            </div>
            {defs.map((def) => {
              const active = isWikiSettingActive(def, 'S1')
              const value = values[def.key] ?? defaultValue(def)
              return (
                <div className={`wiki_set_row${active ? '' : ' is-pending'}`} key={def.key}>
                  <div className="wiki_set_main">
                    <div className="wiki_set_label">
                      {def.label}
                      {!active && <span className="wiki_set_phase">{PHASE_LABEL[def.phase]}</span>}
                    </div>
                    <div className="wiki_set_desc">{def.description}</div>
                  </div>
                  <div className="wiki_set_control">
                    {def.type === 'boolean' && (
                      <Switch
                        size="small"
                        checked={value === true}
                        disabled={!active || savingKey === def.key}
                        onChange={(checked) => void commit(def, checked)}
                      />
                    )}
                    {def.type === 'number' && (
                      <>
                        <InputNumber
                          size="small"
                          style={{ width: 96 }}
                          step={1}
                          {...(def.min != null ? { min: def.min } : {})}
                          {...(def.max != null ? { max: def.max } : {})}
                          value={typeof value === 'number' ? value : Number(def.default)}
                          disabled={!active || savingKey === def.key}
                          onChange={(next) => {
                            if (typeof next === 'number') void commit(def, next)
                          }}
                        />
                        {def.unit != null && <span className="wiki_set_unit">{def.unit}</span>}
                      </>
                    )}
                    {def.type === 'select' && (
                      <Select
                        size="small"
                        style={{ minWidth: 160 }}
                        value={String(value)}
                        disabled={!active || savingKey === def.key}
                        options={(def.options ?? []).map((o) => ({
                          value: o.value,
                          label: o.label,
                        }))}
                        onChange={(next) => void commit(def, next)}
                      />
                    )}
                    {def.type === 'text' && (
                      <textarea
                        className="wiki_text_input"
                        rows={(def.default as string).includes('\n') ? 4 : 1}
                        value={String(value)}
                        disabled={!active || savingKey === def.key}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [def.key]: e.target.value }))
                        }
                        onBlur={(e) => void commit(def, e.target.value)}
                      />
                    )}
                    {active && (
                      <Button
                        size="small"
                        type="text"
                        icon={<Icons.RotateCcw size={13} />}
                        aria-label={`${def.label}恢复默认`}
                        onClick={() => void resetOne(def)}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
      <div className="wiki_hint">
        预算类设置在下一次取用知识时生效；正文分页与服务端硬上限（8000 / 20000 token）
        不可被越界覆盖，越界写入会被直接拒绝。
      </div>
    </div>
  )
}

export default WikiSettingsPanel
