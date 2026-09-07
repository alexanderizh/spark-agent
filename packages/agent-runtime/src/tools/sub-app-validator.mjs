import {
  IMPLEMENTED_SPARK_APP_SYMBOLS,
  RESERVED_SPARK_APP_SYMBOLS,
  SUB_APP_DEVELOPER_CONTRACT_DIGEST,
  SUB_APP_SOURCE_HARD_LIMIT,
} from './sub-app-developer-contract.mjs'

const KNOWN_ROOTS = new Set([
  'runtime',
  'theme',
  'data',
  'ui',
  'navigation',
  'files',
  'agent',
  'media',
  'canvas',
  'browser',
  'ipc',
  'platform',
  'clipboard',
  'notifications',
  'network',
  'provider',
  'backend',
  'jobs',
])

const CAPABILITY_BY_ROOT = {
  runtime: 'runtime',
  theme: 'theme',
  data: 'data',
  ui: 'ui',
  navigation: 'navigation',
  files: 'files',
  agent: 'agent',
  media: 'media',
  canvas: 'canvas',
  browser: 'browser',
  ipc: 'ipc',
  platform: 'ipc',
  clipboard: 'clipboard',
  notifications: 'notifications',
  network: 'network',
  provider: 'provider',
  backend: 'backend',
  jobs: 'jobs',
}

