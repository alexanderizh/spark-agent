# Multimedia Model Providers (Image / Voice / Video)

Spark Agent supports unified image, voice, and video generation through a
**media capability registry + platform adapter** architecture. This document
covers APIMart and xAI configuration, the agent `spark_media` MCP, and how the
infinite canvas drives real generation through platform adapters.

> Design reference: [`multimedia-model-platform-adapters-design.md`](./multimedia-model-platform-adapters-design.md)
> Image-only provider docs (legacy `spark_image` MCP): [`image-generation-providers.md`](./image-generation-providers.md)

## 1. Concepts

Every multimedia provider profile carries the following optional fields inside
its `config_json` (all backward compatible):

| Field | Type | Description |
| --- | --- | --- |
| `mediaProvider` | `apimart` \| `xai` \| `openai-compatible` \| `openai-images` \| `google-generative-ai` \| `volcengine-ark` \| `kling` \| `pixverse` \| `minimax-hailuo` \| `wan` \| `happyhorse` \| `omni` \| `custom` | Platform/manifest adapter kind used for routing and diagnostics |
| `mediaApiType` | `sync` \| `async` \| `auto` | sync returns media directly; async polls a task; auto adapts |
| `mediaCapabilities` | `MediaCapabilityId[]` | Declared capabilities (`image.generate`, `audio.speech`, `video.generate`, …) |
| `mediaDefaults` | object | Default size / voice / aspect ratio / polling interval / timeout |
| `mediaModelRefs` | array | Enabled `MediaModelManifest` refs for schema-driven model discovery |

The unified capability ids are:

```text
image.generate · image.edit · image.variations
audio.speech   · audio.transcription
video.generate · video.image_to_video
```

### Media Model Manifest

Spark now has a first-pass model manifest registry:

- Protocol types and zod schemas live in `packages/protocol/src/media-model-manifest.ts`.
- Built-in seeds cover APIMart, xAI, OpenAI Images, Google/Veo, Volcengine Seedance, and placeholder manifests for Kling, PixVerse, Wan, HappyHorse, Omni, and MiniMax-Hailuo.
- SQLite persistence uses `media_model_manifests` and `media_provider_models` (`028_media_model_manifests.sql`).
- `MediaModelCatalogService` seeds built-ins and exposes list/describe/link operations.
- Provider edit UI can load the global manifest catalog (`catalogOnly`) and save
  selected models into `mediaModelRefs`; selected manifest capabilities are also
  mirrored into legacy `mediaCapabilities` for adapter compatibility.

Phase 1 manifests started as capability/schema metadata, and now also drive a
first generic HTTP path. Built-in provider adapters such as APIMart and xAI keep
priority for provider-specific protocols, while `MediaModelManifest` supplies
model discovery, parameter schemas, defaults, and effective `modelId`
selection. Custom or unsupported providers use the manifest-driven template
adapter: it renders `requestTemplate`, applies capability defaults and aliases,
uses the selected `modelId` as the effective model, polls according to
`invocation.polling` when needed, and materializes URL/base64/binary/text
results.

The same manifest path is now available to the agent-facing `spark_media` MCP
server. Generation tools accept an optional `model` argument; when it matches a
manifest id Spark uses that manifest and sends the manifest `modelId` to the
provider, while a provider model id can still be passed directly for advanced
overrides. MCP arguments plus `extraJson` are merged with capability defaults,
then aliases such as `aspectRatio -> aspect_ratio` are applied before rendering
the provider request template.

### Compatibility with legacy image providers

When a provider is saved with `modelType=image`, Spark automatically syncs:

- `mediaProvider` ← `imageProvider`
- `mediaApiType` ← `imageApiType`
- `mediaCapabilities` ← at least `['image.generate']`

The legacy `spark_image` MCP keeps working for image generation; the new
`spark_media` MCP covers image edit, audio speech/transcription, and video.

## 2. Provider Configuration (APIMart / xAI)

1. Open **Providers** and create or edit a provider.
2. Pick `模型类型` → `生图模型` / `语音模型` / `视频模型`.
3. Select a preset (e.g. `APIMart 图片`, `xAI Imagine 视频`, `APIMart 视频 VEO 3`).
   The preset pre-fills endpoint, default model, capabilities, and polling
   defaults.
4. In the **多媒体能力** section:
   - **平台适配器**: `APIMart` / `xAI` / `OpenAI Compatible` / `Custom`.
   - **支持能力**: check the capabilities this provider supports.
   - **调用方式**: `sync` / `async` / `auto`.
   - **参数默认值**: size, n, quality, voice, format, aspect ratio, duration,
     poll interval, poll timeout (all optional).
