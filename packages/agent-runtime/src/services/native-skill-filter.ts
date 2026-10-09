/**
 * claude-sdk 原生技能列表过滤（缝隙 a 修复，P4）。
 *
 * 背景：主会话与成员路径原本对托管插件目录传 `nativeSkills: 'all'`，绕过 agent
 * 技能白名单。Claude Agent SDK（0.3.287+）的 `skills: string[]` 选项原生支持
 * 列表过滤——未列出的技能「hidden from the model's listing and rejected by the
 * Skill tool」，因此传列表即可同时获得目录收敛与工具硬拒绝，无需为每个
 * agent 物化独立插件目录（计划 7.5）。
 *
 * 名单形态（P0 Spike 结论）：托管插件名固定为 `spark-managed-skills`
 * （apps/desktop/src/main/services/AppSkillsManager.ts buildManagedPluginDir）。
 * CLI 对名单的匹配口径为「SKILL.md frontmatter name / 目录名 / plugin:skill」
 * 三种形态（sdk.d.ts skills 选项文档 + CLI 内置 Skill 工具说明「Plugin skills
 * use `plugin:skill`」）。为保证任一口径下都能命中，对每个生效技能同时输出
 * 多种冗余形态——`skills` 是上下文过滤器，未命中的多余条目无副作用。
 * 同名去重目录（`name-2`）的边角场景下两种技能共享 frontmatter name，
 * 表现与旧的 `'all'` 行为一致（可接受，已记录于计划文档）。
 */

import type { RuntimeSkillConfig } from './runtime-composition.service.js'

/** 与 AppSkillsManager.plugin.json 的 name 字段保持一致（勿单独改动）。 */
export const MANAGED_SKILLS_PLUGIN_NAME = 'spark-managed-skills'

/**
 * 技能名 → 托管目录条目名（与 AppSkillsManager.sanitizeDirName 逐字一致）。
 * 副本原因：AppSkillsManager 位于 desktop app 层，agent-runtime 不依赖 desktop；
 * 两侧同时改时必须保持同步（双向注释锚定）。
 */
function sanitizeManagedSkillDirName(name: string): string {
  return name
    .trim()
    .replace(/[^A-Za-z0-9一-龥._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
}

/**
 * 由运行时技能配置计算应传给 SDK 的 `skills` 值：
 *
 * - agent 未配置技能白名单（agentSkillIds 为空且未启用 replaceAgentSkills）→
 *   `'all'`（回退全量，与历史行为完全一致）；
 * - 白名单模式 → 生效技能的多形态名单（frontmatter name / 目录名 / plugin:name /
 *   plugin:目录名）；名单为空时返回空数组（语义：关闭全部原生技能）。
 *
 * 提示词目录（buildAvailableSkillsPrompt）与本名单同源于同一 effectiveSkillIds，
 * 保证「目录可见」与「工具可加载」一致。
 */
/**
 * 生效技能面的稳定签名（排序连接）：resume 快照保护用（审查 D-2）——与
 * buildNativeSkillsFilter 同源（effectiveSkillIds），签名变化即强制重建 SDK 会话，
 * 防止 resume 会话沿用陈旧 skills 过滤器造成「目录可见却被 Skill 工具拒绝」。
 */
export function buildSkillFaceSignature(skillConfig: RuntimeSkillConfig): string {
  return [...skillConfig.effectiveSkillIds].sort().join(',')
}

export function buildNativeSkillsFilter(skillConfig: RuntimeSkillConfig): string[] | 'all' {
  // 白名单模式 = agent 显式配置了技能（agentSkillIds 非空；repo 对所有 agent
  // 强制并入 builtin:platform-manager，UI 创建的 agent 恒非空），或显式替换后
  // 生效集为空（runtimePatch replaceAgentSkills=true + 空列表 → 关闭全部原生技能；
  // 系统零技能时两种模式实际效果等价，无伪差异）。
  const whitelistMode =
    skillConfig.agentSkillIds.length > 0 || skillConfig.effectiveSkillIds.length === 0
  if (!whitelistMode) return 'all'

  const byId = new Map(skillConfig.skills.map((skill) => [skill.id, skill]))
  const names = new Set<string>()
  for (const id of skillConfig.effectiveSkillIds) {
    const skill = byId.get(id)
    if (skill == null) continue
    const name = skill.name.trim()
    if (name.length === 0) continue
    names.add(name)
    names.add(`${MANAGED_SKILLS_PLUGIN_NAME}:${name}`)
    const dirName = sanitizeManagedSkillDirName(skill.name)
    if (dirName.length > 0 && dirName !== name) {
      // SDK 匹配口径含「目录名」形态（sdk.d.ts：name / directory name / plugin:skill），
      // bare 目录名与 plugin 前缀形态都要给——`skills` 是上下文过滤器，冗余无副作用
      // （审查 M-2：name 含特殊字符/中文时目录名差异大，漏 bare 形态可能漏匹配）。
      names.add(dirName)
      names.add(`${MANAGED_SKILLS_PLUGIN_NAME}:${dirName}`)
    }
  }
  return [...names]
}
