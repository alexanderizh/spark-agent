import type { PermissionApprovalRequest } from '@spark/protocol'
import { Icons } from '../Icons'
import { buildPermissionSummary } from './permissionRequestSummary'

export function PermissionRequestDetails({ request }: { request: PermissionApprovalRequest }) {
  const summary = buildPermissionSummary(request)
  return (
    <div className="permission-request-details">
      <div className="permission-request-intro">
        <Icons.FileText size={16} />
        <div><strong>{summary.heading}</strong><span>{summary.description}</span></div>
      </div>
      {summary.items.length > 0 && <div className="permission-request-fields">
        {summary.items.map((item) => <div className="permission-request-field" key={`${item.label}:${item.value}`}>
          <span>{item.label}</span><code title={item.value}>{item.value}</code>
        </div>)}
      </div>}
      <details className="permission-request-technical">
        <summary><Icons.ChevronDown size={14} />查看技术详情</summary>
        <pre>{JSON.stringify(request.toolInput, null, 2)}</pre>
      </details>
    </div>
  )
}
