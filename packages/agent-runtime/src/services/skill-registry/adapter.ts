/**
 * @module skill-registry/adapter
 *
 * Skill Registry Adapter 统一接口
 *
 * 每个 Skill 市场源（SkillsMP、MCP Market、扣子 Coze 等）实现此接口。
 * 新增市场源只需新建 Adapter 文件，不改核心逻辑。
 */

import type { RemoteSkillItem, SkillHubShowcaseSection } from '@spark/protocol'

/** Adapter 配置 */
export interface SkillRegistryAdapterConfig {
  /** 市场 ID */
  registryId: string
  /** 市场 API 基础 URL */
  apiBaseUrl: string
  /** 额外配置（API Key、自定义 headers 等）*/
  configJson: string
}

/** Skill 市场源统一适配器接口 */
export interface SkillRegistryAdapter {
  /** 市场 ID */
  readonly registryId: string

  /** 市场 名称 */
  readonly registryName: string

  /**
   * 搜索 Skill
   * @param query 搜索关键词
   * @param options 分页和过滤选项
   */
  search(query: string, options?: {
    category?: string
    limit?: number
    offset?: number
  }): Promise<{ skills: RemoteSkillItem[]; total: number }>

  /**
   * 获取热门/推荐 Skill
   * @param limit 返回数量
   * @param section 市场内子分区（如 SkillHub 的 recommended/hot_downloads）；不支持的市场忽略
   * @param category 分类 key（透传给后端过滤）；不支持的市场忽略
   */
  featured(
    limit?: number,
    section?: SkillHubShowcaseSection,
    category?: string,
  ): Promise<RemoteSkillItem[]>

  /**
   * 获取市场分类列表（每项含 key/name，service 层统一 prepend "全部"）
   */
  categories(): Promise<Array<{ key: string; name: string }>>

  /**
   * 获取 Skill 的 Manifest 内容（JSON 字符串）
   * 用于安装时解析 Skill 元数据
   */
  fetchManifest(manifestUrl: string): Promise<string>

  /**
   * 测试市场连接是否可用
   */
  healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }>
}

/**
 * 将原始 API 数据映射为标准的 RemoteSkillItem
 * 子类实现中调用此函数确保字段一致
 */
export function createRemoteSkillItem(base: {
  id: string
  name: string
  description: string
  version: string
  author: string
  registryId: string
  registryName: string
  category: string
  tags: string[]
  rating: number
  downloadCount: number
  homepageUrl?: string
  manifestUrl: string
  iconUrl?: string
}): RemoteSkillItem {
  return {
    ...base,
    installed: false,
  }
}
