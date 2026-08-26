#!/bin/sh
# Spark CLI installer (POSIX sh).
#
#   curl -fsSL https://<host>/install.sh | sh
#   curl -fsSL https://<host>/install.sh | SPARK_INSTALL_BASE=https://<host> sh
#   sh install.sh --base https://<host> [--version 0.1.0] [--tarball ./spark-agent-0.1.0.tgz]
#
# The installer never runs remote shell content beyond this script itself: it
# downloads a versioned npm tarball, verifies its sha256 against the release
# manifest, and installs it with npm. SPARK_INSTALL_TARBALL installs a local
# file with no network download (used by the SparkWork desktop app).

set -eu

PROGRAM=spark
PACKAGE_TARBALL_PREFIX=spark-agent
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=14
NODE_MAX_MAJOR=23
# SYNC CONSTANT — keep identical to DEFAULT_RELEASE_BASE in src/cli/release.ts,
# RELEASE_BASE in scripts/prepare-release.mjs, and $DefaultBase in install.ps1.
DEFAULT_BASE='https://minio.yiqibyte.com/spark-desktop/spark-cli/v1'

BASE=${SPARK_INSTALL_BASE:-$DEFAULT_BASE}
VERSION=${SPARK_INSTALL_VERSION:-}
TARBALL=${SPARK_INSTALL_TARBALL:-}
EXPECTED_SHA=''

usage() {
  cat <<'EOF'
Usage: sh install.sh [--base <url>] [--version <semver>] [--tarball <path>] [--help]

  --base <url>        Release base URL that hosts latest.json and tarballs
                      (default: SPARK_INSTALL_BASE, then the built-in release host)
  --version <semver>  Install a pinned version instead of latest
  --tarball <path>    Install a local npm tarball; no download or manifest needed
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --base) BASE=${2?-missing value for --base}; shift 2 ;;
    --version) VERSION=${2?-missing value for --version}; shift 2 ;;
    --tarball) TARBALL=${2?-missing value for --tarball}; shift 2 ;;
    --help) usage; exit 0 ;;
    *) printf 'install.sh: unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

log() { printf '==> %s\n' "$1"; }
fail() { printf 'install.sh: %s\n' "$1" >&2; exit 1; }

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$1"
  else
    fail 'neither curl nor wget is available; install one of them and retry'
  fi
}

file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  else
    fail 'no sha256 tool found (sha256sum, shasum, or openssl required)'
  fi
}

require_node() {
  command -v node >/dev/null 2>&1 || fail 'node is not installed. Install Node.js >= 22.14 (https://nodejs.org or nvm) and retry.'
  command -v npm >/dev/null 2>&1 || fail 'npm is not installed. Install Node.js >= 22.14 and retry.'
  node_version=$(node -e 'process.stdout.write(process.versions.node)')
  major=$(printf '%s' "$node_version" | cut -d. -f1)
  minor=$(printf '%s' "$node_version" | cut -d. -f2)
  [ "$major" -ge "$NODE_MIN_MAJOR" ] && [ "$major" -lt "$NODE_MAX_MAJOR" ] || \
    fail "node $node_version is outside the supported range >= $NODE_MIN_MAJOR.$NODE_MIN_MINOR < $NODE_MAX_MAJOR. Install a compatible Node.js."
  if [ "$major" -eq "$NODE_MIN_MAJOR" ] && [ "$minor" -lt "$NODE_MIN_MINOR" ]; then
    fail "node $node_version is below the minimum $NODE_MIN_MAJOR.$NODE_MIN_MINOR. Upgrade Node.js and retry."
  fi
  NODE_VERSION=$node_version
}

install_from_tarball() {
  log "Installing $PACKAGE_TARBALL_PREFIX with npm (node $NODE_VERSION)"
  if ! npm install -g --no-audit --no-fund "$1"; then
    printf 'install.sh: npm install -g failed.\nIf this is a permission error, prefer nvm, or set a user prefix:\n  npm config set prefix ~/.npm-global\n' >&2
    exit 1
  fi
}

# Download + verify phase. Sets TARBALL_PATH (local file) and EXPECTED_SHA.
resolve_release() {
  if [ -n "$TARBALL" ]; then
    [ -f "$TARBALL" ] || fail "tarball not found: $TARBALL"
    TARBALL_PATH=$TARBALL
    EXPECTED_SHA=''
    return
  fi
  [ -n "$BASE" ] || fail 'no release base configured. Pass --base <url> or set SPARK_INSTALL_BASE, or use --tarball <path> for offline installs.'
  case "$BASE" in
    http://*|https://*) ;;
    *) fail "--base must be an http(s) URL, got: $BASE" ;;
  esac

  if [ -n "$VERSION" ]; then
    printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' || \
      fail "invalid version: $VERSION"
  else
    log "Resolving the latest release from $BASE"
    manifest=$(fetch "$BASE/latest.json")
    VERSION=$(printf '%s' "$manifest" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
    EXPECTED_SHA=$(printf '%s' "$manifest" | sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{64\}\)".*/\1/p' | head -n 1)
    [ -n "$VERSION" ] || fail 'latest.json does not contain a readable "version"'
    [ -n "$EXPECTED_SHA" ] || fail 'latest.json does not contain a readable "sha256"'
    printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' || \
      fail "latest.json reports an invalid version: $VERSION"
  fi

  archive_url="$BASE/$PACKAGE_TARBALL_PREFIX-$VERSION.tgz"
  workdir=$(mktemp -d "${TMPDIR:-/tmp}/spark-install.XXXXXX")
  cleanup() { rm -rf "$workdir"; }
  trap cleanup EXIT INT TERM
  log "Downloading $archive_url"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$workdir/package.tgz" "$archive_url" || fail "download failed: $archive_url"
  else
    wget -qO "$workdir/package.tgz" "$archive_url" || fail "download failed: $archive_url"
  fi
  TARBALL_PATH=$workdir/package.tgz

  actual_sha=$(file_sha256 "$TARBALL_PATH")
  if [ -z "$EXPECTED_SHA" ]; then
    EXPECTED_SHA=$(fetch "$archive_url.sha256" | awk '{print $1}')
    printf '%s' "$EXPECTED_SHA" | grep -Eq '^[0-9a-f]{64}$' || fail "checksum sidecar is missing or invalid for $VERSION"
  fi
  if [ "$actual_sha" != "$EXPECTED_SHA" ]; then
    fail "checksum mismatch for $VERSION: expected $EXPECTED_SHA, got $actual_sha"
  fi
  log "Checksum verified ($actual_sha)"
}

main() {
  require_node
  resolve_release
  install_from_tarball "$TARBALL_PATH"

  bindir=$(npm prefix -g 2>/dev/null)/bin
  spark_bin=$bindir/$PROGRAM
  if [ ! -e "$spark_bin" ]; then
    printf 'install.sh: install finished but %s was not found in %s.\n' "$PROGRAM" "$bindir" >&2
    exit 1
  fi

  case ":$PATH:" in
    *":$bindir:"*) on_path=yes ;;
    *)
      on_path=no
      log "npm global bin $bindir is not on PATH; linking a launcher instead"
      "$spark_bin" install || printf 'install.sh: spark install could not link a launcher; run `%s doctor` after adding %s to PATH.\n' "$PROGRAM" "$bindir" >&2
      ;;
  esac

  installed_version=$("$spark_bin" --version 2>/dev/null || printf unknown)
  printf 'Spark CLI v%s installed (node %s).\nRun `%s doctor` to verify the setup.\n' "$installed_version" "$NODE_VERSION" "$PROGRAM"
}

main
