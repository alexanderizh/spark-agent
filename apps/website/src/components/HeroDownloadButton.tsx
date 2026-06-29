import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Download } from 'lucide-react'
import { buildDownloadItems } from '../content/downloads'
import { RELEASES_URL } from '../lib/links'
import { detectPlatform, PlatformGuess } from '../lib/platform'
import { useLatestReleases } from '../lib/releases'

const MOBILE_BREAKPOINT = 768

function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < MOBILE_BREAKPOINT
  })
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const update = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches)
    update(mq)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return isMobile
}

export function HeroDownloadButton() {
  const [guess, setGuess] = useState<PlatformGuess>({
    platform: 'unknown',
    arch: 'unknown',
    label: '识别中…',
  })
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()

  const { releases } = useLatestReleases('stable')
  const downloads = useMemo(() => buildDownloadItems(releases), [releases])

  useEffect(() => {
    detectPlatform().then(setGuess)
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const recommended = useMemo(
    () =>
      downloads.find(
        (d) => d.platform === guess.platform && (guess.arch === 'unknown' || d.arch === guess.arch),
      ) ??
      downloads.find((d) => d.platform === guess.platform) ??
      downloads[0],
    [downloads, guess],
  )

  const detected = guess.platform !== 'unknown'
  const mainLabel = detected ? `下载 for ${recommended.label}` : '免费下载'
  const others = downloads.filter((d) => d.id !== recommended.id)

  if (isMobile) {
    return (
      <div className="hero-download hero-download--mobile">
        <Download size={16} strokeWidth={1.8} aria-hidden="true" />
        <span className="hero-download-mobile-hint">
          Spark Agent 目前仅提供桌面端，请前往桌面设备下载使用。
        </span>
        <a className="hero-download-mobile-link" href={RELEASES_URL}>
          查看历史版本
        </a>
      </div>
    )
  }

  return (
    <div className="hero-download" ref={rootRef}>
      <a className="button primary" href={recommended.href}>
        <Download size={17} strokeWidth={1.8} aria-hidden="true" />
        <span className="hero-download-label">{mainLabel}</span>
        {recommended.version && (
          <span className="hero-download-version">v{recommended.version}</span>
        )}
      </a>
      <button
        type="button"
        className={`button primary caret${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="选择其他平台下载"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown size={18} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <div className="hero-download-menu" role="menu">
          <p className="hero-download-hint">
            {detected ? `已识别：${guess.label}` : '未识别到平台，请手动选择'}
          </p>
          {others.map((item) => (
            <a className="hero-download-item" role="menuitem" href={item.href} key={item.id}>
              <span className="hero-download-item-label">{item.label}</span>
              <span className="hero-download-item-meta">
                {item.version ? `v${item.version}` : item.format}
              </span>
            </a>
          ))}
          <span className="hero-download-sep" aria-hidden="true" />
          <a className="hero-download-item" role="menuitem" href={RELEASES_URL}>
            <span className="hero-download-item-label">历史版本</span>
            <span className="hero-download-item-meta">全部版本</span>
          </a>
        </div>
      )}
    </div>
  )
}