export function validateSubAppSource(input) {
  const source = typeof input?.source === 'string' ? input.source : ''
  const file = typeof input?.file === 'string' && input.file.length > 0 ? input.file : undefined
  const surface = typeof input?.surface === 'string' ? input.surface : 'content'
  const diagnostics = []
  const capabilities = new Set()

  if (source.trim().length === 0) {
    add(
      diagnostics,
      source,
      file,
      0,
      'error',
      'SOURCE_EMPTY',
      '子应用源码为空，无法预览或发布。',
      'publishing',
    )
    return buildResult(diagnostics, capabilities)
  }
  if (source.length > SUB_APP_SOURCE_HARD_LIMIT) {
    add(
      diagnostics,
      source,
      file,
      0,
      'error',
      'SOURCE_TOO_LARGE',
      `源码超过 ${SUB_APP_SOURCE_HARD_LIMIT} 字符硬上限。`,
      'security',
    )
    return buildResult(diagnostics, capabilities)
  }

  scanSparkAppSymbols(source, file, diagnostics, capabilities)
  scanForbiddenMarkup(source, file, diagnostics)
  scanResourceUrls(source, file, diagnostics)

  matchOnce(source, /\b(?:localStorage|sessionStorage|indexedDB)\b/u, (match) => {
    add(
      diagnostics,
      source,
      file,
      match.index,
      'warning',
      'NON_DURABLE_BROWSER_STORAGE',
      '浏览器存储不能作为子应用唯一持久化数据源；需要跨重开保留的数据请使用 sparkApp.data 或 sparkApp.files。',
      'data',
    )
  })
  matchOnce(source, /(?:provider:get-api-key|get-api-key)/u, (match) => {
    add(
      diagnostics,
      source,
      file,
      match.index,
      'warning',
      'LEGACY_PROVIDER_SECRET_ACCESS',
      '检测到读取 Provider 明文密钥的 legacy 通道。不要把密钥写入源码、日志或应用数据；后续应迁移到受管请求能力。',
      'provider',
    )
  })
  matchOnce(source, /(?:Authorization|authorization)\s*[:=]\s*['"`]Bearer\s+[^'"`]+/u, (match) => {
    add(
      diagnostics,
      source,
      file,
      match.index,
      'warning',
      'POSSIBLE_INLINE_SECRET',
      '检测到疑似内联 Authorization 凭据。请移除明文 secret，并改用宿主受管连接。',
      'security',
    )
  })
  matchOnce(source, /\b(?:eval\s*\(|new\s+Function\s*\()/u, (match) => {
    add(
      diagnostics,
      source,
      file,
      match.index,
      'warning',
      'UNSAFE_EVAL_DEPENDENCY',
      '源码依赖 unsafe-eval；用户关闭该子应用安全选项后会失效。',
      'security',
    )
  })
  matchOnce(source, /\bfetch\s*\(|\bXMLHttpRequest\b/u, (match) => {
    add(
      diagnostics,
      source,
      file,
      match.index,
      'suggestion',
      'DIRECT_NETWORK_REQUEST',
      '直接网络请求受目标 CORS 和子应用网络设置约束，且不会获得宿主凭据。公开无密钥接口可继续使用。',
      'network',
    )
  })
  matchOnce(source, /\bsparkApp\.data\.delete\s*\([^,]+,[^,()]+\)/u, (match) => {
    add(
      diagnostics,
      source,
      file,
      match.index,
      'warning',
      'DATA_DELETE_REVISION_MISSING',
      'sparkApp.data.delete 需要第三个 expectedRevision 参数；先 get 当前记录再删除。',
      'data',
    )
  })

  if (surface === 'overlay' && !usesThemeBackground(source)) {
    add(
      diagnostics,
      source,
      file,
      0,
      'suggestion',
      'OVERLAY_BACKGROUND_NOT_DECLARED',
      'overlay 容器背景透明；建议给应用根容器设置 --spark-color-bg-container 等宿主主题背景。',
      'surfaces',
    )
  }
  if (!/--spark-|sparkApp\.theme\.(?:get|current|onChange)/u.test(source)) {
    add(
      diagnostics,
      source,
      file,
      0,
      'suggestion',
      'THEME_INTEGRATION_NOT_DETECTED',
      '未检测到宿主主题 token 或 sparkApp.theme 集成；请确认深浅色下文字与背景均可读。',
      'theme',
    )
  }

  return buildResult(diagnostics, capabilities)
}

function buildResult(diagnostics, capabilities) {
  diagnostics.sort(compareDiagnostics)
  const errorCount = diagnostics.filter((item) => item.severity === 'error').length
  const visibleDiagnostics = diagnostics.slice(0, 100)
  return {
    valid: errorCount === 0,
    readyToPreview: errorCount === 0,
    readyToPublish: errorCount === 0,
    detectedCapabilities: [...capabilities].sort(),
    diagnostics: visibleDiagnostics,
    ...(diagnostics.length > visibleDiagnostics.length
      ? { truncatedDiagnostics: diagnostics.length - visibleDiagnostics.length }
      : {}),
    summary: {
      errors: errorCount,
      warnings: diagnostics.filter((item) => item.severity === 'warning').length,
      suggestions: diagnostics.filter((item) => item.severity === 'suggestion').length,
    },
    contractDigest: SUB_APP_DEVELOPER_CONTRACT_DIGEST,
  }
}

function scanSparkAppSymbols(source, file, diagnostics, capabilities) {
  const segments = executableSegments(source)
  const rootPattern = /\bsparkApp(?:\.|\?\.)([A-Za-z_$][\w$]*)/gu
  for (const segment of segments) {
    for (const match of segment.code.matchAll(rootPattern)) {
      const root = match[1]
      if (root && CAPABILITY_BY_ROOT[root]) capabilities.add(CAPABILITY_BY_ROOT[root])
      if (root && !KNOWN_ROOTS.has(root)) {
        add(
          diagnostics,
          source,
          file,
          segment.offset + (match.index ?? 0),
          'error',
          'UNKNOWN_SDK_CAPABILITY',
          `sparkApp.${root} 不存在于当前运行时契约。`,
          'runtime-sdk',
        )
      }
    }
  }

  const symbolPattern =
    /\bsparkApp(?:\.|\?\.)([A-Za-z_$][\w$]*)(?:\.|\?\.)([A-Za-z_$][\w$]*)(?:\s*\(|\b)/gu
  for (const segment of segments) {
    for (const match of segment.code.matchAll(symbolPattern)) {
      const root = match[1]
      const member = match[2]
      if (!root || !member) continue
      if (!KNOWN_ROOTS.has(root)) continue
      let symbol = `sparkApp.${root}.${member}`
      if (root === 'platform' && member === 'ipc') {
        const tail = segment.code
          .slice((match.index ?? 0) + match[0].length)
          .match(/^\s*\.\s*(invoke|on)\b/u)
        if (tail?.[1]) symbol = `sparkApp.ipc.${tail[1]}`
      }
      if (symbol === 'sparkApp.platform.trusted') continue
      const sourceIndex = segment.offset + (match.index ?? 0)
      if (
        RESERVED_SPARK_APP_SYMBOLS.has(symbol) ||
        RESERVED_SPARK_APP_SYMBOLS.has(`sparkApp.${root}`)
      ) {
        add(
          diagnostics,
          source,
          file,
          sourceIndex,
          'error',
          'SDK_CAPABILITY_NOT_IMPLEMENTED',
          `${symbol} 已保留但当前未实现，不能用于可运行子应用。`,
          topicForRoot(root),
        )
        continue
      }
      if (!IMPLEMENTED_SPARK_APP_SYMBOLS.has(symbol)) {
        add(
          diagnostics,
          source,
          file,
          sourceIndex,
          'error',
          'UNKNOWN_SDK_METHOD',
          `${symbol} 不存在于当前运行时契约。`,
          topicForRoot(root),
        )
        continue
      }
      if (root === 'ipc' || root === 'platform') {
        add(
          diagnostics,
          source,
          file,
          sourceIndex,
          'warning',
          'LEGACY_RAW_IPC',
          `${symbol} 属于 V1 legacy 原始 IPC；参数不可发现且未来 V2 默认禁用，优先使用类型化 sparkApp 能力。`,
          'security',
        )
      }
    }
  }
}

function executableSegments(source) {
  const segments = []
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu
  for (const match of source.matchAll(scriptPattern)) {
    const body = match[1] ?? ''
    const bodyOffset = (match.index ?? 0) + match[0].indexOf(body)
    segments.push({ code: maskJavaScriptNonCode(body), offset: bodyOffset })
  }
  const eventPattern = /\bon[a-z]+\s*=\s*(['"])([\s\S]*?)\1/giu
  for (const match of source.matchAll(eventPattern)) {
    const body = match[2] ?? ''
    const bodyOffset = (match.index ?? 0) + match[0].indexOf(body)
    segments.push({ code: maskJavaScriptNonCode(body), offset: bodyOffset })
  }
  return segments
}

function maskJavaScriptNonCode(code) {
  return code.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|(['"])(?:\\.|(?!\1)[^\\\r\n])*\1|`(?:\\.|[^\\`])*`/gu,
    (match) => match.replace(/[^\r\n]/gu, ' '),
  )
}

function scanForbiddenMarkup(source, file, diagnostics) {
  const tags = ['iframe', 'frame', 'object', 'embed', 'base']
  for (const tag of tags) {
    const pattern = new RegExp(`<\\s*${tag}\\b`, 'iu')
    const match = pattern.exec(source)
    if (match) {
      add(
        diagnostics,
        source,
        file,
        match.index,
        'error',
        'CSP_UNSUPPORTED_ELEMENT',
        `<${tag}> 被当前子应用 CSP 禁止，运行时不会正常工作。`,
        'security',
      )
    }
  }
  const form = /<\s*form\b/iu.exec(source)
  if (form) {
    add(
      diagnostics,
      source,
      file,
      form.index,
      'warning',
      'CSP_FORM_SUBMISSION_BLOCKED',
      '<form> 可以承载本地交互，但当前 CSP 会阻止原生表单提交；请在 submit 事件中 preventDefault 并通过允许的 API 处理数据。',
      'security',
    )
  }
}

function scanResourceUrls(source, file, diagnostics) {
  const pattern = /\b(?:src|href)\s*=\s*(['"])([^'"]+)\1/giu
  for (const match of source.matchAll(pattern)) {
    const value = match[2]?.trim() ?? ''
    if (!value || value.startsWith('#')) continue
    if (/^javascript:/iu.test(value)) {
      add(
        diagnostics,
        source,
        file,
        match.index ?? 0,
        'error',
        'JAVASCRIPT_URL',
        '资源或链接使用 javascript: URL，不符合子应用安全契约。',
        'security',
      )
      continue
    }
    if (/^(?:https?:|data:|blob:|safe-file:|mailto:|tel:)/iu.test(value)) continue
    add(
      diagnostics,
      source,
      file,
      match.index ?? 0,
      'error',
      'V1_RELATIVE_RESOURCE',
      `V1 单 HTML 不能可靠加载本地相对资源：${value}`,
      'publishing',
    )
  }
}

function matchOnce(source, pattern, callback) {
  const match = pattern.exec(source)
  if (match) callback(match)
}

function usesThemeBackground(source) {
  return /background(?:-color)?\s*:\s*var\(\s*--spark-/iu.test(source)
}

function topicForRoot(root) {
  if (Object.hasOwn(CAPABILITY_BY_ROOT, root)) return CAPABILITY_BY_ROOT[root]
  return 'runtime-sdk'
}

function add(diagnostics, source, file, index, severity, code, message, helpTopic) {
  if (diagnostics.some((item) => item.code === code && item.message === message)) return
  const location = locate(source, index)
  diagnostics.push({
    severity,
    code,
    message,
    ...(file ? { file } : {}),
    ...location,
    helpTopic,
  })
}

function locate(source, index) {
  const prefix = source.slice(0, Math.max(0, index))
  const lines = prefix.split('\n')
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}

function compareDiagnostics(left, right) {
  const rank = { error: 0, warning: 1, suggestion: 2 }
  return (
    rank[left.severity] - rank[right.severity] ||
    left.line - right.line ||
    left.code.localeCompare(right.code)
  )
}
