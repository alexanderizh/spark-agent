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
# unsigned for local packaging tests unless REQUIRE_WINDOWS_SIGNING=1.
set -euo pipefail

# Windows hardened environments may export NoDefaultCurrentDirectoryInExePath,
# which makes cmd.exe refuse to run executables from the current directory.
# This breaks native module gyp actions (e.g. node-pty winpty's GetCommitHash.bat).
# Clear it for the whole build process tree (inherited by electron-rebuild / electron-builder).
unset NoDefaultCurrentDirectoryInExePath

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

  if { [ -n "${WIN_CSC_LINK:-}" ] && [ -z "${WIN_CSC_KEY_PASSWORD:-}" ]; } \
    || { [ -z "${WIN_CSC_LINK:-}" ] && [ -n "${WIN_CSC_KEY_PASSWORD:-}" ]; }; then
    if [ "${ALLOW_UNSIGNED_WINDOWS_RELEASE:-0}" = "1" ]; then
      warn "Windows signing is partially configured; continuing with an unsigned package"
      unset WIN_CSC_LINK WIN_CSC_KEY_PASSWORD CSC_LINK CSC_KEY_PASSWORD
      export -n WIN_CSC_LINK WIN_CSC_KEY_PASSWORD CSC_LINK CSC_KEY_PASSWORD 2>/dev/null || true
      WINDOWS_SIGNING_MODE="unsigned"
      return
    fi
    fail "Windows signing is partially configured; both WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD are required"
  fi

  if [ -z "${WIN_CSC_LINK:-}" ]; then
    if [ "${REQUIRE_WINDOWS_SIGNING:-0}" = "1" ] \
      && [ "${ALLOW_UNSIGNED_WINDOWS_RELEASE:-0}" != "1" ]; then
      fail "Signed Windows release required, but WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD are missing"
    fi
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

  VERIFY_WINDOWS_SIGNATURE_PATH="$verify_path" "$ps_cmd" -NoProfile -Command '
$path = $env:VERIFY_WINDOWS_SIGNATURE_PATH
if ([string]::IsNullOrWhiteSpace($path)) {
  throw "VERIFY_WINDOWS_SIGNATURE_PATH is empty"
}
if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
  throw "Windows artifact does not exist: $path"
}
$sig = Get-AuthenticodeSignature -LiteralPath $path
$allowUnsignedRelease = $env:ALLOW_UNSIGNED_WINDOWS_RELEASE -eq "1"
Write-Host ("  Status : {0}" -f $sig.Status)
Write-Host ("  Message: {0}" -f $sig.StatusMessage)
if ($sig.SignerCertificate) {
  Write-Host ("  Subject: {0}" -f $sig.SignerCertificate.Subject)
  Write-Host ("  Issuer : {0}" -f $sig.SignerCertificate.Issuer)
}
if ($sig.TimeStamperCertificate) {
  Write-Host ("  Timestamp signer: {0}" -f $sig.TimeStamperCertificate.Subject)
}

