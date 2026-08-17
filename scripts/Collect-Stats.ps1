<#
.SYNOPSIS
    Records today's cumulative download/install numbers for every app in
    site/apps.json, one CSV per app in -DataDir.

.DESCRIPTION
    Per app:
      - GitHub + WinGet: sums download_count across all release assets (gh api).
      - Microsoft Store: cumulative acquisitions since 2026-04-01 via
        Get-StoreStats.ps1. Left blank if the STORE_* credentials are absent
        or the fetch fails, so the GitHub numbers still get recorded.

    Upserts one row per UTC day (re-running on the same day replaces the row).
    Runs identically locally (gh CLI + .env) and in CI.

.EXAMPLE
    ./scripts/Collect-Stats.ps1 -DataDir ./_data
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $DataDir,
    [string] $AppsConfig = (Join-Path $PSScriptRoot "..\site\apps.json")
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Import-DotEnv.ps1")

$apps = Get-Content $AppsConfig -Raw | ConvertFrom-Json
$date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd")
New-Item -ItemType Directory -Force $DataDir | Out-Null

foreach ($app in $apps) {
    # --- GitHub + WinGet: cumulative downloads across all release assets ---
    $ghLines = gh api "repos/$($app.repo)/releases" --paginate `
        --jq '[.[].assets[].download_count] | add // 0'
    if ($LASTEXITCODE -ne 0) { throw "gh api failed for $($app.repo)" }
    $github = ($ghLines | ForEach-Object { [int]$_ } | Measure-Object -Sum).Sum

    # --- Microsoft Store: cumulative acquisitions since launch ---
    $store = ""
    if (-not [string]::IsNullOrWhiteSpace($env:STORE_TENANT_ID)) {
        try {
            $store = & (Join-Path $PSScriptRoot "Get-StoreStats.ps1") `
                -AppId $app.storeId -StartDate ([datetime]"2026-04-01")
        } catch {
            Write-Host "::warning::Store fetch failed for $($app.slug): $_"
        }
    }

    $file = Join-Path $DataDir "$($app.slug).csv"
    if (-not (Test-Path $file)) {
        "date,github_downloads,store_acquisitions" | Set-Content $file
    }
    $kept = Get-Content $file | Where-Object { $_ -notmatch "^$date," -and $_.Trim() -ne "" }
    @($kept) + "$date,$github,$store" | Set-Content $file

    Write-Host "[$($app.slug)] $date github=$github store=$store"
}
