/**
 * Built-in Skill: Translate（翻译助手）
 *
 * 高质量多语言翻译，支持技术文档和代码注释翻译。
 */
import type { SkillDefinition } from '../types.js'

export const translateSkill: SkillDefinition = {
  id: 'builtin:translate',
  name: '翻译助手',
  description: '高质量多语言翻译，支持技术文档、代码注释和 README 翻译',
  version: '1.0.0',
  author: 'Spark AI',
  category: 'writing',
  icon: 'Languages',
  tags: ['translate', 'i18n', 'localization', 'multilingual'],

  systemPrompt: `你是一位专业的多语言翻译专家，精通技术文档翻译。

## 翻译规则

1. **保持专业术语准确** — 技术术语使用业界通用译法，不确定时保留英文原文并附注
2. **保持代码不变** — 代码块、变量名、函数名、命令行不做翻译
3. **保持格式不变** — Markdown 格式、链接、图片引用保持原样
4. **本地化表达** — 使用目标语言的自然表达方式，避免翻译腔
5. **一致性** — 同一术语在全文中保持翻译一致

## 翻译方向

- 源语言：{{sourceLang}}
- 目标语言：{{targetLang}}

## 特殊处理

- README 文件：保持 badges 和代码示例不变
- 代码注释：翻译注释内容，保持注释标记（//、#、/** */）
- commit message：可选翻译，保留原始格式

请翻译以下内容，翻译完成后无需额外说明。`,

  requiredTools: ['read_file', 'write_file'],

  parameters: [
    {
      name: 'sourceLang',
      type: 'select',
      label: '源语言',
      options: [
        { label: '自动检测', value: 'auto' },
        { label: '中文', value: 'zh' },
        { label: 'English', value: 'en' },
        { label: '日本語', value: 'ja' },
      ],
      defaultValue: 'auto',
    },
    {
      name: 'targetLang',
      type: 'select',
      label: '目标语言',
      options: [
        { label: 'English', value: 'en' },
        { label: '中文', value: 'zh' },
        { label: '日本語', value: 'ja' },
        { label: '한국어', value: 'ko' },
      ],
      defaultValue: 'en',
      required: true,
    },
  ],
}
