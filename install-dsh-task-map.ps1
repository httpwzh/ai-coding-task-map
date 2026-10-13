[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:USERPROFILE 'dsh-task-map'),
  [string]$RepoUrl = 'https://github.com/httpwzh/ai-coding-task-map.git',
  [switch]$SkipServer
)

$ErrorActionPreference = 'Stop'

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
  }
}

$installPath = [System.IO.Path]::GetFullPath($InstallDir)
$git = Get-Command git -ErrorAction SilentlyContinue
$existingRepo = Test-Path -LiteralPath (Join-Path $installPath '.git')

Write-Host "Install directory: $installPath"

if ($existingRepo) {
  if (-not $git) {
    throw 'Git is required to update the existing checkout. Install Git or remove the checkout after backing it up.'
  }
  Write-Host 'Updating existing Git checkout...'
  Invoke-Checked -FilePath $git.Source -Arguments @('-C', $installPath, 'pull', '--ff-only') -WorkingDirectory $installPath
} elseif (Test-Path -LiteralPath $installPath) {
  $hasFiles = Get-ChildItem -LiteralPath $installPath -Force | Select-Object -First 1
  if ($hasFiles) {
    throw "Install directory is not empty and is not a Git checkout: $installPath"
  }
  if (-not $git) {
    throw 'Git is required when the install directory already exists. Install Git or choose a new directory.'
  }
  Invoke-Checked -FilePath $git.Source -Arguments @('clone', $RepoUrl, $installPath) -WorkingDirectory (Split-Path -Parent $installPath)
} else {
  New-Item -ItemType Directory -Path (Split-Path -Parent $installPath) -Force | Out-Null
  if ($git) {
    Write-Host 'Cloning repository...'
    Invoke-Checked -FilePath $git.Source -Arguments @('clone', $RepoUrl, $installPath) -WorkingDirectory (Split-Path -Parent $installPath)
  } else {
    Write-Host 'Git was not found; downloading the repository archive...'
    $tempPath = Join-Path $env:TEMP ('dsh-task-map-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempPath -Force | Out-Null
    $zipPath = Join-Path $tempPath 'repository.zip'
    $zipUrl = ($RepoUrl -replace '\.git$', '') + '/archive/refs/heads/main.zip'
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
    Expand-Archive -LiteralPath $zipPath -DestinationPath $tempPath -Force
    $extracted = Get-ChildItem -LiteralPath $tempPath -Directory |
      Where-Object { $_.Name -ne 'repository' } |
      Select-Object -First 1
    if (-not $extracted) {
      throw 'The GitHub archive did not contain a repository directory.'
    }
    Move-Item -LiteralPath $extracted.FullName -Destination $installPath
  }
}

Set-Location -LiteralPath $installPath

$pluginPackagePath = Join-Path $installPath 'dsh-plugin\package.json'
if (-not (Test-Path -LiteralPath $pluginPackagePath)) {
  throw "The DSH plugin package was not found: $pluginPackagePath"
}

$pluginPackage = Get-Content -LiteralPath $pluginPackagePath -Raw | ConvertFrom-Json
if (-not $pluginPackage.dsh.client) {
  throw 'The DSH plugin package does not contain a valid dsh.client declaration.'
}

$pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $pnpm) { $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue }
$corepack = Get-Command corepack.cmd -ErrorAction SilentlyContinue
if (-not $corepack) { $corepack = Get-Command corepack -ErrorAction SilentlyContinue }
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
$dshRuntimeRoot = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies'
$dshNode = Join-Path $dshRuntimeRoot 'node\bin\node.exe'
$dshPnpm = Join-Path $dshRuntimeRoot 'pnpm\bin\pnpm.mjs'

Write-Host 'Installing web dependencies...'
if ($pnpm) {
  Invoke-Checked -FilePath $pnpm.Source -Arguments @('install', '--frozen-lockfile') -WorkingDirectory $installPath
  Invoke-Checked -FilePath $pnpm.Source -Arguments @('build') -WorkingDirectory $installPath
} elseif ($corepack) {
  Invoke-Checked -FilePath $corepack.Source -Arguments @('pnpm', 'install', '--frozen-lockfile') -WorkingDirectory $installPath
  Invoke-Checked -FilePath $corepack.Source -Arguments @('pnpm', 'build') -WorkingDirectory $installPath
} elseif ((Test-Path -LiteralPath $dshNode) -and (Test-Path -LiteralPath $dshPnpm)) {
  Write-Host 'Using the Node and pnpm runtime bundled with DeepSeek Harness...'
  Invoke-Checked -FilePath $dshNode -Arguments @($dshPnpm, 'install', '--frozen-lockfile') -WorkingDirectory $installPath
  Invoke-Checked -FilePath $dshNode -Arguments @($dshPnpm, 'build') -WorkingDirectory $installPath
} elseif ($npm) {
  Invoke-Checked -FilePath $npm.Source -Arguments @('exec', '--yes', 'pnpm@9.15.5', '--', 'install', '--frozen-lockfile') -WorkingDirectory $installPath
  Invoke-Checked -FilePath $npm.Source -Arguments @('exec', '--yes', 'pnpm@9.15.5', '--', 'build') -WorkingDirectory $installPath
} else {
  throw 'Neither pnpm, the bundled DSH runtime, corepack, nor npm was found. Install DeepSeek Harness or Node.js, then run this script again.'
}

$builtPage = Join-Path $installPath 'dist\index.html'
if (-not (Test-Path -LiteralPath $builtPage)) {
  throw "The web build did not produce $builtPage"
}

$serverScript = Join-Path $installPath '启动 AI 编程任务图.bat'
if (-not (Test-Path -LiteralPath $serverScript)) {
  throw "The server launcher was not found: $serverScript"
}

if (-not $SkipServer) {
  Write-Host 'Starting the local task-map server...'
  Start-Process -FilePath $serverScript -WorkingDirectory $installPath
  Start-Sleep -Seconds 3
  Start-Process 'http://127.0.0.1:4173'
}

Write-Host ''
Write-Host 'Web setup completed.'
Write-Host "Install this local DSH plugin directory in DSH's plugin manager:"
Write-Host (Join-Path $installPath 'dsh-plugin')
Write-Host 'Do not edit the DSH profile JSON by hand.'
