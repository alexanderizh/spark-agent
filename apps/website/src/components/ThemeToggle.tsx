import { Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { DARK, getActiveTheme, toggleTheme, type ThemeName } from '../lib/theme'

/**
 * 明暗两态主题切换器。
 * 初始值取 <html data-theme>（index.html 防闪脚本已设好），点击即时翻转并持久化。
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeName>(() => getActiveTheme())
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
