import { GitHubRuntimeAdapter } from './adapters/github-runtime.adapter.js'
import { GoogleWorkspaceRuntimeAdapter } from './adapters/google-runtime.adapter.js'
import { NotionRuntimeAdapter } from './adapters/notion-runtime.adapter.js'
import { ObsidianRuntimeAdapter } from './adapters/obsidian-runtime.adapter.js'
import type { RuntimeBroker } from './runtime-broker.js'

export function registerBuiltinRuntimeAdapters(broker: RuntimeBroker): void {
  broker.register(new GitHubRuntimeAdapter())
  broker.register(new GoogleWorkspaceRuntimeAdapter())
  broker.register(new NotionRuntimeAdapter())
  broker.register(new ObsidianRuntimeAdapter())
}
