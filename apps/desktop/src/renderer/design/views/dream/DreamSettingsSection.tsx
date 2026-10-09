/**
 * DreamSettingsSection — 梦境整理配置区块（AutoDream 双轨共用）
 *
 * 记忆轨（memory）与知识库轨（wiki）的梦境整理配置共用本组件，按 track 参数化：
 *   - 键名映射：memory 轨沿用该分类的无前缀驼峰键（dreamEnabled…，与 consolidation*
 *     族同风格，服务端代码内默认值）；wiki 轨用子路径键（dream/enabled…），定义在
 *     @spark/protocol 的 WIKI_SETTING_DEFINITIONS，写入前经 validateWikiSettingValue
 *     校验，主进程同一份校验兜底。
 *   - 渠道模型：双轨均为「渠道 + 模型」两个下拉；留空回落（wiki 轨 → 抽取模型档位
 *     extract/modelProfile → 会话默认；memory 轨 → 会话默认）。
 *   - 渲染端只做配置读写；「立即整理」按钮与运行状态条随梦境内核（S1）接入本区块。
 *
 * 写入纪律与 WikiSettingsPanel 一致：保存即生效，越界值客户端先拦。
 * 展示约定对齐设置页统一风格：行内标题 + ⓘ 悬浮详情 + 右侧控件，灰底模块卡。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { InputNumber, Popconfirm, Select, Slider, Switch, Tooltip } from 'antd'
import { Button, Input as LobeInput } from '@lobehub/ui'
import { DREAM_SETTING_DEFAULTS, validateWikiSettingValue } from '@spark/protocol'
import type { DreamRunReport, DreamRunState, ProviderProfile } from '@spark/protocol'
import { Icons } from '../../Icons'
import { useToast } from '../../components/Toast'
import './dream.less'

export type DreamTrack = 'memory' | 'wiki'

type SettingValue = boolean | number | string

/** 轨 → 设置分类、键名映射与文案（键名是两侧服务端消费的单一契约） */
const TRACK_CONFIG: Record<
  DreamTrack,
  {
    category: 'memory' | 'wiki'
    subject: string
    /** 留空回落说明（wiki 轨多一级 extract/modelProfile 回落） */
    modelFallbackHint: string
    keys: {
      enabled: string
      scheduleTrigger: string
      scheduleIntervalMinutes: string
      scheduleCron: string
      providerId: string
      model: string
      autoApplyThreshold: string
      autoDeleteEnabled: string
      sessionScanDays: string
      batchLimit: string
    }
  }
> = {
  memory: {
    category: 'memory',
    subject: '记忆',
    modelFallbackHint: '留空跟随会话默认渠道与模型。',
    keys: {
      enabled: 'dreamEnabled',
      scheduleTrigger: 'dreamScheduleTrigger',
      scheduleIntervalMinutes: 'dreamScheduleIntervalMinutes',
      scheduleCron: 'dreamScheduleCron',
      providerId: 'dreamProviderId',
      model: 'dreamModel',
      autoApplyThreshold: 'dreamAutoApplyThreshold',
      autoDeleteEnabled: 'dreamAutoDeleteEnabled',
      sessionScanDays: 'dreamSessionScanDays',
      batchLimit: 'dreamBatchLimit',
    },
  },
  wiki: {
    category: 'wiki',
    subject: '知识库',
    modelFallbackHint: '留空依次回落：抽取模型档位（沉淀与抽取分组）→ 会话默认渠道与模型。',
    keys: {
      enabled: 'dream/enabled',
      scheduleTrigger: 'dream/scheduleTrigger',
      scheduleIntervalMinutes: 'dream/scheduleIntervalMinutes',
      scheduleCron: 'dream/scheduleCron',
      providerId: 'dream/providerProfile',
      model: 'dream/model',
      autoApplyThreshold: 'dream/autoApplyThreshold',
      autoDeleteEnabled: 'dream/autoDeleteEnabled',
      sessionScanDays: 'dream/scanSessionsDays',
      batchLimit: 'dream/batchLimit',
    },
  },
}

