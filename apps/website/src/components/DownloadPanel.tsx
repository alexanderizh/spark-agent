import { useEffect, useMemo, useState } from 'react'
import { Archive, Download, MonitorDown } from 'lucide-react'
import { buildDownloadItems } from '../content/downloads'
import { RELEASES_URL, OPEN_SOURCE_ENABLED } from '../lib/links'
import { detectPlatform, PlatformGuess } from '../lib/platform'
import { useLatestReleases } from '../lib/releases'

function formatBytes(bytes: number | null): string {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function DownloadPanel() {
  const [guess, setGuess] = useState<PlatformGuess>({
    platform: 'unknown',
    arch: 'unknown',
    label: '识别中…',
  })
  useEffect(() => {
    detectPlatform().then(setGuess)
  }, [])

  const { releases } = useLatestReleases('stable')
  const downloads = useMemo(() => buildDownloadItems(releases), [releases])

  const recommended = useMemo(() => {
    // 1) 已知架构时精确匹配 platform + arch
    if (guess.arch !== 'unknown') {
      const exact = downloads.find(
        (d) => d.platform === guess.platform && d.arch === guess.arch,
      )
      if (exact) return exact
    }
    // 2) Mac 上架构无法识别（Safari/Firefox 无 userAgentData、Chrome 隐私模式等）
    //    时，默认回退到 x64：Intel 用户必须拿 x64 才能跑（arm64 完全无法运行），
    //    Apple Silicon 用户拿 x64 还能通过 Rosetta 兜底——这是更安全的默认值。
    //    与 HeroDownloadButton 中的逻辑保持一致。
    if (guess.platform === 'mac') {
      return (
        downloads.find((d) => d.platform === 'mac' && d.arch === 'x64') ??
        downloads[0]
      )
    }
    // 3) 其他平台 / 完全未识别：取同平台首项，否则取数组首项
    return (
      downloads.find((d) => d.platform === guess.platform) ?? downloads[0]
    )
  }, [downloads, guess])

  return (
    <div className="download-panel">
      <div className="download-recommend">
        <p className="eyebrow">自动识别：{guess.label}</p>
        <div className="card-icon" aria-hidden="true">
          <MonitorDown size={24} strokeWidth={1.8} />
        </div>
        <h3>
          推荐下载 {recommended.label}
          {recommended.version && (
            <span className="download-version-tag"> · v{recommended.version}</span>
          )}
        </h3>
        <p>
          {recommended.format}
          {recommended.fileSize ? ` · ${formatBytes(recommended.fileSize)}` : ''} /{' '}
          {recommended.note}
        </p>
        <p>{recommended.install}</p>
        <div className="download-actions">
          <a className="button primary" href={recommended.href}>
            <Download size={17} strokeWidth={1.8} aria-hidden="true" />
            {recommended.hasRelease ? '立即下载' : '查看历史版本'}
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
            <span>
              {item.version ? `v${item.version}` : item.format}
              {item.fileSize ? ` · ${formatBytes(item.fileSize)}` : ''}
            </span>
          </a>
        ))}
        {OPEN_SOURCE_ENABLED && (
          <a className="download-row" href={RELEASES_URL}>
            <span>历史版本</span>
            <span>all</span>
            <span>版本中心</span>
          </a>
        )}
      </div>
    </div>
  )
}
