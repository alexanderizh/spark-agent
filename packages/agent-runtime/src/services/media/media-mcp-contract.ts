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
  providerConfigurations?: Array<{
    id: string
    name: string
    model: string
    provider: string
    modelManifests: Array<{ id: string; modelId: string; capabilities: string[] }>
  }>
  apiEndpoint?: string
}): string {
  const caps =
    input.capabilities.length > 0 ? input.capabilities.join(', ') : 'audio.speech, video.generate'
  const manifestLines = (input.modelManifests ?? []).map(
    (manifest) =>
      `  - ${manifest.id} (${manifest.modelId}): ${manifest.capabilities.join(', ') || 'no declared capabilities'}`,
  )
  const providerLines = (input.providerConfigurations ?? []).flatMap((configuration) => [
    `  - ${configuration.name} [${configuration.id}] — ${configuration.provider}, default ${configuration.model}`,
    ...configuration.modelManifests.map(
      (manifest) =>
        `    - ${manifest.id} (${manifest.modelId}): ${manifest.capabilities.join(', ') || 'no declared capabilities'}`,
    ),
  ])
  return [
    '## Media Generation Capability',
    'The current runtime has configured multimedia models (image / audio / video) and can route each selected model to its owning provider.',
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
    ...(providerLines.length > 0
      ? ['', 'Configured provider/model routes:', ...providerLines]
      : []),
    '',
    'Available tools (call the one matching the user intent):',
    '- `mcp__spark_media__list_models` — inspect configured media models and capabilities.',
    '- `mcp__spark_media__describe_model` — inspect parameter schema before calling a model.',
    '- `mcp__spark_media__generate_image` — text-to-image / image-to-image.',
    '- `mcp__spark_media__edit_image` — edit / compose existing images with a prompt.',
    '- `mcp__spark_media__generate_audio` — text-to-speech or text-to-music, depending on the selected model.',
    '- `mcp__spark_media__transcribe_audio` — audio-to-text transcription.',
    '- `mcp__spark_media__generate_video` — text-to-video / image-to-video.',
    '- `mcp__spark_media__upload_file` — upload/import a file to the configured provider file platform.',
    '- `mcp__spark_media__get_file` / `list_files` — retrieve provider file metadata.',
    '- `mcp__spark_media__delete_file` — delete a provider file after explicit user confirmation.',
    '- `mcp__spark_media__list_tasks` — list asynchronous tasks; Bailian supports the official 24-hour query window.',
    '- `mcp__spark_media__get_task` — inspect a media task returned by generation tools or a Bailian task ID.',
    '- `mcp__spark_media__cancel_task` — cancel a pending/running media task when supported.',
    '',
    'Image generation and image editing may also be available through the active model, SDK, CLI, or executor. Treat `mcp__spark_media__generate_image` and `mcp__spark_media__edit_image` as Spark platform routes, not as replacements for those native capabilities.',
    "For image requests, use these as routing guidelines rather than hard restrictions: normally honor an explicit route choice, but explain and adapt if it is unavailable or clearly unsuitable. When multiple routes are suitable, ask the user only when the choice materially affects quality, cost, latency, privacy, or workflow; otherwise choose a reasonable route without blocking the task. If the user did not specify a route, consider the active model or executor's native image capability first by default, while still using the Spark platform route whenever it better fits the task, native generation is unavailable, or the user selects Spark.",
    '',
    'Before calling `generate_video`, `generate_image`, or `edit_image`, you must call `mcp__spark_media__describe_model` for the selected model/capability unless you already inspected it in this turn.',
    'When the user names a configured model, pass that exact manifest id or model id in the generation tool `model` field. The media server will select the matching provider credentials and endpoint; never substitute the default model silently.',
    'Use the returned `maxImages`, `maxVideos`, `maxAudios`, `rolePolicy`, and parameter schema to tell the user: supported input counts, supported roles (first frame / last frame / reference image/video/audio), and the default role assignment rule.',
    'If the user provides more media inputs than a declared maximum, ask which inputs to keep before generation; do not silently drop extra inputs.',
    'Provider file objects must be active before model use. Files API ids for Chat/Responses understanding must not be passed to media generation endpoints unless that model schema explicitly supports file ids.',
    '',
    'After success, call `mcp__spark_files__present_files` with every generated or edited image, audio, and video file from the structured result.',
    'Returning only a URL or filesystem path is not complete; the application must receive a file card so it can render a preview or playback control.',
    'Do not auto-retry after a provider failure; report the error and suggest model, prompt, or provider-configuration adjustments.',
  ].join('\n')
}
