$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$projectRoot = Split-Path -Parent $PSScriptRoot
$form = New-Object System.Windows.Forms.Form
$form.Text = 'BigFatFish - 知乎凭据配置'
$form.Size = New-Object System.Drawing.Size(600,285)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true
$label = New-Object System.Windows.Forms.Label
$label.Text = "请在知乎开放平台个人中心生成 Access Secret，再粘贴到下方。`r`n凭据仅写入本项目现有 DSH 凭据存储，不发送到聊天。`r`n不会自动启动学习；官方全文读取仍限当前账号本人创作。"
$label.Location = New-Object System.Drawing.Point(20,15)
$label.Size = New-Object System.Drawing.Size(550,66)
$link = New-Object System.Windows.Forms.LinkLabel
$link.Text = '打开知乎开放平台个人中心'
$link.Location = New-Object System.Drawing.Point(20,84)
$link.AutoSize = $true
$link.Add_LinkClicked({ Start-Process 'https://developer.zhihu.com/profile' })
$inputBox = New-Object System.Windows.Forms.TextBox
$inputBox.Location = New-Object System.Drawing.Point(20,113)
$inputBox.Size = New-Object System.Drawing.Size(540,28)
$inputBox.UseSystemPasswordChar = $true
$status = New-Object System.Windows.Forms.Label
$status.Location = New-Object System.Drawing.Point(20,150)
$status.Size = New-Object System.Drawing.Size(540,30)
$save = New-Object System.Windows.Forms.Button
$save.Text = '保存凭据'
$save.Location = New-Object System.Drawing.Point(335,190)
$save.Size = New-Object System.Drawing.Size(110,32)
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = '取消'
$cancel.Location = New-Object System.Drawing.Point(455,190)
$cancel.Size = New-Object System.Drawing.Size(105,32)
$cancel.Add_Click({ $inputBox.Clear(); $form.Close() })
$save.Add_Click({
  if ([string]::IsNullOrWhiteSpace($inputBox.Text)) { $status.Text = '请先填写 Access Secret。'; return }
  $save.Enabled = $false
  try {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = (Get-Command node.exe).Source
    $helper = Join-Path $projectRoot 'scripts/set-zhihu-credential.mjs'
    $startInfo.Arguments = '"' + $helper + '"'
    $startInfo.WorkingDirectory = $projectRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()
    $process.StandardInput.Write($inputBox.Text.Trim())
    $process.StandardInput.Close()
    $inputBox.Clear()
    if (-not $process.WaitForExit(10000)) { $process.Kill(); throw '保存超时' }
    if ($process.ExitCode -ne 0) { throw '保存失败' }
    $status.Text = '已保存。可在后台检查知乎来源；学习仍保持停止。'
  } catch { $status.Text = '保存未完成，请检查输入及本机文件权限。' }
  finally { $save.Enabled = $true }
})
$form.AcceptButton = $save
$form.CancelButton = $cancel
$form.Controls.AddRange(@($label,$link,$inputBox,$status,$save,$cancel))
$form.Add_Shown({ $form.Activate(); $form.BringToFront(); $inputBox.Focus() })
[void]$form.ShowDialog()
$inputBox.Clear()
$form.Dispose()
