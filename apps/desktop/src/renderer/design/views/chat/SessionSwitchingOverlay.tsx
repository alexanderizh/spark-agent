import { Icons } from '../../Icons'
import { createPortal } from 'react-dom'
import './SessionSwitchingOverlay.less'

export function SessionSwitchingOverlay({ host }: { host: HTMLElement | null }) {
  const overlay = (
    <div className="chat-switching-overlay" aria-hidden="true">
      <Icons.Spinner size={22} />
    </div>
  )

  return host == null ? overlay : createPortal(overlay, host)
}
