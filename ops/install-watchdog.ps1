# Installs (or with -Uninstall removes) the "Banner price watchdog" Scheduled
# Task: ops/price-watchdog.ps1 every 10 minutes as SYSTEM. Run from an elevated
# PowerShell in the repo root:
#
#   powershell -ExecutionPolicy Bypass -File ops\install-watchdog.ps1
#   powershell -ExecutionPolicy Bypass -File ops\install-watchdog.ps1 -Uninstall
#
# Installing copies the script to C:\ProgramData\BannerWatchdog (readable and
# writable only by SYSTEM and Administrators, since SYSTEM runs it), so the task
# doesn't depend on which branch this checkout is on. Re-run after changing
# the script. The log and state live in the same folder; -Uninstall keeps them.

param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$TaskName = 'Banner price watchdog'
$Dir = 'C:\ProgramData\BannerWatchdog'
$Script = Join-Path $Dir 'price-watchdog.ps1'

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Item $Script -Force -ErrorAction SilentlyContinue
    "Removed task '$TaskName'. Log and state kept in $Dir."
    return
}

foreach ($name in 'BANNER_GH_TOKEN', 'BANNER_SLACK_WEBHOOK') {
    if (-not [Environment]::GetEnvironmentVariable($name, 'Machine')) {
        throw "$name is not set as a machine-level environment variable"
    }
}

New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($who in 'NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators') {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
        $who, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
}
Set-Acl -Path $Dir -AclObject $acl
Copy-Item (Join-Path $PSScriptRoot 'price-watchdog.ps1') $Script -Force

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Script`""
# Minute 1, 11, 21, ...; repeats indefinitely and carries on after reboots.
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).Date.AddMinutes(1)) `
    -RepetitionInterval (New-TimeSpan -Minutes 10)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
    -Settings $settings -Description 'Triggers the TGS-Game/banner "Update prices" workflow and alerts #depot-alerts when prices go stale. See CLAUDE.md in the banner repo.' `
    -Force | Out-Null
"Installed task '$TaskName'. Next run: $((Get-ScheduledTaskInfo -TaskName $TaskName).NextRunTime)"