5. Fill model ID and API key, then save.

### Built-in presets

```text
apimart-images           — APIMart 图片 (GPT Image 2)
apimart-audio-whisper    — APIMart 语音转写 (Whisper)
apimart-audio-tts        — APIMart 语音合成 (TTS)
apimart-video-veo3       — APIMart 视频 (VEO 3, async)
apimart-video-sora2      — APIMart 视频 (Sora 2, async)
xai-imagine-image        — xAI Imagine 图片
xai-imagine-video        — xAI Imagine 视频 (async)
xai-tts                  — xAI 语音合成
```

Default endpoints:

| Provider | Endpoint |
| --- | --- |
| APIMart | `https://api.apimart.ai/v1` |
| xAI | `https://api.x.ai/v1` |

## 3. Agent Skill (spark_media MCP)

When a session has an enabled provider with voice/video media capabilities
(image generation continues to use `spark_image`), Spark injects an internal
stdio MCP server named **`spark_media`** with these tools:

```text
mcp__spark_media__generate_image     — text-to-image / image-to-image
mcp__spark_media__edit_image         — edit / compose existing images
mcp__spark_media__generate_audio     — text-to-speech
mcp__spark_media__transcribe_audio   — audio-to-text transcription
mcp__spark_media__generate_video     — text-to-video / image-to-video
mcp__spark_media__list_models        — list configured media manifests
mcp__spark_media__describe_model     — inspect a model manifest and parameter schema
mcp__spark_media__get_task           — inspect a task returned by generation tools
mcp__spark_media__cancel_task        — cancel pending/running task when supported
```

- API keys are injected only into the local Spark media MCP server process —
  agents never see or reveal credentials.
- Output files land under `.spark-artifacts/media/{images,audio,videos,text}`.
- The agent system prompt is augmented with the configured model, provider,
  endpoint, and declared capabilities only when a usable media provider exists.
- If a provider has `mediaModelRefs`, the session injects those manifests into
  `spark_media` via `SPARK_MEDIA_MANIFESTS_JSON`; otherwise the MCP server falls
  back to a minimal env-derived model description.
- `generate_image`, `edit_image`, `generate_audio`, `transcribe_audio`, and
  `generate_video` can all select a configured manifest through the optional
  `model` parameter. The tool chooses the matching capability
  (`image.generate`, `image.image_to_image`, `image.edit`,
  `audio.speech`, `audio.transcription`, `video.generate`, or
  `video.image_to_video`) from the injected manifest catalog.
- Manifest responses support direct URL/base64/binary results and task-polling
  results. If a task-polling response already includes a result URL, the MCP
  server materializes it immediately; otherwise it extracts the task id, polls
  `statusEndpoint`, then writes the final artifact locally.
- Generation/edit/transcription tools return a local `taskId`. In the current
  MCP process this is an in-memory lifecycle record for `get_task` and
  `cancel_task`; the next runtime step is to back these tools with the shared
  `MediaTaskRuntimeService` repository.

## 4. Infinite Canvas Integration

The infinite canvas drives real media generation through the main process, with
production-grade SQLite persistence and inline media playback:

```text
Renderer (localStorage hot store)
   │ canvas:task:create-media
   ▼
Main process ── MediaRouterService ── Manifest template / APIMart / xAI adapter ── .spark-artifacts/media/*
   │ canvas:snapshot:save (debounced, every mutation)                    │
   ▼                                                                     ▼
SQLite canvas_projects + canvas_snapshots                    safe-file:// protocol
(production persistence, backup, cross-window)               (renderer <audio>/<video>/<img>)
```

### Media playback

Generated artifacts land under `userData/.spark-artifacts/media/{images,audio,videos}`.
The renderer encodes file paths into `safe-file://x/<base64>` URLs (whitelisted
to userData + temp) so `<audio>`, `<video>`, and `<img>` can load them directly
inside canvas nodes — no `file://` webSecurity issues, no need to inline large
base64 blobs. See [`canvas-safe-file.ts`](../apps/desktop/src/renderer/design/views/canvas/canvas-safe-file.ts).

### SQLite persistence

`localStorage` remains the hot store (instant reads/writes). Every mutation
triggers a debounced (500ms) `canvas:snapshot:save` that writes the full project
snapshot to SQLite (`canvas_projects` + `canvas_snapshots` tables, migration 027).
On startup, `hydrateFromStorage` restores any SQLite projects missing from
localStorage. This gives production-grade durability, backup, and cross-window
consistency without rewriting the canvas data layer.

