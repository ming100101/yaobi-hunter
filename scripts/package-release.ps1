param(
  [string]$Version = "",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$package = Get-Content -LiteralPath (Join-Path $repo "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = [string]$package.version
}

if ($Version -notmatch '^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$') {
  throw "Version must look like 0.1.0 or 0.1.0-beta.1"
}

$releaseRoot = Join-Path $repo "release"
$stageRoot = Join-Path $releaseRoot ".stage"
$buildRoot = Join-Path $releaseRoot ".stage-build"
$builtExe = Join-Path $buildRoot "YaobiHunter.exe"
$stage = Join-Path $stageRoot "YaobiHunter-v$Version-windows-x64"
$zip = Join-Path $releaseRoot "YaobiHunter-v$Version-windows-x64.zip"
$exe = if ($SkipBuild) { Join-Path $repo "sea\YaobiHunter.exe" } else { $builtExe }

function Assert-ReleaseChild([string]$Path) {
  $releaseFull = [IO.Path]::GetFullPath($releaseRoot).TrimEnd('\') + '\'
  $targetFull = [IO.Path]::GetFullPath($Path)
  if (-not $targetFull.StartsWith($releaseFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify path outside release directory: $targetFull"
  }
}

Assert-ReleaseChild $stageRoot
Assert-ReleaseChild $buildRoot
Assert-ReleaseChild $stage
Assert-ReleaseChild $zip

Push-Location $repo
try {
  if (-not $SkipBuild) {
    npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw "Typecheck failed" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Production build failed" }
    if (Test-Path -LiteralPath $buildRoot) {
      Remove-Item -LiteralPath $buildRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
    node scripts\make-exe.mjs $builtExe
    if ($LASTEXITCODE -ne 0) { throw "Windows executable build failed" }
  }

  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    throw "Missing sea\YaobiHunter.exe. Build first or remove -SkipBuild."
  }

  if (Test-Path -LiteralPath $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $stage -Force | Out-Null

  Copy-Item -LiteralPath $exe -Destination (Join-Path $stage "YaobiHunter.exe")
  Copy-Item -LiteralPath (Join-Path $releaseRoot "README-FIRST.txt") -Destination $stage
  Copy-Item -LiteralPath (Join-Path $repo "LICENSE") -Destination $stage
  Copy-Item -LiteralPath (Join-Path $repo "DISCLAIMER.md") -Destination $stage
  Copy-Item -LiteralPath (Join-Path $repo "PRIVACY.md") -Destination $stage

  if (Test-Path -LiteralPath $zip) {
    Remove-Item -LiteralPath $zip -Force
  }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal

  $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  $sumPath = Join-Path $releaseRoot "SHA256SUMS.txt"
  Set-Content -LiteralPath $sumPath -Encoding ascii -NoNewline -Value "$hash  $([IO.Path]::GetFileName($zip))`n"

  $sizeMb = [math]::Round((Get-Item -LiteralPath $zip).Length / 1MB, 1)
  Write-Host "Release package ready: $zip ($sizeMb MB)"
  Write-Host "SHA-256: $hash"
}
finally {
  Pop-Location
  if (Test-Path -LiteralPath $stageRoot) {
    Assert-ReleaseChild $stageRoot
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
  }
  if (Test-Path -LiteralPath $buildRoot) {
    Assert-ReleaseChild $buildRoot
    Remove-Item -LiteralPath $buildRoot -Recurse -Force
  }
}
