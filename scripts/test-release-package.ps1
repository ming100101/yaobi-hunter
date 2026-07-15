param(
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$package = Get-Content -LiteralPath (Join-Path $repo "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = [string]$package.version
}

$releaseRoot = Join-Path $repo "release"
$zip = Join-Path $releaseRoot "YaobiHunter-v$Version-windows-x64.zip"
$sumPath = Join-Path $releaseRoot "SHA256SUMS.txt"
$verify = Join-Path $releaseRoot ".verify"
$verifyFull = [IO.Path]::GetFullPath($verify)
$releaseFull = [IO.Path]::GetFullPath($releaseRoot).TrimEnd('\') + '\'
if (-not $verifyFull.StartsWith($releaseFull, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use verification path outside release directory"
}

if (-not (Test-Path -LiteralPath $zip -PathType Leaf)) { throw "Missing release ZIP: $zip" }
if (-not (Test-Path -LiteralPath $sumPath -PathType Leaf)) { throw "Missing checksum file" }

$expected = ((Get-Content -LiteralPath $sumPath -Raw -Encoding ascii) -split '\s+')[0].ToLowerInvariant()
$actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "Release checksum mismatch" }

if (Test-Path -LiteralPath $verify) { Remove-Item -LiteralPath $verify -Recurse -Force }
Expand-Archive -LiteralPath $zip -DestinationPath $verify

$required = @('YaobiHunter.exe', 'README-FIRST.txt', 'LICENSE', 'DISCLAIMER.md', 'PRIVACY.md')
foreach ($name in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $verify $name) -PathType Leaf)) {
    throw "Release ZIP is missing $name"
  }
}

$stdout = Join-Path $verify "smoke.stdout.log"
$stderr = Join-Path $verify "smoke.stderr.log"
$exe = Join-Path $verify "YaobiHunter.exe"
$process = $null
try {
  $alreadyRunning = $false
  try {
    $existing = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4780/__yaobi_ping__' -TimeoutSec 2
    $alreadyRunning = $existing.StatusCode -eq 200
  } catch { $alreadyRunning = $false }

  $process = Start-Process -FilePath $exe -ArgumentList '--no-open' -WindowStyle Hidden `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

  if ($alreadyRunning) {
    if (-not $process.WaitForExit(8000)) { throw "Second-instance guard did not exit" }
    $outText = if (Test-Path -LiteralPath $stdout) { Get-Content -LiteralPath $stdout -Raw } else { '' }
    $errorText = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw } else { '' }
    if ($outText -notmatch 'already running at http://localhost:4780') {
      throw "Packaged app second-instance check failed. $outText $errorText"
    }
    Write-Host "Release smoke test passed through the single-instance guard."
  } else {
    $healthy = $false
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Milliseconds 500
      try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4780/__yaobi_ping__' -TimeoutSec 2
        if ($response.StatusCode -eq 200) { $healthy = $true; break }
      } catch { }
      if ($process.HasExited) { break }
    }
    if (-not $healthy) {
      $errorText = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw } else { '' }
      throw "Packaged app health check failed. $errorText"
    }
    Write-Host "Release smoke test passed on http://127.0.0.1:4780."
  }
}
finally {
  if ($null -ne $process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
  Start-Sleep -Milliseconds 300
  if (Test-Path -LiteralPath $verify) {
    Remove-Item -LiteralPath $verify -Recurse -Force
  }
}
