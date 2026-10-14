# Spark CLI programming evals

Headless programming cases for the self-built `spark` CLI (`@spark/agent` in `spark-engine/`). The runner copies each fixture into a temp directory, points a temp project config at an OpenAI-Responses or Anthropic-compatible model, and records pass/fail, latency, and tool-call notes.

This suite does not launch Cursor CLI, Codex CLI, or Claude Code, and it does not claim a comparison against them. A later run with live credentials and those CLIs installed can add that comparison. Reports from this runner stay out of git.

## CLI map

| Surface          | Path                                                          | Role                                                                                 |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Package          | `spark-engine/` (`@spark/agent`)                              | Self-contained engine. It does not import SparkWork workspace packages.              |
| CLI bin          | `spark` → `spark-engine/dist/cli/main.js` (`src/cli/main.ts`) | One-shot tasks, TUI, `doctor`, `models`, config, MCP, memory, plans, todos.          |
| SDK              | `spark-engine/dist/index.js` (`src/index.ts`)                 | In-process `Agent` used by tests and by the desktop host.                            |
| Desktop host     | `packages/agent-runtime/src/sdk/spark-engine/`                | SparkWork embeds the same built SDK. Build `spark-engine` before the desktop bundle. |
| Fake-model smoke | `scripts/spark-engine-smoke.mjs`                              | Loads the SDK with `FakeModel`. Not a capability eval.                               |

`spark serve` is still an explicit unsupported command. One-shot automation uses `-p` / a positional prompt.

### Build and invoke

From the repo root (Node `>=22.14.0 <23`):

```bash
pnpm install --frozen-lockfile --filter @spark/agent...
pnpm --filter @spark/agent run build
node spark-engine/dist/cli/main.js --help
node spark-engine/dist/cli/main.js --version
```

Or inside `spark-engine/`: `npm install && npm run build && node dist/cli/main.js --help`.

A one-shot task that can edit files without an approval prompt:

```bash
node spark-engine/dist/cli/main.js \
  --permission-mode bypass \
  --effort off \
  --output-format stream-json \
  --model ark \
  -p "fix the failing test"
```

`--output-format json` prints one final result object. `--output-format stream-json` prints persisted events plus live deltas as JSONL; tool calls are `tool.call` / `tool.result` records. Default text mode writes only the final answer to stdout. `--json` is the older event JSONL stream.

Permission modes are `manual` (default), `auto`, and `bypass`. `bypass` is required for this harness because stdin is not a TTY and an approval prompt would hang until timeout. The flag is also spelled `--dangerously-skip-permissions`.

### Model env and config

The CLI does not read `ARK_*` itself. It reads `~/.spark/config.toml` and `<cwd>/.spark/config.toml` (project wins). Credentials are an environment-variable **name** in `api_key_env`, never the secret. `SPARK_HOME` moves the `~/.spark` data root. `SPARK_MODEL` selects a configured model id when `--model` is absent (`--model` wins). `SPARK_UPDATE_CHECK=0` skips the release notice.

Supported provider protocols are only the two the CLI implements. This harness does not add a Chat Completions adapter.

- `openai-responses` — the CLI posts `{base}/responses` after ensuring a `/v1` segment. A base that already ends in `/v1` is the supported shape: `https://api.openai.com/v1` becomes `https://api.openai.com/v1/responses`. Any other root gets `/v1` inserted first, so `https://example.test` becomes `https://example.test/v1/responses`. The default key variable is `OPENAI_API_KEY`.
- `anthropic-messages` — exactly one `/v1/messages` call. A root, a `…/v1` URL, or a full `…/v1/messages` URL are all accepted. The default key is `ANTHROPIC_API_KEY`, with `ANTHROPIC_AUTH_TOKEN` as a fallback unless `api_key_env` names a variable explicitly.

Volcengine Ark bases in this repo are not that Responses root:

