# Runtime Readiness And Context Consistency

## Desktop Runtime Packaging

Spark Agent must not depend on a user's system Node.js/npm/npx installation for built-in runtime capabilities. The managed Playwright MCP server is launched with the Electron executable in Node mode:

- `command`: `process.execPath`
- `env.ELECTRON_RUN_AS_NODE`: `1`
- first arg: packaged `@playwright/mcp/cli.js`

This keeps Playwright MCP available on fresh machines as long as the desktop app was packaged with production `node_modules`. Browser binaries remain optional: the app first uses an app-bundled/Playwright Chromium if present, then falls back to system Chrome/Edge.

## Offline Avatars

Default user and Agent avatars are generated as inline SVG `data:` URLs. Uploaded avatars are still supported, and existing remote URLs still render with the usual image fallback, but new default avatars no longer depend on external avatar generation APIs.

## Config Freshness

Provider and Agent mutations emit `stream:config:changed`. Renderer views that cache provider/agent lists subscribe to this event and refresh immediately:

- chat/session sidebar composer data
- Providers view
- Agents view

Runtime execution reads provider, agent, prompt, skill, MCP, and rule state from SQLite at turn start, so new turns use the latest persisted configuration without app restart.

## Context Consistency

Each turn emits a `turn_prompt_snapshot` event before SDK execution. The snapshot includes the model/provider/adapter and a runtime load checklist for:

- managed Agent prompt
- team context
- active rules
- memory
- system/agent/project/session prompt layers
- project context
- selected skill prompt
- available skills catalog
- conversation history

Long-session history is built from dialogue-related event types instead of a single "latest N events" window. This prevents high-volume tool events from pushing user/assistant messages out of the context reconstruction query.