if (($sig.Status -eq "UnknownError" -or $sig.Status -eq "NotTrusted") -and
    $sig.SignerCertificate -and
    $sig.SignerCertificate.Subject -eq $sig.SignerCertificate.Issuer) {
  if ($allowUnsignedRelease) {
    Write-Warning "The self-signed signature is not trusted on this runner; skipping temporary root-store trust because unsigned Windows releases are allowed"
    exit 0
  }

  # A self-signed certificate proves that the artifact was signed, but a clean
  # CI runner does not trust it as a root CA. Temporarily trust only its public
  # certificate and run Authenticode verification again so hash/signature
  # failures still fail the build. Never persist this trust beyond the check.
  Write-Host "  Self-signed certificate detected; verifying with temporary CurrentUser trust"
  $certificate = $sig.SignerCertificate
  $store = [System.Security.Cryptography.X509Certificates.X509Store]::new(
    [System.Security.Cryptography.X509Certificates.StoreName]::Root,
    [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
  )
  $certificateAdded = $false

  try {
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $existing = $store.Certificates.Find(
      [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
      $certificate.Thumbprint,
      $false
    )
    if ($existing.Count -eq 0) {
      $store.Add($certificate)
      $certificateAdded = $true
    }
    $store.Close()

    $sig = Get-AuthenticodeSignature -LiteralPath $path
    Write-Host ("  Trusted status : {0}" -f $sig.Status)
    Write-Host ("  Trusted message: {0}" -f $sig.StatusMessage)
  }
  finally {
    try {
      if ($certificateAdded) {
        $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        $store.Remove($certificate)
      }
    }
    finally {
      $store.Close()
    }
  }
}

if ($sig.Status -ne "Valid") {
  if ($allowUnsignedRelease) {
    Write-Warning ("Authenticode verification failed, but the Windows release may continue: {0} - {1}" -f $sig.Status, $sig.StatusMessage)
    exit 0
  }
  throw "Authenticode signature verification failed: $($sig.Status) - $($sig.StatusMessage)"
}
if (-not $sig.TimeStamperCertificate) {
  if ($allowUnsignedRelease) {
    Write-Warning "Authenticode signature has no RFC 3161 timestamp, but the Windows release may continue"
    exit 0
  }
  throw "Authenticode signature is valid but has no RFC 3161 timestamp"
}
' "$verify_path"
  if [ "${ALLOW_UNSIGNED_WINDOWS_RELEASE:-0}" = "1" ]; then
    ok "Windows signature verification step completed (unsigned fallback is allowed)"
  else
    ok "Authenticode signature is valid"
  fi
}

retry_windows_package_without_signing() {
  warn "Signed Windows packaging failed; retrying once without code signing"

  unset WIN_CSC_LINK WIN_CSC_KEY_PASSWORD CSC_LINK CSC_KEY_PASSWORD
  export -n WIN_CSC_LINK WIN_CSC_KEY_PASSWORD CSC_LINK CSC_KEY_PASSWORD 2>/dev/null || true
  WINDOWS_SIGNING_MODE="unsigned"

  # Remove only Windows outputs so a partial signed attempt cannot be uploaded
  # or mistaken for the unsigned retry result.
  rm -rf dist/win-unpacked dist/win-ia32-unpacked dist/win-arm64-unpacked
  rm -f dist/*.exe dist/*.exe.blockmap dist/latest.yml

  pnpm exec electron-builder --win "--$ARCH" "${BUILDER_ARGS[@]}"
}

step "0/5 Build parameters"
echo "  Arch      : $ARCH"
echo "  Publish   : ${BUILDER_ARGS[*]:-(electron-builder default)}"
echo "  App dir   : $APP_DIR"

if ! is_windows_runner; then
  # WSL bash reports a Linux kernel (uname -s = Linux), so is_windows_runner()
  # returns false even though the host is Windows. Detect it explicitly and give
  # an actionable message: Windows native modules must be compiled with the
  # MSVC toolchain, which only Git Bash / MSYS provides — not WSL (gcc/Linux).
  if grep -qiE "(microsoft|wsl)" /proc/version 2>/dev/null; then
    cat <<EOF

You are running this build inside WSL. Windows release builds must use the
Windows (MSVC) toolchain so Electron native modules are compiled correctly,
but WSL only provides the Linux toolchain.

Run the build from a real Windows shell using Git Bash / MSYS2 instead:

    "C:\\Program Files\\Git\\bin\\bash.exe" apps/desktop/scripts/build-win-release.sh x64 --publish never

If 'pnpm run build:win' picks up WSL's bash (C:\\Windows\\System32\\bash.exe),
make sure Git Bash (e.g. D:\\Git\\usr\\bin\\bash.exe) appears earlier in PATH
than C:\\Windows\\System32.

EOF
    fail "Windows release build cannot run inside WSL; use Git Bash / MSYS2."
  fi
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
if ! pnpm exec electron-builder --win "--$ARCH" "${BUILDER_ARGS[@]}"; then
  if [ "$WINDOWS_SIGNING_MODE" = "signed" ] \
    && [ "${ALLOW_UNSIGNED_WINDOWS_RELEASE:-0}" = "1" ]; then
    retry_windows_package_without_signing
  else
    fail "Windows packaging failed"
  fi
fi
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
