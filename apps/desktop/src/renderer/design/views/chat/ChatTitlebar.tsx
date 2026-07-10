import React from 'react'
import { useApp } from '../../AppContext'
import { SidebarExpandButton } from '../../SidebarExpandButton'
import { WindowControls } from '../../components/WindowControls'

const rendererPlatform = typeof window !== 'undefined' ? window.spark?.platform : undefined
const isRendererWin32 = rendererPlatform === 'win32'

export function ChatTitlebarStart({ onExpandSidebar }: { onExpandSidebar?: () => void }) {
  const { t } = useApp()

  if (!t.sidebarHidden) return null

  return (
    <div className="chat-titlebar-start">
      <SidebarExpandButton {...(onExpandSidebar ? { onExpand: onExpandSidebar } : {})} />
    </div>
  )
}

export function ChatTitlebarEnd() {
  if (!isRendererWin32) return null

  return (
    <div className="chat-titlebar-end">
      <WindowControls />
    </div>
  )
}
