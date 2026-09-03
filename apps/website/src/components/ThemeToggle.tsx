import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DARK, getActiveTheme, toggleTheme, type ThemeName } from '../lib/theme'

/**
 * 明暗两态主题切换器。
 * 初始值取 <html data-theme>（index.html 防闪脚本已设好），点击即时翻转并持久化。
 */
export function ThemeToggle() {
  // 服务端与 hydration 首帧固定使用 dark，挂载后再同步防闪脚本确定的真实主题。
  const [theme, setTheme] = useState<ThemeName>(DARK)
  useEffect(() => setTheme(getActiveTheme()), [])
  const isDark = theme === DARK

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(toggleTheme())}
      aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
      title={isDark ? '切换到浅色模式' : '切换到深色模式'}
    >
      {isDark ? <Sun size={15} strokeWidth={1.8} /> : <Moon size={15} strokeWidth={1.8} />}
    </button>
  )
}
