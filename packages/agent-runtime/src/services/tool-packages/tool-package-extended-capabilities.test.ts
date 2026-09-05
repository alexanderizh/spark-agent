import { describe, expect, it, vi } from 'vitest'
import { createToolPackageBrowserCapabilities } from './tool-package-browser-capabilities.js'
import { createToolPackageComputerCapabilities } from './tool-package-computer-capabilities.js'
import { createToolPackageMediaCapabilities } from './tool-package-media-capabilities.js'
import { createToolPackageWorkflowCapabilities } from './tool-package-workflow-capabilities.js'
import { ToolHostCapabilityBroker } from './tool-host-capability-broker.js'

const context = {
  packageId: 'acme.extended',
  packageVersion: '1.0.0',
  toolName: 'run',
  invocationId: 'invocation-1',
}

describe('Tool Package extended host capabilities', () => {
  it('registers every capability family and applies confirmation to side effects', async () => {
    const broker = new ToolHostCapabilityBroker()
    const definitions = [
      ...createToolPackageWorkflowCapabilities({
        listWorkflows: vi.fn(async () => ({ workflows: [] })),
        runWorkflow: vi.fn(async (_context, input) => ({ workflowId: input.workflowId })),
        getWorkflowStatus: vi.fn(async (_context, input) => ({ sessionId: input.sessionId })),
      }),
      ...createToolPackageBrowserCapabilities({
        browserListWindows: vi.fn(async () => ({ windows: [] })),
        browserOpen: vi.fn(async (_context, input) => ({ url: input.url })),
        browserNavigate: vi.fn(async (_context, input) => ({ url: input.url })),
        browserScreenshot: vi.fn(async () => ({ image: true })),
        browserInspect: vi.fn(async () => ({ url: 'https://example.com', title: 'Example' })),
        browserEvaluate: vi.fn(async () => ({ result: 2 })),
        browserClose: vi.fn(async () => ({ closed: true })),
      }),
      ...createToolPackageComputerCapabilities({
        computerCapabilities: vi.fn(async () => ({ available: true })),
        computerInvoke: vi.fn(async (_context, action, args) => ({ action, args })),
      }),
      ...createToolPackageMediaCapabilities({
        listMediaModels: vi.fn(async () => ({ providers: [] })),
        generateMedia: vi.fn(async (_context, input) => ({ operation: input.operation })),
      }),
    ]
    definitions.forEach((definition) => broker.register(definition))
    expect(broker.list()).toEqual([
      'browser.automation.close',
      'browser.automation.evaluate',
      'browser.automation.inspect',
      'browser.automation.navigate',
      'browser.automation.open',
      'browser.automation.screenshot',
      'browser.automation.windows',
      'computer.capabilities',
      'computer.execute',
      'computer.inspect',
      'media.generate',
      'media.models',
      'workflows.list',
      'workflows.run',
      'workflows.status',
    ])

    const invoke = (capability: string, input: unknown = {}) =>
      broker.invoke({
        capability,
        declaredCapabilities: new Set([capability]),
        grantedCapabilities: new Set([capability]),
        context,
        input,
      })
    await expect(invoke('workflows.list')).resolves.toEqual({ workflows: [] })
    await expect(
      invoke('computer.inspect', { action: 'list_windows', arguments: {} }),
    ).resolves.toMatchObject({ action: 'list_windows' })
    await expect(
      invoke('media.generate', { operation: 'text_to_image', prompt: 'test' }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_NOT_AUTHORIZED' })

    const authorize = vi.fn(async () => true)
    broker.setInvocationAuthorizer(authorize)
    await expect(
      invoke('media.generate', { operation: 'text_to_image', prompt: 'test' }),
    ).resolves.toEqual({ operation: 'text_to_image' })
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: expect.objectContaining({
          name: 'media.generate',
          supportsCancellation: true,
          requiresCallConfirmation: true,
        }),
      }),
    )
  })

  it('rejects invalid actions and malformed inputs before calling desktop adapters', async () => {
    const computerInvoke = vi.fn(async () => ({}))
    const mediaGenerate = vi.fn(async () => ({}))
    const browserInspect = vi.fn(async () => ({}))
    const broker = new ToolHostCapabilityBroker()
    ;[
      ...createToolPackageBrowserCapabilities({ browserInspect }),
      ...createToolPackageComputerCapabilities({ computerInvoke }),
      ...createToolPackageMediaCapabilities({ generateMedia: mediaGenerate }),
    ].forEach((definition) => broker.register(definition))
    broker.setInvocationAuthorizer(async () => true)
    const invoke = (capability: string, input: unknown) =>
      broker.invoke({
        capability,
        declaredCapabilities: new Set([capability]),
        grantedCapabilities: new Set([capability]),
        context,
        input,
      })
    await expect(
      invoke('computer.execute', { action: 'raw_mouse_click', arguments: {} }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_FAILED' })
    await expect(invoke('browser.automation.inspect', {})).rejects.toMatchObject({
      code: 'CAPABILITY_FAILED',
    })
    await expect(invoke('media.generate', { operation: 'text_to_speech' })).rejects.toMatchObject({
      code: 'CAPABILITY_FAILED',
    })
    expect(computerInvoke).not.toHaveBeenCalled()
    expect(browserInspect).not.toHaveBeenCalled()
    expect(mediaGenerate).not.toHaveBeenCalled()
  })
})
