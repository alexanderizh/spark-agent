import type { ParsedShotRow } from './canvasShotTableParse'

type ShotDetail = {
  label: string
  value: string | undefined
}

function ShotDetailStack({ items }: { items: ShotDetail[] }) {
  const visibleItems = items.filter((item) => item.value?.trim())
  if (visibleItems.length === 0) return <span className="canvas-node-shot-empty">—</span>

  return (
    <div className="canvas-node-shot-stack">
      {visibleItems.map((item) => (
        <div className="canvas-node-shot-detail" key={item.label}>
          <span className="canvas-node-shot-detail-label">{item.label}</span>
          <span className="canvas-node-shot-detail-value">{item.value}</span>
        </div>
      ))}
    </div>
  )
}

/** 分镜脚本产物的只读全字段表格，可复用于普通产物节点和操作节点内嵌产物。 */
export function CanvasShotScriptTable({ rows }: { rows: ParsedShotRow[] }) {
  const totalSec = rows.reduce((sum, row) => sum + (row.durationSec ?? 0), 0)
  const hasDuration = rows.some((row) => row.durationSec != null)

  return (
    <div className="canvas-node-shot-table-wrap nowheel">
      <table className="canvas-node-shot-table">
        <colgroup>
          <col className="canvas-node-shot-col-idx" />
          <col className="canvas-node-shot-col-shot" />
          <col className="canvas-node-shot-col-visual" />
          <col className="canvas-node-shot-col-performance" />
          <col className="canvas-node-shot-col-camera" />
          <col className="canvas-node-shot-col-line" />
          <col className="canvas-node-shot-col-char" />
          <col className="canvas-node-shot-col-prompt" />
          <col className="canvas-node-shot-col-negative" />
        </colgroup>
        <thead>
          <tr>
            <th>镜号 / 时长</th>
            <th>镜头</th>
            <th>场景 / 画面</th>
            <th>调度 / 表演</th>
            <th>光色 / 摄影</th>
            <th>对白 / 旁白</th>
            <th>角色 / 造型</th>
            <th>生成提示词</th>
            <th>反向提示词</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, displayIndex) => (
            <tr key={displayIndex}>
              <td className="canvas-node-shot-idx">
                <strong>#{row.index ?? displayIndex + 1}</strong>
                {row.durationSec != null ? (
                  <span className="canvas-node-shot-index-meta">{row.durationSec}s</span>
                ) : null}
                {row.title ? (
                  <span className="canvas-node-shot-index-title">{row.title}</span>
                ) : null}
              </td>
              <td>
                <ShotDetailStack
                  items={[
                    { label: '景别', value: row.shotSize },
                    { label: '角度', value: row.angle },
                    { label: '运镜', value: row.movement },
                  ]}
                />
              </td>
              <td>
                <ShotDetailStack
                  items={[
                    { label: '场次', value: row.groupName },
                    { label: '场景', value: row.sceneName },
                    { label: '布局', value: row.sceneLayout },
                    { label: '画面', value: row.description },
                  ]}
                />
              </td>
              <td>
                <ShotDetailStack
                  items={[
                    { label: '调度', value: row.blocking },
                    { label: '表演', value: row.performance },
                  ]}
                />
              </td>
              <td>
                <ShotDetailStack
                  items={[
                    { label: '焦距', value: row.focalLength },
                    { label: '光圈', value: row.aperture },
                    { label: 'ISO', value: row.iso },
                    { label: '参数', value: row.cameraParams },
                    { label: '光照', value: row.lighting },
                    { label: '色调', value: row.colorTone },
                    { label: '氛围', value: row.mood },
                  ]}
                />
              </td>
              <td>
                <ShotDetailStack
                  items={[
                    { label: '对白', value: row.dialogue },
                    { label: '旁白', value: row.narration },
                  ]}
                />
              </td>
              <td>
                <ShotDetailStack
                  items={[
                    {
                      label: '角色',
                      value:
                        row.characterNames && row.characterNames.length > 0
                          ? row.characterNames.join('、')
                          : undefined,
                    },
                    { label: '造型', value: row.costume },
                  ]}
                />
              </td>
              <td className="canvas-node-shot-prompt">{row.shotPrompt || '—'}</td>
              <td className="canvas-node-shot-negative">{row.negativePrompt || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="canvas-node-shot-foot">
        共 {rows.length} 镜{hasDuration ? ` · 总时长 ${totalSec}s` : ''}
      </div>
    </div>
  )
}
