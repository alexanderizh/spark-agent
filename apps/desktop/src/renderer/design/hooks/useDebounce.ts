import { useState, useEffect, useRef } from 'react'

/**
 * useDebounce — 延迟更新值，常用于搜索/过滤输入的防抖。
 *
 * @param value 原始值
 * @param delay 延迟毫秒，默认 300ms
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedValue(value)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}

/**
 * useDebouncedCallback — 防抖回调，返回一个 debounced 版本。
 *
 * @param callback 要防抖的回调
 * @param delay 延迟毫秒，默认 300ms
 */
export function useDebouncedCallback<T extends (...args: never[]) => void>(
  callback: T,
  delay = 300,
): T {
  const timerRef = useRef<number | null>(null)

  const debounced = (...args: Parameters<T>) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
    }
    timerRef.current = window.setTimeout(() => {
      callback(...args)
      timerRef.current = null
    }, delay)
  }

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  return debounced as T
}
