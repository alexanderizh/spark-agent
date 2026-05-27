/**
 * @module skills/builtin
 *
 * 内置 Skill 定义集合
 */
import type { SkillDefinition } from '../types.js'
import { codeReviewSkill } from './code-review.js'
import { translateSkill } from './translate.js'
import { summarizeSkill } from './summarize.js'
import { testGenSkill } from './test-gen.js'
import { refactorSkill } from './refactor.js'

/** 所有内置 Skill 定义 */
export const BUILTIN_SKILLS: SkillDefinition[] = [
  codeReviewSkill,
  translateSkill,
  summarizeSkill,
  testGenSkill,
  refactorSkill,
]

/** 按 ID 获取内置 Skill 定义 */
export function getBuiltinSkill(id: string): SkillDefinition | undefined {
  return BUILTIN_SKILLS.find((s) => s.id === id)
}
