/**
 * 远程附件取回（含进程内缓存）。
 *
 * 目标电脑上的文件本机读不到：统一经 remote-agent:attachment:fetch 取回并落到
 * userData 缓存，再交给 safe-file:// 加载。同一 (deviceId, path) 只取一次，
 * 失败就从缓存移除，下次渲染可以重试。
 */
import { useEffect, useState } from 'react'
import type { RemoteAgentAttachmentFetchResponse } from '@spark/protocol'

const cache = new Map<string, Promise<RemoteAgentAttachmentFetchResponse>>()

function cacheKey(deviceId: string, remotePath: string): string {
  return `${deviceId}\u0000${remotePath}`
}

export function fetchRemoteAttachment(
  deviceId: string,
  remotePath: string,
): Promise<RemoteAgentAttachmentFetchResponse> {
  const key = cacheKey(deviceId, remotePath)
  const cached = cache.get(key)
  if (cached != null) return cached
  const task = window.spark.invoke('remote-agent:attachment:fetch', {
    deviceId,
    path: remotePath,
  })
  cache.set(key, task)
  task.catch(() => {
    cache.delete(key)
  })
  return task
}

/**
 * 取回后的本机缓存路径 → `<img>` 可加载的 URL。
 *
 * safe-file 只认 `safe-file://x/<base64url(绝对路径)>`（见 main/services/SafeFileProtocol
 * 的 decodeSafeFileUrl）；早先这里直接拼 `safe-file://${localPath}`，解析端把 `/Users/...`
 * 当成 base64 段、还原失败 → 400，于是远程会话里的图片一律停在占位（目标端看得到、本机看不到）。
 * 编码方式与 SafeFileProtocol.toSafeFileUrl、MarkdownImage 保持一致。
 */
export function remoteFileUrl(localPath: string): string {
  const encoded = btoa(unescape(encodeURIComponent(localPath)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `safe-file://x/${encoded}`
}

export interface RemoteFileState {
  loading: boolean
  localPath: string | null
  mimeType: string | null
  /** 文本类内容原文（html/md/文本），非文本或缺省为 null */
  text: string | null
  error: string | null
}

const IDLE: RemoteFileState = {
  loading: false,
  localPath: null,
  mimeType: null,
  text: null,
  error: null,
}

/** 按需取回远程文件；enabled 为 false 时保持 idle（未点开预览就不拉内容） */
export function useRemoteFile(
  deviceId: string,
  remotePath: string | null,
  enabled: boolean,
): RemoteFileState {
  const [state, setState] = useState<RemoteFileState>(IDLE)

  useEffect(() => {
    if (!enabled || remotePath == null) {
      setState(IDLE)
      return
    }
    let cancelled = false
    setState({ ...IDLE, loading: true })
    fetchRemoteAttachment(deviceId, remotePath)
      .then((response) => {
        if (cancelled) return
        setState({
          loading: false,
          localPath: response.localPath,
          mimeType: response.mimeType,
          text: response.text ?? null,
          error: null,
        })
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setState({
          ...IDLE,
          error: cause instanceof Error ? cause.message : String(cause),
        })
      })
    return () => {
      cancelled = true
    }
  }, [deviceId, enabled, remotePath])

  return state
}
