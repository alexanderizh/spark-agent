/**
 * @module wiki-settings
 *
 * 知识库设置项的**单一事实源**（方案 §12）。
 *
 * 为什么放在 protocol：三处必须用同一份定义，任何一处另写一份都会漂移 ——
 *   - agent-runtime：budget 预算档的默认值与服务端硬上限（裁剪层钳制）；
 *   - 桌面主进程：`settings:set` 的写入校验（越界拒绝，方案 §12.2）；
 *   - 渲染端设置面板：控件类型 / 范围 / 单位 / 分组 / 文案。
 *
 * 存储契约：设置系统是 (category, key) 二元组，本文件 key 为**子路径**
 * （如 'budget/readMaxTokens'），落地即 (category='wiki', key='budget/readMaxTokens')——
 * 方案文档里的扁平键 `wiki/budget/readMaxTokens` 语义不变。
 *
 * 硬上限原则（§12.2）：用户可以调大预算，但服务端仍有不可超越的兜底
 * （readMaxTokens ≤ 8000、turnTotal ≤ 20000），防止误设把上下文撑爆。
 */

export const WIKI_SETTINGS_CATEGORY = 'wiki'

export type WikiSettingGroup = 'budget' | 'extract' | 'dream' | 'space' | 'repo' | 'ui'

/** 设置分组的展示元数据（渲染端按此顺序渲染分区） */
export const WIKI_SETTING_GROUPS: ReadonlyArray<{
  id: WikiSettingGroup
  label: string
  description: string
  /** 该分组功能在哪个分片生效；早于当前分片的分组在 UI 上标注"随 XX 启用" */
  phase: WikiSettingPhase
  /**
   * 该分组允许的 key 前缀。多数分组是 1:1（group 名即前缀），但方案 §12.1
   * 把候选策略（`candidate/*`）与存储位置（`store/*`）归入相邻分组，因此这里
   * 显式声明映射，避免"前缀 = 分组名"的隐含假设在下一次加设置项时被打破。
   */
  keyPrefixes: readonly string[]
}> = [
  {
    id: 'budget',
    label: '上下文预算',
    description:
      'Agent 取用知识库时的上下文闸门。知识库内容不常驻上下文，这些阈值决定单次取用的上限。',
    phase: 'S1',
    keyPrefixes: ['budget/'],
  },
  {
    id: 'extract',
    label: '沉淀与抽取',
    description: '把对话沉淀为知识候选的策略。默认只保留"显式沉淀"与"里程碑收尾"两条人审路径。',
    phase: 'S2',
    keyPrefixes: ['extract/', 'candidate/'],
  },
  {
    id: 'dream',
    label: '梦境整理',
    description:
      '空闲/定时自动整理知识库：回顾近期会话提取新知识、合并重复页面、修剪过期内容。整理产生的写入按置信度分流，删除默认需人工确认。',
    phase: 'S4',
    keyPrefixes: ['dream/'],
  },
  {
    id: 'space',
    label: '空间与存储',
    description: '知识空间的创建与正文文件落盘方式。',
    phase: 'S1',
    keyPrefixes: ['space/', 'store/'],
  },
  {
    id: 'repo',
    label: 'Repo Wiki',
    description: '由代码仓库生成知识页的扫描与重建策略。',
    phase: 'S4',
    keyPrefixes: ['repo/'],
  },
  {
    id: 'ui',
    label: '界面偏好',
    description: '知识库视图的默认展示方式与导航行为。',
    phase: 'S1',
    keyPrefixes: ['ui/'],
  },
]

/** 分组 → 允许的 key 前缀（校验用） */
export const WIKI_GROUP_KEY_PREFIXES: ReadonlyMap<WikiSettingGroup, readonly string[]> = new Map(
  WIKI_SETTING_GROUPS.map((g) => [g.id, g.keyPrefixes]),
)

export type WikiSettingType = 'boolean' | 'number' | 'select' | 'text'

export interface WikiSettingOption {
  value: string
  label: string
}

export interface WikiSettingDefinition {
  /** 设置 key（category='wiki' 下的子路径） */
  key: string
  group: WikiSettingGroup
  label: string
  description: string
  type: WikiSettingType
  default: boolean | number | string
  /** UI 可设最小值（数字型） */
  min?: number
  /** UI 可设最大值（数字型） */
  max?: number
  /** 服务端硬下限（与 min 不同：硬下限防"调到 0 导致功能不可用"） */
  hardMin?: number
  /** 服务端硬上限：任何写入都不可超越（§12.2） */
  hardMax?: number
  /** 数字型单位后缀（如 'token' / '天'） */
  unit?: string
  /** select 型的可选项 */
  options?: WikiSettingOption[]
  /** 该设置实际生效的分片（用于 UI 标注未生效项） */
  phase: WikiSettingPhase
}

