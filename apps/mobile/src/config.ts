/**
 * 运行时配置。
 *
 * src/config.json 由 scripts/build.mjs 在构建期生成（可被 SPARK_EDUGEN_BASE_URL 覆盖），
 * tsc 以 resolveJsonModule 静态内联进产物，不依赖运行时动态 require。
 * 默认值与桌面端一致：https://www.yiqibyte.com
 * （见 apps/desktop/src/main/index.ts 的 defaultBaseUrl）。
 */

import defaultConfig from './config.json'

export interface RuntimeConfig {
  /** edu-server 根地址，不带结尾斜杠 */
  baseUrl: string
  /** API 全局前缀，与 EduServerClient.resolveUrl 一致 */
  apiPrefix: string
}

const FALLBACK: RuntimeConfig = {
  baseUrl: 'https://www.yiqibyte.com',
  apiPrefix: '/api/v1',
}

let cached: RuntimeConfig | null = null

export function getConfig(): RuntimeConfig {
  if (cached) return cached
  const config = defaultConfig as Partial<RuntimeConfig>
  cached = {
    baseUrl:
      typeof config?.baseUrl === 'string' && config.baseUrl.length > 0
        ? config.baseUrl
        : FALLBACK.baseUrl,
    apiPrefix:
      typeof config?.apiPrefix === 'string' && config.apiPrefix.length > 0
        ? config.apiPrefix
        : FALLBACK.apiPrefix,
  }
  return cached
}
