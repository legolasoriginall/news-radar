# تریگر دستی به‌روزرسانی اخبار (برای زمان‌بند ویندوز یا cron خارجی)
# استفاده:  .\trigger-update.ps1
# توکن از $env:NEWS_RADAR_GH_TOKEN یا فایل token.txt کنار همین اسکریپت خوانده می‌شود.

param(
    [string]$Owner = "legolasoriginall",
    [string]$Repo = "news-radar",
    [string]$Workflow = "update.yml",
    [string]$Ref = "main"
)

$ErrorActionPreference = "Stop"

$token = $env:NEWS_RADAR_GH_TOKEN
if (-not $token) {
    $tokenFile = Join-Path $PSScriptRoot "token.txt"
    if (Test-Path $tokenFile) { $token = (Get-Content $tokenFile -Raw).Trim() }
}
if (-not $token) {
    Write-Error "توکن پیدا نشد. NEWS_RADAR_GH_TOKEN را تنظیم کنید یا token.txt بسازید."
}

$headers = @{
    Authorization          = "Bearer $token"
    Accept                 = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}
$body = @{ ref = $Ref } | ConvertTo-Json -Compress
$uri = "https://api.github.com/repos/$Owner/$Repo/actions/workflows/$Workflow/dispatches"

try {
    $response = Invoke-WebRequest -Uri $uri -Method Post -Headers $headers -Body $body -ContentType "application/json" -TimeoutSec 30
    Write-Output "$(Get-Date -Format s) dispatched OK (HTTP $($response.StatusCode))"
} catch {
    # 204 هم موفق است ولی Invoke-WebRequest ممکن است خطا بدهد
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 204) {
        Write-Output "$(Get-Date -Format s) dispatched OK (204)"
    } else {
        Write-Output "$(Get-Date -Format s) dispatch failed: $($_.Exception.Message)"
        exit 1
    }
}
