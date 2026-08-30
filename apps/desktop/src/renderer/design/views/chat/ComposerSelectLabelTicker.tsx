import { useEffect, useRef, useState } from 'react'

/** Animated label shared by compact composer selectors. */
export function ComposerSelectLabelTicker({ label }: { label: string }) {
  const currentRef = useRef(label)
  const [leaving, setLeaving] = useState<string | null>(null)

  useEffect(() => {
    if (label === currentRef.current) return
    setLeaving(currentRef.current)
    currentRef.current = label
    const timer = window.setTimeout(() => setLeaving(null), 260)
    return () => window.clearTimeout(timer)
  }, [label])

  return (
    <span className="composer-select-label-ticker">
      <span key={label} className="composer-select-label-ticker-item is-current">
        {label}
      </span>
      {leaving != null && (
        <span className="composer-select-label-ticker-item is-leaving">{leaving}</span>
      )}
    </span>
  )
}
