/**
 * media-extract.mjs — 多媒体响应提取纯函数（单一事实源）。
 *
 * 被两处复用，避免 HTTP 响应解析逻辑分叉：
 *   - TS adapter（packages/agent-runtime/src/services/media/media-http.util.ts）
 *   - spark_media MCP（packages/agent-runtime/src/tools/media-generation-mcp-server.mjs）
 *
 * 纯 JS、零依赖、无 I/O，便于在 stdio 子进程和 TS 运行时之间共享。
 */

/** 递归遍历 JSON 树，对每个 (value, key) 调用 visit */
export function walkJson(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, visit)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      visit(child, key)
      walkJson(child, visit)
    }
  }
}

/** 从任意 JSON 响应中提取图片（url 或 base64），去重 */
export function extractImages(value) {
  const images = []
  walkJson(value, (node, key) => {
    if (typeof node !== 'string') {
      if (key === 'url' && Array.isArray(node)) {
        for (const item of node) {
          if (typeof item === 'string' && /^https?:\/\//i.test(item)) {
            images.push({ kind: 'url', value: item })
          }
        }
      }
      return
    }
    if ((key === 'url' || key === 'image_url' || key === 'imageUrl') && /^https?:\/\//i.test(node)) {
      images.push({ kind: 'url', value: node })
    }
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(node)) {
      const match = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(node)
      images.push({ kind: 'base64', value: match?.[2] ?? '', mimeType: match?.[1] ?? 'image/png' })
    }
    if ((key === 'b64_json' || key === 'base64' || key === 'image') && node.length > 64) {
      images.push({ kind: 'base64', value: node, mimeType: 'image/png' })
    }
  })
  const seen = new Set()
  return images.filter((image) => {
    const k = `${image.kind}:${image.value.slice(0, 120)}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** 提取音频/视频 URL（key 命中 url/audio_url/video_url/file_url/download_url/link/result 等） */
export function extractMediaUrls(value, opts = { kind: 'video' }) {
  const keys = opts.kind === 'audio'
    ? ['url', 'audio_url', 'audioUrl', 'file_url', 'fileUrl', 'download_url', 'link']
    : ['url', 'video_url', 'videoUrl', 'file_url', 'fileUrl', 'download_url', 'link', 'result']
  const found = []
  walkJson(value, (node, key) => {
    if (typeof node === 'string' && keys.includes(key) && /^https?:\/\//i.test(node)) {
      found.push(node)
    }
  })
  return [...new Set(found)]
}

/** 提取文本（语音转写结果）：优先 text/transcript 字段，否则整个字符串 */
export function extractText(value) {
  const direct = []
  walkJson(value, (node, key) => {
    if (typeof node === 'string' && (key === 'text' || key === 'transcript') && node.trim()) {
      direct.push(node)
    }
  })
  if (direct.length > 0) return direct.join('\n')
  const str = typeof value === 'string' ? value : ''
  return str.trim().length > 0 ? str : ''
}

/** 提取异步任务 id（按命名优先级：task_id > taskId > job_id > jobId > request_id > requestId > id） */
export function extractTaskId(value) {
  const priority = ['task_id', 'taskId', 'job_id', 'jobId', 'request_id', 'requestId', 'id']
  const found = {}
  walkJson(value, (node, key) => {
    if (priority.includes(key) && typeof node === 'string' && node.trim()) {
      found[key] ??= []
      found[key].push(node)
    }
  })
  for (const key of priority) {
    if (found[key]?.length) return found[key][0]
  }
  return ''
}

/** 提取任务状态字符串（status / task_status / state），小写化 */
export function extractStatus(value) {
  let status = ''
  walkJson(value, (node, key) => {
    if ((key === 'status' || key === 'task_status' || key === 'state') && typeof node === 'string') {
      status ||= node.toLowerCase()
    }
  })
  return status
}