| Base                                              | In-repo meaning                                                                                                                      | This harness                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `https://ark.cn-beijing.volces.com/api/coding`    | Anthropic Coding Plan (`volcengine-ark-anthropic` in `packages/protocol/src/provider-presets.ts`)                                    | Allowed only with `SPARK_EVAL_PROTOCOL=anthropic-messages`. The CLI calls `…/api/coding/v1/messages`. |
| `https://ark.cn-beijing.volces.com/api/coding/v3` | OpenAI Coding preset. The desktop client posts `…/v3/responses` for responses, or `…/v3/chat/completions` when the wire API is chat. | Refused. The CLI joiner would post `…/v3/v1/responses`, and there is no chat adapter to send instead. |
| `https://ark.cn-beijing.volces.com/api/v3`        | Chat Completions (`volcengine-ark-seed21`, `codexApiKind: chat`)                                                                     | Refused on `openai-responses`. The CLI would post `…/api/v3/v1/responses`.                            |

`--dry-run` and a live run both exit `2` for a refused base. They do not write config or a report. Setting `SPARK_EVAL_PROTOCOL=openai-responses` explicitly does not override the refusal; the protocol has to be one the CLI can actually address, or the base has to already end in `/v1`.

Other CLI env vars that are not the eval contract: `SPARK_FAILOVER_MODELS`, `SPARK_RELEASE_BASE`, `SPARK_INSTALL_BASE`, `SPARK_EDUGEN_BASE_URL`, `SPARK_WEB_LOGIN_URL`.

## What already exists in the repo

| Location                                                | What it measures                                                            | Live model |
| ------------------------------------------------------- | --------------------------------------------------------------------------- | ---------- |
| `spark-engine/test/`                                    | Engine invariants, CLI parsing, tools, permissions. Models are `FakeModel`. | No         |
| `scripts/spark-engine-smoke.mjs`                        | SDK text turn, `read` tool, session resume.                                 | No         |
| `packages/agent-runtime/src/services/memory/__evals__/` | Memory write-gate and FTS recall. See `BASELINE.md`.                        | No         |
| `spark-engine/evals/`                                   | This harness. Real `spark` CLI process per fixture.                         | Opt-in     |

No in-repo suite was running the `spark` binary against programming fixtures before this directory.

## Tasks

Each task is a directory under `tasks/<id>/` with `task.json`, `prompt.md`, `grade.mjs`, `oracle.mjs`, and a `workspace/` fixture. `oracle.mjs` is only for `--self-test`. The model never sees it. Graders check behavior. The runner additionally hashes `frozen` files and, where `requireTools` is set, requires a matching tool call in the stream.

| Id                       | Capability                | Pass condition                                                                            |
| ------------------------ | ------------------------- | ----------------------------------------------------------------------------------------- |
| `01-file-edit`           | file edit                 | `sum` adds; the test file is unchanged                                                    |
| `02-multi-file-refactor` | multi-file refactor       | `formatName` becomes `formatDisplayName` across `src/`; `greet()` still passes            |
| `03-terminal-command`    | terminal                  | `out/token.txt` matches `node bin/token.mjs`, and a `bash` call ran that script           |
| `04-test-run-loop`       | test-run loop             | `parsePort` satisfies the existing test, and a `bash` call ran that test                  |
| `05-git-diff-hygiene`    | git / diff hygiene        | `clamp` is fixed, HEAD is unchanged, the scratch line in `notes.txt` stays unstaged       |
| `06-error-recovery`      | error recovery            | `node src/main.js` prints `ready:3`; the YAML comment is a decoy; `src/main.js` stays put |
| `07-long-context`        | long-context instructions | `SPEC.md` section 4 (`ID:…\|ROLE:…`) wins over the abandoned JSON draft in section 9      |
| `08-create-from-spec`    | file create               | new `src/slug.js` matches `SPEC.md` and the untouched test                                |

`07` is a few hundred lines, enough to bury the contract under background notes. It is not a 100k-token stress test; grow `SPEC.md` in place when that becomes the question.

`--self-test` proves each unfixed fixture fails its grader and each oracle passes without editing frozen files. It does not start the CLI and does not need a key. Required tool-call checks are unit-tested in `harness.test.mjs` and applied on live runs.

## Run

Install and build first (see above). Then:

