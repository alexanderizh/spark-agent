/**
 * Built-in Skill: Test Generator（测试生成）
 *
 * 根据源代码自动生成高质量的单元测试和集成测试。
 */
import type { SkillDefinition } from '../types.js'

export const testGenSkill: SkillDefinition = {
  id: 'builtin:test-gen',
  name: '测试生成器',
  description: '根据源代码自动生成单元测试和集成测试用例，支持主流测试框架',
  version: '1.0.0',
  author: 'Spark AI',
  category: 'coding',
  icon: 'FlaskConical',
  tags: ['testing', 'unit-test', 'integration-test', 'automation'],

  systemPrompt: `你是一位测试工程专家。你的任务是为代码编写全面、高质量的测试用例。

## 测试原则

1. **覆盖关键路径** — 正常流程、边界条件、异常情况
2. **独立性** — 每个测试用例独立运行，不依赖其他测试
3. **可读性** — 测试名称清晰描述测试意图
4. **AAA 模式** — Arrange（准备）、Act（执行）、Assert（断言）

## 测试框架

{{framework}}

## 测试类型

{{testType}}

## 输出要求

1. 先分析源代码的公开接口和关键逻辑
2. 为每个函数/方法生成测试用例
3. 覆盖以下场景：
   - 正常输入的预期输出
   - 边界值（空值、零值、最大值）
   - 异常输入（类型错误、格式错误）
   - 异步操作（如适用）
4. 使用 mock/stub 隔离外部依赖
5. 添加清晰的测试描述

将生成的测试代码写入对应的测试文件。`,

  requiredTools: ['read_file', 'write_file', 'list_directory', 'search_files'],

  parameters: [
    {
      name: 'framework',
      type: 'select',
      label: '测试框架',
      options: [
        { label: 'Vitest', value: 'Vitest（推荐，与 Vite 生态集成）' },
        { label: 'Jest', value: 'Jest' },
        { label: 'Pytest', value: 'Pytest（Python）' },
        { label: 'Mocha + Chai', value: 'Mocha + Chai' },
      ],
      defaultValue: 'Vitest（推荐，与 Vite 生态集成）',
    },
    {
      name: 'testType',
      type: 'select',
      label: '测试类型',
      options: [
        { label: '单元测试', value: '生成单元测试（Unit Tests），聚焦单个函数/模块' },
        { label: '集成测试', value: '生成集成测试（Integration Tests），测试模块间交互' },
        { label: '两者都要', value: '同时生成单元测试和集成测试' },
      ],
      defaultValue: '生成单元测试（Unit Tests），聚焦单个函数/模块',
    },
  ],
}
