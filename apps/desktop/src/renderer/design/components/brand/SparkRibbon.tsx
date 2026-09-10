import { useEffect, useRef, useState } from 'react'
import logo from '../../../assets/spark-logo.png'
import { mountSparkRibbon } from './spark-ribbon'
import './spark-ribbon.less'

export function SparkRibbon() {
  const ref = useRef<HTMLCanvasElement>(null)
  const [fallback, setFallback] = useState(false)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let cleanup: (() => void) | undefined
    const lost = () => {
      cleanup?.()
      cleanup = undefined
      setFallback(true)
    }
    canvas.addEventListener('webglcontextlost', lost)
    try {
      cleanup = mountSparkRibbon(canvas)
    } catch {
      setFallback(true)
    }
    return () => {
      cleanup?.()
      canvas.removeEventListener('webglcontextlost', lost)
    }
  }, [])
  return (
    <div className="spark-ribbon" aria-hidden="true">
      <canvas ref={ref} style={{ display: fallback ? 'none' : undefined }} />
      {fallback && <img src={logo} alt="" />}
    </div>
  )
}

export function SparkBootSplash({ version, label }: { version: string | null; label: string }) {
  return (
    <div className="spark-boot" role="status" aria-label={label}>
      <div className="spark-boot-content">
        <SparkRibbon />
        {version && <span className="spark-boot-version">v{version}</span>}
      </div>
    </div>
  )
}
