# Offline tests for ops/price-watchdog.ps1: the alert rule (only sustained
# problems alert; one message per problem, one "fixed").
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File ops\test-price-watchdog.ps1
#
# Each watchdog run is a separate powershell.exe, exactly like the Scheduled
# Task, so every step also shows state.json carrying the state across runs.
# Nothing real is touched: Slack and the GitHub API are a fake HTTP server on
# localhost (-SlackUrl / -GitHubApiUrl, which make the watchdog use a fake
# token), prices.json is a local file, and the state lives in a temp folder.
# Exit code 0 = all passed.

$ErrorActionPreference = 'Stop'
$Watchdog = Join-Path $PSScriptRoot 'price-watchdog.ps1'
$Work = Join-Path ([IO.Path]::GetTempPath()) ('banner-watchdog-test-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $Work | Out-Null
$PricesFile = Join-Path $Work 'prices.json'

# ---- fake Slack + GitHub API ------------------------------------------------

$tcp = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$tcp.Start(); $Port = $tcp.LocalEndpoint.Port; $tcp.Stop()
$Base = "http://localhost:$Port"

$ctl = [hashtable]::Synchronized(@{
    slack = New-Object Collections.ArrayList   # texts posted
    slackDown = $false                          # answer 503 instead of "ok"
    dispatch = 204                              # status for the workflow dispatch
    dispatches = 0
    branchJson = $null                          # gh-pages prices.json; $null = 401
    lastRunAt = $null                           # last successful run; $null = 401
})

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add("$Base/")
$listener.Start()
$server = [powershell]::Create()
[void]$server.AddScript({
    param($listener, $ctl)
    while ($listener.IsListening) {
        try { $c = $listener.GetContext() } catch { break }
        $req = $c.Request; $res = $c.Response
        $status = 404; $body = ''
        try {
            $path = $req.Url.AbsolutePath
            if ($req.HttpMethod -eq 'POST' -and $path -eq '/slack') {
                $text = (New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
                if ($ctl.slackDown) { $status = 503; $body = 'down' }
                else { [void]$ctl.slack.Add(($text | ConvertFrom-Json).text); $status = 200; $body = 'ok' }
            } elseif ($req.HttpMethod -eq 'POST' -and $path -like '*/actions/workflows/*/dispatches') {
                $ctl.dispatches++
                $status = $ctl.dispatch
            } elseif ($path -like '*/contents/prices.json') {
                if ($ctl.branchJson) { $status = 200; $body = $ctl.branchJson } else { $status = 401 }
            } elseif ($path -like '*/actions/workflows/*/runs') {
                if ($ctl.lastRunAt) {
                    $status = 200; $body = (@{ workflow_runs = @(@{ updated_at = $ctl.lastRunAt }) } | ConvertTo-Json -Depth 4)
                } else { $status = 401 }
            }
        } catch { $status = 500 }
        $res.StatusCode = $status
        $bytes = [Text.Encoding]::UTF8.GetBytes($body)
        if ($bytes.Length) { $res.ContentType = 'text/plain'; $res.OutputStream.Write($bytes, 0, $bytes.Length) }
        $res.Close()
    }
}).AddArgument($listener).AddArgument($ctl)
$async = $server.BeginInvoke()

# ---- helpers ------------------------------------------------------------------

$results = New-Object Collections.ArrayList
function Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
    [void]$results.Add($Ok)
    if ($Ok) { "PASS $Name" } else { "FAIL $Name  [$Detail]" }
}

# Prices fetched $Minutes ago (the watchdog compares fetchedAt with its clock).
function Set-Prices([double]$Minutes) {
    $at = [DateTime]::UtcNow.AddMinutes(-$Minutes).ToString('yyyy-MM-ddTHH:mm:ssZ')
    $json = '{"fetchedAt":"' + $at + '","metals":{}}'
    [IO.File]::WriteAllText($PricesFile, $json)
    $json
}

$script:dir = $null
function New-Scenario {
    $script:dir = Join-Path $Work ([Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $script:dir | Out-Null
    $ctl.slack.Clear(); $ctl.slackDown = $false; $ctl.dispatch = 204
    $ctl.branchJson = $null; $ctl.lastRunAt = $null
    Set-Prices 5 | Out-Null
}

# One watchdog run (a new process). -Prices: minutes old; -Dispatch: status.
function Run([double]$Prices = 5, [int]$Dispatch = 204, [string]$PricesPath, [switch]$NoTrigger) {
    if ($PSBoundParameters.ContainsKey('Prices') -or -not $PricesPath) { Set-Prices $Prices | Out-Null }
    $ctl.dispatch = $Dispatch
    $argv = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $Watchdog,
        '-PricesUrl', $(if ($PricesPath) { $PricesPath } else { $PricesFile }), '-StateDir', $script:dir,
        '-Test', '-SlackUrl', "$Base/slack", '-GitHubApiUrl', $Base)
    if ($NoTrigger) { $argv += '-NoTrigger' }
    & powershell.exe @argv 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "watchdog run failed (exit $LASTEXITCODE): $(Get-Content (Join-Path $script:dir 'watchdog.log') -Tail 1)" }
}

function Slack { , @($ctl.slack) }  # the comma keeps a 1-item array an array
function Last-Log { Get-Content (Join-Path $script:dir 'watchdog.log') -Tail 1 }

try {
    # 1. Replay of 22 Oct 2026: the token was revoked (401 on every trigger),
    #    prices went stale, someone ran the workflow by hand (fresh), stale
    #    again, then a new token. It posted 6 times; now: one alert, one fixed.
    New-Scenario
    Run -Prices 9 -Dispatch 401
    Check '22 Oct: first 401 alone posts nothing' ((Slack).Count -eq 0) ((Slack) -join ' / ')
    Run -Prices 19 -Dispatch 401
    Check '22 Oct: second 401 in a row -> one trigger alert' ((Slack).Count -eq 1 -and (Slack)[0] -like "*can't trigger the price update*BANNER_GH_TOKEN*") ((Slack) -join ' / ')
    foreach ($m in 29, 39, 49, 59, 69) { Run -Prices $m -Dispatch 401 }
    Check '22 Oct: stale while the trigger alert is open -> nothing more' ((Slack).Count -eq 1) ((Slack) -join ' / ')
    Check '22 Oct: the log says the stale alert was held back' ((Last-Log) -like '*stale alert held back*') (Last-Log)
    foreach ($m in 1, 11, 21, 31, 41) { Run -Prices $m -Dispatch 401 }   # manual run: fresh
    foreach ($m in 51, 61) { Run -Prices $m -Dispatch 401 }               # stale again
    Check '22 Oct: manual run, then stale again -> still nothing' ((Slack).Count -eq 1) ((Slack) -join ' / ')
    Run -Prices 62 -Dispatch 204                                          # new token
    Check '22 Oct: one good trigger is not yet "fixed"' ((Slack).Count -eq 1) ((Slack) -join ' / ')
    Run -Prices 8 -Dispatch 204
    Check '22 Oct: second good trigger -> one "fixed"' ((Slack).Count -eq 2 -and (Slack)[1] -like '*can trigger price updates again*') ((Slack) -join ' / ')
    foreach ($m in 9, 9, 9) { Run -Prices $m -Dispatch 204 }
    Check '22 Oct: 2 messages in total (was 6)' ((Slack).Count -eq 2) ((Slack) -join ' / ')

    # 2. Stale prices with a working trigger: 2 stale checks in a row to alert,
    #    2 fresh in a row for "recovered"; a blip either way posts nothing.
    New-Scenario
    Run -Prices 50
    Check 'stale once -> nothing' ((Slack).Count -eq 0) ((Slack) -join ' / ')
    Run -Prices 5
    Run -Prices 50
    Check 'stale, fresh, stale -> nothing' ((Slack).Count -eq 0) ((Slack) -join ' / ')
    Run -Prices 60
    Check 'stale twice in a row -> one stale alert' ((Slack).Count -eq 1 -and (Slack)[0] -like '*Banner prices are stale*') ((Slack) -join ' / ')
    Run -Prices 70
    Run -Prices 3
    Run -Prices 50
    Check 'still stale, one fresh blip, stale -> no new message' ((Slack).Count -eq 1) ((Slack) -join ' / ')
    Run -Prices 3
    Check 'one fresh check -> not yet recovered' ((Slack).Count -eq 1) ((Slack) -join ' / ')
    Run -Prices 8
    Check 'two fresh checks in a row -> one "recovered"' ((Slack).Count -eq 2 -and (Slack)[1] -like '*Banner prices recovered*') ((Slack) -join ' / ')
    Run -Prices 9
    Check 'and nothing after it' ((Slack).Count -eq 2) ((Slack) -join ' / ')

    # 3. Unchanged rates (markets closed) still count as fresh.
    New-Scenario
    $json = Set-Prices 120
    $ctl.branchJson = $json
    $ctl.lastRunAt = [DateTime]::UtcNow.AddMinutes(-5).ToString('yyyy-MM-ddTHH:mm:ssZ')
    Run -PricesPath $PricesFile
    Run -PricesPath $PricesFile
    Check 'unchanged rates (gh-pages same file, recent good run) -> no alert' ((Slack).Count -eq 0 -and (Last-Log) -like '*rates unchanged*') "$((Slack) -join ' / ') $(Last-Log)"

    # 4. Trigger: 2 non-token failures post nothing, the 3rd alerts; a single
    #    401 blip posts nothing.
    New-Scenario
    Run -Dispatch 401
    Run -Dispatch 204
    Check 'a single 401 blip -> nothing' ((Slack).Count -eq 0) ((Slack) -join ' / ')
    Run -Dispatch 500
    Run -Dispatch 500
    Check '500 twice -> nothing' ((Slack).Count -eq 0) ((Slack) -join ' / ')
    Run -Dispatch 500
    Check '500 three times -> one alert' ((Slack).Count -eq 1 -and (Slack)[0] -like '*HTTP 500*') ((Slack) -join ' / ')
    Run -Dispatch 204
    Run -Dispatch 500
    Run -Dispatch 204
    Check 'good, bad, good while alerted -> no "fixed" yet' ((Slack).Count -eq 1) ((Slack) -join ' / ')
    Run -Dispatch 204
    Check 'two good in a row -> one "fixed"' ((Slack).Count -eq 2 -and (Slack)[1] -like '*again*') ((Slack) -join ' / ')

    # 5. prices.json unreadable: 3 in a row to alert, 2 good in a row for fixed.
    New-Scenario
    $missing = Join-Path $script:dir 'no-such-prices.json'
    Run -PricesPath $missing
    Run -PricesPath $missing
    Check "can't read twice -> nothing" ((Slack).Count -eq 0) ((Slack) -join ' / ')
    Run -PricesPath $missing
    Check "can't read 3 times -> one alert" ((Slack).Count -eq 1 -and (Slack)[0] -like "*can't read prices.json*") ((Slack) -join ' / ')
    Run -Prices 5
    Check 'one good read -> not yet fixed' ((Slack).Count -eq 1) ((Slack) -join ' / ')
    Run -Prices 5
    Check 'two good reads -> one "fixed"' ((Slack).Count -eq 2 -and (Slack)[1] -like '*can read prices.json again*') ((Slack) -join ' / ')

    # 6. Slack down when an alert is due: retried on the next run, sent once.
    New-Scenario
    Run -Dispatch 403
    $ctl.slackDown = $true
    Run -Dispatch 403
    $ctl.slackDown = $false
    Check 'Slack down -> nothing recorded as sent' ((Slack).Count -eq 0) ((Slack) -join ' / ')
    Run -Dispatch 403
    Run -Dispatch 403
    Check 'next run posts it, once' ((Slack).Count -eq 1 -and (Slack)[0] -like '*HTTP 403*') ((Slack) -join ' / ')

    # 7. A state.json written by the old script (fewer fields, plus one it no
    #    longer uses) still loads; an alert open in it is not re-posted.
    New-Scenario
    Set-Content -Path (Join-Path $script:dir 'state.json') -Encoding UTF8 -Value (
        '{"staleSince":null,"stale":false,"expiryReminded":false,"triggerAlerted":true,' +
        '"checkFailures":0,"triggerFailures":4,"checkAlerted":false}')
    Run -Dispatch 401
    Check 'old state.json: open trigger alert not re-posted' ((Slack).Count -eq 0) ((Slack) -join ' / ')
    Run -Dispatch 204
    Run -Dispatch 204
    Check 'old state.json: then one "fixed"' ((Slack).Count -eq 1 -and (Slack)[0] -like '*again*') ((Slack) -join ' / ')

    # 8. Safety: the overrides are refused without -Test.
    $ErrorActionPreference = 'Continue'   # its error goes to stderr, on purpose
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Watchdog -PricesUrl $PricesFile `
        -StateDir $script:dir -NoTrigger -SlackUrl "$Base/slack" 2>&1 | Out-Null
    Check '-SlackUrl without -Test is refused' ($LASTEXITCODE -ne 0) "exit $LASTEXITCODE"
    $ErrorActionPreference = 'Stop'
    Check 'every message was a [TEST] message to the fake Slack' (@($ctl.slack | Where-Object { $_ -notlike '`[TEST`]*' }).Count -eq 0)
} finally {
    $listener.Stop(); $listener.Close()
    [void]$server.EndInvoke($async); $server.Dispose()
    Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
}

$passed = @($results | Where-Object { $_ }).Count
"`n$passed/$($results.Count) passed"
if ($passed -ne $results.Count) { exit 1 }
exit 0
