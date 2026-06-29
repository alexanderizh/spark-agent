# Remote Connections

Spark Agent supports usable remote channel bridges from Settings -> Remote Connections.
The feature is modeled after the TeamAgentX bridge bot flow: external messages are
normalized by platform adapters, `/bind CODE` pairs the external chat, and all
paired messages are routed into Spark Agent sessions or built-in remote commands.

## Channels

- Telegram bot
- Feishu bot

Each channel can be enabled independently. Multiple channels may remain configured and paired at the same time.

## Configuration Model

Remote connection data is stored in `app_settings` under:

- category: `remote-connections`
- key: `data`

The payload contains global pairing defaults and a list of connection configs. A
connection config includes channel credentials, command prefix, allow lists,
default session/model/provider/agent, enabled remote capabilities, pairing
challenge, and paired devices.

The main process starts a local bridge runtime automatically during IPC handler
registration. The runtime exposes:

- `GET /remote/health`
- `POST /remote/webhook/:channel/:connectionId`

By default the local webhook server listens on `127.0.0.1:32178`. If the port is
already occupied, Spark Agent falls back to a random local port and shows the
actual URL in Settings -> Remote Connections.

Telegram starts local long polling when an enabled Telegram connection has a
valid bot token. Feishu starts an official WebSocket long connection when an
enabled Feishu connection has an App ID and App Secret. These two channels work
without a public webhook URL.

## Pairing

Connections require pairing before they are treated as connected.

1. Save the channel credentials.
2. Generate a pairing code or QR payload.
3. In the external chat, send `/bind CODE`.
4. The bridge validates the code, stores the external chat as a paired device,
   and replies in the same channel.

QR pairing produces a `spark-agent://remote-pair` payload containing the same
connection ID, channel, code, and expiry. Clients that can open that payload may
still complete the same pairing flow.

## Commands

The built-in remote command surface is shared across channels:

- `/help`
- `/sessions`
- `/use-session <sessionId>`
- `/models`
- `/use-model <modelId>`
- `/providers`
- `/use-provider <providerProfileId>`
- `/agents`
- `/use-agent <agentId>`
- `/workspaces`
- `/new-session [workspaceId]`
- `/open-workspace <path>`
- `/send <message>`
- `/status`

Paired inbound messages are handled directly by the main-process bridge runtime:

- messages starting with the configured command prefix run the command handler
- normal messages are sent to the connection's default session through
  `SessionService.sendTurn`
- when no default session is configured, Spark Agent creates a no-project
  session automatically and stores it as the connection default
- default provider/model/agent overrides are applied when configured

The settings page exposes a default session selector so ordinary remote messages
have an explicit destination.

Telegram commands configured in the settings page are synchronized to Telegram
with `setMyCommands` when polling starts.

## Settings UI

Settings -> Remote Connections is organized as a compact management workspace:

- The top runtime strip shows the local webhook base URL, enabled channel count,
  and connected channel count.
- Platform entry cards use bundled real platform assets for Telegram and
  Feishu. Clicking a card creates a draft and opens the matching
  platform console or setup entry.
- The connection list uses consistent cards: platform icon, connection name,
  channel name, status, enabled state, paired device count, and default session
  are always shown in the same positions.
- The editor modal is split into a fixed header, a section navigator, a scrolling
  content pane, and a fixed action bar. Long settings are grouped into Basics,
  Credentials, Authorization, Pairing, and Commands so save/test/delete actions
  remain visible.
- On narrow windows the editor collapses to a single-column layout and hides the
  section navigator.

## Platform Runtime Notes

- Telegram: uses `getUpdates` polling and `sendMessage`.
- Feishu: uses the official WebSocket long connection through
  `@larksuiteoapi/node-sdk`; only App ID and App Secret are required. Use
  `https://open.feishu.cn/page/openclaw?form=multiAgent` as the shortcut entry
  to create a self-built bot app with common capabilities selected. Replies are
  sent through `im/v1/messages`; `chat_id` is the default receive ID type.
  Spark Agent also adds the Feishu `Typing` reaction to the source message when
  a paired message is accepted for processing.

## Bot Creation

The settings page includes one-click draft creation for each channel. This creates a local connection draft and opens the relevant platform console:

- Telegram: BotFather
- Feishu: Feishu openclaw shortcut page

External platforms still require the user to authorize or copy credentials
manually. The one-click action creates a Spark Agent draft and opens the target
platform console.

## Startup

The General settings page now reads and writes Electron login-item settings through:

- `app:get-startup-settings`
- `app:set-startup-settings`

The existing persisted `general.autoStart` value is synchronized with the OS login-item state when the page opens.
