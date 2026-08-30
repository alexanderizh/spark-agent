export function MacWindowDragHeader() {
  if (typeof window === 'undefined') return null

  return (
    <div
      className="mac-window-drag-header"
      onDoubleClick={() => { window.spark?.invoke('window:maximize', {}).catch(() => {}) }}
    />
  )
}
