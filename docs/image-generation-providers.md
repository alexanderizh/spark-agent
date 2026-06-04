# Image Generation Providers

Spark-Agent supports image generation through provider profiles whose `modelType`
is `image`. Image models are not routed through the default Anthropic chat
format. They carry two extra fields:

- `imageProvider`: image API family, for example `openai`, `apimart`,
  `openrouter`, `gemini`, `seeddance`, `bailian`, `zhipu`, `xai`, or `custom`.
- `imageApiType`: invocation mode, one of `sync`, `async`, or `auto`.

Text, coding, multimodal, voice, and video models keep the existing provider
protocol behavior. If a non-image model is saved, Spark clears image-only
configuration from that profile.

## Configuration Flow

1. Open Providers and create or edit a provider.
2. Choose `生图模型` in `模型类型`.
3. Pick the image API source. Spark pre-fills a recommended endpoint and mode
   for common providers.
4. Fill the model ID and API key, then save.

Built-in image presets currently include OpenAI Images, APIMart Images,
OpenRouter Images, Gemini Images, and Volcengine Seedream/Seedance.

## Runtime Behavior

During a Claude SDK turn, Spark looks for the first enabled provider profile
with `modelType=image` and a readable Keychain secret. If one is found, Spark
injects an internal stdio MCP server named `spark_image` and allows:

```text
mcp__spark_image__generate_image
```

The tool writes generated files to:

```text
.spark-artifacts/images
```

inside the active workspace. The tool result returns both local `files` and
displayable `urls` when a URL prefix is configured.

## Agent Usage

Agents receive an appended image-generation system prompt only when a usable
image provider exists. The prompt tells the agent to call the controlled MCP
tool for explicit image requests and not to expose API keys.

The tool accepts:

- `prompt`: detailed image prompt.
- `size`: pixel size, ratio, or semantic size like `portrait`, `landscape`, or
  `square`.
- `n`: number of images, 1 to 4.
- `filename`: optional output filename.
- `extraJson`: provider-specific parameters.

The current implementation uses a global image provider selection. Per-agent
image-model binding can be added later by extending the agent runtime config.
