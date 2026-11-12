# Banner price watchdog. Run every 10 minutes by the Windows Scheduled Task
# "Banner price watchdog" (as SYSTEM; installed by ops/install-watchdog.ps1).
# Each run:
#
#   1. Checks prices.json on the live site. If it is over 45 minutes old on 2
#      checks in a row, posts once to #depot-alerts, and once more when it has
#      been fresh on 2 checks in a row. If prices.json can't be read 3 times in
#      a row, posts once; "fixed" after 2 good reads in a row.
#   2. Triggers the "Update prices" workflow (workflow_dispatch). If that fails
#      3 times in a row, or 2 times in a row on 401/403/404 (token revoked,
#      broken or lacking access), posts once to #depot-alerts, and once when it
#      has worked 2 times in a row.
#
# Only SUSTAINED problems alert, and each gets one message and one "fixed": a
# single bad or good check never posts (hysteresis; on 22 Oct 2026 a revoked
# token made it post stale / fixed / stale / fixed). While the trigger is
# failing, a stale alert is not sent: the trigger alert already says prices
# will go stale and what to do, and the stale "fixed" would only flap with
# each manual run.
#
# Old prices are fine when the rates really haven't changed (markets closed):
# the job then keeps the file and fetchedAt stops moving. So a file over 45
# minutes old still counts as fresh when the gh-pages branch holds the same
# file (Pages is serving the latest) and a workflow run succeeded in the last
# 45 minutes (so the job has confirmed nothing changed).
#
# Secrets: BANNER_GH_TOKEN and BANNER_SLACK_WEBHOOK, machine-level environment
# variables, read from the registry at each run. Never log or print them; every
# logged message goes through Hide-Secrets.
#
# Every run appends to watchdog.log in -StateDir; state.json there remembers what
# has been alerted, so each problem gets one message, not one every 10 minutes.
#
# For tests: -PricesUrl may be a local file, -StateDir a scratch folder,
# -NoTrigger skips step 2, -Test prefixes messages with [TEST], and
# -TestBadToken uses a fake token to show the trigger-failure alert.
# With -Test only: -SlackUrl posts to that URL instead of BANNER_SLACK_WEBHOOK
# and -GitHubApiUrl talks to a fake GitHub API (with a fake token, never the
# real one). ops/test-price-watchdog.ps1 uses both, so it never touches the
# real Slack or GitHub.

param(
    [string]$PricesUrl = 'https://tgs-game.github.io/banner/prices.json',
    [string]$StateDir = 'C:\ProgramData\BannerWatchdog',
    [switch]$NoTrigger,
    [switch]$Test,
    [switch]$TestBadToken,
    [string]$SlackUrl,
    [string]$GitHubApiUrl
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'TGS-Game/banner'
$Workflow = 'update-prices.yml'
$RunWorkflowUrl = "https://github.com/$Repo/actions/workflows/$Workflow"
$StaleMinutes = 45
$FailuresBeforeAlert = 3
$TokenFailuresBeforeAlert = 2   # 401/403/404 in a row
$StaleChecksBeforeAlert = 2     # stale checks in a row
$GoodChecksBeforeFixed = 2      # good checks in a row before any "fixed"
$MaxLogBytes = 1MB

if (($SlackUrl -or $GitHubApiUrl) -and -not $Test) { throw '-SlackUrl and -GitHubApiUrl need -Test' }
$GitHubApi = 'https://api.github.com'
if ($GitHubApiUrl) { $GitHubApi = $GitHubApiUrl.TrimEnd('/') }

if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Path $StateDir | Out-Null }
$LogFile = Join-Path $StateDir 'watchdog.log'
$StateFile = Join-Path $StateDir 'state.json'

$Token = [Environment]::GetEnvironmentVariable('BANNER_GH_TOKEN', 'Machine')
$Webhook = [Environment]::GetEnvironmentVariable('BANNER_SLACK_WEBHOOK', 'Machine')
if ($TestBadToken -or $GitHubApiUrl) { $Token = 'github_pat_this_is_not_a_real_token' }
if ($SlackUrl) { $Webhook = $SlackUrl }

function Hide-Secrets([string]$Text) {
    foreach ($secret in @($Token, $Webhook)) {
        if ($secret) { $Text = $Text.Replace($secret, '***') }
    }
    $Text
}

function Write-Log([string]$Message) {
    if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt $MaxLogBytes) {
        Move-Item $LogFile "$LogFile.1" -Force
    }
    $line = '{0:yyyy-MM-ddTHH:mm:ssZ} {1}' -f [DateTime]::UtcNow, (Hide-Secrets $Message)
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Format-Age([TimeSpan]$Age) {
    if ($Age.TotalMinutes -lt 60) { return '{0}m' -f [int][Math]::Floor($Age.TotalMinutes) }
    if ($Age.TotalHours -lt 48) { return '{0}h {1}m' -f [int][Math]::Floor($Age.TotalHours), $Age.Minutes }
    '{0}d {1}h' -f [int][Math]::Floor($Age.TotalDays), $Age.Hours
}

