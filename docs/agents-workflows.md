# Agents and Workflows

Spark Agent now supports managed agent profiles and workflow graphs.

## Agent Profiles

The built-in `platform-manager-agent` is the default agent for new conversations. Spark only ships this one built-in agent by default; custom agents can be created from the Agents page and configured with:

- default provider, model, adapter, permission mode, and reasoning effort
- agent prompt
- rule selection
- enabled and disabled skills
- MCP server allow-list
- agent-specific hook overrides for permission requests, user questions, session completion, and failures
- optional workflow binding

From the Agents page, each profile's `快速对话` entry now opens a lightweight project picker before the conversation starts. Users can jump straight into an existing project, create a brand-new project, or enter a temporary chat; the newly opened session is always created with the selected agent instead of reusing the previous project's context by accident.

When a conversation uses an agent, `sessions.agent_id` stores the selected profile. The session runtime patch carries `agentId`, so queued and follow-up turns keep the same agent unless the user changes it.

In the sidebar, the `临时会话` group now behaves more like a normal project group: selecting one of those sessions also switches the active workspace to the no-project context, and the group header exposes a quick-create action plus a small operations menu for creating another temporary session or opening the temporary workspace folder.

## Workflow Graphs

Workflows are stored in `workflows.graph_json` as:

- `nodes`: visual nodes with `kind`, title, position, and config
- `edges`: directed connections between nodes

Node configuration supports prompts, provider/model preference, skill IDs, rule IDs, built-in tool IDs, MCP server IDs, permission mode, retry count, and phase metadata. The visual editor lets users drag nodes, add node kinds, connect nodes, and edit node configuration.

The Workflows view is split into two surfaces:

- a card list page for creating, refreshing, and selecting workflows
- a detail orchestration page for editing one workflow graph with the node palette, canvas, and inspector

This keeps workflow selection out of the graph editor, so the canvas has enough space for practical node arrangement.

## Runtime Behavior

If an agent has a workflow, the runtime injects a `[Workflow Execution Plan]` section into the system prompt. Nodes are topologically ordered from the graph edges. Node-level model, skill, rule, tool, MCP, and permission settings are treated as preferred phase configuration.

On the Claude SDK path, Spark now exposes `mcp__spark_team__workflow_run` whenever the workflow graph contains executable nodes. That tool runs the managed workflow for the current objective, persists `workflow_runs` snapshots for resume/audit, dispatches `agent` / `subagent` nodes through the team dispatcher, and executes host-side atomic nodes such as `input`, `approval`, and `verify`. Atomic-only workflows can run through the same tool, so they no longer depend on prompt-only behavior.

On the Codex path, Spark does not expose `workflow_run`. Instead, the workflow stays as a structured execution prompt: Codex is instructed to follow the graph in topological order, preserve node intent, and report the blocking node if it cannot complete the active path.

Runtime rules are injected as a `[Runtime Rules]` section. This includes active system/project rules, project instruction files, selected agent rules, and workflow node rules. Agent-level skill selections are included in the runtime skill catalog, and agent/workflow MCP selections filter the MCP servers passed to the SDK. If no MCP allow-list is configured, all enabled MCP servers remain available.

Agent-specific hooks are optional. When enabled on an agent, they override global hook settings for sessions running that agent. When disabled, global hook settings remain the fallback.

Current SDK execution is still one host turn per user message. When `workflow_run` is available, the host uses one tool call to drive the graph execution and child dispatches. Node model switching remains a preference/override on each dispatched worker rather than a fully separate host SDK run per node.

## Platform Management Tools

Every session receives the built-in `spark_platform` MCP server. The platform manager skill documents the full `mcp__spark_platform__*` surface and should be updated whenever tools are added or removed.

The platform tool surface currently covers:

