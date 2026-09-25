/**
 * Provider 限额查询（Quota）类型与厂商注册表。
 *
 * 渠道卡片上的限额展示（API 余额 / 五小时 / 周 / 月限额、套餐档位、MCP 用量等）
 * 由各厂商专属接口提供，字段口径各不相同。本模块定义统一的归一化结构
 * `ProviderQuotaSnapshot`，主进程侧每个厂商实现一个适配器把原始响应
 * 折算成该结构；渲染端只消费归一化结果，不感知厂商差异。
 *
 * 厂商识别不依赖持久化的 presetId（provider 配置未落库该字段），而是用
 * endpoint / 名称信号匹配（`detectProviderQuotaVendor`），主进程与渲染端
 * 共用同一份注册表，保证「卡片是否发起限额查询」与「主进程能否处理」
 * 判定一致。
 */

/** 单条限额（一个窗口一条，如「五小时窗口」「本月窗口」）。 */
export interface ProviderQuotaLimit {
  /** 限额类别：credit=额度类、mcp=MCP 用量；厂商自定义类别直接透传小写标识。 */
  kind: string
  /** 类别展示名（"额度" / "MCP" / …）。 */
  kindLabel: string
  /** 窗口展示名（"5小时" / "本周" / "本月" / …）。 */
  windowLabel: string
  /** 窗口总额度（厂商原始单位，仅用于展示与计算，不做跨厂商换算）；接口只给百分比时缺省。 */
  total?: number
  /** 已用额度；接口只给百分比时缺省。 */
  used?: number
  /** 剩余额度；接口只给百分比时缺省。 */
  remaining?: number
  /** 已用百分比 0-100（整数）。 */
  usedPercentage: number
  /** 剩余百分比 0-100（整数）。 */
  remainingPercentage: number
  /** 窗口重置时间（epoch ms）；缺省表示接口未提供。 */
  resetAt?: number
  /** 厂商原始限额类型（如 zhipu 的 "TIME_LIMIT" / "TOKENS_LIMIT"），仅用于排查日志。 */
  rawType?: string
  /** 窗口内分项用量明细（如 MCP 的 网络搜索/网页读取/开源仓库），用于悬浮提示。 */
  details?: ProviderQuotaLimitDetail[]
}

/** 限额窗口内的单条分项用量（如 MCP 共享额度里各工具的用量）。 */
export interface ProviderQuotaLimitDetail {
  /** 厂商侧分项标识（如 "search-prime"），排查用。 */
  key: string
  /** 分项展示名（如 "网络搜索"）。 */
  label: string
  /** 分项已用量（厂商原始单位）。 */
  used: number
}

/** 一个 Provider 的限额快照。 */
export interface ProviderQuotaSnapshot {
  providerId: string
  /** 厂商标识（注册表 id，如 'zhipu'）。 */
  vendor: string
  /** 套餐档位原始值（如 'lite' / 'pro' / 'max'）；接口未提供时缺省。 */
  planLevel?: string
  /** 套餐档位展示名（如 "Lite"）。 */
  planLabel?: string
  limits: ProviderQuotaLimit[]
  fetchedAt: number
}

export interface ProviderQuotaRequest {
  id: string
}

/**
 * 限额查询响应。supported=false 表示该渠道当前没有限额适配器
 * （渲染端按同一注册表预判，正常不会对不支持渠道发起查询）。
 */
export interface ProviderQuotaResponse {
  supported: boolean
  quota?: ProviderQuotaSnapshot
  errorMessage?: string
}

/** 厂商限额适配器注册条目（描述「怎么识别这个厂商」，请求逻辑在主进程侧实现）。 */
export interface ProviderQuotaVendorDescriptor {
  /** 厂商标识，与适配器实现一一对应。 */
  id: string
  /** 展示名（日志 / 调试用）。 */
  label: string
  /** endpoint 主机名等于该域名或其子域名时命中（大小写不敏感）。 */
  endpointHosts: string[]
  /** 仅 endpoint 缺失时，渠道名称包含任一子串才作为兜底（大小写不敏感）。 */
  nameIncludes: string[]
}

/**
 * 已支持限额查询的厂商注册表。新增渠道时在此追加条目，并在主进程
 * providerQuota/ 下实现同名适配器。
 */
export const PROVIDER_QUOTA_VENDORS: readonly ProviderQuotaVendorDescriptor[] = [
  {
    id: 'zhipu',
    label: '智谱',
    endpointHosts: ['bigmodel.cn'],
    nameIncludes: ['智谱', 'bigmodel'],
  },
]

/**
 * 检测某个 Provider 属于哪个已支持限额查询的厂商。
 * endpoint 主机名优先；仅 endpoint 缺失时按名称兜底。返回 null 表示不支持。
 */
export function detectProviderQuotaVendor(input: {
  name?: string | undefined
  apiEndpoint?: string | null | undefined
}): ProviderQuotaVendorDescriptor | null {
  const endpoint = (input.apiEndpoint ?? '').trim()
  const name = (input.name ?? '').trim().toLowerCase()

  // A configured endpoint is the authority for where this provider's key is
  // intended to go. Never fall back to a display name when that endpoint is
  // present but belongs to an unknown host.
  if (endpoint.length > 0) {
    const urlInput = /^[a-z][a-z\d+.-]*:\/\//iu.test(endpoint) ? endpoint : `https://${endpoint}`
    let hostname: string
    try {
      hostname = new URL(urlInput).hostname.toLowerCase()
    } catch {
      return null
    }
    for (const vendor of PROVIDER_QUOTA_VENDORS) {
      if (vendor.endpointHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
        return vendor
      }
    }
    return null
  }

  for (const vendor of PROVIDER_QUOTA_VENDORS) {
    if (vendor.nameIncludes.some((frag) => name.includes(frag))) return vendor
  }
  return null
}
