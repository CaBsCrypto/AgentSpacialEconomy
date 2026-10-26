param([string]$Blender, [string]$Python = 'python', [switch]$SkipGraphics)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$Blender) { $Blender = & (Join-Path $PSScriptRoot 'setup-render-tools.ps1') }
Push-Location $repoRoot
$previousPython = $env:PYTHON
$previousBytecode = $env:PYTHONDONTWRITEBYTECODE
$previousBuildDirectory = $env:ONE16_BUILD_DIR
$buildDirectory = Join-Path ([IO.Path]::GetTempPath()) ('one16-render-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $buildDirectory | Out-Null
try {
    $env:PYTHON = $Python
    $env:PYTHONDONTWRITEBYTECODE = '1'
    $env:ONE16_BUILD_DIR = $buildDirectory
    if (!$SkipGraphics) {
        & $Python scripts/generate-venue-appearance.py
        if ($LASTEXITCODE -ne 0) { throw 'Venue graphics generation failed' }
    }
    & $Blender --background --factory-startup --threads 6 --python-exit-code 1 --python model/build_venue.py
    if ($LASTEXITCODE -ne 0) { throw 'Venue geometry export failed' }
    node scripts/validate-glb.mjs (Join-Path $buildDirectory 'one16.glb')
    if ($LASTEXITCODE -ne 0) { throw 'Staged GLB validation failed' }
    foreach ($asset in @('one16.glb', 'layout.json')) {
        Copy-Item -LiteralPath (Join-Path $buildDirectory $asset) -Destination (Join-Path $repoRoot ('dist/assets/' + $asset)) -Force
    }
    Copy-Item -LiteralPath (Join-Path $buildDirectory 'one16-editable.blend') -Destination (Join-Path $repoRoot 'model/one16-editable.blend') -Force
    & $Python scripts/prepare-model.py
    if ($LASTEXITCODE -ne 0) { throw 'Model transfer preparation failed' }
    node scripts/update-review-static.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Static map/layout generation failed' }
    Write-Host 'Venue, textures, transfer hashes and static map rebuilt successfully.'
} finally {
    $env:PYTHON = $previousPython
    $env:PYTHONDONTWRITEBYTECODE = $previousBytecode
    $env:ONE16_BUILD_DIR = $previousBuildDirectory
    Pop-Location
}
