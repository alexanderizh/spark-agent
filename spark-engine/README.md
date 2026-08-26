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

- one-line installer, once release artifacts are hosted on a static file server:

  ```bash
  curl -fsSL <base>/install.sh | SPARK_INSTALL_BASE=<base> sh     # macOS / Linux
  powershell -File install.ps1 -Base <base>                        # Windows
  ```

  The installer enforces the Node engine range, downloads the versioned tarball, verifies its sha256 against the release manifest (`latest.json` or the `.sha256` sidecar for pinned versions), installs it with npm, and — when the npm global bin is not on PATH — falls back to `spark install` for the `~/.spark/bin` launcher. `--tarball <path>` / `SPARK_INSTALL_TARBALL` installs a local file with no download (the hook the SparkWork desktop app uses for its future install button). Build the distributable directory with `node scripts/prepare-release.mjs [out-dir]` (tarball + `.sha256` + `latest.json`); upload it to any static host.

- `npm install -g @spark/agent` — the bin is managed by npm;
- from any install location (cloned repo, unpacked tarball, local folder): `spark install` links a launcher into `~/.spark/bin` (override with `--bin <dir>`). On Unix it is a symlink to the package entry, so in-place package updates flow through automatically; on Windows it writes a `spark.cmd` shim.

`spark install` never depends on the working directory: the package root is located from the running code itself and verified by package name. It refuses to overwrite a foreign file at the launcher path unless `--force` is passed, prints the exact `export PATH=...` (or `fish_add_path`) line when the bin directory is not on PATH, and warns when another `spark` appears earlier on PATH. `spark uninstall` removes only launchers that provably belong to spark.

First run without local configuration: if SparkWork is running, its default model is selected automatically and no credentials are copied anywhere. If SparkWork is not running, `spark init` writes a credential-free starter `~/.spark/config.toml` (all examples reference `api_key_env`); the CLI then falls back to that standalone configuration. `spark doctor` reports the resolved `spark` on PATH (broken links, version drift, shadowing), stale SparkWork bridge descriptors, and Node engine compliance.

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
