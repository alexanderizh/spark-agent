# Spark Agent Engine

`@spark/agent` is a deterministic, event-sourced coding agent engine with two first-class entry surfaces today:

- `spark` CLI and terminal UI;
- an embeddable TypeScript SDK.

A versioned App Server protocol for hosts such as SparkWork is planned for M3. Until then,
`spark serve` exits with an explicit unsupported-command message instead of starting a server.

The package is intentionally self-contained. It does not import or depend on any SparkWork workspace package.

## Requirements

- Node.js `>=22.14.0 <23`
- npm 10 or newer

## Development

```bash
npm install
npm run verify
npm run build
node dist/cli/main.js --help
```

## Installing the `spark` command

Three equivalent paths put `spark` on PATH:

- one-line installer from the static release server (the built-in release base below is compiled into the CLI, installers, and scripts — override anytime with `--base <url>` / `-Base <url>` / `SPARK_INSTALL_BASE`):

  ```bash
  # macOS / Linux — latest release
  curl -fsSL https://raw.githubusercontent.com/alexanderizh/spark-agent/spark-cli-releases/install.sh | sh
  ```

  ```powershell
  # Windows PowerShell
  irm https://raw.githubusercontent.com/alexanderizh/spark-agent/spark-cli-releases/install.ps1 | iex
  ```

  The installer enforces the Node engine range, downloads the versioned tarball, verifies its sha256 against the release manifest (`latest.json` or the `.sha256` sidecar for pinned versions), installs it with npm, and — when the npm global bin is not on PATH — falls back to `spark install` for the `~/.spark/bin` launcher. `--tarball <path>` / `SPARK_INSTALL_TARBALL` installs a local file with no download (the hook the SparkWork desktop app uses for its future install button). Build the distributable directory with `node scripts/prepare-release.mjs [out-dir]` (tarball + `.sha256` + `latest.json`); upload it to any static host.

- `npm install -g @spark/agent` — the bin is managed by npm;
- from any install location (cloned repo, unpacked tarball, local folder): `spark install` links a launcher into `~/.spark/bin` (override with `--bin <dir>`). On Unix it is a symlink to the package entry, so in-place package updates flow through automatically; on Windows it writes a `spark.cmd` shim.

`spark install` never depends on the working directory: the package root is located from the running code itself and verified by package name. It refuses to overwrite a foreign file at the launcher path unless `--force` is passed, prints the exact `export PATH=...` (or `fish_add_path`) line when the bin directory is not on PATH, and warns when another `spark` appears earlier on PATH. `spark uninstall` removes only launchers that provably belong to spark.

## Updating spark

```bash
spark update --check          # report only; deterministic exit codes
spark update                  # upgrade to the latest release
spark upgrade                 # alias of update
spark update --target 1.2.3   # pin an exact version (checksum via .sha256 sidecar)
spark update --allow-prerelease
spark update --json           # machine-readable one-line status
```

Exit codes: `0` an update is available or was applied · `1` up to date, remote older, or prerelease gated · `2` usage error · `3` check or upgrade failed · `4` another update is in progress.

Every check downloads a strictly validated `latest.json` (package identity must be `@spark/agent`, strict SemVer version, lowercase hex sha256, deterministic tarball name) over https — loopback http is accepted only for local testing. Redirects that leave the release origin are refused; size caps and timeouts bound every response. Before anything is touched, the downloaded tarball is checksum-verified, its embedded `package.json` identity/version must match the manifest, and its `engines.node` must accept the running Node.

The upgrade itself is transactional: install into a staging prefix inside the npm global tree, verify the staged CLI reports the expected version, then swap the whole staged package directory by rename with the previous installation snapshotted first (dependencies ride inside the package) — any later failure (version probe, `spark doctor`, launcher relink) rolls everything back, so a failed update always leaves the previous spark runnable. A cross-process lock at `~/.spark/update.lock` serializes concurrent updates: a live owner is always honored, a provably dead owner (ESRCH) is retaken immediately, and a lock older than 15 minutes is removed and retaken so a crashed or recycled-pid updater can never wedge updates permanently.

Source precedence for where updates come from: `--base/--target` flags > `SPARK_RELEASE_BASE`/`SPARK_INSTALL_BASE`/`SPARK_INSTALL_VERSION` env > `[update]` in `~/.spark/config.toml` (`base_url`, `version`) > built-in release host. The channel is deliberately steered only by flags/env/global config: a repo-local `.spark/config.toml` may toggle `[update] enabled` for the daily notice but its `base_url`/`version` are ignored by design, so a checked-out project can never hijack the update path.

Interactive TUI sessions print a one-line notice on stderr when a newer release exists. The notice checks at most once per day (cached in `~/.spark/update-check.json`), is skipped entirely for `--json`/`--plain`/piped/CI runs, and is disabled with `SPARK_UPDATE_CHECK=0` or `[update] enabled = false`. An unreachable release host never blocks startup or turns.

## Uninstalling spark

```bash
spark uninstall               # remove the ~/.spark/bin launcher only
spark uninstall --package     # full removal: npm package + proven bin shims + launcher
```

`spark uninstall --package` removes only what provably belongs to spark — the `@spark/agent` package in the npm global tree, its bin shims there, and the `~/.spark/bin` launcher. It never deletes `~/.spark` configuration, sessions, or caches, never follows into foreign packages sharing the tree, and never touches a third-party `spark` found elsewhere on PATH (it is reported instead). Running it twice is safe (`absent`). This intentionally does not uninstall the code this command executes from when installed via `npm link` development setups — remove those with `npm unlink -g @spark/agent`.

