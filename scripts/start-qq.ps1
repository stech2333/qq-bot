$ErrorActionPreference = 'Stop'
if (Get-Process -Name QQ -ErrorAction SilentlyContinue) { exit 0 }
$candidates = [Collections.Generic.List[string]]::new()
foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\QQ.exe', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\QQ.exe', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\QQ.exe')) {
  if (Test-Path -LiteralPath $key) { $value = (Get-Item -LiteralPath $key).GetValue(''); if ($value) { $candidates.Add($value.Trim('"')) } }
}
foreach ($directory in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
  if ($directory) { foreach ($relative in @('Tencent\QQNT\QQ.exe', 'Tencent\QQ\QQ.exe', 'Programs\Tencent\QQ\QQ.exe')) { $candidates.Add((Join-Path $directory $relative)) } }
}
foreach ($directory in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'))) {
  if (!$directory -or !(Test-Path -LiteralPath $directory)) { continue }
  $shell = New-Object -ComObject WScript.Shell
  foreach ($link in Get-ChildItem -LiteralPath $directory -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue) {
    $entry = $shell.CreateShortcut($link.FullName)
    if ([IO.Path]::GetFileName($entry.TargetPath) -ieq 'QQ.exe') { $candidates.Add($entry.TargetPath) }
  }
}
$exe = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (!$exe) { throw 'QQ executable was not found. Open the installed QQ manually.' }
Start-Process -FilePath $exe -WindowStyle Hidden
