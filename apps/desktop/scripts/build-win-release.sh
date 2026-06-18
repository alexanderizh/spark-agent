#!/usr/bin/env bash
#
# Local/CI signed Windows release build.
#
# Usage:
#   ./scripts/build-win-release.sh [arch] [electron-builder publish args...]
#
# Examples:
#   WIN_CSC_LINK=/path/to/cert.pfx \
#   WIN_CSC_KEY_PASSWORD=secret \
#   ./scripts/build-win-release.sh x64 --publish never
#
#   WIN_CSC_LINK="$(base64 -i cert.pfx)" \
#   WIN_CSC_KEY_PASSWORD=secret \
#   ./scripts/build-win-release.sh x64 --publish always
#
# If WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD are missing, the build continues
# unsigned so Windows installer packaging can still be tested locally and in CI.
set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }
step()  { echo -e "\n${CYAN}========== $* ==========${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

ARCH="${1:-x64}"
if [ "$#" -gt 0 ]; then
  shift
fi
BUILDER_ARGS=("$@")

TMP_DIR=""
WINDOWS_SIGNING_MODE="unsigned"
cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

is_windows_runner() {
  [ "${RUNNER_OS:-}" = "Windows" ] || [[ "$(uname -s 2>/dev/null || true)" =~ MINGW|MSYS|CYGWIN ]]
}

absolute_path() {
  local input="$1"
  local dir
  dir="$(cd "$(dirname "$input")" && pwd)"
  echo "$dir/$(basename "$input")"
}

builder_cert_path() {
  local input="$1"
  if is_windows_runner && command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$input"
  else
    echo "$input"
  fi
}

prepare_windows_signing() {
  step "1/4 Windows signing environment"

  if [ -z "${WIN_CSC_LINK:-}" ] || [ -z "${WIN_CSC_KEY_PASSWORD:-}" ]; then
    warn "WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD not set; Windows installer will be built unsigned"
    unset WIN_CSC_LINK WIN_CSC_KEY_PASSWORD CSC_LINK CSC_KEY_PASSWORD
    export -n WIN_CSC_LINK WIN_CSC_KEY_PASSWORD CSC_LINK CSC_KEY_PASSWORD 2>/dev/null || true
    WINDOWS_SIGNING_MODE="unsigned"
    return
  fi

  WINDOWS_SIGNING_MODE="signed"

  if ! is_windows_runner; then
    warn "This is not a Windows runner. electron-builder may package Windows artifacts cross-platform, but Authenticode signing is expected to run on Windows."
  fi

  case "$WIN_CSC_LINK" in
    http://*|https://*|data:*)
      ok "Using WIN_CSC_LINK as remote/data certificate reference"
      ;;
    *)
      local local_cert_path="$WIN_CSC_LINK"
      if [ ! -f "$local_cert_path" ] && command -v cygpath >/dev/null 2>&1; then
        local maybe_unix_path
        maybe_unix_path="$(cygpath -u "$WIN_CSC_LINK" 2>/dev/null || true)"
        if [ -n "$maybe_unix_path" ] && [ -f "$maybe_unix_path" ]; then
          local_cert_path="$maybe_unix_path"
        fi
      fi

      if [ -f "$local_cert_path" ]; then
        local_cert_path="$(absolute_path "$local_cert_path")"
        WIN_CSC_LINK="$(builder_cert_path "$local_cert_path")"
        ok "Using local Windows signing certificate: $WIN_CSC_LINK"
      else
        TMP_DIR="$(mktemp -d)"
        local pfx_path="$TMP_DIR/windows-signing-cert.pfx"
        WIN_CSC_LINK="$WIN_CSC_LINK" node - "$pfx_path" <<'NODE'
const fs = require('fs')
const output = process.argv[2]
const raw = (process.env.WIN_CSC_LINK || '').trim()
const base64 = raw.replace(/^data:.*?;base64,/, '').replace(/\s+/g, '')
const bytes = Buffer.from(base64, 'base64')
if (!bytes.length) {
  throw new Error('decoded WIN_CSC_LINK is empty')
}
fs.writeFileSync(output, bytes)
NODE
        [ -s "$pfx_path" ] || fail "Decoded WIN_CSC_LINK is empty; expected a base64 encoded .pfx"
        WIN_CSC_LINK="$(builder_cert_path "$pfx_path")"
        ok "Decoded WIN_CSC_LINK base64 to temporary .pfx"
      fi
      ;;
  esac

  export WIN_CSC_LINK
  export WIN_CSC_KEY_PASSWORD
  export CSC_LINK="$WIN_CSC_LINK"
  export CSC_KEY_PASSWORD="$WIN_CSC_KEY_PASSWORD"
  ok "Windows signing variables are ready"
}

