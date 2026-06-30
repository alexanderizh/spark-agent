/**
 * @module skill-registry/mock-adapter
 *
 * Mock Adapter — 开发阶段使用，返回模拟数据
 * 后续每个市场源替换为真实 API 调用
 */

import type { RemoteSkillItem, SkillHubShowcaseSection } from '@spark/protocol'
import type { SkillRegistryAdapter, SkillRegistryAdapterConfig } from './adapter.js'
import { createRemoteSkillItem } from './adapter.js'

const MOCK_SKILLS: Array<Record<string, unknown>> = [
  {
    name: '代码审查助手',
    description: '自动化代码审查，检测潜在的 Bug、安全漏洞和性能问题，提供改进建议',
    version: '1.2.0',
    author: 'SkillsMP',
    category: '代码',
    tags: ['code-review', 'security', 'quality'],
    rating: 4.8,
    downloadCount: 12340,
    homepageUrl: 'https://skillsmp.com/skills/code-review',
    manifestUrl: 'https://api.skillsmp.com/v1/skills/code-review/manifest',
  },
  {
    name: '测试用例生成器',
    description: '根据源代码自动生成单元测试和集成测试用例，支持 Jest、Vitest、Pytest 等框架',
    version: '2.1.0',
    author: 'DevTools',
    category: '测试',
    tags: ['testing', 'unit-test', 'automation'],
    rating: 4.6,
    downloadCount: 8920,
    homepageUrl: 'https://skillsmp.com/skills/test-gen',
    manifestUrl: 'https://api.skillsmp.com/v1/skills/test-gen/manifest',
  },
  {
    name: '文档生成器',
    description: '自动为代码生成 API 文档、README 和使用指南，支持 JSDoc、TSDoc 格式',
    version: '1.0.3',
    author: 'DocMaster',
    category: '文档',
    tags: ['documentation', 'api-docs', 'readme'],
    rating: 4.3,
    downloadCount: 5670,
    homepageUrl: 'https://skillsmp.com/skills/doc-gen',
    manifestUrl: 'https://api.skillsmp.com/v1/skills/doc-gen/manifest',
  },
  {
    name: '数据库专家',
    description: 'SQL 查询优化、数据库设计建议、索引分析和 ORM 映射辅助',
    version: '1.5.0',
    author: 'DataPro',
    category: '数据',
    tags: ['database', 'sql', 'optimization'],
    rating: 4.5,
    downloadCount: 7230,
    homepageUrl: 'https://skillsmp.com/skills/db-expert',
    manifestUrl: 'https://api.skillsmp.com/v1/skills/db-expert/manifest',
  },
  {
    name: '安全扫描器',
    description: '扫描代码中的安全漏洞，检测依赖项中的已知 CVE，生成安全报告',
    version: '3.0.1',
    author: 'SecureAI',
    category: '安全',
    tags: ['security', 'vulnerability', 'cve'],
    rating: 4.9,
    downloadCount: 15890,
    homepageUrl: 'https://skillsmp.com/skills/security-scan',
    manifestUrl: 'https://api.skillsmp.com/v1/skills/security-scan/manifest',
  },
  {
    name: 'API 设计师',
    description: 'RESTful API 设计辅助，OpenAPI 规范生成，接口最佳实践建议',
    version: '1.1.0',
    author: 'APIForge',
    category: '代码',
    tags: ['api', 'rest', 'openapi'],
    rating: 4.4,
    downloadCount: 4560,
    homepageUrl: 'https://skillsmp.com/skills/api-design',
    manifestUrl: 'https://api.skillsmp.com/v1/skills/api-design/manifest',
  },
  {
    name: 'Git 工作流助手',
    description: '智能 Git 操作辅助，分支策略建议，合并冲突解决，commit 规范化',
    version: '2.0.0',
    author: 'GitGuru',
    category: '工具',
    tags: ['git', 'version-control', 'workflow'],
    rating: 4.7,
    downloadCount: 9870,
    homepageUrl: 'https://skillsmp.com/skills/git-helper',
    manifestUrl: 'https://api.skillsmp.com/v1/skills/git-helper/manifest',
  },
  {
    name: '性能分析器',
    description: '分析代码性能瓶颈，提供优化建议，支持 CPU、内存和 I/O 分析',
    version: '1.3.0',
    author: 'PerfX',
    category: '性能',
    tags: ['performance', 'profiling', 'optimization'],
    rating: 4.2,
    downloadCount: 3210,
    homepageUrl: 'https://skillsmp.com/skills/perf-analyzer',
    manifestUrl: 'https://api.skillsmp.com/v1/skills/perf-analyzer/manifest',
  },
  {
    name: 'i18n 国际化助手',
    description: '自动提取代码中的硬编码字符串，生成多语言翻译文件',
    version: '1.0.0',
    author: 'LocaleAI',
    category: '工具',
    tags: ['i18n', 'localization', 'translation'],
    rating: 4.1,
    downloadCount: 1890,
    homepageUrl: 'https://skillsmp.com/skills/i18n',
    manifestUrl: 'https://api.skillsmp.com/v1/skills/i18n/manifest',
  },
  {
    name: 'Prompt 工程师',
    description: '帮助用户编写和优化 AI Prompt，提供 prompt 模板和调优建议',
    version: '2.2.0',
    author: 'PromptLab',
    category: 'AI',
    tags: ['prompt', 'ai', 'optimization'],
    rating: 4.6,
    downloadCount: 11200,
    homepageUrl: 'https://skillsmp.com/skills/prompt-eng',
    manifestUrl: 'https://api.skillsmp.com/v1/skills/prompt-eng/manifest',
  },
  {
    name: 'Docker 部署助手',
    description: '生成 Dockerfile 和 docker-compose 配置，容器化部署最佳实践',
    version: '1.4.0',
    author: 'DeployX',
    category: '运维',
    tags: ['docker', 'deployment', 'container'],
    rating: 4.5,
    downloadCount: 6780,
    homepageUrl: 'https://skillsmp.com/skills/docker',
    manifestUrl: 'https://api.skillsmp.com/v1/skills/docker/manifest',
  },
  {
    name: '数据可视化',
    description: '根据数据自动生成图表和可视化报告，支持 ECharts、D3 等库',
    version: '1.1.2',
    author: 'VizMaster',
    category: '数据',
    tags: ['visualization', 'charts', 'data'],
    rating: 4.3,
    downloadCount: 4120,
    homepageUrl: 'https://skillsmp.com/skills/data-viz',
    manifestUrl: 'https://api.skillsmp.com/v1/skills/data-viz/manifest',
  },
]