/** 默认值单一事实源：@spark/protocol DREAM_SETTING_DEFAULTS（服务端读取同源） */
const DEFAULTS = DREAM_SETTING_DEFAULTS

const TRIGGER_OPTIONS = [
  { value: 'off', label: '关闭（仅手动）' },
  { value: 'interval', label: '固定间隔' },
  { value: 'cron', label: 'Cron 表达式' },
]

/** 运行阶段中文标签（编排器实际只推进这三个阶段；四阶段方法论在梦境内部自动进行） */
const PHASE_LABEL: Record<string, string> = {
  orient: '定向准备',
  gather: '整理中（四阶段自动进行）',
  consolidate: '整理中（四阶段自动进行）',
  prune: '整理中（四阶段自动进行）',
  settle: '分流落库',
}

const REPORT_STATUS_LABEL: Record<string, string> = {
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 梦境维度累计用量的最小结构（usage:get-by-date-range source='dream'） */
interface DreamUsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  recordCount: number
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** cron 字段合法字符（数字/星号/逗号/连字符/斜杠/英文缩写名） */
const CRON_FIELD_RE = /^[0-9A-Za-z*,/-]+$/

/**
 * cron 轻量结构校验（渲染端输入提示用）：五段、每段非空且字符合法。
 * 权威校验在主进程定时对齐时按调度器同一解析器判定（isValidCronExpression），
 * 此处只做即时反馈，不阻断写入（避免逐键输入的中间态被拦）。
 */
function looksLikeCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/)
  return fields.length === 5 && fields.every((f) => f.length > 0 && CRON_FIELD_RE.test(f))
}

function SettingHelp({ tip }: { tip: string }) {
  return (
    <Tooltip title={tip} overlayStyle={{ maxWidth: 340 }}>
      <Icons.HelpCircle className="dream_set_help" size={13} />
    </Tooltip>
  )
}

/**
 * 宿主视觉变体：
 *   - sunken（默认）：灰底 + 头部色带，与知识库设置页 wiki_set_group 同款；
 *   - bordered：透明底 + 1px 描边 + 圆角 8px，与记忆配置弹窗 mp_settings_section 同款。
 */
export type DreamSectionVariant = 'sunken' | 'bordered'