verify_windows_signature() {
  step "5/5 Verify Windows signature"

  local exe_path
  exe_path="$(find dist -maxdepth 1 -type f -iname "*.exe" 2>/dev/null | head -1)"
  [ -n "$exe_path" ] || fail "No Windows .exe artifact found in dist/"

  echo "  Artifact: $exe_path"

  if [ "$WINDOWS_SIGNING_MODE" != "signed" ]; then
    warn "Unsigned Windows build requested; skipping required signature validation"
    return
  fi

  if ! is_windows_runner; then
    warn "Skipping Authenticode verification outside Windows"
    return
  fi

  local ps_cmd=""
  if command -v pwsh >/dev/null 2>&1; then
    ps_cmd="pwsh"
  elif command -v powershell.exe >/dev/null 2>&1; then
    ps_cmd="powershell.exe"
  elif command -v powershell >/dev/null 2>&1; then
    ps_cmd="powershell"
  else
    fail "PowerShell is required to verify Authenticode signatures on Windows"
  fi

  local verify_path="$exe_path"
  if command -v cygpath >/dev/null 2>&1; then
    verify_path="$(cygpath -w "$exe_path")"
  fi

  "$ps_cmd" -NoProfile -Command '
param([string]$Path)
$sig = Get-AuthenticodeSignature -FilePath $Path
Write-Host ("  Status : {0}" -f $sig.Status)
Write-Host ("  Message: {0}" -f $sig.StatusMessage)
if ($sig.SignerCertificate) {
  Write-Host ("  Subject: {0}" -f $sig.SignerCertificate.Subject)
  Write-Host ("  Issuer : {0}" -f $sig.SignerCertificate.Issuer)
}
if ($sig.Status -ne "Valid") {
  exit 1
}
' "$verify_path"
  ok "Authenticode signature is valid"
}

step "0/5 Build parameters"
echo "  Arch      : $ARCH"
echo "  Publish   : ${BUILDER_ARGS[*]:-(electron-builder default)}"
echo "  App dir   : $APP_DIR"

if ! is_windows_runner; then
  fail "Windows release builds must run on Windows so Electron native modules are rebuilt for the correct OS/arch."
fi

prepare_windows_signing

if [ "${SKIP_DESKTOP_BUILD:-}" = "1" ]; then
  step "2/5 Build desktop source"
  ok "Skipping desktop source build because SKIP_DESKTOP_BUILD=1"
else
  step "2/5 Build desktop source"
  pnpm run build
  ok "Desktop source built"
fi

step "3/5 Rebuild and verify Electron native modules"
pnpm run rebuild:native -- "$ARCH"

step "4/5 electron-builder Windows package + sign"
pnpm exec electron-builder --win "--$ARCH" "${BUILDER_ARGS[@]}"
ok "Windows package complete"

verify_windows_signature

echo ""
echo -e "${GREEN}========================================================${NC}"
if [ "$WINDOWS_SIGNING_MODE" = "signed" ]; then
  echo -e "${GREEN}  Windows signed build complete${NC}"
else
  echo -e "${YELLOW}  Windows unsigned build complete${NC}"
fi
echo -e "${GREEN}========================================================${NC}"
