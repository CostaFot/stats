<#
.SYNOPSIS
    One-off backfill of historical stats into -DataDir (default ./_data),
    ready to seed the orphan `data` branch.

.DESCRIPTION
    - adb: AdbExtension has recorded daily stats since launch on its own
      `stats` branch — copied verbatim (same CSV schema).
    - Every other app in site/apps.json: daily Store acquisition history is
      queried from the analytics API (it keeps history) and running-summed
      into cumulative values. GitHub download history is unrecoverable — the
      API only exposes current totals — so that column stays blank; daily
      collection fills it going forward.

    Needs STORE_* credentials (env vars or .env) for the Store part; without
    them only the adb copy runs.
#>
[CmdletBinding()]
param(
    [string]   $DataDir    = (Join-Path $PSScriptRoot "..\_data"),
    [string]   $AppsConfig = (Join-Path $PSScriptRoot "..\site\apps.json"),
    [datetime] $StartDate  = [datetime]"2026-04-01"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Import-DotEnv.ps1")
New-Item -ItemType Directory -Force $DataDir | Out-Null

# --- adb: copy the full recorded history -----------------------------------
Invoke-WebRequest "https://raw.githubusercontent.com/CostaFot/AdbExtension/stats/download-stats.csv" `
    -OutFile (Join-Path $DataDir "adb.csv")
Write-Host "[adb] copied history from AdbExtension stats branch"

if ([string]::IsNullOrWhiteSpace($env:STORE_TENANT_ID)) {
    Write-Host "STORE_* credentials not set - skipping Store history for the other apps."
    return
}

# --- others: rebuild cumulative Store history from daily API rows ----------
$apps = Get-Content $AppsConfig -Raw | ConvertFrom-Json | Where-Object { $_.slug -ne "adb" }
foreach ($app in $apps) {
    $raw = & (Join-Path $PSScriptRoot "Get-StoreStats.ps1") `
        -AppId $app.storeId -StartDate $StartDate -EndDate (Get-Date).AddDays(-1) `
        -AggregationLevel day -Json
    $rows = if ([string]::IsNullOrWhiteSpace($raw)) { @() } else { $raw | ConvertFrom-Json }

    $byDate = $rows | Group-Object { ([datetime]$_.date).ToString("yyyy-MM-dd") } | Sort-Object Name
    $running = 0
    $lines = @("date,github_downloads,store_acquisitions")
    foreach ($g in $byDate) {
        $running += [int](($g.Group | Measure-Object -Property acquisitionQuantity -Sum).Sum)
        $lines += "$($g.Name),,$running"
    }
    $lines | Set-Content (Join-Path $DataDir "$($app.slug).csv")
    Write-Host "[$($app.slug)] backfilled $(@($byDate).Count) days, cumulative total $running"
}
