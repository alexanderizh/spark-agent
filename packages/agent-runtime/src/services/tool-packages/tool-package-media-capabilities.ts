import { z } from 'zod'
import type {
  ToolHostCapabilityContext,
  ToolHostCapabilityDefinition,
} from './tool-host-capability-broker.js'

const MediaInputFileSchema = z
  .object({
    path: z.string().min(1).max(4_096).optional(),
    url: z
      .string()
      .url()
      .max(32_768)
      .refine((url) => /^https?:\/\//iu.test(url), 'Media URL must use HTTP(S)')
      .optional(),
    dataUrl: z
      .string()
      .startsWith('data:')
      .max(28 * 1024 * 1024)
      .optional(),
    mimeType: z.string().min(1).max(200).optional(),
    type: z.enum(['image', 'audio', 'video', 'file']),
    role: z.enum(['input', 'first_frame', 'last_frame', 'reference', 'mask']).optional(),
    sizeBytes: z.number().int().min(0).optional(),
    width: z.number().int().min(1).optional(),
    height: z.number().int().min(1).optional(),
    durationMs: z.number().int().min(0).optional(),
  })
  .refine((file) => file.path != null || file.url != null || file.dataUrl != null, {
    message: 'Media input requires path, HTTP(S) url, or dataUrl',
  })

const MediaGenerateSchema = z.object({
  operation: z.enum([
    'text_to_image',
    'image_to_image',
    'image_edit',
    'image_compose',
    'storyboard_grid',
    'panorama_360',
    'text_to_video',
    'image_to_video',
    'video_edit',
    'video_extend',
    'text_to_audio',
  ]),
  prompt: z.string().max(200_000).optional(),
  negativePrompt: z.string().max(100_000).optional(),
  inputFiles: z.array(MediaInputFileSchema).max(20).optional(),
  modelParams: z.record(z.string(), z.unknown()).default({}),
  providerProfileId: z.string().min(1).max(200).optional(),
  manifestId: z.string().min(1).max(300).optional(),
  modelId: z.string().min(1).max(300).optional(),
  capabilityId: z.string().min(1).max(100).optional(),
})

export interface ToolPackageMediaCapabilityDeps {
  listMediaModels?: (context: ToolHostCapabilityContext) => Promise<unknown>
  generateMedia?: (
    context: ToolHostCapabilityContext,
    input: z.infer<typeof MediaGenerateSchema>,
  ) => Promise<unknown>
}

export function createToolPackageMediaCapabilities(
  deps: ToolPackageMediaCapabilityDeps,
): ToolHostCapabilityDefinition[] {
  const definitions: ToolHostCapabilityDefinition[] = []
  const listModels = deps.listMediaModels
  if (listModels != null)
    definitions.push({
      name: 'media.models',
      description: 'List configured media generation models without exposing credentials.',
      inputSchema: z.toJSONSchema(z.object({})) as Record<string, unknown>,
      outputSchema: { type: 'object' },
      risk: 'read',
      invoke: async (context, input) => {
        z.object({}).parse(input)
        return listModels(context)
      },
    })
  const generate = deps.generateMedia
  if (generate != null)
    definitions.push({
      name: 'media.generate',
      description:
        'Generate image, video, speech, or music through the governed Spark media runtime.',
      inputSchema: z.toJSONSchema(MediaGenerateSchema) as Record<string, unknown>,
      outputSchema: { type: 'object' },
      risk: 'high-write',
      supportsCancellation: true,
      requiresCallConfirmation: true,
      invoke: async (context, input) => generate(context, MediaGenerateSchema.parse(input)),
    })
  return definitions
}
