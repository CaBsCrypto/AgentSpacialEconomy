param([string]$RuntimeDirectory = (Join-Path $PSScriptRoot '../.tools/blender'))
$ErrorActionPreference = 'Stop'
$version = '4.3.2'
$archiveName = "blender-$version-windows-x64.zip"
$expectedHash = '933a62a770c941e316535f893629ff106ddd2aa5a956f0081ec557439073d4f6'
$runtimeRoot = [IO.Path]::GetFullPath($RuntimeDirectory)
$executable = Join-Path $runtimeRoot "blender-$version-windows-x64/blender.exe"
if (!(Test-Path -LiteralPath $executable)) {
    New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
    $archive = Join-Path $runtimeRoot $archiveName
    if (!(Test-Path -LiteralPath $archive)) {
        Invoke-WebRequest -Uri "https://download.blender.org/release/Blender4.3/$archiveName" -OutFile $archive
    }
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
    if ($hash -ne $expectedHash) { throw "Blender checksum mismatch: $archive" }
    Expand-Archive -LiteralPath $archive -DestinationPath $runtimeRoot -Force
}
$actualVersion = (& $executable --background --factory-startup --version | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or $actualVersion -notmatch 'Blender 4\.3\.2') { throw 'Unexpected Blender runtime' }
Write-Host "Verified $actualVersion"
Write-Output $executable
