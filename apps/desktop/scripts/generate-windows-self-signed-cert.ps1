[CmdletBinding()]
param(
  [string]$PublisherCommonName = "Spark Foundation",
  [string]$Organization = "Spark Foundation",
  [string]$OrganizationalUnit = "Spark Agent",
  [ValidateRange(1, 20)]
  [int]$ValidYears = 10,
  [string]$OutputDirectory = (Join-Path ([Environment]::GetFolderPath("Desktop")) "spark-agent-signing"),
  [System.Security.SecureString]$Password,
  [switch]$KeepInCertificateStore
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "This script must run on Windows PowerShell."
}

foreach ($value in @($PublisherCommonName, $Organization, $OrganizationalUnit)) {
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "PublisherCommonName, Organization, and OrganizationalUnit must not be empty."
  }
  if ($value.IndexOfAny([char[]]",=+<>#;") -ge 0) {
    throw "Certificate identity fields must not contain X.500 separator characters: , = + < > # ;"
  }
}

if (-not $Password) {
  $Password = Read-Host "Enter a strong password for the exported PFX" -AsSecureString
}

$output = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($output) | Out-Null

$baseName = "spark-foundation-code-signing"
$pfxPath = Join-Path $output "$baseName.pfx"
$cerPath = Join-Path $output "$baseName.cer"
$base64Path = Join-Path $output "$baseName.pfx.base64.txt"
$infoPath = Join-Path $output "$baseName.info.txt"

foreach ($path in @($pfxPath, $cerPath, $base64Path, $infoPath)) {
  if (Test-Path -LiteralPath $path) {
    throw "Refusing to overwrite existing certificate material: $path"
  }
}

$subject = "CN=$PublisherCommonName, O=$Organization, OU=$OrganizationalUnit"
$certificate = $null

try {
  $certificate = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $subject `
    -FriendlyName "$PublisherCommonName Authenticode Code Signing" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyAlgorithm RSA `
    -KeyLength 4096 `
    -KeySpec Signature `
    -KeyExportPolicy Exportable `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears($ValidYears)

  Export-PfxCertificate `
    -Cert $certificate `
    -FilePath $pfxPath `
    -Password $Password `
    -ChainOption EndEntityCertOnly `
    -CryptoAlgorithmOption AES256_SHA256 | Out-Null

  Export-Certificate -Cert $certificate -FilePath $cerPath -Type CERT | Out-Null

  [Convert]::ToBase64String([IO.File]::ReadAllBytes($pfxPath)) |
    Set-Content -LiteralPath $base64Path -NoNewline -Encoding Ascii

  @(
    "Subject=$($certificate.Subject)"
    "Thumbprint=$($certificate.Thumbprint)"
    "SerialNumber=$($certificate.SerialNumber)"
    "NotBefore=$($certificate.NotBefore.ToUniversalTime().ToString('o'))"
    "NotAfter=$($certificate.NotAfter.ToUniversalTime().ToString('o'))"
    "PfxSha256=$((Get-FileHash -LiteralPath $pfxPath -Algorithm SHA256).Hash)"
    "CerSha256=$((Get-FileHash -LiteralPath $cerPath -Algorithm SHA256).Hash)"
  ) | Set-Content -LiteralPath $infoPath -Encoding UTF8
}
finally {
  if ($certificate -and -not $KeepInCertificateStore) {
    Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($certificate.Thumbprint)" -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Host "Self-signed Authenticode certificate created."
Write-Host "  PFX       : $pfxPath"
Write-Host "  Public CER: $cerPath"
Write-Host "  Base64    : $base64Path"
Write-Host "  Metadata  : $infoPath"
Write-Host "  Thumbprint: $($certificate.Thumbprint)"
Write-Warning "The PFX, its base64 file, and password are secrets. Never commit or distribute them."
Write-Warning "Keep this same PFX for every release; replacing it discards any certificate reputation."
