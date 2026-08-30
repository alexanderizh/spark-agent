import { Icons } from './Icons'
import { useApp } from './AppContext'
import { useI18n } from './i18n'
import { Tooltip } from '@lobehub/ui'

/** Shown when the floating sidebar is hidden — restores navigation panel. */
export function SidebarExpandButton({ onExpand }: { onExpand?: () => void }) {
  const { setTweak } = useApp()
  const { t } = useI18n()
  return (
    <Tooltip title={t('sidebar.expandButton')} mouseEnterDelay={0.05}>
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
        aria-label={t('sidebar.expandButton')}
      >
        <Icons.Menu size={16} />
      </button>
    </Tooltip>
  )
}
