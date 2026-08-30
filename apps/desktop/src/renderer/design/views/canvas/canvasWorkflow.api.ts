import type {
  CanvasWorkflowArchiveRequest,
  CanvasWorkflowCreateRequest,
  CanvasWorkflowDefinition,
  CanvasWorkflowDuplicateRequest,
  CanvasWorkflowListRequest,
  CanvasWorkflowUpdateRequest,
  CanvasWorkflowExecutionPlan,
  CanvasWorkflowRun,
  CanvasWorkflowRunCreateRequest,
  CanvasWorkflowRunListRequest,
  CanvasWorkflowRunStepUpdateRequest,
  CanvasWorkflowVersion,
} from '@spark/protocol'

export const canvasWorkflowApi = {
  async listPage(request: CanvasWorkflowListRequest = {}): Promise<{
    workflows: CanvasWorkflowDefinition[]
    total: number
    hasMore: boolean
  }> {
    return window.spark.invoke('canvas:workflow:list', request)
  },

  async list(request: CanvasWorkflowListRequest = {}): Promise<CanvasWorkflowDefinition[]> {
    const response = await this.listPage(request)
    return response.workflows
  },

  async get(id: string): Promise<CanvasWorkflowDefinition | null> {
    const response = await window.spark.invoke('canvas:workflow:get', { id })
    return response.workflow
  },

  async create(request: CanvasWorkflowCreateRequest): Promise<CanvasWorkflowDefinition> {
    const response = await window.spark.invoke('canvas:workflow:create', request)
    return response.workflow
  },

  async update(request: CanvasWorkflowUpdateRequest): Promise<CanvasWorkflowDefinition> {
    const response = await window.spark.invoke('canvas:workflow:update', request)
    return response.workflow
  },

  async duplicate(request: CanvasWorkflowDuplicateRequest): Promise<CanvasWorkflowDefinition> {
    const response = await window.spark.invoke('canvas:workflow:duplicate', request)
    return response.workflow
  },

  async archive(request: CanvasWorkflowArchiveRequest): Promise<CanvasWorkflowDefinition> {
    const response = await window.spark.invoke('canvas:workflow:archive', request)
    return response.workflow
  },

  async delete(id: string): Promise<boolean> {
    const response = await window.spark.invoke('canvas:workflow:delete', { id })
    return response.deleted
  },

  async publish(id: string): Promise<{ workflow: CanvasWorkflowDefinition; version: CanvasWorkflowVersion }> {
    return window.spark.invoke('canvas:workflow:publish', { id })
  },

  async listVersions(workflowId: string, limit = 100, offset = 0): Promise<CanvasWorkflowVersion[]> {
    const response = await window.spark.invoke('canvas:workflow:version:list', {
      workflowId,
      limit,
      offset,
    })
    return response.versions
  },

  async createRun(
    request: CanvasWorkflowRunCreateRequest,
  ): Promise<{ run: CanvasWorkflowRun; plan: Readonly<CanvasWorkflowExecutionPlan> }> {
    return window.spark.invoke('canvas:workflow:run:create', request)
  },

  async listRuns(request: CanvasWorkflowRunListRequest): Promise<CanvasWorkflowRun[]> {
    const response = await window.spark.invoke('canvas:workflow:run:list', request)
    return response.runs
  },

  async getRun(id: string): Promise<CanvasWorkflowRun | null> {
    const response = await window.spark.invoke('canvas:workflow:run:get', { id })
    return response.run
  },

  async updateRunStep(request: CanvasWorkflowRunStepUpdateRequest): Promise<CanvasWorkflowRun> {
    const response = await window.spark.invoke('canvas:workflow:run:step-update', request)
    return response.run
  },

  async cancelRun(id: string): Promise<CanvasWorkflowRun> {
    const response = await window.spark.invoke('canvas:workflow:run:cancel', { id })
    return response.run
  },

  async retryRunStep(id: string, nodeId: string): Promise<CanvasWorkflowRun> {
    const response = await window.spark.invoke('canvas:workflow:run:retry', { id, nodeId })
    return response.run
  },

  async resumeRun(id: string): Promise<{
    run: CanvasWorkflowRun
    plan: Readonly<CanvasWorkflowExecutionPlan>
  }> {
    return window.spark.invoke('canvas:workflow:run:resume', { id })
  },
}