## Publishing a release (maintainers)

```bash
node scripts/prepare-release.mjs [out-dir]
```

produces the immutable release set: `spark-agent-<version>.tgz` (npm pack), its `<...>.sha256` sidecar, the three installers, and `latest.json`. Versioned artifacts are immutable — republishing the same version with different bytes is a hard error; bump `package.json` instead.

Publishing is GitHub-native and credential-free: the release workflow commits the directory to the `spark-cli-releases` branch, whose raw URLs (`https://raw.githubusercontent.com/alexanderizh/spark-agent/spark-cli-releases/...`) are exactly what installers, `spark update`, and the public verifier consume. All versions coexist on that branch, so pinned installs of old releases keep working; `latest.json` is the only mutable pointer and is committed last. Raw CDN caching means a just-published version can take up to five minutes to become visible everywhere.

```bash
node scripts/verify-release.mjs [dir] [--base <url>]   # public HTTPS check against any base
```

`scripts/release-contract.mjs` carries the shared schema/base-URL contract for all tools; CI runs prepare → publish-to-branch → verify in the spark-engine publish workflow.

## Recovering from a failed update

If an updater was killed mid-transaction, the next `spark update` restores consistency automatically from its snapshot before proceeding. If automatic restore was impossible (e.g. permissions), the error message names the backup directory to move back manually. `spark doctor` shows the resolved PATH entry's version versus the running one — a stale launcher after manual repair is reported as version drift.

First run without local configuration: `spark` still opens the TUI and shows the model picker — SparkWork routes (live catalog), locally configured models, and a terminal provider-configuration wizard (`c`). The wizard writes a local provider into `~/.spark/config.toml` referencing credentials only by environment-variable name; nothing secret is ever stored. `/model` reopens the picker between turns (a running turn keeps its model). Non-interactive invocations (`--plain`, `--json`, piped prompts) stay fail-fast with actionable guidance. `spark init` remains for scripting; `spark doctor` reports the resolved `spark` on PATH (broken links, version drift, shadowing), stale SparkWork bridge descriptors, and Node engine compliance.

## Interactive session controls

The TUI keeps a persistent status line under the input box — model · permission mode · reasoning effort · token/cost tally — so you always know what will run before you type.

| Command   | Action                                                    |
| --------- | --------------------------------------------------------- |
| `/model`  | Open the model picker (SparkWork routes + local channels) |
| `/perm`   | Switch permission policy for this session                 |
| `/effort` | Cycle reasoning effort: auto → off → low → medium → high  |
| `/status` | Session id, queued turns, event count, current controls   |
| `/clear`  | Start a fresh session                                     |
| `/help`   | Command reference (Tab completes any prefix)              |

Permission switching is session-scoped: `/perm` opens a picker over `default` → `acceptEdits` → `plan` → `bypass`. The destructive `bypass` entry demands a second Enter to arm, and single-key cycling never reaches it — bypass requires going through the picker or launching with `--permission-mode bypass`. A new session falls back to its config snapshot.

Reasoning effort (`/effort`, or `--effort off|low|medium|high` on one-shot runs) maps onto each protocol's native control: Anthropic receives a thinking-token budget (4k/12k/32k), the OpenAI Responses API receives the matching `reasoning.effort`. `auto` leaves the provider default untouched.

Plan mode composes an approval loop with the policy switch: a turn run under `plan` sees only read-only tools; when it finishes with a proposal on screen, the TUI shows it back bounded to twelve lines — **Enter** approves the plan, switches the session to `acceptEdits`, and immediately executes with full tooling; **Esc** keeps iterating in plan mode.

Approvals remain fail-closed: every side-effecting tool call renders a card with the exact arguments, policy reason, and risk class, offering allow-once, allow-for-session (when the policy grants that scope), and deny; Esc always denies.

## Model configuration

Spark reads `~/.spark/config.toml` and then project `.spark/config.toml`. Provider credentials are referenced by environment-variable name and are never stored in the config or session snapshot.

When SparkWork is running, the CLI also discovers its currently enabled Provider/model catalog through an authenticated loopback host bridge. SparkWork remains the credential owner: provider API keys stay in its Keychain/encrypted vault and are never copied into CLI configuration or fact events. Selection precedence is CLI flag / environment / project config, then the SparkWork default route, then global config.

```toml
[agent]
model = "primary"
failover = []
max_retries = 2

[providers.openai]
protocol = "openai-responses"
base_url = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"

[models.primary]
provider = "openai"
model = "your-model-id"
```

Anthropic uses `protocol = "anthropic-messages"` and defaults to `ANTHROPIC_API_KEY`. Select another configured model with `spark --model <id>` or `SPARK_MODEL=<id>`.

```bash
spark "inspect this repository and run the relevant tests"
spark --json --model primary "explain the current failure"
spark --permission-mode plan "design the change without editing files"
spark models
spark doctor
```

The production CLI/TUI requires a configured real model. `FakeModel`, `VirtualFileSystem`, and `FakeShell` remain exported only as deterministic SDK test seams.

Built-in workspace tools are `read`, `glob`, `grep`, `write`, `edit`, and `bash`. File writes are atomic and require the SHA-256 revision returned by `read` when replacing an existing file.

Permission modes are `default`, `acceptEdits`, `plan`, and `bypass`. `plan` hides and rejects tools with side effects. `bypass` requires the explicit `--permission-mode bypass` or `--dangerously-skip-permissions` flag and prints a danger warning. Every policy result is persisted as a `permission.evaluated` fact event.
