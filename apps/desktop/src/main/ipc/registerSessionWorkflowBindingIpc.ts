import type { SessionService } from '@spark/agent-runtime'
import { typedIpcHandle } from './typed-ipc.js'

export function registerSessionWorkflowBindingIpc(input: {
  getSessionService: () => SessionService
  onChanged: (sessionId: string, bindingInstanceId: string) => void
}): void {
  typedIpcHandle('session:get-workflow-binding', async (request) =>
    input.getSessionService().getWorkflowBinding(request.sessionId),
  )
  typedIpcHandle('session:set-workflow-binding', async (request) => {
    const response = input.getSessionService().setWorkflowBinding(request)
    if (response.changed && response.binding != null) {
      input.onChanged(request.sessionId, response.binding.bindingInstanceId)
    }
    return response
  })
}
