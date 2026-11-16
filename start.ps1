<#
.SYNOPSIS
  Start Aether locally: the Next.js server (frontend + API) and, optionally, the desktop shell.

.DESCRIPTION
  The frontend and the backend are the same Next.js process (pages + /app/api routes),
  so there is nothing else to start. Default: dev server on http://127.0.0.1:4321 with a browser.

.EXAMPLE
  .\start.ps1

.EXAMPLE
  .\start.ps1 -Port 4400 -NoOpen

.EXAMPLE
  .\start.ps1 -Desktop
  Dev server + the Electron window.

.EXAMPLE
  .\start.ps1 -Prod
  Build once, then serve the production bundle.

.EXAMPLE
  .\start.ps1 -AuthDisabled -Fresh
  Skip sign-in and keep data in .\.data-dev.
#>
[CmdletBinding()]
param(
  [int]$Port = 4321,
  [switch]$Desktop,
  [switch]$Prod,
  [switch]$AuthDisabled,
  [switch]$Fresh,
  [switch]$NoOpen,
  [switch]$Install
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Write-Step($message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Write-Note($message) { Write-Host "    $message" -ForegroundColor DarkGray }
function Fail($message) {
  Write-Host "!!  $message" -ForegroundColor Red
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'Node.js is not on PATH. Install Node 22+ and try again.'
}
$nodeVersion = (node --version).TrimStart('v')
if ([int]($nodeVersion.Split('.')[0]) -lt 20) {
  Write-Host "!!  Node $nodeVersion looks old; this project expects Node 20 or newer." -ForegroundColor Yellow
}

if (-not (Test-Path package.json)) { Fail 'package.json not found - run this script from the project root.' }

if ($Install -or -not (Test-Path node_modules)) {
  Write-Step 'Installing dependencies (npm ci)'
  if (Test-Path package-lock.json) { npm ci } else { npm install }
  if ($LASTEXITCODE -ne 0) { Fail 'dependency install failed.' }
}

# A stale listener on the port is the most common "it will not start" cause.
$listener = $null
try {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
} catch {
  $listener = $null
}
if ($listener) {
  $owner = (Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue).ProcessName
  $suffix = if ($owner) { " by $owner" } else { '' }
  Fail "port $Port is already in use$suffix. Stop it, or pass -Port <other>."
}

$env:PORT = "$Port"
$env:NODE_ENV = if ($Prod) { 'production' } else { 'development' }
if ($AuthDisabled) {
  $env:AUTH_DISABLED = '1'
  Write-Host '!!  AUTH_DISABLED=1 - no sign-in. Only do this on your own machine.' -ForegroundColor Yellow
}
if ($Fresh) {
  $env:LAB_DATA_DIR = Join-Path $PSScriptRoot '.data-dev'
  New-Item -ItemType Directory -Force -Path $env:LAB_DATA_DIR | Out-Null
}
$dataDir = if ($env:LAB_DATA_DIR) { $env:LAB_DATA_DIR } else { Join-Path $PSScriptRoot '.data' }

$url = "http://127.0.0.1:$Port"
$mode = if ($Prod) { 'production' } else { 'development' }
Write-Host ''
Write-Host '  Aether' -ForegroundColor White
Write-Note "mode     $mode$(if ($Desktop) { ' + desktop shell' })"
Write-Note "address  $url"
Write-Note "data     $dataDir"
Write-Host ''

function Wait-ForServer([int]$timeoutSeconds = 240) {
  for ($i = 0; $i -lt ($timeoutSeconds * 2); $i++) {
    try {
      $response = Invoke-WebRequest -Uri "$url/api/auth" -Method Head -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -lt 500) { return $true }
    } catch {
      $status = $_.Exception.Response.StatusCode.value__
      if ($status -and $status -lt 500) { return $true }
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Open-Browser {
  if ($NoOpen) { return }
  try {
    Start-Process $url | Out-Null
    Write-Note "opened $url in your browser"
  } catch {
    Write-Note "open $url yourself (browser launch failed)"
  }
}

try {
  if ($Desktop) {
    Write-Step 'Starting dev server and the desktop window'
    Write-Note 'close the window or press Ctrl+C to stop both'
    npm run desktop:dev
    exit $LASTEXITCODE
  }

  if ($Prod) {
    Write-Step 'Building (this takes a minute)'
    npm run build
    if ($LASTEXITCODE -ne 0) { Fail 'build failed.' }
  }

  if ($Prod) { Write-Step 'Serving the production build' } else { Write-Step 'Starting the dev server (frontend + API)' }
  Write-Note "waiting for $url/api/auth"

  $nextArgs = if ($Prod) {
    @('node_modules/next/dist/bin/next', 'start', '-p', "$Port")
  } else {
    @('node_modules/next/dist/bin/next', 'dev', '-p', "$Port")
  }

  $server = Start-Process -FilePath 'node' -ArgumentList $nextArgs -NoNewWindow -PassThru
  try {
    if (Wait-ForServer 240) {
      Write-Host "==> Ready at $url" -ForegroundColor Green
      Open-Browser
    } else {
      Write-Host '!!  the server did not answer in time; see the log above.' -ForegroundColor Yellow
    }
    Wait-Process -Id $server.Id
  } finally {
    if (-not $server.HasExited) {
      Write-Note 'stopping the server'
      Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    }
  }
  exit 0
} catch {
  Write-Host "!!  $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
