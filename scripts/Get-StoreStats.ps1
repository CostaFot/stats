<#
.SYNOPSIS
    Fetches Microsoft Store acquisition / install stats for one app via the
    Microsoft Store analytics API.

.DESCRIPTION
    Obtains a Microsoft Entra (Azure AD) access token using client-credentials,
    then queries the analytics API for the given date range and prints a total
    (or the raw JSON with -Json).

    The credentials are account-level: the same Entra app covers every app in
    the Partner Center account, and -AppId selects which one to query.

    Credentials come from parameters or, if omitted, these environment variables:
        STORE_TENANT_ID, STORE_CLIENT_ID, STORE_CLIENT_SECRET

.EXAMPLE
    .\Get-StoreStats.ps1 -AppId 9NHDX4XWCNGS -StartDate ([datetime]"2026-04-01")

.EXAMPLE
    # Daily rows as raw JSON (used by Backfill.ps1):
    .\Get-StoreStats.ps1 -AppId 9MV7M639533Q -AggregationLevel day -Json
#>
[CmdletBinding()]
param(
    [string]   $TenantId     = $env:STORE_TENANT_ID,
    [string]   $ClientId     = $env:STORE_CLIENT_ID,
    [string]   $ClientSecret = $env:STORE_CLIENT_SECRET,

    [Parameter(Mandatory)]
    [string]   $AppId,

    [ValidateSet("Acquisitions", "Installs")]
    [string]   $Metric       = "Acquisitions",

    [datetime] $StartDate    = (Get-Date).AddDays(-30),
    [datetime] $EndDate      = (Get-Date),

    # Pass "day" to get one row per day instead of a single aggregate window.
    [ValidateSet("", "day", "week", "month")]
    [string]   $AggregationLevel = "",

    # Print the raw JSON rows instead of just the total
    [switch]   $Json
)

$ErrorActionPreference = "Stop"

foreach ($p in @("TenantId", "ClientId", "ClientSecret")) {
    if ([string]::IsNullOrWhiteSpace((Get-Variable $p -ValueOnly))) {
        throw "Missing $p. Pass -$p or set the matching STORE_* environment variable."
    }
}

# --- 1. Get an access token (valid 60 min) ---------------------------------
$token = (Invoke-RestMethod -Method Post `
    -Uri "https://login.microsoftonline.com/$TenantId/oauth2/token" `
    -ContentType "application/x-www-form-urlencoded" `
    -Body @{
        grant_type    = "client_credentials"
        client_id     = $ClientId
        client_secret = $ClientSecret
        resource      = "https://manage.devcenter.microsoft.com"
    }).access_token

# --- 2. Query the analytics API (follow paging) ----------------------------
$endpoint = if ($Metric -eq "Installs") { "installs" } else { "appacquisitions" }
$start    = $StartDate.ToString("yyyy-MM-dd")
$end      = $EndDate.ToString("yyyy-MM-dd")

$uri = "https://manage.devcenter.microsoft.com/v1.0/my/analytics/$endpoint" +
       "?applicationId=$AppId&startDate=$start&endDate=$end&top=10000"
if ($AggregationLevel) { $uri += "&aggregationLevel=$AggregationLevel" }

$headers = @{ Authorization = "Bearer $token" }
$rows = [System.Collections.Generic.List[object]]::new()

while ($uri) {
    $resp = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers
    if ($resp.Value) { $rows.AddRange($resp.Value) }
    $uri = $resp.'@nextLink'
}

# --- 3. Report -------------------------------------------------------------
if ($Json) {
    $rows | ConvertTo-Json -Depth 6
    return
}

$qtyField = if ($Metric -eq "Installs") { "installCount" } else { "acquisitionQuantity" }
$total    = ($rows | Measure-Object -Property $qtyField -Sum).Sum

Write-Host ""
Write-Host "Store $Metric for $AppId" -ForegroundColor Cyan
Write-Host "  Window : $start -> $end"
Write-Host "  Rows   : $($rows.Count)"
Write-Host "  Total  : $([int]$total)" -ForegroundColor Green
Write-Host ""

# Emit the number so it can be captured: $n = .\Get-StoreStats.ps1 -AppId ...
[int]$total
