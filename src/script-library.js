export const scriptLibrary = [
  {
    "id": "clear-temp-files",
    "name": "Clear Temp Files",
    "category": "Maintenance",
    "description": "Preview temporary files older than 7 days. Cleanup requires -Apply and affects only the current user\u2019s Temp folder.",
    "effect": "Changes files only with -Apply",
    "author": "SkyBase starter library",
    "language": "PowerShell",
    "filename": "clear-temp-files.ps1",
    "code": "# SkyBase IT Solutions - Clear Temp Files\n# Default: preview only. Run with -Apply to delete matching files.\n[CmdletBinding(SupportsShouldProcess=$true)]\nparam([switch]$Apply, [ValidateRange(1,365)][int]$OlderThanDays=7)\n$ErrorActionPreference = 'Stop'\n$root = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\\')\nif (-not (Test-Path -LiteralPath $root -PathType Container)) { throw 'Temp folder not found.' }\nif ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Temp root is a link; cleanup stopped.' }\n$cutoff = (Get-Date).AddDays(-$OlderThanDays)\n# Top-level files only; no recursive traversal or browser cache deletion.\n$files = @(Get-ChildItem -LiteralPath $root -File -Force | Where-Object {\n    $_.LastWriteTime -lt $cutoff -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)\n})\n$files | Select-Object FullName,Length,LastWriteTime\nif ($Apply) {\n    foreach ($file in $files) {\n        if ($PSCmdlet.ShouldProcess($file.FullName, 'Delete old temporary file')) {\n            try { Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop }\n            catch { Write-Warning \"Skipped $($file.FullName): $($_.Exception.Message)\" }\n        }\n    }\n} else { Write-Output 'Preview only. Use -Apply to delete these files, or -Apply -WhatIf to review.' }\n"
  },
  {
    "id": "disk-space-report",
    "name": "Disk Space Report",
    "category": "Monitoring",
    "description": "Report total, used, and free space for local fixed drives.",
    "effect": "Read-only",
    "author": "SkyBase starter library",
    "language": "PowerShell",
    "filename": "disk-space-report.ps1",
    "code": "# SkyBase IT Solutions - Disk Space Report\n$ErrorActionPreference = 'Stop'\nGet-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {\n    [pscustomobject]@{\n        Drive = $_.DeviceID\n        TotalGB = [math]::Round($_.Size / 1GB, 2)\n        FreeGB = [math]::Round($_.FreeSpace / 1GB, 2)\n        UsedPercent = if ($_.Size -gt 0) { [math]::Round(100 * (1 - $_.FreeSpace / $_.Size), 1) } else { $null }\n    }\n} | Format-Table -AutoSize\n"
  },
  {
    "id": "restart-spooler",
    "name": "Restart Spooler Service",
    "category": "Self-Healing",
    "description": "Restart the Windows Print Spooler. Existing print jobs are not deleted; printing is briefly interrupted.",
    "effect": "Changes service \u00b7 Administrator",
    "author": "SkyBase starter library",
    "language": "PowerShell",
    "filename": "restart-spooler.ps1",
    "code": "# SkyBase IT Solutions - Restart Spooler Service\n# Run PowerShell as Administrator. Use -WhatIf to preview.\n[CmdletBinding(SupportsShouldProcess=$true, ConfirmImpact='High')]\nparam()\n$ErrorActionPreference = 'Stop'\nGet-Service -Name Spooler -ErrorAction Stop | Format-Table Name,Status\nif ($PSCmdlet.ShouldProcess('Windows Print Spooler', 'Restart (temporarily interrupts printing)')) {\n    Restart-Service -Name Spooler -Force -ErrorAction Stop\n    Get-Service -Name Spooler | Format-Table Name,Status\n}\n"
  },
  {
    "id": "windows-update-status",
    "name": "Windows Update Status",
    "category": "Patching",
    "description": "Query pending Windows Updates using the configured update source. Does not install updates or restart.",
    "effect": "Read-only \u00b7 Update query may take several minutes",
    "author": "SkyBase starter library",
    "language": "PowerShell",
    "filename": "windows-update-status.ps1",
    "code": "# SkyBase IT Solutions - Windows Update Status\n$ErrorActionPreference = 'Stop'\n$session = New-Object -ComObject Microsoft.Update.Session\n$session.ClientApplicationID = 'SkyBase Update Status'\n$searcher = $session.CreateUpdateSearcher()\n$result = $searcher.Search('IsInstalled=0 and IsHidden=0')\nWrite-Output \"Pending updates: $($result.Updates.Count)\"\nforeach ($update in $result.Updates) {\n    [pscustomobject]@{\n        Title = $update.Title\n        KB = @($update.KBArticleIDs) -join ', '\n        Severity = $update.MsrcSeverity\n        Downloaded = $update.IsDownloaded\n        RebootBehavior = $update.InstallationBehavior.RebootBehavior\n    }\n}\n"
  },
  {
    "id": "logged-in-users",
    "name": "Get Logged-In Users",
    "category": "Inventory",
    "description": "List interactive Windows sessions, including disconnected sessions.",
    "effect": "Read-only",
    "author": "SkyBase starter library",
    "language": "PowerShell",
    "filename": "logged-in-users.ps1",
    "code": "# SkyBase IT Solutions - Get Logged-In Users\n$ErrorActionPreference = 'Stop'\n& \"$env:SystemRoot\\System32\\quser.exe\"\nif ($LASTEXITCODE -ne 0) { throw 'Session query failed or no interactive users were found.' }\n"
  },
  {
    "id": "enable-remote-desktop",
    "name": "Enable Remote Desktop",
    "category": "Remote Access",
    "description": "Enable RDP with Network Level Authentication and a Domain-profile, LocalSubnet firewall rule.",
    "effect": "Changes remote access \u00b7 Administrator",
    "author": "SkyBase starter library",
    "language": "PowerShell",
    "filename": "enable-remote-desktop.ps1",
    "code": "# SkyBase IT Solutions - Enable Remote Desktop\n# Windows Pro/Enterprise/Server only. Run as Administrator.\n# Changes persist. This does not create or grant access to user accounts.\n[CmdletBinding(SupportsShouldProcess=$true, ConfirmImpact='High')]\nparam()\n$ErrorActionPreference = 'Stop'\nif ($PSCmdlet.ShouldProcess($env:COMPUTERNAME, 'Enable RDP with NLA and Domain-only LocalSubnet firewall access')) {\n    $edition = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion').EditionID\n    if ($edition -match '^(Core|Starter)') { throw 'This Windows edition does not support hosting Remote Desktop.' }\n    Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -Value 0\n    Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp' -Name UserAuthentication -Value 1\n    $rule = 'SkyBase-RDP-Domain-LocalSubnet'\n    if (Get-NetFirewallRule -Name $rule -ErrorAction SilentlyContinue) {\n        Set-NetFirewallRule -Name $rule -Enabled True -Profile Domain -Direction Inbound -Action Allow\n        Get-NetFirewallRule -Name $rule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet\n    } else {\n        New-NetFirewallRule -Name $rule -DisplayName 'SkyBase RDP - Domain Local Subnet' -Direction Inbound -Protocol TCP -LocalPort 3389 -RemoteAddress LocalSubnet -Profile Domain -Action Allow\n    }\n    Write-Output 'RDP enabled with NLA. Review existing firewall rules separately; this script does not alter them.'\n}\n"
  },
  {
    "id": "deployment-readiness",
    "name": "Software Deployment Readiness",
    "category": "Deployment",
    "description": "Check Windows version, PowerShell, package manager availability, and administrator status.",
    "effect": "Read-only",
    "author": "SkyBase starter library",
    "language": "PowerShell",
    "filename": "deployment-readiness.ps1",
    "code": "# SkyBase IT Solutions - Software Deployment Readiness\n$ErrorActionPreference = 'Stop'\n$identity = [Security.Principal.WindowsIdentity]::GetCurrent()\n$principal = New-Object Security.Principal.WindowsPrincipal($identity)\n$os = Get-CimInstance Win32_OperatingSystem\n[pscustomobject]@{\n    Computer = $env:COMPUTERNAME\n    Windows = $os.Caption\n    Version = $os.Version\n    PowerShell = $PSVersionTable.PSVersion.ToString()\n    Administrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)\n    WingetAvailable = [bool](Get-Command winget.exe -ErrorAction SilentlyContinue)\n    ChocolateyAvailable = [bool](Get-Command choco.exe -ErrorAction SilentlyContinue)\n} | Format-List\n# No software is downloaded or installed.\n"
  },
  {
    "id": "flush-dns-cache",
    "name": "Flush DNS Cache",
    "category": "Network",
    "description": "Clear the local Windows DNS resolver cache to troubleshoot name resolution.",
    "effect": "Changes local DNS cache \u00b7 Administrator",
    "author": "SkyBase starter library",
    "language": "PowerShell",
    "filename": "flush-dns-cache.ps1",
    "code": "# SkyBase IT Solutions - Flush DNS Cache\n# Run PowerShell as Administrator. Does not change DNS server settings.\n[CmdletBinding(SupportsShouldProcess=$true)]\nparam()\n$ErrorActionPreference = 'Stop'\nif ($PSCmdlet.ShouldProcess($env:COMPUTERNAME, 'Clear Windows DNS resolver cache')) {\n    Clear-DnsClientCache -ErrorAction Stop\n    Write-Output 'Windows DNS resolver cache cleared.'\n}\n"
  }
];
