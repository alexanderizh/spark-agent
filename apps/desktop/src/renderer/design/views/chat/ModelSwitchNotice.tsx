import React, { useId } from 'react'
import { Box, CircleHelp } from 'lucide-react'
import type { ModelSwitchMarker } from './ModelSwitchMarkers'
import './ModelSwitchNotice.less'

export function ModelSwitchNotice({ marker }: { marker: ModelSwitchMarker }) {
  const tooltipId = useId()
  return (
    <div className="model-switch-notice" role="status">
      <span className="model-switch-notice-line" />
      <span className="model-switch-notice-content">
        <Box aria-hidden="true" size={17} strokeWidth={1.8} />
        <span>
          模型已从 {marker.fromModel} 更改为 {marker.toModel}
        </span>
        <span className="model-switch-notice-help" tabIndex={0} aria-describedby={tooltipId}>
          <CircleHelp aria-hidden="true" size={16} strokeWidth={1.8} />
          <span id={tooltipId} className="model-switch-notice-tooltip" role="tooltip">
            在对话过程中切换模型会降低性能表现。
          </span>
        </span>
      </span>
      <span className="model-switch-notice-line" />
    </div>
  )
}
