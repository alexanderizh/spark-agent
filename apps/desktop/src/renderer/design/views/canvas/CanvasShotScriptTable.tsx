import type { ParsedShotRow } from './canvasShotTableParse'

/** 分镜脚本产物的只读表格，可复用于普通产物节点和操作节点内嵌产物。 */
export function CanvasShotScriptTable({ rows }: { rows: ParsedShotRow[] }) {
  const totalSec = rows.reduce((sum, row) => sum + (row.durationSec ?? 0), 0)
  const hasDuration = rows.some((row) => row.durationSec != null)

  return (
    <div className="canvas-node-shot-table-wrap nowheel">
      <table className="canvas-node-shot-table">
        <colgroup>
          <col className="canvas-node-shot-col-idx" />
          {hasDuration ? <col className="canvas-node-shot-col-dur" /> : null}
          <col className="canvas-node-shot-col-size" />
          <col className="canvas-node-shot-col-move" />
          <col />
          <col className="canvas-node-shot-col-line" />
          <col className="canvas-node-shot-col-char" />
        </colgroup>
        <thead>
          <tr>
            <th>镜号</th>
            {hasDuration ? <th>时长</th> : null}
            <th>景别</th>
            <th>运镜</th>
            <th>画面 / 动作</th>
            <th>对白</th>
            <th>角色</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, displayIndex) => (
            <tr key={displayIndex}>
              <td className="canvas-node-shot-idx">#{row.index ?? displayIndex + 1}</td>
              {hasDuration ? (
                <td className="canvas-node-shot-dur">
                  {row.durationSec != null ? `${row.durationSec}s` : '—'}
                </td>
              ) : null}
              <td className="canvas-node-shot-size">{row.shotSize || '—'}</td>
              <td className="canvas-node-shot-move">{row.movement || '—'}</td>
              <td className="canvas-node-shot-desc">
                {row.title ? <div className="canvas-node-shot-title">{row.title}</div> : null}
                {row.description || row.narration ? (
                  <div>
                    {row.description}
                    {row.narration ? (
                      <span className="canvas-node-shot-narr">旁白：{row.narration}</span>
                    ) : null}
                  </div>
                ) : null}
              </td>
              <td className="canvas-node-shot-line">{row.dialogue || '—'}</td>
              <td className="canvas-node-shot-char">
                {row.characterNames && row.characterNames.length > 0
                  ? row.characterNames.join('、')
                  : '—'}
              </td>
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
