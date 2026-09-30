/**
 * WikiSettingsPanel — 设置页「知识库」分区（设计稿 v2 §13）。
 *
 * 单一事实源：控件类型 / 范围 / 分组 / 文案全部来自 @spark/protocol 的
 * 知识库设置定义（WIKI_SETTING_DEFINITIONS），渲染端不另写一份键名表。
 *
 * 写入纪律（方案 §12.2）：保存即生效；越界值在客户端先拦（避免无谓 IPC），
 * 主进程 settings:set 侧同一校验兜底——两条路径共用 validateWikiSettingValue。
 * 尚未生效分组（S2/S4）标注「随 XX 启用」并禁用控件，不制造假开关。
 *
 * 展示约定（对齐语音助手设置）：行内只留标题 + 标题旁 ⓘ 悬浮详情 + 右侧控件，
 * 分组与设置项的说明文字全部收进 Tooltip，不再平铺在标题下方。
 * 宽度行为复用设置页统一分区类 `.settings-section`（居中 + 980 封顶 + 窄屏铺满），
 * 不在本文件另写一套 max-width，避免和其他设置页的宽度变化逻辑漂移。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@lobehub/ui'
import { InputNumber, Select, Spin, Switch, Tooltip } from 'antd'
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

/**
 * 当前已落地的分片。S1（写入/设置面板）/ S2（抽取沉淀）/ S3（技能提议）
 * / S4（Repo Wiki）均已交付，因此不再有"待生效"标注；保留 phase 机制是为了
 * 后续分片新增设置项时能自动标注，不必改这里。
 */
const CURRENT_PHASE: WikiSettingDefinition['phase'] = 'S4'

const PHASE_LABEL: Record<WikiSettingDefinition['phase'], string> = {
  S1: '',
  S2: '',
  S3: '随技能提议（S3）启用',
  S4: '',
}

function defaultValue(def: WikiSettingDefinition): SettingValue {
  return def.default
}

/**
 * 标题旁的 ⓘ 悬浮说明：与语音助手设置（VoiceAssistantSettingsCard）同一套约定 ——
 * 标题后跟一个问号图标，鼠标悬浮时以浮窗展示完整解释，行内不再平铺描述文字。
 */
function SettingHelp({ tip }: { tip: string }) {
  return (
    <Tooltip title={tip} overlayStyle={{ maxWidth: 340 }}>
      <Icons.HelpCircle className="wiki_set_help" size={13} />
    </Tooltip>
  )
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
      <div className="wiki_set_root settings-section">
        <Spin />
      </div>
    )
  }

  return (
    <div className="wiki_set_root settings-section">
      {groups.map(({ group, defs }) => {
        if (defs.length === 0) return null
        // 分组级待生效标记：与逐项 def.phase 同源（当前分片之后的分组才标注）
        const pending = !isWikiSettingActive(
          { phase: group.phase } as WikiSettingDefinition,
          CURRENT_PHASE,
        )
        return (
          <div className="wiki_set_group" key={group.id}>
            <div className="wiki_set_group_head">
              <div className="wiki_set_group_title">
                {group.label}
                <SettingHelp tip={group.description} />
                {pending && <span className="wiki_set_phase"> {PHASE_LABEL[group.phase]}</span>}
              </div>
            </div>
            {defs.map((def) => {
              const active = isWikiSettingActive(def, CURRENT_PHASE)
              const value = values[def.key] ?? defaultValue(def)
              return (
                <div className={`wiki_set_row${active ? '' : ' is-pending'}`} key={def.key}>
                  <div className="wiki_set_main">
                    <div className="wiki_set_label">
                      {def.label}
                      <SettingHelp tip={def.description} />
                      {!active && <span className="wiki_set_phase">{PHASE_LABEL[def.phase]}</span>}
                    </div>
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
