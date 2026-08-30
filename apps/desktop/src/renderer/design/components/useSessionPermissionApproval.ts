import { useCallback, useEffect, useState } from 'react'
import type { PermissionApprovalRequest } from '@spark/protocol'

export function useSessionPermissionApproval(sessionId: string | null) {
  const [approvalRequest, setApprovalRequest] = useState<PermissionApprovalRequest | null>(null)

  useEffect(() => {
    setApprovalRequest(null)
    if (sessionId == null) return

    const unsubscribeRequest = window.spark.on('stream:permission:approval-request', (request) => {
      if (request.sessionId !== sessionId) return
      setApprovalRequest(request)
    })
    const unsubscribeResolved = window.spark.on(
      'stream:permission:approval-resolved',
      (resolved) => {
        if (resolved.sessionId !== sessionId) return
        setApprovalRequest((current) =>
          current?.requestId === resolved.requestId ? null : current,
        )
      },
    )

    return () => {
      unsubscribeRequest()
      unsubscribeResolved()
    }
  }, [sessionId])

  const dismissApprovalRequest = useCallback((requestId: string) => {
    setApprovalRequest((current) => (current?.requestId === requestId ? null : current))
  }, [])

  return { approvalRequest, dismissApprovalRequest }
}
