import { useEffect, useMemo, useState } from 'react'
import { downloads } from '../content/downloads'
import { detectPlatform, PlatformGuess } from '../lib/platform'
import { RELEASES_URL } from '../lib/links'

export function DownloadPanel() {
  const [guess, setGuess] = useState<PlatformGuess>({
    platform: 'unknown',
    arch: 'unknown',
    label: '识别中…',
  })
  useEffect(() => {
    detectPlatform().then(setGuess)
  }, [])
  const recommended = useMemo(
    () =>
      downloads.find(
        (d) => d.platform === guess.platform && (guess.arch === 'unknown' || d.arch === guess.arch),
      ) ??
      downloads.find((d) => d.platform === guess.platform) ??
      downloads[0],
    [guess],
  )
  return (
    <div className="download-panel">
      <div className="download-recommend">
        <p className="eyebrow">自动识别：{guess.label}</p>
        <h3>推荐下载 {recommended.label}</h3>
        <p>
          {recommended.format} · {recommended.note}
        </p>
        <a className="button primary" href={recommended.href}>
          前往 GitHub Releases
        </a>
      </div>
      <div className="download-table">
        {downloads.map((item) => (
          <a
            className={item.id === recommended.id ? 'download-row active' : 'download-row'}
            href={item.href}
            key={item.id}
          >
            <span>{item.label}</span>
            <span>{item.arch}</span>
            <span>{item.format}</span>
          </a>
        ))}
        <a className="download-row" href={RELEASES_URL}>
          <span>全部版本</span>
          <span>history</span>
          <span>GitHub Releases</span>
        </a>
      </div>
    </div>
  )
}
