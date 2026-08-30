import { describe, expect, it } from 'vitest'
import {
  classifyToolLog,
  getToolActionLabel,
  getToolIconKey,
  isImageReadToolCall,
  normalizeToolName,
} from './tool-log-metadata'

describe('normalizeToolName', () => {
  it('strips functions__ and single-segment mcp server prefixes', () => {
    expect(normalizeToolName('functions__Read')).toBe('read')
    expect(normalizeToolName('mcp__playwright__browser_click')).toBe('browser_click')
    // server 名含下划线时前缀去不掉（保持原语义，判定函数用 endsWith 兜底）
    expect(normalizeToolName('mcp__spark_search__web_search')).toBe('mcp__spark_search__web_search')
  })
})

describe('isImageReadToolCall', () => {
  it('matches Read on image extensions and rejects others', () => {
    expect(isImageReadToolCall('Read', { file_path: '/tmp/截图.PNG' })).toBe(true)
    expect(isImageReadToolCall('read_file', { path: 'a/b/c.jpeg' })).toBe(true)
    expect(isImageReadToolCall('Read', { file_path: '/tmp/src/index.ts' })).toBe(false)
    expect(isImageReadToolCall('Read', {})).toBe(false)
    expect(isImageReadToolCall('Grep', { file_path: '/tmp/a.png' })).toBe(false)
  })
})

describe('classifyToolLog', () => {
  it('keeps the excluded tools out of the activity log', () => {
    expect(classifyToolLog('todo_write', {})).toBeNull()
    expect(classifyToolLog('mcp__spark_team__agent_dispatch', {})).toBeNull()
    expect(classifyToolLog('mcp__spark_files__present_files', {})).toBeNull()
  })

  it('classifies built-in and mcp-prefixed web tools', () => {
    expect(classifyToolLog('WebSearch', {})).toBe('web')
    expect(classifyToolLog('mcp__spark_search__web_search', {})).toBe('web')
    expect(classifyToolLog('mcp__spark_search__fetch_url', {})).toBe('web')
  })

  it('classifies browser tools across playwright and spark_browser servers', () => {
    expect(classifyToolLog('mcp__playwright__browser_click', {})).toBe('browser')
    expect(classifyToolLog('mcp__spark_browser__screenshot', {})).toBe('browser')
  })

  it('classifies media generation tools', () => {
    expect(classifyToolLog('mcp__spark_media__generate_image', {})).toBe('media')
    expect(classifyToolLog('generate_video', {})).toBe('media')
    expect(classifyToolLog('mcp__spark_media__transcribe_audio', {})).toBe('media')
  })

  it('falls back to the generic tool group', () => {
    expect(classifyToolLog('mcp__spark_canvas__create_node', {})).toBe('tool')
  })
})

describe('getToolActionLabel', () => {
  it('returns friendly action names for common tools', () => {
    expect(getToolActionLabel('Read', { file_path: '/tmp/a.ts' })).toBe('查看文件')
    expect(getToolActionLabel('Read', { file_path: '/tmp/a.png' })).toBe('查看图片')
    expect(getToolActionLabel('Grep', {})).toBe('搜索代码')
    expect(getToolActionLabel('Bash', {})).toBe('执行命令')
    expect(getToolActionLabel('Edit', {})).toBe('编辑文件')
    expect(getToolActionLabel('WebSearch', {})).toBe('联网搜索')
    expect(getToolActionLabel('mcp__spark_search__fetch_url', {})).toBe('抓取网页')
    expect(getToolActionLabel('mcp__spark_media__generate_image', {})).toBe('生成图片')
  })

  it('maps browser tools to concrete actions with a generic fallback', () => {
    expect(getToolActionLabel('mcp__playwright__browser_navigate', {})).toBe('打开页面')
    expect(getToolActionLabel('mcp__spark_browser__screenshot', {})).toBe('页面截图')
    expect(getToolActionLabel('mcp__playwright__browser_click', {})).toBe('点击元素')
    expect(getToolActionLabel('mcp__playwright__browser_evaluate', {})).toBe('执行脚本')
    expect(getToolActionLabel('mcp__spark_browser__network_set_rules', {})).toBe('浏览器操作')
  })

  it('falls back to the mcp tool tail, broad search semantics, then the raw name', () => {
    expect(getToolActionLabel('mcp__spark_canvas__create_node', {})).toBe('create_node')
    // 广义 search（知识库检索等）不归 web 组，动作名走泛化搜索
    expect(getToolActionLabel('mcp__apimart-docs__search_api_mart', {})).toBe('搜索')
    expect(getToolActionLabel('SomeCustomTool', {})).toBe('SomeCustomTool')
  })
})

describe('getToolIconKey', () => {
  it('maps each group to a dedicated icon key', () => {
    expect(getToolIconKey('Bash', {})).toBe('terminal')
    expect(getToolIconKey('Grep', {})).toBe('search')
    expect(getToolIconKey('Edit', {})).toBe('edit')
    expect(getToolIconKey('Read', { file_path: '/tmp/a.ts' })).toBe('file')
    expect(getToolIconKey('Read', { file_path: '/tmp/a.png' })).toBe('image')
    expect(getToolIconKey('WebSearch', {})).toBe('globe')
    expect(getToolIconKey('mcp__spark_browser__open', {})).toBe('browser')
    expect(getToolIconKey('mcp__spark_media__generate_image', {})).toBe('wand')
    expect(getToolIconKey('mcp__spark_canvas__create_node', {})).toBe('wrench')
  })
})
