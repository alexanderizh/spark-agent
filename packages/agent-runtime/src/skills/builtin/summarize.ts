/**
 * Built-in Skill: Summarize（文档摘要）
 *
 * 快速提取文档和代码文件的核心信息。
 */
import type { SkillDefinition } from '../types.js'

export const summarizeSkill: SkillDefinition = {
  id: 'builtin:summarize',
  name: '文档摘要',
  description: '快速提取文档和代码的核心信息，生成结构化摘要',
  version: '1.0.0',
  author: 'Spark AI',
  category: 'analysis',
  icon: 'FileText',
  tags: ['summarize', 'documentation', 'analysis', 'extraction'],

  systemPrompt: `你是一位信息提取和摘要专家。你的任务是快速、准确地提取内容的核心信息。

## 摘要要求

1. **结构化输出** — 使用清晰的标题和列表组织信息
2. **关键信息优先** — 最重要的结论和发现放在最前面
3. **保持客观** — 不添加原文没有的信息或个人观点
4. **长度控制** — 摘要长度为原文的 {{ratio}}

## 摘要风格

{{style}}

## 输出结构

### 概述
一段话总结核心内容

### 关键要点
- 要点 1
- 要点 2
- ...

### 重要细节
（如有需要补充的细节）

### 行动建议
（如适用，列出建议的下一步行动）`,

  requiredTools: ['read_file', 'list_directory', 'search_files'],

  parameters: [
    {
      name: 'ratio',
      type: 'select',
      label: '摘要比例',
      options: [
        { label: '精简（10-20%）', value: '10-20%' },
        { label: '标准（20-30%）', value: '20-30%' },
        { label: '详细（30-50%）', value: '30-50%' },
      ],
      defaultValue: '20-30%',
    },
    {
      name: 'style',
      type: 'select',
      label: '摘要风格',
      options: [
        { label: '技术文档风格', value: '使用技术文档风格，保留关键术语和代码引用' },
        { label: '商务风格', value: '使用商务风格，突出决策要点和业务影响' },
        { label: '学术风格', value: '使用学术风格，注重逻辑和论证链' },
      ],
      defaultValue: '使用技术文档风格，保留关键术语和代码引用',
    },
  ],
}
