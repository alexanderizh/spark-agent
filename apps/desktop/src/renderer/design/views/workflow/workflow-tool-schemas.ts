/**
 * 工作流工具节点「内置工具直调」模式的参数 schema 目录。
 *
 * 仅覆盖 WORKFLOW_RESTRICTABLE_TOOLS 里的 SDK 内置工具，字段名与真实工具入参一一对应
 * （Claude Code 工具契约）；type 决定参数表单控件（string→输入框、number→数字、
 * boolean→开关），description 作为字段提示。运行时把表单值经 {{key}} 插值后原样传给
 * 锁定的单工具 worker，schema 与真实入参不符时工具会自行报错——所以这里宁可少列
 * 可选参数，也不要臆造字段名。
 *
 * 没有列出的工具（TodoWrite/AskUserQuestion/ExitPlanMode 等交互类）不支持确定性直调
 * 参数配置，仍可走「受限代理」模式。
 */

export interface WorkflowBuiltinToolArgSchema {
  name: string
  type: 'string' | 'number' | 'boolean'
  description?: string
  required?: boolean
  /** 多行文本（如文件内容、命令脚本）用 TextArea 而不是单行输入框。 */
  multiline?: boolean
}

export interface WorkflowBuiltinToolSchema {
  name: string
  args: WorkflowBuiltinToolArgSchema[]
}

export const WORKFLOW_BUILTIN_TOOL_SCHEMAS: Record<string, WorkflowBuiltinToolSchema> = {
  Bash: {
    name: 'Bash',
    args: [
      {
        name: 'command',
        type: 'string',
        required: true,
        multiline: true,
        description: '要执行的 shell 命令',
      },
      { name: 'timeout', type: 'number', description: '超时毫秒数（可选）' },
    ],
  },
  Read: {
    name: 'Read',
    args: [
      { name: 'file_path', type: 'string', required: true, description: '要读取的文件绝对路径' },
      { name: 'offset', type: 'number', description: '起始行号（可选）' },
      { name: 'limit', type: 'number', description: '读取行数（可选）' },
    ],
  },
  Write: {
    name: 'Write',
    args: [
      { name: 'file_path', type: 'string', required: true, description: '要写入的文件绝对路径' },
      {
        name: 'content',
        type: 'string',
        required: true,
        multiline: true,
        description: '写入的完整内容',
      },
    ],
  },
  Edit: {
    name: 'Edit',
    args: [
      { name: 'file_path', type: 'string', required: true, description: '要编辑的文件绝对路径' },
      {
        name: 'old_string',
        type: 'string',
        required: true,
        multiline: true,
        description: '被替换的原文（须唯一）',
      },
      {
        name: 'new_string',
        type: 'string',
        required: true,
        multiline: true,
        description: '替换后的新文本',
      },
    ],
  },
  MultiEdit: {
    name: 'MultiEdit',
    args: [
      { name: 'file_path', type: 'string', required: true, description: '要编辑的文件绝对路径' },
      {
        name: 'edits',
        type: 'string',
        required: true,
        multiline: true,
        description: 'JSON 数组：[{old_string,new_string}]，值支持 {{key}} 插值',
      },
    ],
  },
  Grep: {
    name: 'Grep',
    args: [
      { name: 'pattern', type: 'string', required: true, description: '正则表达式' },
      { name: 'path', type: 'string', description: '搜索目录（可选，缺省当前工作区）' },
    ],
  },
  Glob: {
    name: 'Glob',
    args: [
      {
        name: 'pattern',
        type: 'string',
        required: true,
        description: '文件名匹配模式，如 **/*.ts',
      },
      { name: 'path', type: 'string', description: '搜索目录（可选）' },
    ],
  },
  WebFetch: {
    name: 'WebFetch',
    args: [
      { name: 'url', type: 'string', required: true, description: '要抓取的 URL' },
      { name: 'prompt', type: 'string', multiline: true, description: '针对页面内容要回答的问题' },
    ],
  },
  WebSearch: {
    name: 'WebSearch',
    args: [{ name: 'query', type: 'string', required: true, description: '搜索关键词' }],
  },
}
