param([switch]$StartAll)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root 'logs\bridge'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$launcherLog = Join-Path $logs 'launcher.log'
$stage = 'initialization'
$launcherMutex = New-Object System.Threading.Mutex($false, 'Local\BigFatFishQQLauncher')
$launcherAcquired = $false
function Write-LaunchStatus([string]$Result) {
  Add-Content -LiteralPath $launcherLog -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $stage + ': ' + $Result) -Encoding UTF8
}
function Read-LocalConfig {
  # Windows PowerShell 5 otherwise reads BOM-less UTF-8 as the system ANSI codepage.
  Get-Content -LiteralPath (Join-Path $root 'integrations\qq-bridge\config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
}
function Open-ManagerPage($Config) {
  $url = 'http://127.0.0.1:3105/?token=' + [Uri]::EscapeDataString($Config.consoleToken)
  Start-Process -FilePath $url -ErrorAction Stop
}
try {
  try { $launcherAcquired = $launcherMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $launcherAcquired = $true }
  $stage = 'read_config'
  $config = Read-LocalConfig
  if (!$config.consoleToken) { throw 'Missing management credential' }
  Write-LaunchStatus 'ok'
  if (!$launcherAcquired) {
    $stage = 'open_existing_page'
    Open-ManagerPage $config
    Write-LaunchStatus 'ok; another startup is in progress'
    exit 0
  }
  $stage = 'find_node'
  $node = (Get-Command node -ErrorAction Stop).Source
  $manager = Join-Path $root 'scripts\bridge-manager.mjs'
  $online = $false
  try { $client = New-Object System.Net.Sockets.TcpClient; $client.Connect('127.0.0.1',3105); $online = $true; $client.Dispose() } catch {}
  if (!$online) {
    $stage = 'start_manager'
    Start-Process -FilePath $node -ArgumentList ('"' + $manager + '"') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'manager.out.log') -RedirectStandardError (Join-Path $logs 'manager.err.log')
    $deadline = (Get-Date).AddSeconds(15)
    do {
      Start-Sleep -Milliseconds 300
      try { $client = New-Object System.Net.Sockets.TcpClient; $client.Connect('127.0.0.1',3105); $online = $true; $client.Dispose() } catch {}
    } while (!$online -and (Get-Date) -lt $deadline)
    if (!$online) { throw 'Management service is unavailable' }
  }
  $stage = 'open_browser'
  Open-ManagerPage $config
  Write-LaunchStatus 'ok'
  if ($StartAll) {
    $stage = 'start_services'
    $headers = @{ 'x-console-token' = $config.consoleToken; Origin = 'http://127.0.0.1:3105' }
    $status = Invoke-RestMethod -Uri 'http://127.0.0.1:3105/api/manager/status' -Headers $headers -TimeoutSec 10
    if (!$status.ok -or !$status.services.dsh -or !$status.services.bridge) { throw 'Unexpected management service' }
    if (!$status.busy) {
      Invoke-RestMethod -Uri 'http://127.0.0.1:3105/api/manager/action' -Method Post -Headers $headers -ContentType 'application/json' -Body '{"service":"all","action":"start"}' -TimeoutSec 180 | Out-Null
      Write-LaunchStatus 'ok'
    } else { Write-LaunchStatus 'already in progress; see management page' }
  }
  exit 0
} catch {
  # JSON errors may contain the entire config. Never print or persist raw exceptions.
  Write-LaunchStatus ('failed (' + $_.Exception.GetType().Name + ')')
  Write-Error -Message ('Startup failed at ' + $stage + '. See logs/bridge/launcher.log and the management page.') -ErrorAction Continue
  exit 1
} finally {
  if ($launcherAcquired) { $launcherMutex.ReleaseMutex() }
  $launcherMutex.Dispose()
}