export class MockSkillRegistryAdapter implements SkillRegistryAdapter {
  readonly registryId: string
  readonly registryName: string
  private readonly mockData: RemoteSkillItem[]

  constructor(config: SkillRegistryAdapterConfig) {
    this.registryId = config.registryId
    this.registryName = this.deriveRegistryName(config.registryId)
    this.mockData = MOCK_SKILLS.map((item) =>
      createRemoteSkillItem({
        id: `${config.registryId}:${(item.name as string).toLowerCase().replace(/\s+/g, '-')}`,
        name: item.name as string,
        description: item.description as string,
        version: item.version as string,
        author: item.author as string,
        registryId: config.registryId,
        registryName: this.registryName,
        category: item.category as string,
        tags: item.tags as string[],
        rating: item.rating as number,
        downloadCount: item.downloadCount as number,
        homepageUrl: item.homepageUrl as string,
        manifestUrl: item.manifestUrl as string,
      }),
    )
  }

  async search(query: string, options?: { category?: string; limit?: number; offset?: number }): Promise<{ skills: RemoteSkillItem[]; total: number }> {
    // 模拟 200ms 网络延迟
    await this.simulateLatency()

    const q = query.toLowerCase().trim()
    let filtered = this.mockData

    if (q.length > 0) {
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)) ||
          s.category.toLowerCase().includes(q) ||
          s.author.toLowerCase().includes(q),
      )
    }

    if (options?.category && options.category !== '全部') {
      filtered = filtered.filter((s) => s.category === options.category)
    }

    const offset = options?.offset ?? 0
    const limit = options?.limit ?? 20
    const paged = filtered.slice(offset, offset + limit)

    return { skills: paged, total: filtered.length }
  }

  async featured(limit?: number, section?: SkillHubShowcaseSection): Promise<RemoteSkillItem[]> {
    await this.simulateLatency()
    const cap = limit ?? 8
    // mock 不区分 section：2 个 tab 走不同的排序 key，避免前端看到「2 个 tab 拿同一份数据」
    switch (section) {
      case 'hot_downloads':
        return [...this.mockData]
          .sort((a, b) => b.downloadCount - a.downloadCount)
          .slice(0, cap)
      case 'recommended':
      default:
        return [...this.mockData]
          .sort((a, b) => b.rating * b.downloadCount - a.rating * a.downloadCount)
          .slice(0, cap)
    }
  }

  async categories(): Promise<Array<{ key: string; name: string }>> {
    await this.simulateLatency()
    const cats = new Set(this.mockData.map((s) => s.category))
    return [
      { key: 'all', name: '全部' },
      ...Array.from(cats).sort().map((name) => ({ key: name, name })),
    ]
  }

  async fetchManifest(_manifestUrl: string): Promise<string> {
    await this.simulateLatency()
    return JSON.stringify({
      name: 'mock-skill',
      version: '1.0.0',
      description: 'Mock Skill Manifest',
      author: 'Mock',
      tools: [],
    })
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now()
    await this.simulateLatency()
    return { healthy: true, latencyMs: Date.now() - start }
  }

  private deriveRegistryName(id: string): string {
    const names: Record<string, string> = {
      skillsmp: 'SkillsMP',
      'mcp-market': 'MCP Market',
      coze: '扣子 Coze',
      'claude-skills': 'Claude Skills',
    }
    return names[id] ?? id
  }

  private simulateLatency(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 150))
  }
}
