export function MacWindowDragHeader() {
  if (typeof window === 'undefined' || window.spark?.platform !== 'darwin') return null

  return (
    <div
      className="mac-window-drag-header"
      onDoubleClick={() => { window.spark?.invoke('window:maximize', {}).catch(() => {}) }}
    />
  )
}