export function DreamSettingsSection({
  track,
  variant = 'sunken',
}: {
  track: DreamTrack
  variant?: DreamSectionVariant
}) {
  const config = TRACK_CONFIG[track]
  const { toast } = useToast()
  const [cfg, setCfg] = useState<Record<string, unknown>>({})
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [dreamState, setDreamState] = useState<DreamRunState | null>(null)
  const [lastReport, setLastReport] = useState<DreamRunReport | null>(null)
  const [dreamUsage, setDreamUsage] = useState<DreamUsageSummary | null>(null)
  const [starting, setStarting] = useState(false)
  /** 运行秒数滴答：running 期间每秒刷新，驱动「已运行 N 秒」实时跳动 */
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  /** 梦境维度累计用量（source='dream' 单列分账，§12-2）：初始加载与终态后刷新 */
  const refreshDreamUsage = useCallback(() => {
    void window.spark
      .invoke('usage:get-by-date-range', {
        startDate: '2000-01-01T00:00:00Z',
        endDate: '2999-12-31T23:59:59Z',
        source: 'dream',
      })
      .then((r: { summary?: DreamUsageSummary }) => {
        if (r?.summary != null) setDreamUsage(r.summary)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [settingsRes, providersRes, dreamRes] = await Promise.all([
          window.spark.invoke('settings:get-category', { category: config.category }),
          window.spark.invoke('provider:list', {}).catch(() => null),
          window.spark.invoke('dream:get-state', { track }).catch(() => null),
        ])
        if (cancelled) return
        setCfg(settingsRes?.settings ?? {})
        setProviders(providersRes?.profiles ?? [])
        if (dreamRes != null) {
          setDreamState(dreamRes.state ?? null)
          setLastReport(dreamRes.report ?? null)
        }
        refreshDreamUsage()
      } catch (err) {
        if (!cancelled) {
          toast.error(`自动整编配置加载失败：${err instanceof Error ? err.message : String(err)}`)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [config.category, toast, track, refreshDreamUsage])

  // 梦境状态实时刷新：主进程 stream:dream:changed 广播（仅本轨事件）
  useEffect(() => {
    const off =
      window.spark?.on?.('stream:dream:changed', (payload: DreamRunState) => {
        if (payload.track !== track) return
        setDreamState(payload)
        if (payload.status !== 'running') {
          // 终态后拉一次完整报告（提案数/落库数等摘要数据源）
          void window.spark
            .invoke('dream:get-state', { track })
            .then((r: { state: DreamRunState | null; report: DreamRunReport | null }) => {
              if (r?.report != null) setLastReport(r.report)
            })
            .catch(() => {})
          refreshDreamUsage()
        }
      }) ?? (() => {})
    return off
  }, [track, refreshDreamUsage])

  const runNow = async () => {
    setStarting(true)
    try {
      const r = await window.spark.invoke('dream:run', { track, trigger: 'manual' })
      if (r?.ok) toast.success('自动整编已启动，完成后会通知你')
      else toast.warning(r?.message ?? '启动失败')
    } catch (err) {
      toast.error(`启动失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setStarting(false)
    }
  }

  const cancelNow = async () => {
    try {
      const r = await window.spark.invoke('dream:cancel', { track })
      if (r?.ok) toast.info('已请求取消，已产生的提案仍会完成分流')
      else toast.warning(r?.message ?? '取消失败')
    } catch (err) {
      toast.error(`取消失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const getStr = (key: string): string => (typeof cfg[key] === 'string' ? (cfg[key] as string) : '')
  const getNum = (key: string, dflt: number): number =>
    typeof cfg[key] === 'number' ? (cfg[key] as number) : dflt
  const getBool = (key: string, dflt: boolean): boolean =>
    typeof cfg[key] === 'boolean' ? (cfg[key] as boolean) : dflt

  /**
   * 写入单个键。wiki 轨经 protocol 契约校验（与主进程同一份）；空串/null 视为
   * 「未设置」发送 null，触发后端删除该键 → 回落默认值（渠道清除、表达式清空同理）。
   */
  const set = useCallback(
    (key: string, value: SettingValue | null) => {
      const isBlank = value === null || value === '' || value === undefined
      const effective = isBlank ? null : value
      if (track === 'wiki' && !isBlank) {
        const check = validateWikiSettingValue(key, value)
        if (!check.ok) {
          toast.error(check.message ?? '取值无效')
          return
        }
      }
      setCfg((prev) => {
        const next = { ...prev }
        if (isBlank) delete next[key]
        else next[key] = value
        return next
      })
      void window.spark
        .invoke('settings:set', { category: config.category, key, value: effective })
        .catch((err: unknown) => {
          toast.error(`保存失败：${err instanceof Error ? err.message : String(err)}`)
        })
    },
    [config.category, toast, track],
  )

  // 梦境是 chat 整理任务：渠道过滤口径与记忆抽取一致（排除 responses API /
  // 纯 Embeddings / 纯多媒体，只留能跑对话补全的渠道）。
  const providerOptions = useMemo(() => {
    const kind = (p: ProviderProfile & { codexApiKind?: string; modelType?: string }) => ({
      codexApiKind: p.codexApiKind,
      modelType: p.modelType,
    })
    return providers
      .filter((p) => {
        const k = kind(p)
        return (
          k.codexApiKind !== 'responses' &&
          k.codexApiKind !== 'embedding' &&
          k.modelType !== 'image' &&
          k.modelType !== 'voice' &&
          k.modelType !== 'video'
        )
      })
      .map((p) => ({ label: p.name, value: p.id }))
  }, [providers])

  const selectedProviderId = getStr(config.keys.providerId)
  const modelOptions = useMemo(() => {
    const p = providers.find((x) => x.id === selectedProviderId)
    return (p?.modelIds ?? []).map((m) => ({ label: m, value: m }))
  }, [providers, selectedProviderId])

  // 切渠道时若当前模型不属于新渠道的 modelIds，清空模型防跨渠道串味
  const pickProvider = (providerId: string) => {
    const modelIds = providers.find((p) => p.id === providerId)?.modelIds ?? []
    const curModel = getStr(config.keys.model)
    set(config.keys.providerId, providerId)
    if (curModel.length > 0 && !modelIds.includes(curModel)) {
      set(config.keys.model, null)
    }
  }

  const enabled = getBool(config.keys.enabled, DEFAULTS.enabled)
  const trigger = getStr(config.keys.scheduleTrigger) || DEFAULTS.scheduleTrigger
  const autoDeleteOn = getBool(config.keys.autoDeleteEnabled, DEFAULTS.autoDeleteEnabled)
  const disabled = !enabled

  // 运行秒数滴答：仅 running 时挂 1s interval，终态自动拆除（无泄漏）
  useEffect(() => {
    if (dreamState?.status !== 'running' || dreamState == null) return
    const compute = () =>
      setElapsedSeconds(Math.max(1, Math.round((Date.now() - dreamState.startedAt) / 1000)))
    compute()
    const timer = window.setInterval(compute, 1000)
    return () => window.clearInterval(timer)
  }, [dreamState?.status, dreamState?.startedAt])

  return (
    <div className={`dream_set_group${variant === 'bordered' ? ' dream_set_group--bordered' : ''}`}>
      <div className="dream_set_head">
        <div className="dream_set_title">
          自动整编
          <SettingHelp
            tip={`空闲/定时自动整编${config.subject}：回顾近期会话提取新内容、合并重复、修剪过期。置信度达标的提案自动落库，其余进入人审候选；删除默认需人工确认。写入均带溯源与审计日志，可在人审候选区按批次整批拒绝。`}
          />
          {enabled && <span className="dream_set_badge">已开启</span>}
        </div>
        <Switch
          size="small"
          checked={enabled}
          loading={loading}
          onChange={(v) => set(config.keys.enabled, v)}
        />
      </div>

      <div className="dream_set_rows">
        <div className="dream_set_row">
          <div className="dream_set_label">
            定时触发
            <SettingHelp tip="自动整编的自动触发方式；关闭后仍可手动触发。定时任务可在「定时任务」页看到系统任务行。" />
          </div>
          <div className="dream_set_control">
            <Select
              size="small"
              style={{ minWidth: 150 }}
              value={trigger}
              disabled={disabled}
              options={TRIGGER_OPTIONS}
              onChange={(v) => set(config.keys.scheduleTrigger, v)}
            />
          </div>
        </div>

        {trigger === 'interval' && (
          <div className="dream_set_row">
            <div className="dream_set_label">
              整理间隔
              <SettingHelp tip="固定间隔模式的自动整理周期，默认 1440 分钟（24 小时）。" />
            </div>
            <div className="dream_set_control">
              <InputNumber
                size="small"
                style={{ width: 96 }}
                min={30}
                max={10080}
                value={getNum(
                  config.keys.scheduleIntervalMinutes,
                  DEFAULTS.scheduleIntervalMinutes,
                )}
                disabled={disabled}
                onChange={(n) => {
                  if (typeof n === 'number') set(config.keys.scheduleIntervalMinutes, n)
                }}
              />
              <span className="dream_set_unit">分钟</span>
            </div>
          </div>
        )}

        {trigger === 'cron' && (
          <div className="dream_set_row">
            <div className="dream_set_label">
              Cron 表达式
              <SettingHelp tip="五段式 cron（分 时 日 月 周），如 '0 3 * * *' 每天凌晨 3 点。时区跟随系统。" />
            </div>
            <div className="dream_set_control dream_set_control_wide">
              <LobeInput
                value={getStr(config.keys.scheduleCron)}
                disabled={disabled}
                placeholder="0 3 * * *"
                onChange={(e) =>
                  set(config.keys.scheduleCron, (e.target as HTMLInputElement).value)
                }
              />
              {(() => {
                const cronValue = getStr(config.keys.scheduleCron)
                return cronValue.trim().length > 0 && !looksLikeCron(cronValue) ? (
                  <span className="dream_set_cron_error">
                    表达式格式有误：五段式「分 时 日 月 周」，如 0 3 * * *
                  </span>
                ) : null
              })()}
            </div>
          </div>
        )}

        <div className="dream_set_row">
          <div className="dream_set_label">
            整编渠道
            <SettingHelp tip={`自动整编使用的渠道。${config.modelFallbackHint}`} />
          </div>
          <div className="dream_set_control dream_set_control_wide">
            <Select
              size="small"
              style={{ minWidth: 200 }}
              value={selectedProviderId || undefined}
              disabled={disabled}
              options={providerOptions}
              placeholder="留空跟随默认"
              allowClear
              showSearch
              onChange={(v) => pickProvider((v as string) ?? '')}
            />
          </div>
        </div>

        <div className="dream_set_row">
          <div className="dream_set_label">
            整编模型
            <SettingHelp tip="自动整编使用的模型。整编需回顾大量上下文，建议选长上下文档位；留空跟随所选渠道的默认模型。" />
          </div>
          <div className="dream_set_control dream_set_control_wide">
            {modelOptions.length > 0 ? (
              <Select
                size="small"
                style={{ minWidth: 200 }}
                value={getStr(config.keys.model) || undefined}
                disabled={disabled}
                options={modelOptions}
                placeholder="留空跟随渠道默认"
                allowClear
                showSearch
                onChange={(v) => set(config.keys.model, (v as string) ?? '')}
              />
            ) : (
              <LobeInput
                value={getStr(config.keys.model)}
                disabled={disabled}
                placeholder="留空跟随渠道默认"
                onChange={(e) => set(config.keys.model, (e.target as HTMLInputElement).value)}
              />
            )}
          </div>
        </div>

        <div className="dream_set_row">
          <div className="dream_set_label">
            自动落库阈值
            <SettingHelp tip="提案置信度达到该值时自动落库，低于则进入人审候选。默认 85%；误落库偏多时上调收紧。" />
          </div>
          <div className="dream_set_control dream_set_control_slider">
            <Slider
              style={{ width: 160, margin: 0 }}
              min={0}
              max={100}
              step={1}
              value={getNum(config.keys.autoApplyThreshold, DEFAULTS.autoApplyThreshold)}
              disabled={disabled}
              onChange={(n) => set(config.keys.autoApplyThreshold, n)}
            />
            <span className="dream_set_unit">
              {getNum(config.keys.autoApplyThreshold, DEFAULTS.autoApplyThreshold)}%
            </span>
          </div>
        </div>

        <div className="dream_set_row">
          <div className="dream_set_label">
            允许高置信自动删除
            <SettingHelp
              tip={
                track === 'wiki'
                  ? '危险项：开启后删除类提案在高置信时也会自动执行（知识库走版本快照，可回滚）。默认关闭 = 删除一律人审。'
                  : '危险项：开启后删除类提案在高置信时也会自动执行（记忆软删，历史可追溯）。默认关闭 = 删除一律人审。'
              }
            />
          </div>
          <div className="dream_set_control">
            <Popconfirm
              title="开启自动删除"
              description="高置信删除提案将不再等人确认、直接执行。确定开启吗？"
              okText="开启"
              cancelText="再想想"
              disabled={disabled || autoDeleteOn}
              onConfirm={() => set(config.keys.autoDeleteEnabled, true)}
            >
              <Switch
                size="small"
                checked={autoDeleteOn}
                disabled={disabled}
                onChange={(v) => {
                  if (!v) set(config.keys.autoDeleteEnabled, false)
                  // 开启走 Popconfirm 确认，关闭直接生效
                }}
              />
            </Popconfirm>
          </div>
        </div>

        <div className="dream_set_row">
          <div className="dream_set_label">
            会话回看窗口
            <SettingHelp tip="Gather 采集阶段回看最近多少天的会话存档。窗口越大越完整，也越耗 token。" />
          </div>
          <div className="dream_set_control">
            <InputNumber
              size="small"
              style={{ width: 96 }}
              min={1}
              max={90}
              value={getNum(config.keys.sessionScanDays, DEFAULTS.sessionScanDays)}
              disabled={disabled}
              onChange={(n) => {
                if (typeof n === 'number') set(config.keys.sessionScanDays, n)
              }}
            />
            <span className="dream_set_unit">天</span>
          </div>
        </div>

        <div className="dream_set_row">
          <div className="dream_set_label">
            单次提案上限
            <SettingHelp tip="单次整编最多处理的提案数量，超过部分丢弃并记入运行报告。" />
          </div>
          <div className="dream_set_control">
            <InputNumber
              size="small"
              style={{ width: 96 }}
              min={1}
              max={200}
              value={getNum(config.keys.batchLimit, DEFAULTS.batchLimit)}
              disabled={disabled}
              onChange={(n) => {
                if (typeof n === 'number') set(config.keys.batchLimit, n)
              }}
            />
            <span className="dream_set_unit">条</span>
          </div>
        </div>
      </div>
      {/* 运行状态条（R7）：running 展示阶段进度 + 取消；终态展示上次报告摘要 */}
      {dreamState?.status === 'running' && (
        <div className="dream_set_runbar">
          <span className="dream_set_runspin" aria-hidden />
          <span className="dream_set_runtext">
            自动整编中 · {PHASE_LABEL[dreamState.phase] ?? dreamState.phase} · 已运行{' '}
            {elapsedSeconds} 秒
          </span>
          <Button size="small" onClick={() => void cancelNow()}>
            取消
          </Button>
        </div>
      )}
      {dreamState?.status !== 'running' && lastReport != null && (
        <div className={`dream_set_report${lastReport.status === 'failed' ? ' is-error' : ''}`}>
          上次整理（{formatTime(lastReport.finishedAt)}）·{' '}
          {REPORT_STATUS_LABEL[lastReport.status] ?? lastReport.status}
          {lastReport.status !== 'failed' && lastReport.status !== 'cancelled'
            ? ` · 提案 ${lastReport.stats.proposals} · 自动落库 ${lastReport.stats.autoApplied} · 待人审 ${lastReport.stats.pendingReview}`
            : ''}
          {lastReport.error != null ? ` · ${lastReport.error.slice(0, 120)}` : ''}
        </div>
      )}
      {dreamUsage != null && dreamUsage.recordCount > 0 && (
        <div className="dream_set_report dream_set_usage">
          <span>
            累计整理消耗（两轨合计）· {dreamUsage.recordCount} 次调用 · 入出{' '}
            {formatTokens(dreamUsage.totalInputTokens + dreamUsage.totalOutputTokens)} tokens
          </span>
          <SettingHelp tip="自动整编的模型消耗单列 dream 分账，不计入正常用量统计。" />
        </div>
      )}
      <div className="dream_set_actions">
        <Button
          type="primary"
          size="small"
          loading={starting}
          disabled={dreamState?.status === 'running'}
          onClick={() => void runNow()}
        >
          {dreamState?.status === 'running' ? '整理中…' : '立即整理'}
        </Button>
        <SettingHelp tip="手动触发不受总开关限制；定时触发需开启上方开关，也可在会话输入框用 /dream 命令触发。" />
      </div>
    </div>
  )
}

export default DreamSettingsSection
