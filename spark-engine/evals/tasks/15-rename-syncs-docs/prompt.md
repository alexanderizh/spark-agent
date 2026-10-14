Rename the `pack` CLI's `--outdir` flag to `--dest`. After the change `--outdir` is no longer accepted: `pack` exits non-zero with an unknown-option error. `test/cli.test.mjs` already describes the new behavior; make `node --test test/cli.test.mjs` exit 0.

Do not modify the test or `package.json`.
