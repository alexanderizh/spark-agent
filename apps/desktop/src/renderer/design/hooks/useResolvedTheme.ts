import { useEffect, useState } from 'react'

/** 跟随 AppContext 写入的 `<html data-theme>` 与系统主题偏好。 */
export function useResolvedTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof document === 'undefined') return 'light'
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  })

  useEffect(() => {
    const root = document.documentElement
    const sync = () => {
      setTheme(root.dataset.theme === 'dark' ? 'dark' : 'light')
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  return theme
}
