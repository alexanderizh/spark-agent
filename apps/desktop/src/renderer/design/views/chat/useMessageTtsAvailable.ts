/**
 * useMessageTtsAvailable — 消息语音播报按钮可用性（是否配置了可用的 TTS 模型）
 *
 * 口径与语音助手设置卡一致：`canvas:media-models:list`（capability=audio.speech、
 * enabledOnly=true）返回非空即视为可用。
 *
 * 每条助手消息都会挂播报按钮，不能各自发 IPC：结果做模块级缓存（60s TTL），
 * 同窗口内的消息共享同一次查询；渠道配置变更最迟 60s 后对新渲染的按钮生效，
 * 已挂出的按钮保持当次结果（重进会话即刷新）。
 */

import { useEffect, useState } from 'react'

const CACHE_TTL_MS = 60_000

interface TtsAvailabilityCache {
  value: boolean
  at: number
}

let cachedResult: TtsAvailabilityCache | null = null
let inflight: Promise<boolean> | null = null

function readFreshCache(): TtsAvailabilityCache | null {
  if (cachedResult == null) return null
  return Date.now() - cachedResult.at < CACHE_TTL_MS ? cachedResult : null
}

async function queryTtsAvailable(): Promise<boolean> {
  try {
    const res = await window.spark.invoke('canvas:media-models:list', {
      capability: 'audio.speech',
      enabledOnly: true,
    })
    return res.models.length > 0
  } catch {
    // 列举失败按不可用处理：按钮不出现比出现后必失败更稳妥
    return false
  }
}

function requestTtsAvailable(): Promise<boolean> {
  if (inflight == null) {
    inflight = queryTtsAvailable().then((value) => {
      cachedResult = { value, at: Date.now() }
      inflight = null
      return value
    })
  }
  return inflight
}

/** 当前会话是否配置了可用的文字转语音模型（缓存优先，未命中后台查询） */
export function useMessageTtsAvailable(): boolean {
  const [available, setAvailable] = useState<boolean>(() => readFreshCache()?.value ?? false)

  useEffect(() => {
    const fresh = readFreshCache()
    if (fresh != null) {
      setAvailable(fresh.value)
      return
    }
    let cancelled = false
    void requestTtsAvailable().then((value) => {
      if (!cancelled) setAvailable(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return available
}
