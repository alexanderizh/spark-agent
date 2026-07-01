import { Icons } from './Icons'
import { useApp } from './AppContext'
import { useI18n } from './i18n'

/** Shown when the floating sidebar is hidden — restores navigation panel. */
export function SidebarExpandButton({ onExpand }: { onExpand?: () => void }) {
  const { setTweak } = useApp()
  const { t } = useI18n()
  return (
    <button
      type="button"
      className="icon-btn sidebar-expand-btn"
      onClick={() => {
        if (onExpand) {
          onExpand()
        } else {
          setTweak('sidebarHidden', false)
        }
      }}
      title={t('sidebar.expandButton')}
      aria-label={t('sidebar.expandButton')}
    >
      <Icons.Menu size={16} />
    </button>
  )
}