function ConvertTo-Utc([string]$Text) {
    [DateTime]::Parse($Text, [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]'AssumeUniversal, AdjustToUniversal')
}

# One HTTP request. Returns @{ Status; Content; Error } and never throws.
function Invoke-Http([string]$Method, [string]$Uri, [hashtable]$Headers = @{}, [string]$Body) {
    $params = @{ Method = $Method; Uri = $Uri; Headers = $Headers; UseBasicParsing = $true; TimeoutSec = 30 }
    if ($Body) { $params.Body = [Text.Encoding]::UTF8.GetBytes($Body); $params.ContentType = 'application/json' }
    try {
        $r = Invoke-WebRequest @params
        $content = $r.Content
        # PowerShell 5.1 returns bytes for content types it doesn't know as text.
        if ($content -is [byte[]]) { $content = [Text.Encoding]::UTF8.GetString($content) }
        @{ Status = [int]$r.StatusCode; Content = $content; Error = $null }
    } catch {
        $status = 0
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        @{ Status = $status; Content = $null; Error = $_.Exception.Message }
    }
}

function Get-GitHub([string]$Path, [string]$Accept = 'application/vnd.github+json') {
    Invoke-Http GET "$GitHubApi/repos/$Repo/$Path" @{
        Authorization = "Bearer $Token"; Accept = $Accept
        'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'banner-watchdog'
    }
}

# Posts to #depot-alerts. Returns $true only when Slack answers "ok"; the caller
# keeps the alert pending otherwise, so it is tried again next run.
function Send-Slack([string]$Text) {
    if (-not $Webhook) { Write-Log 'slack: BANNER_SLACK_WEBHOOK not set'; return $false }
    if ($Test) { $Text = "[TEST] $Text" }
    $Text = "$Text`n_(banner watchdog on $env:COMPUTERNAME)_"
    $r = Invoke-Http POST $Webhook @{} (@{ text = $Text } | ConvertTo-Json -Compress)
    if ($r.Status -eq 200 -and $r.Content -eq 'ok') { Write-Log 'slack: sent'; return $true }
    Write-Log "slack: FAILED (HTTP $($r.Status)) $($r.Error)"
    $false
}

function Read-State {
    # *Ok counters: good checks in a row while that problem is alerted.
    $state = @{ stale = $false; staleSince = $null; staleChecks = 0; freshChecks = 0
        checkFailures = 0; checkAlerted = $false; checkOk = 0
        triggerFailures = 0; triggerAlerted = $false; triggerOk = 0 }
    if (Test-Path $StateFile) {
        try {
            $saved = Get-Content $StateFile -Raw | ConvertFrom-Json
            foreach ($p in $saved.PSObject.Properties) { $state[$p.Name] = $p.Value }
        } catch { Write-Log "state: unreadable, starting afresh ($($_.Exception.Message))" }
    }
    $state
}

$now = [DateTime]::UtcNow
$state = Read-State
$summary = @()

# ---- 1. Staleness ---------------------------------------------------------

