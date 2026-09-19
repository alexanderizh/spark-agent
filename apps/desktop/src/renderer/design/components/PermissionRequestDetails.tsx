import type { PermissionApprovalRequest } from '@spark/protocol'
import { Icons } from '../Icons'
import { buildPermissionSummary } from './permissionRequestSummary'

export function PermissionRequestDetails({ request }: { request: PermissionApprovalRequest }) {
  const summary = buildPermissionSummary(request)
  const mcpServer = request.mcpServer
  return (
    <div className="permission-request-details">
      <div className="permission-request-intro">
        <Icons.FileText size={16} />
        <div>
          <strong>{summary.heading}</strong>
          <span>{summary.description}</span>
        </div>
      </div>
      {mcpServer != null && (
        <div className="permission-request-mcp">
          {/* 信任判定以 source 为准（sdk=SDK 注册可信）；name 是配置键名，React 已转义 */}
          <span className={`dot-indicator ${mcpServer.source === 'sdk' ? 'green' : ''}`} />
          <span>
            MCP 服务 {mcpServer.name} · 来源 {mcpServer.source}
            {mcpServer.source === 'sdk' ? '（SDK 注册，可信）' : ''}
          </span>
        </div>
      )}
      {summary.items.length > 0 && (
        <div className="permission-request-fields">
          {summary.items.map((item) => (
            <div className="permission-request-field" key={`${item.label}:${item.value}`}>
              <span>{item.label}</span>
              <code title={item.value}>{item.value}</code>
            </div>
          ))}
        </div>
      )}
      <details className="permission-request-technical">
        <summary>
          <Icons.ChevronDown size={14} />
          查看技术详情
        </summary>
        <pre>{JSON.stringify(request.toolInput, null, 2)}</pre>
      </details>
    </div>
  )
}
