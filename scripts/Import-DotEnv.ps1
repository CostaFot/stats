# Loads KEY=value pairs from the repo-root .env into the process environment
# (local runs only — CI provides the STORE_* variables via repo secrets).
$envFile = Join-Path $PSScriptRoot "..\.env"
if ((Test-Path $envFile) -and [string]::IsNullOrWhiteSpace($env:STORE_TENANT_ID)) {
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*([^#][^=]*)=(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim())
        }
    }
}