```bash
export ARK_BASE_URL='https://your-responses-host/v1'
export ARK_API_KEY='your-key'
export ARK_MODEL='your-model-id'
# optional:
# export SPARK_EVAL_PROTOCOL=openai-responses   # or anthropic-messages
# export SPARK_EVAL_EFFORT=off                  # off|low|medium|high|max
# export SPARK_EVAL_TIMEOUT_MS=180000

cd spark-engine
npm run eval:self-test          # no key; graders and endpoint helpers
node evals/run.mjs --dry-run    # prints the resolved URL and config; hides the key
node evals/run.mjs              # all tasks
node evals/run.mjs --task 01-file-edit --task 03-terminal-command
```

From the repo root the same commands are `pnpm --filter @spark/agent run eval:self-test` and `node spark-engine/evals/run.mjs`.

`--dry-run` and a live run both require the three `ARK_*` variables to be set. The runner writes them into a temp `<workspace>/.spark/config.toml` as `api_key_env = "ARK_API_KEY"` plus `base_url` and the model id. The key value is passed only through the child environment. Reports redact it when it shows up in streamed tool args or output. Do not put the key in `ARK_BASE_URL` (userinfo and credential query params are rejected) and do not commit `.env` files.

A live run is sequential. The default timeout is 180s (240s for `07-long-context`). Override with `--timeout` or `SPARK_EVAL_TIMEOUT_MS`. `SPARK_EVAL_CONTEXT_WINDOW` (default 128000) and `SPARK_EVAL_MAX_TOKENS` (default 16000) are written into the temp model entry. `SPARK_BIN` overrides the CLI path. `SPARK_EVAL_OUT` sets the report directory (default `spark-engine/evals/reports/<timestamp>/`, gitignored). `SPARK_EVAL_KEEP=1` keeps a copy of each workspace under that report; those copies can contain whatever the model wrote, so leave them uncommitted.

Each live task:

1. Copies `workspace/` to a temp directory (the monorepo is not the cwd).
2. Runs `setup.mjs` when the task has one (`05` creates a local git repo).
3. Writes the temp Spark config, with web search, web fetch, task subagents, and memory disabled so the case stays local.
4. Sets `SPARK_HOME` and `HOME` to a temp directory, and `SPARK_UPDATE_CHECK=0`.
5. Runs the built CLI with `--permission-mode bypass`, `--effort` from `SPARK_EVAL_EFFORT` (default `off`, so a gateway that rejects `reasoning.effort` still gets a plain request), and `--output-format stream-json`.
6. Grades the workspace and writes `report.json` plus `report.md`.

Exit codes: `0` all selected tasks passed (or `--list` / `--self-test` / `--dry-run` succeeded), `1` a task or self-test failed, `2` usage or missing configuration.

### Report

`report.json` is the source of truth. For each task it stores `passed`, `latencyMs` (CLI wall time only), `exitCode`, `turnStatus` (`completed`, `failed`, `cancelled`, `timeout`, or `unknown`), `toolCounts`, and `toolNotes` (`tool`, `ok`, `durationMs`, truncated `argsPreview`, truncated `resultPreview`). `report.md` is the same information as a table. Neither file is a leaderboard against another agent.

A task passes only when the CLI exits 0, the turn status is `completed`, every grader check passes, frozen files are unchanged, and required tool calls were observed. Fixing the files and then crashing is a fail.

### Safety

`bypass` plus the `bash` tool is not a sandbox. The shell starts in the temp workspace, and a command can still reach anything the OS user can reach. Run live evals on a disposable machine or CI runner. The runner itself only writes the temp copy, the temp `SPARK_HOME`, and the report directory.

CI runs `npm run eval:self-test` in the Spark engine job. It does not call a model.

## Later comparison

A fair run against Cursor CLI, Codex CLI, and Claude Code is not this harness. When that comparison happens, use these same tasks and the same graders, pin one reasoning effort for every CLI, and repeat each task at least three times. A single live pass/fail is not a ranking.

## Adding a task

1. Create `tasks/<id>/` whose `task.json` `id` matches the directory name.
2. Put the starting tree in `workspace/`, including `"type": "module"` in `package.json` so copied `.js` files stay ESM outside this package.
3. Add `prompt.md`, `grade.mjs` (print `{ "ok", "checks": [{ "name", "passed", "detail" }] }` via `finish()`), and `oracle.mjs`.
4. List files the model must not touch in `frozen`. Add `requireTools` only for capabilities that are the tool call itself.
5. Run `npm run eval:self-test` and confirm the unfixed fixture fails and the oracle passes.
