/**
 * @module skills
 *
 * Skill 系统入口
 */
export { SkillLoader } from './skill-loader.js'
export type { SkillInfo } from './skill-loader.js'
export type {
  SkillDefinition,
  SkillParameter,
  SkillCategory,
  SkillParamType,
  SkillExecutionContext,
} from './types.js'
export { buildSkillSystemPrompt } from './types.js'
export { BUILTIN_SKILLS, getBuiltinSkill } from './builtin/index.js'
