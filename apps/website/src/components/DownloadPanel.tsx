import { useEffect, useMemo, useState } from 'react'
import { Archive, Download, MonitorDown } from 'lucide-react'
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
        <div className="card-icon" aria-hidden="true">
          <MonitorDown size={24} strokeWidth={1.8} />
        </div>
        <h3>推荐下载 {recommended.label}</h3>
        <p>
          {recommended.format} / {recommended.note}
        </p>
        <p>{recommended.install}</p>
        <div className="download-actions">
          <a className="button primary" href={recommended.href}>
            <Download size={17} strokeWidth={1.8} aria-hidden="true" />
            前往 Releases
          </a>
          <a className="button" href="/docs">
            安装文档
          </a>
        </div>
      </div>
      <div className="download-table" aria-label="全部下载平台">
        <div className="download-table-head">
          <Archive size={18} strokeWidth={1.8} aria-hidden="true" />
          <span>全部平台</span>
        </div>
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
          <span>历史版本</span>
          <span>all</span>
          <span>GitHub Releases</span>
        </a>
      </div>
    </div>
  )
}
