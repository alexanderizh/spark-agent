import { Icons } from './Icons'
import { useApp } from './AppContext'

/** Shown when the floating sidebar is hidden — restores navigation panel. */
export function SidebarExpandButton() {
  const { setTweak } = useApp()
  return (
    <button
      type="button"
      className="sidebar-expand-btn"
      onClick={() => setTweak('sidebarHidden', false)}
      title="展开菜单栏"
    >
      <Icons.SidebarShow size={16} />
    </button>
  )
}