/**
 * 设置项生效分片。与 isWikiSettingActive 的入参保持同一联合，避免渲染端
 * 为了标注"随 XX 启用"而写类型断言。
 */
export type WikiSettingPhase = 'S1' | 'S2' | 'S3' | 'S4'

/**
 * 全部知识库设置项。
 *
 * 分组 A（budget）= 方案 §12.1 A 组；B（extract）= B 组；C（space）= C 组；
 * D（repo）= D 组；E（ui）= E 组。键名与方案文档一致（去掉 `wiki/` 前缀）。
 */
export const WIKI_SETTING_DEFINITIONS: ReadonlyArray<WikiSettingDefinition> = [
  // ── A. 上下文预算 ────────────────────────────────────────────────────
  {
    key: 'budget/helpDisclosure',
    group: 'budget',
    label: '工具瘦身（help 二级发现）',
    description:
      '开启后只常驻检索 / 阅读 / 浏览 / 新建与空间列表，更新与关联 / 归档 / 删除收进 wiki_admin 二级入口，降低每轮常驻 token（实测 1086 → 约 780）。关闭则全量挂载。',
    type: 'boolean',
    default: false,
    phase: 'S1',
  },
  {
    key: 'budget/residentLimit',
    group: 'budget',
    label: '常驻预算告警阈值',
    description: 'L0 提示词 + 工具 schema 的常驻 token 超过该值时告警，提示是否开启工具瘦身。',
    type: 'number',
    default: 800,
    min: 200,
    max: 2000,
    hardMin: 100,
    hardMax: 4000,
    unit: 'token',
    phase: 'S1',
  },
  {
    key: 'budget/readMaxTokens',
    group: 'budget',
    label: '正文分页大小',
    description: '单次读取一页正文的 token 上限。调大可一次读完长文，但单轮上下文占用更高。',
    type: 'number',
    default: 3000,
    min: 1000,
    max: 8000,
    hardMin: 500,
    hardMax: 8000,
    unit: 'token',
    phase: 'S1',
  },
  {
    key: 'budget/turnTotal',
    group: 'budget',
    label: '单轮注入总闸',
    description: '同一轮对话内知识库内容注入的总上限，超出后提示先总结已读内容。',
    type: 'number',
    default: 8000,
    min: 1000,
    max: 20000,
    hardMin: 1000,
    hardMax: 20000,
    unit: 'token',
    phase: 'S1',
  },
  {
    key: 'budget/searchLimit',
    group: 'budget',
    label: '检索返回条数',
    description: '检索默认返回的命中条数（只含标题与摘要，不含正文）。',
    type: 'number',
    default: 8,
    min: 3,
    max: 20,
    hardMin: 1,
    hardMax: 20,
    unit: '条',
    phase: 'S1',
  },
  {
    key: 'budget/summaryChars',
    group: 'budget',
    label: '摘要最大字数',
    description: '写入时摘要按该值截断，决定检索结果的单条信息量。',
    type: 'number',
    default: 240,
    min: 60,
    max: 600,
    hardMin: 40,
    hardMax: 1000,
    unit: '字',
    phase: 'S1',
  },
  {
    key: 'budget/noiseWarnPct',
    group: 'budget',
    label: '占比告警阈值',
    description: '会话中知识库内容占上下文比例超过该值时在会话检查器标黄。',
    type: 'number',
    default: 40,
    min: 10,
    max: 90,
    hardMin: 5,
    hardMax: 95,
    unit: '%',
    phase: 'S1',
  },

  // ── B. 沉淀与抽取 ────────────────────────────────────────────────────
  {
    key: 'extract/enabled',
    group: 'extract',
    label: '自动沉淀总开关',
    description:
      '控制后台自动沉淀（空闲异步 / 定时批处理）。关闭时仍保留"显式沉淀"与"里程碑收尾"两条需你确认的路径。',
    type: 'boolean',
    default: false,
    phase: 'S2',
  },
  {
    key: 'extract/manual',
    group: 'extract',
    label: '显式"沉淀此对话"',
    description: '允许你在会话中主动把这段对话沉淀为知识候选（主路径）。',
    type: 'boolean',
    default: true,
    phase: 'S2',
  },
  {
    key: 'extract/milestone',
    group: 'extract',
    label: '里程碑收尾沉淀',
    description: '长任务交付或目标达成时生成一次候选，供你确认。',
    type: 'boolean',
    default: true,
    phase: 'S2',
  },
  {
    key: 'extract/idle',
    group: 'extract',
    label: '空闲异步沉淀',
    description: '会话空闲一段时间后在后台生成候选。默认关闭，避免不必要的模型调用。',
    type: 'boolean',
    default: false,
    phase: 'S2',
  },
  {
    key: 'extract/idleMinutes',
    group: 'extract',
    label: '空闲判定时长',
    description: '超过该时长没有新消息即视为空闲，可触发异步沉淀。',
    type: 'number',
    default: 30,
    min: 5,
    max: 720,
    hardMin: 1,
    hardMax: 1440,
    unit: '分钟',
    phase: 'S2',
  },
  {
    key: 'extract/schedule',
    group: 'extract',
    label: '定时批处理',
    description: '按固定间隔兜底扫描未沉淀的会话。默认关闭。',
    type: 'boolean',
    default: false,
    phase: 'S2',
  },
  {
    key: 'extract/scheduleIntervalMinutes',
    group: 'extract',
    label: '批处理间隔',
    description: '定时批处理的运行间隔。',
    type: 'number',
    default: 360,
    min: 30,
    max: 1440,
    hardMin: 10,
    hardMax: 10080,
    unit: '分钟',
    phase: 'S2',
  },
  {
    key: 'extract/scheduleLimit',
    group: 'extract',
    label: '每日批处理上限',
    description: '每天最多处理的会话数，防止兜底任务持续烧 token。',
    type: 'number',
    default: 20,
    min: 1,
    max: 200,
    hardMin: 1,
    hardMax: 1000,
    unit: '次',
    phase: 'S2',
  },
  {
    key: 'extract/modelProfile',
    group: 'extract',
    label: '抽取模型档位',
    description: '用于抽取知识的小模型档位；留空表示跟随默认小模型配置。',
    type: 'text',
    default: '',
    phase: 'S2',
  },
  {
    key: 'candidate/ttlDays',
    group: 'extract',
    label: '候选过期天数',
    description: '待确认候选超过该天数自动过期，保持候选区清爽。',
    type: 'number',
    default: 14,
    min: 1,
    max: 365,
    hardMin: 1,
    hardMax: 3650,
    unit: '天',
    phase: 'S2',
  },
  {
    key: 'candidate/maxPending',
    group: 'extract',
    label: '候选容量上限',
    description: '单作用域内待确认候选的上限，溢出时优先淘汰低置信候选。',
    type: 'number',
    default: 200,
    min: 10,
    max: 2000,
    hardMin: 1,
    hardMax: 10000,
    unit: '条',
    phase: 'S2',
  },
  {
    key: 'extract/redact',
    group: 'extract',
    label: '敏感信息过滤',
    description: '开启后 Agent 与抽取管道写入的正文会拦截疑似凭据内容（用户手动写入不受限）。',
    type: 'boolean',
    default: true,
    phase: 'S1',
  },

  // ── B2. 梦境整理（AutoDream 知识库轨，开发计划 todo/2026-10-10 §5.1）──
  {
    key: 'dream/enabled',
    group: 'dream',
    label: '梦境整理总开关',
    description:
      '开启后按定时配置拉起梦境 Agent 整理知识库：提取新知识、合并重复、修剪过期。置信度达标自动落库，删除默认人审。',
    type: 'boolean',
    default: false,
    phase: 'S4',
  },
  {
    key: 'dream/scheduleTrigger',
    group: 'dream',
    label: '定时触发方式',
    description:
      '关闭 = 仅手动触发；固定间隔 = 按周期自动整理；Cron = 按五段表达式自动整理（时区跟随系统）。',
    type: 'select',
    default: 'off',
    options: [
      { value: 'off', label: '关闭（仅手动）' },
      { value: 'interval', label: '固定间隔' },
      { value: 'cron', label: 'Cron 表达式' },
    ],
    phase: 'S4',
  },
  {
    key: 'dream/scheduleIntervalMinutes',
    group: 'dream',
    label: '整理间隔',
    description: '固定间隔模式的自动整理周期，默认 1440 分钟（24 小时）。',
    type: 'number',
    default: 1440,
    min: 30,
    max: 10080,
    hardMin: 10,
    hardMax: 20160,
    unit: '分钟',
    phase: 'S4',
  },
  {
    key: 'dream/scheduleCron',
    group: 'dream',
    label: 'Cron 表达式',
    description:
      "五段式 cron（分 时 日 月 周），如 '0 3 * * *' 表示每天凌晨 3 点整理。仅 Cron 触发方式生效。",
    type: 'text',
    default: '',
    phase: 'S4',
  },
  {
    key: 'dream/providerProfile',
    group: 'dream',
    label: '梦境渠道',
    description:
      '梦境整理使用的渠道 id（Provider Profile）。留空时依次回落：抽取模型档位（extract/modelProfile）→ 会话默认渠道。',
    type: 'text',
    default: '',
    phase: 'S4',
  },
  {
    key: 'dream/model',
    group: 'dream',
    label: '梦境模型',
    description:
      '梦境整理使用的模型 id。留空跟随所选渠道的默认模型。梦境需处理大上下文，建议选长上下文档位。',
    type: 'text',
    default: '',
    phase: 'S4',
  },
  {
    key: 'dream/autoApplyThreshold',
    group: 'dream',
    label: '自动落库阈值',
    description:
      '提案置信度达到该百分数时自动落库，低于则进入人审候选。默认 85；误落库偏多时上调收紧。',
    type: 'number',
    default: 85,
    // min/hardMin 至少 1：阈值 0 会连 confidence 缺失（clamp 归 0）的垃圾提案
    // 都自动落库，等于整体关掉人审安全网。
    min: 1,
    max: 100,
    hardMin: 1,
    hardMax: 100,
    unit: '%',
    phase: 'S4',
  },
  {
    key: 'dream/autoDeleteEnabled',
    group: 'dream',
    label: '允许高置信自动删除',
    description:
      '危险项：开启后删除类提案在高置信时自动执行（知识库走版本快照可回滚）。默认关闭 = 删除一律人审。',
    type: 'boolean',
    default: false,
    phase: 'S4',
  },
  {
    key: 'dream/scanSessionsDays',
    group: 'dream',
    label: '会话回看窗口',
    description: 'Gather 采集阶段回看最近多少天的会话存档，窗口越小越省 token。',
    type: 'number',
    default: 7,
    min: 1,
    max: 90,
    hardMin: 1,
    hardMax: 365,
    unit: '天',
    phase: 'S4',
  },
  {
    key: 'dream/batchLimit',
    group: 'dream',
    label: '单次提案上限',
    description: '单次梦境最多处理的提案数量，超过部分丢弃并记入运行报告，防止长梦失控烧 token。',
    type: 'number',
    default: 50,
    min: 1,
    max: 200,
    hardMin: 1,
    hardMax: 500,
    unit: '条',
    phase: 'S4',
  },

  // ── C. 空间与存储 ────────────────────────────────────────────────────
  {
    key: 'space/autoCreate',
    group: 'space',
    label: '首次进入自动建空间',
    description: '首次打开知识库时自动创建"我的知识库"与"本项目知识库"。',
    type: 'boolean',
    default: true,
    phase: 'S1',
  },
  {
    key: 'store/exportIndex',
    group: 'space',
    label: '导出 INDEX.md 投影',
    description: '在空间目录下维护一份人类可读的页面索引，便于直接浏览与版本管理。',
    type: 'boolean',
    default: true,
    phase: 'S1',
  },
  {
    key: 'store/bodyLocation',
    group: 'space',
    label: '正文存储位置',
    description:
      '用户级空间默认落在应用数据目录；选择"随仓库"时项目级空间正文写入仓库的 .spark-agent/wiki。',
    type: 'select',
    default: 'default',
    options: [
      { value: 'default', label: '应用数据目录（推荐）' },
      { value: 'project', label: '项目级随仓库' },
    ],
    phase: 'S1',
  },

  // ── D. Repo Wiki（S4 生效） ─────────────────────────────────────────
  {
    key: 'repo/enabled',
    group: 'repo',
    label: '启用 Repo Wiki',
    description: '关闭后 Repo Wiki 标签页隐藏。',
    type: 'boolean',
    default: true,
    phase: 'S4',
  },
  {
    key: 'repo/mode',
    group: 'repo',
    label: '生成方式',
    description:
      '手动：只在点「重建」时更新。自动：打开 Repo Wiki 时若检测到代码已漂移则自动重建。',
    type: 'select',
    default: 'manual',
    options: [
      { value: 'manual', label: '手动触发（推荐）' },
      { value: 'auto', label: '漂移后自动重建' },
    ],
    phase: 'S4',
  },
  {
    key: 'repo/ignoreGlobs',
    group: 'repo',
    label: '忽略路径',
    description: '扫描仓库时跳过的路径（每行一条 glob），直接决定扫描成本。',
    type: 'text',
    default: 'node_modules\ndist\nbuild\nout\n.git',
    phase: 'S4',
  },
  {
    key: 'repo/staleCommits',
    group: 'repo',
    label: '漂移提示阈值',
    description: '代码落后生成版本超过该提交数时，提示重建 Repo Wiki。',
    type: 'number',
    default: 20,
    min: 1,
    max: 500,
    hardMin: 1,
    hardMax: 5000,
    unit: '提交',
    phase: 'S4',
  },

  // ── E. 界面偏好 ──────────────────────────────────────────────────────
  {
    key: 'ui/defaultView',
    group: 'ui',
    label: '默认视图',
    description: '知识库页面列表的默认展示方式。',
    type: 'select',
    default: 'list',
    options: [
      { value: 'list', label: '列表' },
      { value: 'grid', label: '宫格' },
    ],
    phase: 'S1',
  },
  {
    key: 'ui/candidateBadge',
    group: 'ui',
    label: '候选待办提醒',
    description: '在导航与标签页上显示待确认候选数量。',
    type: 'boolean',
    default: true,
    phase: 'S2',
  },
  {
    key: 'ui/pinNav',
    group: 'ui',
    label: '固定导航项',
    description: '把知识库固定到侧栏靠前位置；关闭时收纳在扩展入口中，不抢占常用位置。',
    type: 'boolean',
    default: false,
    phase: 'S1',
  },
]

