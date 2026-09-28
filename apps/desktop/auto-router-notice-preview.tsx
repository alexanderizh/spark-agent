import React from 'react'
import { createRoot } from 'react-dom/client'
import { AutoRouterDecisionNotice } from './src/renderer/design/views/chat/AutoRouterDecisionNotice'
import './src/renderer/design/views/chat/ModelSwitchNotice.less'

const decision = {
  id: 'event-1',
  type: 'auto_router_decision' as const,
  sessionId: 'session-1',
  turnId: 'turn-1',
  timestamp: '2026-09-29T00:00:00.000Z',
  seq: 1,
  routerId: 'router-1',
  routerName: '默认分流器',
  intensity: 'high' as const,
  resolvedProviderId: 'provider-1',
  resolvedModelId: 'deepseek-v4.1-flash',
  modelDisplayName: 'deepseek-v4.1-flash',
  reason:
    '分流降级（http｜HTTP 400：Request is missing x-opencode-session and cannot be routed），规则判定为high',
  fallbackUsed: true,
  fallbackStage: 'http' as const,
  latencyMs: 321,
  prevIntensity: 'balanced' as const,
  reasoningEffort: null,
  decompose: false,
}

function Preview() {
  return (
    <main>
      <section>
        <AutoRouterDecisionNotice decision={decision} />
      </section>
    </main>
  )
}

const style = document.createElement('style')
style.textContent = `
  :root { --text-tertiary: #858585; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 80px; background: #fff; font-family: sans-serif; }
  main { width: 560px; border: 1px dashed #ddd; }
`
document.head.appendChild(style)

createRoot(document.getElementById('root')!).render(<Preview />)
