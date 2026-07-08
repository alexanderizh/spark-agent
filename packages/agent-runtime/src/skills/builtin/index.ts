/**
 * @module skills/builtin
 *
 * 硬编码内置 Skill 定义集合
 *
 * 所有内置 Skill 已迁移到 resources/skills/ 目录以文件形式存储。
 * 此模块保留空数组以维持模块兼容性。
 */
import type { SkillDefinition } from '../types.js'

/** 硬编码内置 Skill 定义（已全部迁移到文件系统） */
export const BUILTIN_SKILLS: SkillDefinition[] = []

/** 按 ID 获取硬编码内置 Skill 定义 */
export function getBuiltinSkill(id: string): SkillDefinition | undefined {
  return BUILTIN_SKILLS.find((s) => s.id === id)
}
