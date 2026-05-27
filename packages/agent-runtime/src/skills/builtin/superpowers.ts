import type { SkillDefinition } from '../types.js'

export const superpowersSkill: SkillDefinition = {
  id: 'builtin:superpowers',
  name: 'Superpowers',
  description: '结构化开发工作流技能：计划、TDD、调试、验证和收尾检查。',
  version: '1.0.0',
  author: 'Spark Agent',
  category: 'workflow',
  icon: 'sparkles',
  tags: ['workflow', 'tdd', 'planning', 'verification'],
  requiredTools: ['read_file', 'write_file', 'edit_file', 'bash'],
  parameters: [],
  systemPrompt: `你可以使用 Superpowers 工作流来组织复杂任务。

当任务涉及功能开发、修复、调试、重构或提交前验证时，优先采用以下步骤:
1. 先理解需求和影响范围。
2. 对行为变化先写能失败的测试，再实现。
3. 复杂问题使用系统化调试，不靠猜。
4. 声称完成前运行能证明结论的验证命令。
5. 提交前检查变更范围，只提交当前任务相关文件。

这不是强制每次都展开长流程；你应根据任务复杂度选择合适的工作流，并保持对用户可见的进度更新。`,
}