Media generation requests are also persisted in SQLite through
`media_generation_tasks` (migration 029). The first Phase 2 runtime exposes
`submit / submitBackground / inquire / cancel / materialize` through
`MediaTaskRuntimeService`. Canvas media tasks use `submitBackground` by default:
the IPC call returns a persisted `running` runtime task immediately, then the
main process sends exactly one low-frequency completion event when the provider
finishes or fails. Every request records status, provider/model, request id,
assets, raw response summary, and error details.

IPC channels:

```text
canvas:media-capabilities:list   — available media providers + model summaries (no keys)
canvas:media-models:list         — manifest-driven model catalog for canvas/provider parameter panels
canvas:media-models:describe     — full manifest details for one model
canvas:task:create-media         — submit a media generation task; waitForCompletion:false returns immediately
stream:canvas:media-task         — low-frequency media task completion/failure event for canvas writeback
canvas:snapshot:save             — persist project snapshot to SQLite
canvas:snapshot:load             — load project snapshot from SQLite
canvas:project:list              — list persisted projects
canvas:project:delete            — soft/hard delete a project
```

| Canvas operation | Capability | Input | Output |
| --- | --- | --- | --- |
| `text_to_image` | `image.generate` | prompt/text | image |
| `image_to_image` | `image.edit` | image + prompt | image |
| `image_edit` | `image.edit` | image + prompt | image |
| `image_compose` | `image.edit` | images + prompt | image |
| `text_to_audio` | `audio.speech` | text/prompt | audio |
| `audio_transcribe` | `audio.transcription` | audio | text |
| `text_to_video` | `video.generate` | prompt | video |
| `image_to_video` | `video.image_to_video` | image + prompt | video |

Flow:

1. Select a text/prompt node (for text→*) or an image/audio node (for image/audio→*).
2. Open the inline AI composer, pick the operation, optionally choose a
   manifest-backed provider/model, fill the manifest-derived parameter panel,
   then enter the prompt.
3. The canvas creates an optimistic `running` task node.
4. The renderer calls `canvas:task:create-media` with `waitForCompletion:false`.
   The main process persists a runtime task and returns a `running` response
   immediately, so canvas pan/zoom/drag interactions are not blocked by long
   video or image jobs.
5. In the background, the main process resolves
   available providers + API keys (never exposed), selects an adapter via
   `MediaRouterService`, applies the selected `modelId` as the effective model,
   renders manifest templates when available, runs sync or async polling, and
   downloads artifacts.
6. When the runtime task completes/fails/cancels, the main process pushes
   `stream:canvas:media-task` with `projectId`, `clientTaskId`, `runtimeTaskId`,
   status, and the normalized response. The renderer applies it once and writes
   output assets/nodes back to the canvas with provider, model, requestId, and
   raw response metadata.
7. Selecting a task node in the Inspector shows provider/model/request metadata
   and the exact `modelParams` used for that run.

## 5. Error Handling

Unified error codes (returned to the canvas and surfaced in the Inspector):

```text
provider_not_configured
capability_not_supported
api_key_missing
invalid_input
provider_http_error
task_failed
task_timeout
artifact_download_failed
```

- A failed task stays on the canvas with status `failed`; the task node and
  Inspector show the error code and message.
- Async tasks that exceed the polling timeout raise `task_timeout`.

## 6. Testing Without Real API Keys

All adapter behavior is covered by mock `fetch` tests under
`packages/agent-runtime/src/__tests__/services/media/media-adapters.test.ts`.
No real API key is required to run:

```text
pnpm --filter @spark/agent-runtime test:unit
pnpm --filter @spark/desktop typecheck
```

## 7. Extending With New Platforms

To add a new platform (e.g. Runway, Kling, Seedream video, OpenAI Audio):

1. Prefer adding or updating a `MediaModelManifest` first when the provider uses
   JSON submit, optional polling, and URL/base64/binary/text results.
2. Bind the manifest from the provider edit UI (`mediaModelRefs`) so canvas and
   agents can discover its schema.
3. Create `packages/agent-runtime/src/services/media/adapters/<vendor>-media.adapter.ts`
   only when the provider needs custom auth, multipart upload, callback flows,
   file job handling, or provider-specific cancellation.
4. Register dedicated adapters in `MediaRouterService` constructor and add
   provider presets/UI vendor metadata as needed.

The canvas, MCP, and capability registry pick up the new adapter automatically.
