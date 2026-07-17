export const SPARK_MEDIA_TOOL_NAMES = [
  'mcp__spark_media__list_models',
  'mcp__spark_media__describe_model',
  'mcp__spark_media__generate_image',
  'mcp__spark_media__edit_image',
  'mcp__spark_media__generate_audio',
  'mcp__spark_media__transcribe_audio',
  'mcp__spark_media__generate_video',
  'mcp__spark_media__upload_file',
  'mcp__spark_media__get_file',
  'mcp__spark_media__list_files',
  'mcp__spark_media__delete_file',
  'mcp__spark_media__list_tasks',
  'mcp__spark_media__get_task',
  'mcp__spark_media__cancel_task',
] as const

export function buildMediaGenerationSystemPrompt(input: {
  name: string
  model: string
  provider: string
  apiType: string
  outputDir: string
  capabilities: string[]
  modelManifests?: Array<{ id: string; modelId: string; capabilities: string[] }>
  apiEndpoint?: string
}): string {
  const caps =
    input.capabilities.length > 0 ? input.capabilities.join(', ') : 'audio.speech, video.generate'
  const manifestLines = (input.modelManifests ?? []).map(
    (manifest) =>
      `  - ${manifest.id} (${manifest.modelId}): ${manifest.capabilities.join(', ') || 'no declared capabilities'}`,
  )
  return [
    '## Media Generation Capability',
    'The current runtime has a configured multimedia model (image / audio / video).',
    'Credentials are injected only into the local media MCP server — never ask for or reveal API keys.',
    '',
    `- Configuration name: ${input.name}`,
    `- Model ID: ${input.model}`,
    `- Platform adapter: ${input.provider}`,
    `- Invocation mode: ${input.apiType}`,
    `- API base URL: ${input.apiEndpoint ?? '(provider default)'}`,
    `- Declared capabilities: ${caps}`,
    `- Output directory: ${input.outputDir}`,
    ...(manifestLines.length > 0 ? ['', 'Configured model manifests:', ...manifestLines] : []),
    '',
    'Available tools (call the one matching the user intent):',
    '- `mcp__spark_media__list_models` — inspect configured media models and capabilities.',
    '- `mcp__spark_media__describe_model` — inspect parameter schema before calling a model.',
    '- `mcp__spark_media__generate_image` — text-to-image / image-to-image.',
    '- `mcp__spark_media__edit_image` — edit / compose existing images with a prompt.',
    '- `mcp__spark_media__generate_audio` — text-to-speech.',
    '- `mcp__spark_media__transcribe_audio` — audio-to-text transcription.',
    '- `mcp__spark_media__generate_video` — text-to-video / image-to-video.',
    '- `mcp__spark_media__upload_file` — upload/import a file to the configured provider file platform.',
    '- `mcp__spark_media__get_file` / `list_files` — retrieve provider file metadata.',
    '- `mcp__spark_media__delete_file` — delete a provider file after explicit user confirmation.',
    '- `mcp__spark_media__list_tasks` — list asynchronous tasks; Bailian supports the official 24-hour query window.',
    '- `mcp__spark_media__get_task` — inspect a media task returned by generation tools or a Bailian task ID.',
    '- `mcp__spark_media__cancel_task` — cancel a pending/running media task when supported.',
    '',
    'Before calling `generate_video`, `generate_image`, or `edit_image`, you must call `mcp__spark_media__describe_model` for the selected model/capability unless you already inspected it in this turn.',
    'Use the returned `maxImages`, `maxVideos`, `maxAudios`, `rolePolicy`, and parameter schema to tell the user: supported input counts, supported roles (first frame / last frame / reference image/video/audio), and the default role assignment rule.',
    'If the user provides more media inputs than a declared maximum, ask which inputs to keep before generation; do not silently drop extra inputs.',
    'Provider file objects must be active before model use. Files API ids for Chat/Responses understanding must not be passed to media generation endpoints unless that model schema explicitly supports file ids.',
    '',
    'After success, show the generated `files` from the structured result. Local file paths can be shown as Markdown links.',
    'Do not auto-retry after a provider failure; report the error and suggest model, prompt, or provider-configuration adjustments.',
  ].join('\n')
}
