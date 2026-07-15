<#
  Yaobi Hunter control panel — auto-start + master kill switch. No admin needed:
  auto-start uses per-user Startup-folder launchers (not scheduled tasks, which
  require elevation on this machine).

  Usage (from anywhere):
    powershell -ExecutionPolicy Bypass -File scripts\yaobi-ctl.ps1 <action>

  Actions:
    install    Build the recorder bundle and drop two hidden launchers in the
               Startup folder: the app (opens at logon) + the 24/7 recorder.
    shortcuts  Create desktop shortcuts: "Yaobi 熄 (Kill)" / "Yaobi 開 (Resume)".
    kill       Throw the master switch: create the KILL file and kill any running
               app / recorder. Stays off across reboots (auto-start self-aborts).
    resume     Clear the KILL file and relaunch app + recorder now.
    status     Show KILL state, auto-start state, and running Yaobi processes.
    uninstall  Remove the Startup launchers (does not touch the KILL file).

  The KILL file (%LOCALAPPDATA%\YaobiHunter\KILL) is the single source of truth:
  while it exists the recorder self-exits and the --auto app launch aborts, so a
  reboot won't bring anything back until you `resume`.
#>
param([Parameter(Position = 0)][string]$Action = 'status')

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Exe = Join-Path $Repo 'sea\YaobiHunter.exe'
$RecorderMjs = Join-Path $Repo 'scripts\.build\recorder.mjs'
$Local = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE 'AppData\Local' }
$KillFile = Join-Path $Local 'YaobiHunter\KILL'
$Startup = [Environment]::GetFolderPath('Startup')
$AppVbs = Join-Path $Startup 'YaobiApp.vbs'
$RecVbs = Join-Path $Startup 'YaobiRecorder.vbs'

function Stop-YaobiProcesses {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*recorder.mjs*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*YaobiHunter*app-profile*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-Process 'YaobiHunter' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Start-App {
  if (Test-Path $Exe) { Start-Process -FilePath $Exe -ArgumentList @('--auto', '--daemon') -WindowStyle Hidden }
}
function Start-Recorder {
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden `
    -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-Command', "Set-Location '$Repo'; node '$RecorderMjs'")
}

switch ($Action.ToLower()) {
  'install' {
    if (-not (Test-Path $Exe)) {
      Write-Warning "App exe not found at $Exe — build it: npm run build; node scripts\make-exe.mjs"
    }
    Write-Host 'Building recorder bundle...'
    Push-Location $Repo
    & npx --no-install esbuild scripts/recorder.ts --bundle --format=esm --platform=node --outfile=scripts/.build/recorder.mjs --log-level=warning
    Pop-Location

    $appLine = 'CreateObject("WScript.Shell").Run """__EXE__"" --auto --daemon", 0, False'.Replace('__EXE__', $Exe)
    Set-Content -Path $AppVbs -Value $appLine -Encoding ASCII

    $recLine = 'CreateObject("WScript.Shell").Run "powershell -NoProfile -WindowStyle Hidden -Command ""Set-Location ''__REPO__''; node ''__REC__''""", 0, False'.Replace('__REPO__', $Repo).Replace('__REC__', $RecorderMjs)
    Set-Content -Path $RecVbs -Value $recLine -Encoding ASCII

    Write-Host "Auto-start installed (Startup folder, no admin): app + 24/7 recorder open at logon."
    Write-Host "Run '.\scripts\yaobi-ctl.ps1 status' to check, or 'resume' to launch now."
  }
  'shortcuts' {
    $desk = [Environment]::GetFolderPath('Desktop')
    $ws = New-Object -ComObject WScript.Shell
    $k = $ws.CreateShortcut((Join-Path $desk 'Yaobi KILL.lnk'))
    $k.TargetPath = Join-Path $PSScriptRoot 'yaobi-kill.cmd'
    $k.WorkingDirectory = $PSScriptRoot
    $k.IconLocation = 'shell32.dll,131'
    $k.Description = 'Stop all Yaobi background jobs'
    $k.Save()
    $r = $ws.CreateShortcut((Join-Path $desk 'Yaobi RESUME.lnk'))
    $r.TargetPath = Join-Path $PSScriptRoot 'yaobi-resume.cmd'
    $r.WorkingDirectory = $PSScriptRoot
    $r.IconLocation = 'shell32.dll,137'
    $r.Description = 'Resume Yaobi background jobs'
    $r.Save()
    Write-Host 'Desktop shortcuts created: "Yaobi KILL" / "Yaobi RESUME".'
  }
  'kill' {
    New-Item -ItemType Directory -Force (Split-Path $KillFile) | Out-Null
    Set-Content -Path $KillFile -Value ("killed " + (Get-Date -Format o)) -Encoding ASCII
    Stop-YaobiProcesses
    Write-Host 'KILLED. All Yaobi background jobs stopped; KILL file set (stays off across reboots until Resume).'
  }
  'resume' {
    Remove-Item -Force $KillFile -ErrorAction SilentlyContinue
    # Resume is idempotent: repeated clicks must not create parallel recorder
    # writers/watchers or duplicate Telegram alerts.
    Stop-YaobiProcesses
    Start-App
    Start-Recorder
    Write-Host 'RESUMED. KILL file cleared; app + recorder relaunched.'
  }
  'uninstall' {
    Remove-Item -Force $AppVbs, $RecVbs -ErrorAction SilentlyContinue
    Write-Host 'Removed Startup auto-start launchers.'
  }
  default {
    Write-Host ("KILL file  : " + $(if (Test-Path $KillFile) { 'PRESENT -> background jobs disabled' } else { 'absent  -> running allowed' }))
    Write-Host ("Auto-start : app=" + $(if (Test-Path $AppVbs) { 'ON' } else { 'off' }) + "  recorder=" + $(if (Test-Path $RecVbs) { 'ON' } else { 'off' }))
    $procs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'YaobiHunter.exe' -or $_.CommandLine -like '*recorder.mjs*' -or $_.CommandLine -like '*YaobiHunter*app-profile*' })
    Write-Host ("Processes  : {0} Yaobi process(es) running" -f $procs.Count)
  }
}
