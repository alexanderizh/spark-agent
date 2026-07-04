# better-sqlite3 dual-ABI prebuilds

`better_sqlite3.node.node` — built for the system Node.js ABI, used by vitest.
`better_sqlite3.node.electron` — built for this repo's Electron version, used by `pnpm dev` / packaging.

Switch between them with `scripts/sqlite-abi.sh <node|electron>` (repo root). It's a plain file copy — no recompiling, so it's safe to run repeatedly.

## Regenerating after a better-sqlite3 or Electron version bump

1. Node ABI build:
   ```
   cd node_modules/better-sqlite3 && npm run build-release
   cp build/Release/better_sqlite3.node <repo>/vendor/prebuilds/better-sqlite3/better_sqlite3.node.node
   ```
2. Electron ABI build:
   ```
   cd apps/desktop && pnpm run rebuild:native
   cp ../../node_modules/better-sqlite3/build/Release/better_sqlite3.node ../../vendor/prebuilds/better-sqlite3/better_sqlite3.node.electron
   ```
3. Restore whichever ABI you need on disk afterward with `scripts/sqlite-abi.sh <node|electron>`.
