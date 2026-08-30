# Spark CLI installer (Windows PowerShell).
#
#   irm https://<host>/install.ps1 | iex
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Base https://<host> [-Version 0.1.0] [-Tarball .\spark-agent-0.1.0.tgz]
#
# Mirrors install.sh: download the npm tarball, verify sha256, install with npm.
# NOTE: logic validated by review only; real-machine Windows validation is a
# tracked follow-up (see docs 016).

param(
  [string]$Base = $env:SPARK_INSTALL_BASE,
  [string]$Version = $env:SPARK_INSTALL_VERSION,
  [string]$Tarball = $env:SPARK_INSTALL_TARBALL
)

$ErrorActionPreference = 'Stop'
$NodeMin = '22.14.0'
$NodeMaxMajor = 23
# SYNC CONSTANT — keep identical to DEFAULT_RELEASE_BASE in src/cli/release.ts,
# RELEASE_BASE in scripts/prepare-release.mjs, and DEFAULT_BASE in install.sh.
$DefaultBase = 'https://raw.githubusercontent.com/alexanderizh/spark-agent/spark-cli-releases'
if (-not $Base) { $Base = $DefaultBase }

function Fail([string]$Message) {
  Write-Host "install.ps1: $Message" -ForegroundColor Red
  exit 1
}

function Compare-Version([string]$Left, [string]$Right) {
  $a = $Left.Split('.') | ForEach-Object { [int]($_ -replace '-.*$', '') }
  $b = $Right.Split('.') | ForEach-Object { [int]($_ -replace '-.*$', '') }
  for ($i = 0; $i -lt 3; $i++) {
    if ($a[$i] -lt $b[$i]) { return -1 }
    if ($a[$i] -gt $b[$i]) { return 1 }
  }
  return 0
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'node is not installed. Install Node.js >= 22.14 (https://nodejs.org) and retry.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail 'npm is not installed. Install Node.js >= 22.14 and retry.'
}
$nodeVersion = (node -e 'process.stdout.write(process.versions.node)')
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -ge $NodeMaxMajor -or (Compare-Version $nodeVersion $NodeMin) -lt 0) {
  Fail "node $nodeVersion is outside the supported range >= $NodeMin < $NodeMaxMajor."
}

$tarballPath = $Tarball
$expectedSha = $null
if ($Tarball) {
  if (-not (Test-Path $Tarball)) { Fail "tarball not found: $Tarball" }
} else {
  if (-not $Base) {
    Fail 'no release base configured. Pass -Base <url> or set SPARK_INSTALL_BASE, or use -Tarball <path>.'
  }
  if ($Base -notmatch '^https?://') { Fail "-Base must be an http(s) URL, got: $Base" }

  if (-not $Version) {
    $manifest = Invoke-RestMethod -Uri "$Base/latest.json"
    $Version = $manifest.version
    $expectedSha = $manifest.sha256
    if (-not $Version -or -not $expectedSha) { Fail 'latest.json does not contain version and sha256.' }
    if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$') {
      Fail "latest.json reports an invalid version: $Version"
    }
  }

  $archiveUrl = "$Base/spark-agent-$Version.tgz"
  $tarballPath = Join-Path $env:TEMP "spark-agent-$Version.tgz"
  Invoke-WebRequest -Uri $archiveUrl -OutFile $tarballPath
  if (-not $expectedSha) {
    $sidecar = (Invoke-RestMethod -Uri "$archiveUrl.sha256") -split '\s+' | Select-Object -First 1
    if ($sidecar -notmatch '^[0-9a-f]{64}$') { Fail "checksum sidecar is invalid for $Version." }
    $expectedSha = $sidecar
  }
  $actualSha = (Get-FileHash -Algorithm SHA256 -Path $tarballPath).Hash.ToLower()
  if ($actualSha -ne $expectedSha) {
    Fail "checksum mismatch for ${Version}: expected $expectedSha, got $actualSha"
  }
  Write-Host "==> Checksum verified ($actualSha)"
}

Write-Host "==> Installing spark-agent with npm (node $nodeVersion)"
$npmExit = & npm install -g --no-audit --no-fund $tarballPath 2>&1
$npmCode = $LASTEXITCODE
if ($npmCode -ne 0) {
  Write-Host $npmExit
  Fail 'npm install -g failed. If this is a permission error, set a user prefix: npm config set prefix "%APPDATA%\npm"'
}

$prefix = (npm prefix -g).Trim()
# On Windows npm's global bin directory is the prefix itself (e.g.
# %APPDATA%\npm); only Unix installs shims under <prefix>/bin.
$bindir = if ($env:OS -eq 'Windows_NT') { $prefix } else { Join-Path $prefix 'bin' }
$sparkBin = Join-Path $bindir 'spark.cmd'
if (-not (Test-Path $sparkBin)) { $sparkBin = Join-Path $bindir 'spark' }
if (-not (Test-Path $sparkBin)) { Fail "install finished but spark was not found in $bindir." }

if (($env:PATH -split ';') -notcontains $bindir) {
  Write-Host "==> npm global bin $bindir is not on PATH; linking a launcher instead"
  & $sparkBin install
}

$installedVersion = & $sparkBin --version
Write-Host "Spark CLI v$installedVersion installed (node $nodeVersion)."
Write-Host 'Run spark doctor to verify the setup.'
