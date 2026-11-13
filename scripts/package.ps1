<#
.SYNOPSIS
  Package Quick Task Logger into a store-ready zip (Chrome Web Store / Edge Add-ons).

.DESCRIPTION
  Runs the unit tests, then zips only the files the extension needs at runtime
  (manifest, src/, icons/) into dist\quick-task-logger-<version>.zip.
  Tests, docs and scripts are left out of the package.
  Compatible with Windows PowerShell 5.1 and PowerShell 7+.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\package.ps1
#>
[CmdletBinding()]
param(
    # Skip "npm test" (e.g. on a machine without Node).
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Version comes from manifest.json so the zip name always matches what the store sees.
$manifest = Get-Content -Raw -Path (Join-Path $root 'manifest.json') | ConvertFrom-Json
$version = $manifest.version
Write-Host "Quick Task Logger v$version"

if (-not $SkipTests) {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node.js not found. Install Node 20+ or re-run with -SkipTests.'
    }
    Write-Host 'Running unit tests...'
    & node --test tests/
    if ($LASTEXITCODE -ne 0) { throw "Unit tests failed (exit $LASTEXITCODE). Not packaging." }
}

$dist = Join-Path $root 'dist'
$stage = Join-Path $dist 'stage'
$zip = Join-Path $dist "quick-task-logger-$version.zip"

# Fresh staging folder with runtime files only.
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item -Path (Join-Path $root 'manifest.json') -Destination $stage
Copy-Item -Recurse -Path (Join-Path $root 'src') -Destination $stage
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'icons') | Out-Null
Copy-Item -Path (Join-Path $root 'icons\*.png') -Destination (Join-Path $stage 'icons')

if (Test-Path $zip) { Remove-Item -Force $zip }
# Compress-Archive on Windows PowerShell 5.1 writes entry names with backslashes, which the
# Chrome Web Store mis-extracts. Build the zip by hand with forward-slash entry names instead.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    Get-ChildItem -Path $stage -Recurse -File | ForEach-Object {
        $entry = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, $_.FullName, $entry, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
}
finally {
    $archive.Dispose()
}
Remove-Item -Recurse -Force $stage

$kb = [math]::Round((Get-Item $zip).Length / 1KB, 1)
Write-Host "Packaged: $zip ($kb KB)"
