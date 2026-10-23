import { describe, expect, it } from 'vitest'
import {
  baseNameOf,
  extractSkillName,
  extractStringField,
  extractWebEntry,
  hostOfUrl,
  isJourneyArtifactPath,
  isSkillToolName,
  isWebToolName,
  shortToolLabel,
} from './session-journey-helpers.js'

describe('session-journey-helpers', () => {
  it('isSkillToolName matches native Skill tool and skills_load family', () => {
    expect(isSkillToolName('Skill')).toBe(true)
    expect(isSkillToolName('skills_load')).toBe(true)
    expect(isSkillToolName('mcp__spark_platform__skills_load')).toBe(true)
    expect(isSkillToolName('mcp__spark_platform__skill_run')).toBe(true)
    expect(isSkillToolName('Bash')).toBe(false)
    expect(isSkillToolName('mcp__spark_platform__mcp_list')).toBe(false)
    // 相似但不等同的名字不得误命中
    expect(isSkillToolName('SkillList')).toBe(false)
  })

  it('isWebToolName matches builtin web tools and search/fetch families', () => {
    expect(isWebToolName('WebSearch')).toBe(true)
    expect(isWebToolName('WebFetch')).toBe(true)
    expect(isWebToolName('mcp__spark_search__web_search')).toBe(true)
    expect(isWebToolName('mcp__spark_search__fetch_url')).toBe(true)
    expect(isWebToolName('mcp__web-search-prime__web_search_prime')).toBe(true)
    expect(isWebToolName('mcp__web-reader__webReader')).toBe(true)
    expect(isWebToolName('mcp__spark_platform__mcp_list')).toBe(false)
    expect(isWebToolName('mcp__zread__read_file')).toBe(false)
  })

  it('shortToolLabel compresses mcp qualified names and keeps builtin names', () => {
    expect(shortToolLabel('mcp__spark_search__web_search')).toBe('spark_search/web_search')
    expect(shortToolLabel('WebFetch')).toBe('WebFetch')
  })

  it('extractStringField picks first non-empty string field across candidates', () => {
    expect(extractStringField({ url: 'https://a.dev', prompt: 'x' }, ['url', 'link'])).toBe(
      'https://a.dev',
    )
    expect(extractStringField({ link: null, url: '' }, ['link', 'url'])).toBeNull()
    expect(extractStringField('not-an-object', ['url'])).toBeNull()
    expect(extractStringField([1, 2], ['url'])).toBeNull()
    expect(extractStringField({ q: 42 }, ['q'])).toBeNull()
  })

  it('extractSkillName prefers payload id/name and falls back to tool name', () => {
    expect(extractSkillName({ id: 'builtin:browser-use' }, 'Skill')).toBe('builtin:browser-use')
    expect(extractSkillName({ name: 'ppt-master' }, 'Skill')).toBe('ppt-master')
    expect(extractSkillName(null, 'mcp__spark_platform__skills_load')).toBe(
      'mcp__spark_platform__skills_load',
    )
  })

  it('extractWebEntry classifies url payloads as page and query payloads as search', () => {
    expect(extractWebEntry({ url: 'https://example.com/a?b=1' })).toEqual({
      kind: 'page',
      text: 'https://example.com/a?b=1',
    })
    expect(extractWebEntry({ search_query: 'claude code release notes' })).toEqual({
      kind: 'search',
      text: 'claude code release notes',
    })
    // URL 优先于检索词（fetch 工具载荷可能同时携带 prompt）
    expect(extractWebEntry({ url: 'https://a.dev', query: 'ignored' })?.kind).toBe('page')
    expect(extractWebEntry({ prompt: 'no url or query' })).toBeNull()
  })

  it('hostOfUrl returns host or null for invalid urls', () => {
    expect(hostOfUrl('https://docs.example.com/x')).toBe('docs.example.com')
    expect(hostOfUrl('not a url')).toBeNull()
  })

  it('baseNameOf handles posix and win32 separators', () => {
    expect(baseNameOf('apps/desktop/src/main.ts')).toBe('main.ts')
    expect(baseNameOf('C:\\Users\\dev\\doc.pdf')).toBe('doc.pdf')
    expect(baseNameOf('/')).toBe('/')
  })

  it('isJourneyArtifactPath only collects document and multimedia extensions', () => {
    // 文档
    expect(isJourneyArtifactPath('exports/report.md')).toBe(true)
    expect(isJourneyArtifactPath('slides/deck.pptx')).toBe(true)
    expect(isJourneyArtifactPath('data/统计.xlsx')).toBe(true)
    expect(isJourneyArtifactPath('docs/spec.pdf')).toBe(true)
    expect(isJourneyArtifactPath('build/index.html')).toBe(true)
    expect(isJourneyArtifactPath('notes.txt')).toBe(true)
    // 多媒体
    expect(isJourneyArtifactPath('.spark-artifacts/media/img.PNG')).toBe(true)
    expect(isJourneyArtifactPath('out/voice.mp3')).toBe(true)
    expect(isJourneyArtifactPath('out/clip.MOV')).toBe(true)
    // 代码 / 配置 / 无扩展名一律排除
    expect(isJourneyArtifactPath('src/main.ts')).toBe(false)
    expect(isJourneyArtifactPath('src/component.tsx')).toBe(false)
    expect(isJourneyArtifactPath('package.json')).toBe(false)
    expect(isJourneyArtifactPath('.env')).toBe(false)
    expect(isJourneyArtifactPath('Dockerfile')).toBe(false)
    expect(isJourneyArtifactPath('src/noext')).toBe(false)
    // 隐藏文件（点开头的“扩展名”不算扩展名）
    expect(isJourneyArtifactPath('docs/.gitignore')).toBe(false)
  })
})
