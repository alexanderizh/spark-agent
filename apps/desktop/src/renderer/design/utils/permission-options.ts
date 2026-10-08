/**
 * Composer 下拉菜单的通用选项类型 + 权限模式选项。
 *
 * 统一维护 Claude/Codex 权限选项，供主对话框、设置和 Agent 配置等入口复用，
 * 避免用户看到的权限语义与运行时映射漂移。
 */
import type { SessionPermissionMode, SessionAgentAdapter } from '@spark/protocol'

export type ComposerMenuOption = {
  value: SessionPermissionMode
  label: string
  description: string
  tone?: 'default' | 'auto' | 'danger'
}

export const CLAUDE_PERMISSION_MODE_OPTIONS: Array<ComposerMenuOption> = [
  { value: 'claude-ask', label: '请求批准', description: '每次工具执行前确认' },
  { value: 'claude-plan', label: '计划模式', description: '先产出计划，再批准执行' },
  {
    value: 'claude-auto-edits',
    label: '自动编辑',
    description: '自动批准文件编辑',
    tone: 'auto',
  },
  {
    value: 'claude-auto',
    label: '自动审批',
    description: '使用自动权限策略',
    tone: 'auto',
  },
  {
    value: 'claude-bypass',
    label: '完全访问',
    description: '完全由 agent 执行',
    tone: 'danger',
  },
]

export const CODEX_PERMISSION_MODE_OPTIONS: Array<ComposerMenuOption> = [
  {
    value: 'codex-default',
    label: '按需批准',
    description: 'workspace-write；工作区内安全写入自动执行，越界操作请求批准',
  },
  {
    value: 'codex-auto-review',
    label: '替我批准',
    description: 'workspace-write；越界操作交由 Codex 自动审查',
    tone: 'auto',
  },
  {
    value: 'codex-full-access',
    label: '完全访问',
    description: 'danger-full-access；允许修改 .git 和工作区外文件',
    tone: 'danger',
  },
]

export const SPARK_PERMISSION_MODE_OPTIONS: Array<ComposerMenuOption> = [
  {
    value: 'spark-default',
    label: '手动审批',
    description: '只读工具直接执行；写入与命令逐次确认',
  },
  {
    value: 'spark-auto',
    label: '自动审批',
    description: '所有工具自动执行（显式 deny 规则仍生效）',
    tone: 'auto',
  },
  {
    value: 'spark-bypass',
    label: '完全访问',
    description: '跳过全部审批与规则，完全由 agent 执行',
    tone: 'danger',
  },
]

/** 按 adapter 返回可选的权限模式（codex 与 claude 系列互斥） */
export function getPermissionModeOptions(adapter: SessionAgentAdapter): Array<ComposerMenuOption> {
  if (adapter === 'codex') return CODEX_PERMISSION_MODE_OPTIONS
  if (adapter === 'spark') return SPARK_PERMISSION_MODE_OPTIONS
  return CLAUDE_PERMISSION_MODE_OPTIONS
}

/** 校验权限模式是否适配当前 adapter，不适配则回退到该 adapter 的默认值 */
export function getValidPermissionMode(
  value: SessionPermissionMode | undefined,
  adapter: SessionAgentAdapter,
): SessionPermissionMode {
  const options = getPermissionModeOptions(adapter)
  return options.some((option) => option.value === value)
    ? (value as SessionPermissionMode)
    : (options[0]?.value ?? 'claude-ask')
}

/** 权限档位（跨引擎语义等价分组，与 runtime permission-mapper 的分组对齐） */
type PermissionTier = 'manual' | 'plan' | 'autoEdits' | 'autoPolicy' | 'full'

const PERMISSION_TIER_BY_MODE: Record<SessionPermissionMode, PermissionTier> = {
  'claude-ask': 'manual',
  'claude-plan': 'plan',
  'claude-auto-edits': 'autoEdits',
  'claude-auto': 'autoPolicy',
  'claude-bypass': 'full',
  'codex-default': 'manual',
  'codex-auto-review': 'autoEdits',
  'codex-full-access': 'full',
  'spark-default': 'manual',
  'spark-accept-edits': 'autoEdits',
  'spark-plan': 'plan',
  'spark-auto': 'autoEdits',
  'spark-bypass': 'full',
}

// 各引擎在每个档位上的等价值；目标引擎没有的档位（如 codex/spark 无计划档、
// claude 之外无 autoPolicy 档）就近落到语义最接近的档位。
const TIER_MODE_BY_ADAPTER_FAMILY: Record<
  'claude' | 'codex' | 'spark',
  Record<PermissionTier, SessionPermissionMode>
> = {
  claude: {
    manual: 'claude-ask',
    plan: 'claude-plan',
    autoEdits: 'claude-auto-edits',
    autoPolicy: 'claude-auto',
    full: 'claude-bypass',
  },
  codex: {
    manual: 'codex-default',
    plan: 'codex-default',
    autoEdits: 'codex-auto-review',
    autoPolicy: 'codex-auto-review',
    full: 'codex-full-access',
  },
  spark: {
    manual: 'spark-default',
    plan: 'spark-default',
    autoEdits: 'spark-auto',
    autoPolicy: 'spark-auto',
    full: 'spark-bypass',
  },
}

function adapterFamily(adapter: SessionAgentAdapter): 'claude' | 'codex' | 'spark' {
  if (adapter === 'codex') return 'codex'
  if (adapter === 'spark') return 'spark'
  return 'claude'
}

/**
 * 跨引擎切换模型时保持权限档位语义的等价映射。
 *
 * 三套引擎的权限值集互斥；切换模型跨引擎时若保持原值不动，UI 会回退显示
 * 目标引擎默认档、runtime 却按原值映射执行（如 claude-bypass → bypassPermissions），
 * 显示与实际执行不一致。因此跨引擎按档位等价映射（用户选的“完全访问”切到
 * codex 后仍是“完全访问”）；同引擎（含 claude ↔ claude-sdk）返回原值。
 * 未收录的值兜底走 getValidPermissionMode。
 */
export function mapPermissionModeAcrossAdapters(
  value: SessionPermissionMode | undefined,
  targetAdapter: SessionAgentAdapter,
): SessionPermissionMode {
  if (value == null) return getValidPermissionMode(value, targetAdapter)
  const tier = PERMISSION_TIER_BY_MODE[value]
  if (tier == null) return getValidPermissionMode(value, targetAdapter)
  return TIER_MODE_BY_ADAPTER_FAMILY[adapterFamily(targetAdapter)][tier]
}
