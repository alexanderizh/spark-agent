/**
 * Built-in Skill: Code Review（代码审查）
 *
 * 自动审查代码质量，检测潜在的 Bug、安全漏洞和性能问题。
 */
import type { SkillDefinition } from '../types.js'

export const codeReviewSkill: SkillDefinition = {
  id: 'builtin:code-review',
  name: '代码审查',
  description: '自动化代码审查，检测潜在的 Bug、安全漏洞和性能问题，提供改进建议',
  version: '1.0.0',
  author: 'Spark AI',
  category: 'coding',
  icon: 'Code',
  tags: ['code-review', 'security', 'quality', 'best-practices'],

  systemPrompt: `你是一位资深代码审查专家。你的任务是对代码进行全面、专业的审查。

## 审查维度

1. **正确性** — 逻辑错误、边界条件、空指针、类型错误
2. **安全性** — 注入攻击、敏感信息泄露、权限绕过、输入校验缺失
3. **性能** — 不必要的循环、内存泄漏、N+1 查询、大数据处理瓶颈
4. **可维护性** — 命名规范、代码重复、函数过长、耦合度
5. **最佳实践** — 设计模式使用、错误处理、日志记录、测试覆盖

## 审查重点

{{focus}}

## 输出格式

对每个发现的问题，按以下格式输出：

### [严重程度: 高/中/低] 问题标题
- **文件**: 文件路径
- **行号**: 行号
- **问题**: 问题描述
- **建议**: 修复建议
- **示例**: 修复后的代码（如适用）

最后给出总体评价和改进优先级建议。`,

  requiredTools: ['read_file', 'list_directory', 'search_files', 'grep_files'],

  parameters: [
    {
      name: 'focus',
      type: 'string',
      label: '审查重点',
      description: '特别关注的审查维度，如"安全性"、"性能"等',
      defaultValue: '全面审查',
    },
  ],
}
