import { z } from 'zod'
import type {
  ToolHostCapabilityContext,
  ToolHostCapabilityDefinition,
} from './tool-host-capability-broker.js'

const WindowIdSchema = z.string().min(1).max(200)
const BrowserOpenSchema = z.object({
  url: z
    .string()
    .url()
    .max(32_768)
    .refine((url) => /^https?:\/\//iu.test(url), 'Only HTTP(S) URLs are allowed'),
  show: z.boolean().default(true),
  reuse: z.boolean().default(true),
})
const BrowserNavigateSchema = z.object({
  windowId: WindowIdSchema,
  url: z
    .string()
    .url()
    .max(32_768)
    .refine((url) => /^https?:\/\//iu.test(url), 'Only HTTP(S) URLs are allowed'),
})
const BrowserWindowSchema = z.object({ windowId: WindowIdSchema })
const BrowserEvaluateSchema = z.object({
  windowId: WindowIdSchema,
  code: z.string().min(1).max(200_000),
})

export interface ToolPackageBrowserCapabilityDeps {
  browserListWindows?: (context: ToolHostCapabilityContext) => Promise<unknown>
  browserOpen?: (
    context: ToolHostCapabilityContext,
    input: z.infer<typeof BrowserOpenSchema>,
  ) => Promise<unknown>
  browserNavigate?: (
    context: ToolHostCapabilityContext,
    input: z.infer<typeof BrowserNavigateSchema>,
  ) => Promise<unknown>
  browserScreenshot?: (
    context: ToolHostCapabilityContext,
    input: z.infer<typeof BrowserWindowSchema>,
  ) => Promise<unknown>
  browserInspect?: (
    context: ToolHostCapabilityContext,
    input: z.infer<typeof BrowserWindowSchema>,
  ) => Promise<unknown>
  browserEvaluate?: (
    context: ToolHostCapabilityContext,
    input: z.infer<typeof BrowserEvaluateSchema>,
  ) => Promise<unknown>
  browserClose?: (
    context: ToolHostCapabilityContext,
    input: z.infer<typeof BrowserWindowSchema>,
  ) => Promise<unknown>
}

export function createToolPackageBrowserCapabilities(
  deps: ToolPackageBrowserCapabilityDeps,
): ToolHostCapabilityDefinition[] {
  const definitions: ToolHostCapabilityDefinition[] = []
  const listWindows = deps.browserListWindows
  if (listWindows != null)
    definitions.push({
      name: 'browser.automation.windows',
      description: 'List windows in the governed in-app browser.',
      inputSchema: z.toJSONSchema(z.object({})) as Record<string, unknown>,
      outputSchema: { type: 'object' },
      risk: 'read',
      invoke: async (context, input) => {
        z.object({}).parse(input)
        return listWindows(context)
      },
    })
  const open = deps.browserOpen
  if (open != null)
    definitions.push({
      name: 'browser.automation.open',
      description: 'Open a URL in the governed in-app browser.',
      inputSchema: z.toJSONSchema(BrowserOpenSchema) as Record<string, unknown>,
      outputSchema: { type: 'object' },
      risk: 'low-write',
      requiresCallConfirmation: true,
      invoke: async (context, input) => open(context, BrowserOpenSchema.parse(input)),
    })
  const navigate = deps.browserNavigate
  if (navigate != null)
    definitions.push({
      name: 'browser.automation.navigate',
      description: 'Navigate an existing governed browser window.',
      inputSchema: z.toJSONSchema(BrowserNavigateSchema) as Record<string, unknown>,
      outputSchema: { type: 'object' },
      risk: 'low-write',
      requiresCallConfirmation: true,
      invoke: async (context, input) => navigate(context, BrowserNavigateSchema.parse(input)),
    })
  const screenshot = deps.browserScreenshot
  if (screenshot != null)
    definitions.push({
      name: 'browser.automation.screenshot',
      description: 'Capture the current governed browser window.',
      inputSchema: z.toJSONSchema(BrowserWindowSchema) as Record<string, unknown>,
      outputSchema: { type: 'object' },
      risk: 'read',
      sensitiveDataPolicy:
        'Screenshots are returned to the package and are not logged by the broker.',
      invoke: async (context, input) => screenshot(context, BrowserWindowSchema.parse(input)),
    })
  const inspect = deps.browserInspect
  if (inspect != null)
    definitions.push({
      name: 'browser.automation.inspect',
      description: 'Read the URL and title of a governed browser window.',
      inputSchema: z.toJSONSchema(BrowserWindowSchema) as Record<string, unknown>,
      outputSchema: { type: 'object' },
      risk: 'read',
      invoke: async (context, input) => inspect(context, BrowserWindowSchema.parse(input)),
    })
  const evaluate = deps.browserEvaluate
  if (evaluate != null)
    definitions.push({
      name: 'browser.automation.evaluate',
      description: 'Evaluate JavaScript in a governed browser page.',
      inputSchema: z.toJSONSchema(BrowserEvaluateSchema) as Record<string, unknown>,
      outputSchema: { type: 'object' },
      risk: 'high-write',
      requiresCallConfirmation: true,
      sensitiveDataPolicy:
        'Page evaluation may access private page content; source and results are not logged by the broker.',
      invoke: async (context, input) => evaluate(context, BrowserEvaluateSchema.parse(input)),
    })
  const close = deps.browserClose
  if (close != null)
    definitions.push({
      name: 'browser.automation.close',
      description: 'Close a governed in-app browser window.',
      inputSchema: z.toJSONSchema(BrowserWindowSchema) as Record<string, unknown>,
      outputSchema: { type: 'object' },
      risk: 'destructive',
      requiresCallConfirmation: true,
      invoke: async (context, input) => close(context, BrowserWindowSchema.parse(input)),
    })
  return definitions
}
