# VibeHub tracker - setup-only install for Windows (PowerShell).
#
#   $env:VIBEHUB_TOKEN="<TRACKER_TOKEN>"; irm https://web-production-da778.up.railway.app/tracker/install.ps1 | iex
#
# What it does: downloads the single-file tracker to %USERPROFILE%\.vibehub\app
# and validates + saves your token. That is the whole job.
#
# What it never does, on every code path:
#   - start, stop or restart the tracker daemon
#   - spawn a detached or background process
#   - register OS autostart (Task Scheduler, Run key, Startup folder)
# Installing the tracker and allowing it to run in the background are two
# separate decisions and this script only makes the first one. There is no
# flag, argument or environment variable that turns a background start back on
# here: starting the tracker is a command you run yourself, printed at the end.
# See meta/plans/vibehub-tracker-explicit-start.md.
#
# Once you do start it, the tracker reads only local AI-tool logs and window
# titles; no code, prompts or diffs ever leave your machine.
$ErrorActionPreference = "Stop"

$Token  = $env:VIBEHUB_TOKEN
$WebUrl = if ($env:VIBEHUB_WEB_URL) { $env:VIBEHUB_WEB_URL } else { "https://web-production-da778.up.railway.app" }
$ApiUrl = if ($env:VIBEHUB_API_URL) { $env:VIBEHUB_API_URL } else { "https://server-production-cc06.up.railway.app" }
$AppDir = Join-Path $HOME ".vibehub\app"
$Bin    = Join-Path $AppDir "vibehub-tracker.cjs"

if (-not $Token) {
  Write-Error 'Set $env:VIBEHUB_TOKEN first (create a token in VibeHub -> Settings -> Tracker).'
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error "Node.js 18+ is required. Install it from https://nodejs.org and re-run."
}
# Parsed from `node --version` rather than `node -p '...split(".")...'`: Windows
# PowerShell 5.1 strips embedded double-quotes when it rewrites a quoted argument
# for a native (non-PowerShell) executable, so the eval'd JS arrived as
# `process.versions.node.split(.)[0]` (a SyntaxError) on every real Windows
# machine - `$major` always came out 0 and this always aborted with a false
# "Node.js 0 found; 18+ is required.", even with Node 18+ installed. Parsing
# PowerShell's own string output avoids passing quoted JS through the native
# command line at all.
$major = [int]((node --version).Trim() -replace '^v(\d+)\..*', '$1')
if ($major -lt 18) {
  Write-Error "Node.js $major found; 18+ is required."
}

New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
Write-Host "-> downloading tracker"
# PS 5.1's progress bar slows large downloads and can stall in non-interactive
# hosts (agent terminals); bounded so a dead connection fails instead of hanging.
$ProgressPreference = "SilentlyContinue"
Invoke-WebRequest -Uri "$WebUrl/tracker/vibehub-tracker.cjs" -OutFile $Bin -UseBasicParsing -TimeoutSec 60
# A 200 that isn't the tracker (a captive portal, or an SPA index.html served for
# an unknown path) would otherwise surface much later as a confusing node
# SyntaxError. Fail here, before the token is sent anywhere.
$size = (Get-Item $Bin).Length
if ($size -lt 1024) {
  Write-Error "Downloaded $size bytes from $WebUrl/tracker/vibehub-tracker.cjs - that is not the tracker. Nothing was installed."
}

Write-Host "-> saving token"
node "$Bin" login $Token --api-url $ApiUrl
# $ErrorActionPreference only governs PowerShell cmdlets - a native exe's non-zero
# exit code doesn't throw on its own, so `login`'s exit(1) on a rejected token
# would otherwise be silently ignored and this script would go on to report a
# successful install for a token it already knows is bad. Check explicitly.
if ($LASTEXITCODE -ne 0) {
  Write-Error "Login failed - see the message above. The tracker was downloaded, but no token was saved."
}

# Setup ends here, deliberately. No start, no stop, no autostart registration.
Write-Host ""
Write-Host "OK Installed."
Write-Host ('    start:   node "' + $Bin + '" start')
Write-Host ('    status:  node "' + $Bin + '" status')
Write-Host ('    stop:    node "' + $Bin + '" stop')
Write-Host "  start runs in the background until you stop it."
