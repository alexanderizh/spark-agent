import { CircleStop } from 'lucide-react'
import './CancellationNotice.css'

export interface CancellationNoticeProps {
  message?: string
}

export function CancellationNotice({
  message = '已取消本次任务',
}: CancellationNoticeProps): React.ReactElement {
  return (
    <div className="cancellation-notice" role="status">
      <CircleStop size={14} strokeWidth={1.8} aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}
