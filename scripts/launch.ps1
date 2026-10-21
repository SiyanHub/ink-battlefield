param([switch]$Lan)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '请先安装 Node.js 22.12 或以上版本，然后重新运行。' }
$nodeVersion = [version]((& node --version).TrimStart('v'))
if ($nodeVersion -lt [version]'22.12') { throw '需要 Node.js 22.12 或以上版本。' }
if (-not (Test-Path -LiteralPath 'node_modules/tsx')) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw '依赖安装失败，请检查网络后重试。' }
}
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw '构建失败，请查看上方错误。' }
if ($Lan) { & npm.cmd run start:lan } else { & npm.cmd start }
