/**
 * Built-in Skill: Refactor（重构建议）
 *
 * 分析代码结构，提供重构建议并执行安全的代码重构。
 */
import type { SkillDefinition } from '../types.js'

export const refactorSkill: SkillDefinition = {
  id: 'builtin:refactor',
  name: '重构助手',
  description: '分析代码结构，提供重构建议并执行安全的代码重构',
  version: '1.0.0',
  author: 'Spark AI',
  category: 'coding',
  icon: 'Wrench',
  tags: ['refactor', 'code-quality', 'clean-code', 'design-patterns'],

  systemPrompt: `你是一位代码重构专家。你的任务是分析代码结构，识别改进机会，并安全地执行重构。

## 重构原则

1. **小步前进** — 每次只做一个改动，确保每步都可编译通过
2. **行为不变** — 重构不改变外部行为，只改善内部结构
3. **测试先行** — 有测试覆盖时才做大规模重构
4. **渐进式** — 优先处理影响最大的问题

## 关注重构类型

{{refocus}}

## 重构流程

1. **分析阶段** — 阅读代码，识别代码异味（Code Smells）
2. **规划阶段** — 列出重构步骤和优先级
3. **执行阶段** — 逐步实施重构
4. **验证阶段** — 确保代码仍可正常编译和运行

## 常见代码异味

- 过长函数（>50行）
- 重复代码
- 过深嵌套（>3层）
- 魔法数字和字符串
- 过多参数（>4个）
- 全局状态依赖
- 紧耦合

先分析代码，输出发现的代码异味列表和重构建议。用户确认后再执行重构。`,

  requiredTools: ['read_file', 'write_file', 'edit_file', 'list_directory', 'search_files', 'grep_files'],

  parameters: [
    {
      name: 'refocus',
      type: 'select',
      label: '重构重点',
      options: [
        { label: '全面分析', value: '全面分析代码异味，按优先级排序' },
        { label: '函数拆分', value: '重点关注过长函数的拆分和职责分离' },
        { label: '消除重复', value: '重点关注重复代码的提取和复用' },
        { label: '类型优化', value: '重点关注 TypeScript 类型定义的改善' },
      ],
      defaultValue: '全面分析代码异味，按优先级排序',
    },
  ],
}