- Skills: list, load, search, install, GitHub install, uninstall, toggle
- MCP servers: list, create, update, delete, status
- Providers: list, get, create, update, delete, health check, set default, set default model
- Workflows: list, get, create, update, delete
- Agents: list, get, create, update, delete
- Teams: list, get, create, update, delete
- Settings: get, set, category get, get all
- Sessions: get, switch model/provider/mode/permission/reasoning effort
- Board tasks: list, get, create, update, delete, batch operations, restore, permanent delete

Team CRUD is exposed through `mcp__spark_platform__teams_*` and persists long-lived team definitions in `agent_teams`. Agents should use `agents_list` to resolve host/member IDs before calling `teams_create` or `teams_update`.

## Team Mode (Agent-to-Agent)

Team Mode lets a **Host agent** delegate focused subtasks to **Member agents** during a single conversation, and renders the collaboration as an IM-style group chat. See the full design in `团队模式开发.md`.

### Enabling

In the Composer's agent picker, choose **团队模式（多 Agent 协作）**. The picker label becomes `团队模式 · <Host>`, a **成员 N** chip appears, and the Inspector shows a **团队成员** section where you toggle which agents may be dispatched in this session.

Team config is stored per session in `sessions.metadata.team` (`enabled / hostAgentId / memberAgentIds / maxDepth / allowNesting`) and mirrored to `composer-prefs` as the global last-used default. It is also submitted with each turn via `session:send-turn`'s `teamConfig`.

Saved teams are stored separately in `agent_teams`. They can be created from the Agents view's Teams tab or by the platform management tools, then selected from the Agent Picker as reusable Team Mode presets.

### How dispatch works

1. The Host turn injects an in-process MCP server `spark_team` exposing the tool `mcp__spark_team__agent_dispatch`, plus a `[Team Roster]` system-prompt section listing available members. The built-in `Task` tool is disabled so all A2A goes through the dispatcher.
2. When the Host calls `agent_dispatch`, `TeamDispatchService` validates (member enabled, depth, per-turn budget of 5), persists a `team_dispatches` row, emits `team_dispatch_requested`, and queues member execution per turn. This keeps multiple member calls from racing the same workspace/session files.
3. The member runs a one-shot turn with its own provider/model/skills/MCP and an isolated Claude SDK `sdkSessionId`. Its streaming `assistant_message` events are rebranded to `team_member_message` (tagged with `dispatchId`) so the UI renders every member as a peer message row with its own square avatar, name, and content.
4. On completion, a structured `TeamA2AReply` is returned to the Host (and emitted as `team_dispatch_completed`). The Host decides whether to dispatch again or synthesize a final answer.

### Avatars & timeline UI

- Agent avatars are stored in `agents.metadata.avatar`; user avatars are stored in the `general.data.userAvatar` setting.
- The default avatar source is a DiceBear URL (`https://api.dicebear.com/9.x/{style}/svg?seed={nickname}`), and users can upload a local image that is cropped client-side to a 256px square data URL.
- Team member output is no longer visually nested under the Host. Dispatch events appear as lightweight status rows, raw `mcp__spark_team__agent_dispatch` tool JSON is hidden from the main timeline, and each `team_member_message` renders as an independent chat row: avatar on the left, agent name above the message body.
- `team_member_message` deltas and completes are merged by `dispatchId`, so a final complete event cannot duplicate an already-streamed answer.

### Nesting & limits

- `allowNesting=false` (default): members cannot dispatch. With `allowNesting=true`, a member receives `spark_team` at depth+1 and may dispatch while `depth < maxDepth` (max 3).
- Soft budget of 5 dispatches per turn; exceeding it returns a `Dispatch budget exceeded` error to the Host.
- Each dispatch has a default 120s timeout (max 600s). Cancelling the session aborts all in-flight dispatches.

### Events

Team Mode adds four events to the `AgentEvent` union, distinct from the SDK's built-in `subagent_*` events: `team_dispatch_requested`, `team_member_message`, `team_member_status`, `team_dispatch_completed`. History can be queried via `team:list-dispatches`.