$served = $null
$problem = $null
try {
    if ($PricesUrl -match '^https?://') {
        $r = Invoke-Http GET ('{0}?t={1}' -f $PricesUrl, [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) @{ 'Cache-Control' = 'no-cache' }
        if ($r.Status -ne 200) { throw "HTTP $($r.Status) $($r.Error)" }
        $served = $r.Content | ConvertFrom-Json
    } else {
        $served = Get-Content $PricesUrl -Raw | ConvertFrom-Json
    }
    $fetchedAt = ConvertTo-Utc $served.fetchedAt
} catch {
    $problem = "can't read prices.json: $($_.Exception.Message)"
}

if ($problem) {
    $state.checkFailures++
    $state.checkOk = 0
    $summary += "check FAILED ($($state.checkFailures) in a row): $problem"
    if ($state.checkFailures -ge $FailuresBeforeAlert -and -not $state.checkAlerted) {
        $state.checkAlerted = Send-Slack (":warning: *Banner watchdog can't read prices.json* " +
            "($($state.checkFailures) checks in a row). The live banner may be broken or showing old prices.`n" +
            "Last error: $(Hide-Secrets $problem)`nCheck: $PricesUrl")
    }
} else {
    if ($state.checkAlerted) {
        $state.checkOk++
        if ($state.checkOk -ge $GoodChecksBeforeFixed) {
            if (Send-Slack ':white_check_mark: *Banner watchdog can read prices.json again.*') {
                $state.checkAlerted = $false; $state.checkOk = 0
            }
        }
    }
    if (-not $state.checkAlerted) { $state.checkFailures = 0 }

    $age = $now - $fetchedAt
    $isStale = $age.TotalMinutes -gt $StaleMinutes
    $note = ''
    if ($isStale) {
        # Unchanged rates? Fresh if the branch holds this same file and a run
        # succeeded recently. Anything we can't confirm counts as stale.
        $branch = Get-GitHub 'contents/prices.json?ref=gh-pages' 'application/vnd.github.raw+json'
        $runs = Get-GitHub "actions/workflows/$Workflow/runs?status=success&per_page=1"
        try {
            $branchFetchedAt = ConvertTo-Utc ($branch.Content | ConvertFrom-Json).fetchedAt
            $lastOk = ConvertTo-Utc (($runs.Content | ConvertFrom-Json).workflow_runs[0].updated_at)
            if ($branchFetchedAt -eq $fetchedAt -and ($now - $lastOk).TotalMinutes -le $StaleMinutes) {
                $isStale = $false
                $note = ", rates unchanged (run succeeded $(Format-Age ($now - $lastOk)) ago)"
            } elseif ($branchFetchedAt -gt $fetchedAt) {
                $note = ", gh-pages has newer prices ($($branchFetchedAt.ToString('s'))Z) than the site serves"
            }
        } catch {
            $note = ", couldn't confirm unchanged rates (HTTP $($branch.Status)/$($runs.Status))"
        }
    }
    if ($isStale) { $state.staleChecks++; $state.freshChecks = 0 } else { $state.freshChecks++; $state.staleChecks = 0 }
    $summary += "check: fetchedAt $($fetchedAt.ToString('s'))Z, age $(Format-Age $age), $(if ($isStale) { "STALE ($($state.staleChecks) in a row)" } else { 'fresh' })$note"

    # A failing trigger (from the last run) explains stale prices, and its own
    # alert already says so: don't add a stale alert on top of it.
    $triggerFailing = $state.triggerAlerted -or $state.triggerFailures -gt 0
    if ($isStale -and -not $state.stale -and $state.staleChecks -ge $StaleChecksBeforeAlert) {
        if ($triggerFailing) {
            $summary += 'stale alert held back: the trigger is failing'
        } else {
            $sent = Send-Slack (":warning: *Banner prices are stale:* last updated *$(Format-Age $age) ago* " +
                "($($fetchedAt.ToString('yyyy-MM-dd HH:mm')) UTC). Visitors see old prices.`n" +
                $(if ($note) { "_$($note.TrimStart(', '))_`n" }) +
                "Run the update now (tap *Run workflow*): $RunWorkflowUrl")
            if ($sent) { $state.stale = $true; $state.staleSince = $fetchedAt.ToString('o') }
        }
    } elseif (-not $isStale -and $state.stale -and $state.freshChecks -ge $GoodChecksBeforeFixed) {
        $was = ''
        if ($state.staleSince) { $was = " Gap between updates: $(Format-Age ($fetchedAt - (ConvertTo-Utc $state.staleSince)))." }
        if (Send-Slack ":white_check_mark: *Banner prices recovered:* updated $(Format-Age $age) ago.$was") {
            $state.stale = $false; $state.staleSince = $null
        }
    }
}

# ---- 2. Trigger the workflow ----------------------------------------------

if ($NoTrigger) {
    $summary += 'trigger: skipped (-NoTrigger)'
} else {
    if ($Token) {
        $r = Invoke-Http POST "$GitHubApi/repos/$Repo/actions/workflows/$Workflow/dispatches" @{
            Authorization = "Bearer $Token"; Accept = 'application/vnd.github+json'
            'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'banner-watchdog'
        } '{"ref":"main"}'
    } else {
        $r = @{ Status = 0; Error = 'BANNER_GH_TOKEN not set' }
    }

    if ($r.Status -eq 204) {
        $summary += 'trigger: ok (204)'
        if ($state.triggerAlerted) {
            $state.triggerOk++
            if ($state.triggerOk -ge $GoodChecksBeforeFixed) {
                if (Send-Slack ':white_check_mark: *Banner watchdog can trigger price updates again.*') {
                    $state.triggerAlerted = $false; $state.triggerOk = 0
                }
            }
        }
        if (-not $state.triggerAlerted) { $state.triggerFailures = 0 }
    } else {
        $state.triggerFailures++
        $state.triggerOk = 0
        $summary += "trigger FAILED ($($state.triggerFailures) in a row): HTTP $($r.Status) $($r.Error)"
        $tokenProblem = $r.Status -in 401, 403, 404
        $needed = $FailuresBeforeAlert
        if ($tokenProblem) { $needed = $TokenFailuresBeforeAlert }
        if ($state.triggerFailures -ge $needed -and -not $state.triggerAlerted) {
            $why = "HTTP $($r.Status)"
            if ($r.Status -eq 0) { $why = "no answer from GitHub: $(Hide-Secrets $r.Error)" }
            if ($tokenProblem) {
                $why += ': BANNER_GH_TOKEN has probably been revoked, changed or lost Actions write on ' +
                    "$Repo. Make a new fine-grained token and set it on the VPS (see CLAUDE.md)"
            }
            $state.triggerAlerted = Send-Slack (":rotating_light: *Banner watchdog can't trigger the price update* " +
                "($($state.triggerFailures) attempt(s) in a row, $why). Prices will go stale; GitHub's own " +
                "schedule is the only trigger left.`nRun it by hand: $RunWorkflowUrl")
        }
    }
}

$state | ConvertTo-Json | Set-Content -Path $StateFile -Encoding UTF8
Write-Log ($summary -join ' | ')
