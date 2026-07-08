import { CodexSdkExecutor } from './codex-sdk-executor.js'

/**
 * Backward-compatible name for older routing/tests. Codex API providers now use
 * the embedded Codex SDK so chat-wire providers keep agent, MCP, and file-tool
 * capabilities instead of falling back to a plain OpenAI chat stream.
 */
export class CodexOpenAIExecutor extends CodexSdkExecutor {}
