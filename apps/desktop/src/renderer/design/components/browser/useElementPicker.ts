/**
 * useElementPicker — 「选择元素加入会话」的宿主侧状态机。
 *
 * 打开后向当前活动 webview 注入拾取脚本并等待其 Promise resolve；每次拾取
 * 成功回调一次文本并自动续注入（连续拾取），Esc / 关闭开关 / 切换 tab 或
 * 页面导航时退出。generation 计数用于丢弃取消后才返回的迟到结果。
 */
import { useCallback, useRef, useState } from 'react'
import {
  ELEMENT_PICKER_CANCEL_SCRIPT,
  ELEMENT_PICKER_SCRIPT,
  type ElementPickInfo,
} from './elementPickerScript'
import { callWebviewSafely } from './BrowserTabViewport'

export interface UseElementPickerOptions {
  /** 取当前活动 tab 的 webview（可能尚未挂载） */
  getWebview: () => Electron.WebviewTag | null
  /** 拾取到元素（结构化信息），由调用方决定以引用形式加入面板会话还是跨窗口转发 */
  onPickedElement: (info: ElementPickInfo) => void
  /** 拾取异常（特权页无法注入等）时的提示 */
  onPickError?: (message: string) => void
}

export interface ElementPickerController {
  active: boolean
  toggle: () => void
  stop: () => void
}

export function useElementPicker(opts: UseElementPickerOptions): ElementPickerController {
  const [active, setActive] = useState(false)
  const activeRef = useRef(false)
  const generationRef = useRef(0)
  // opts 闭包每次渲染都变，用 ref 保存最新值避免 stale callback
  const optsRef = useRef(opts)
  optsRef.current = opts

  const stop = useCallback((): void => {
    generationRef.current += 1
    const wasActive = activeRef.current
    activeRef.current = false
    setActive(false)
    // 拾取从未开启时无需向页面注入取消脚本：地址栏提交等高频路径都会先调
    // stop()，此时 webview guest 可能尚未 attach（dom-ready 未发出），
    // executeJavaScript 会同步 throw 炸出全局错误弹窗。
    if (!wasActive) return
    const wv = optsRef.current.getWebview()
    if (wv != null) {
      callWebviewSafely(wv, () => {
        void wv.executeJavaScript(ELEMENT_PICKER_CANCEL_SCRIPT).catch(() => {
          /* 页面已销毁 / 特权页：忽略 */
        })
      })
    }
  }, [])

  const runLoop = useCallback(async (generation: number): Promise<void> => {
    while (activeRef.current && generation === generationRef.current) {
      const wv = optsRef.current.getWebview()
      if (wv == null) break
      let result: unknown
      try {
        result = await wv.executeJavaScript(ELEMENT_PICKER_SCRIPT)
      } catch {
        // chrome-error 等特权页无法注入脚本
        optsRef.current.onPickError?.('当前页面不支持元素拾取')
        break
      }
      if (!activeRef.current || generation !== generationRef.current) break
      const pick =
        result != null && typeof result === 'object' && typeof (result as { tag?: unknown }).tag === 'string'
          ? (result as ElementPickInfo)
          : null
      if (pick == null) break // Esc / 空结果取消
      optsRef.current.onPickedElement(pick)
    }
    if (activeRef.current) stop()
  }, [stop])

  const toggle = useCallback((): void => {
    if (activeRef.current) {
      stop()
      return
    }
    activeRef.current = true
    setActive(true)
    const generation = ++generationRef.current
    void runLoop(generation)
  }, [runLoop, stop])

  return { active, toggle, stop }
}