/** key → 定义（含非法 key 的快速判定） */
export const WIKI_SETTING_BY_KEY: ReadonlyMap<string, WikiSettingDefinition> = new Map(
  WIKI_SETTING_DEFINITIONS.map((d) => [d.key, d]),
)

export interface WikiSettingValidation {
  ok: boolean
  /** 归一化后的值（类型正确时始终返回） */
  value: boolean | number | string
  message?: string
}

/**
 * 校验并归一化单个设置值（服务端与渲染端共用同一口径）。
 *
 * 越界策略（§12.2）：超出 hardMax/hardMin 一律**拒绝**而不是静默钳制 ——
 * 静默钳制会让用户以为设置生效了，实际没生效。UI 层另有 max/min 软边界，
 * 只允许在可用区间内调节，硬边界用于挡住绕过 UI 的写入。
 */
export function validateWikiSettingValue(key: string, raw: unknown): WikiSettingValidation {
  const def = WIKI_SETTING_BY_KEY.get(key)
  if (def == null) {
    return { ok: false, value: '', message: `未知的知识库设置项：${key}` }
  }
  switch (def.type) {
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw }
      return { ok: false, value: Boolean(def.default), message: `${def.label} 需要布尔值` }
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(n)) {
        return { ok: false, value: Number(def.default), message: `${def.label} 需要数字` }
      }
      const int = Math.floor(n)
      const hardMin = def.hardMin ?? def.min ?? 0
      const hardMax = def.hardMax ?? def.max ?? Number.MAX_SAFE_INTEGER
      if (int < hardMin || int > hardMax) {
        return {
          ok: false,
          value: int,
          message: `${def.label} 必须在 ${hardMin} ~ ${hardMax}${def.unit ?? ''} 之间`,
        }
      }
      return { ok: true, value: int }
    }
    case 'select': {
      const s = String(raw)
      const allowed = (def.options ?? []).map((o) => o.value)
      if (allowed.length > 0 && !allowed.includes(s)) {
        return { ok: false, value: String(def.default), message: `${def.label} 取值无效` }
      }
      return { ok: true, value: s }
    }
    case 'text': {
      if (typeof raw !== 'string') {
        return { ok: false, value: String(def.default), message: `${def.label} 需要文本` }
      }
      if (raw.length > 4000) {
        return { ok: false, value: raw, message: `${def.label} 超出长度上限` }
      }
      return { ok: true, value: raw }
    }
  }
}

/** 该设置当前分片是否已生效（渲染端用于标注"随 XX 启用"）。 */
export function isWikiSettingActive(def: WikiSettingDefinition, phase: WikiSettingPhase): boolean {
  const order: Record<WikiSettingPhase, number> = { S1: 1, S2: 2, S3: 3, S4: 4 }
  return order[def.phase] <= order[phase]
}
