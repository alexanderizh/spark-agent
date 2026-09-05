import { Tag } from '@lobehub/ui'
import type { ToolPackageDetail } from '@spark/protocol'

export function ToolPackageToolList({ detail }: { detail: ToolPackageDetail }) {
  return (
    <section className="tp_section">
      <div className="tp_sectionHeading">
        <strong>包内工具</strong>
        <span className="tp_muted">{detail.manifest.tools.length} 个</span>
      </div>
      {detail.manifest.guidance != null && (
        <div className="tp_guidance">
          {detail.manifest.guidance.overview != null && <p>{detail.manifest.guidance.overview}</p>}
          {detail.manifest.guidance.prerequisites != null && (
            <p>前置条件：{detail.manifest.guidance.prerequisites.join('；')}</p>
          )}
          {detail.manifest.guidance.sharedInstructions != null && (
            <p>共享说明：{detail.manifest.guidance.sharedInstructions}</p>
          )}
        </div>
      )}
      <div className="tp_toolList">
        {detail.manifest.tools.map((tool) => (
          <details className="tp_tool" key={tool.name}>
            <summary>
              <span>
                <strong>{tool.title}</strong>
                <code>{tool.name}</code>
              </span>
              <span className="tp_toolTags">
                <Tag>{tool.risk}</Tag>
                <Tag>{tool.effect}</Tag>
                <Tag>{tool.idempotency}</Tag>
              </span>
            </summary>
            <p>{tool.description}</p>
            {tool.guidance?.whenToUse != null && <p>适用：{tool.guidance.whenToUse.join('；')}</p>}
            {tool.guidance?.whenNotToUse != null && (
              <p>不适用：{tool.guidance.whenNotToUse.join('；')}</p>
            )}
            {tool.guidance?.instructions != null && <p>操作说明：{tool.guidance.instructions}</p>}
            {tool.guidance?.resultSemantics != null && (
              <p>结果语义：{tool.guidance.resultSemantics}</p>
            )}
            <div className="tp_schemaGrid">
              <div>
                <div className="tp_subsectionTitle">输入 Schema</div>
                <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
              </div>
              <div>
                <div className="tp_subsectionTitle">输出 Schema</div>
                <pre>
                  {tool.outputSchema == null
                    ? '未声明（接受任意 JSON 结果）'
                    : JSON.stringify(tool.outputSchema, null, 2)}
                </pre>
              </div>
            </div>
            {tool.guidance?.examples != null && tool.guidance.examples.length > 0 && (
              <div>
                <div className="tp_subsectionTitle">示例</div>
                <pre>{JSON.stringify(tool.guidance.examples, null, 2)}</pre>
              </div>
            )}
          </details>
        ))}
      </div>
    </section>
  )
}
