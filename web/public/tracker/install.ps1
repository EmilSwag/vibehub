# VibeHub tracker — one-line install for Windows (PowerShell).
#
#   $env:VIBEHUB_TOKEN="<TRACKER_TOKEN>"; irm https://web-production-da778.up.railway.app/tracker/install.ps1 | iex
#
# Downloads the single-file tracker to %USERPROFILE%\.vibehub\app, saves your
# token, and starts the background daemon. Reads only local AI-tool logs and
# window titles; no code, prompts or diffs ever leave your machine.
$ErrorActionPreference = "Stop"

$Token  = $env:VIBEHUB_TOKEN
$WebUrl = if ($env:VIBEHUB_WEB_URL) { $env:VIBEHUB_WEB_URL } else { "https://web-production-da778.up.railway.app" }
$ApiUrl = if ($env:VIBEHUB_API_URL) { $env:VIBEHUB_API_URL } else { "https://server-production-cc06.up.railway.app" }
$AppDir = Join-Path $HOME ".vibehub\app"
$Bin    = Join-Path $AppDir "vibehub-tracker.cjs"

if (-not $Token) {
  Write-Error 'Set $env:VIBEHUB_TOKEN first (create a token in VibeHub → Settings → Tracker).'
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error "Node.js 18+ is required. Install it from https://nodejs.org and re-run."
}
# Parsed from `node --version` rather than `node -p '...split(".")...'`: Windows
# PowerShell 5.1 strips embedded double-quotes when it rewrites a quoted argument
# for a native (non-PowerShell) executable, so the eval'd JS arrived as
# `process.versions.node.split(.)[0]` (a SyntaxError) on every real Windows
# machine — `$major` always came out 0 and this always aborted with a false
# "Node.js 0 found; 18+ is required.", even with Node 18+ installed. Parsing
# PowerShell's own string output avoids passing quoted JS through the native
# command line at all.
$major = [int]((node --version).Trim() -replace '^v(\d+)\..*', '$1')
if ($major -lt 18) {
  Write-Error "Node.js $major found; 18+ is required."
}

New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
Write-Host "-> downloading tracker"
Invoke-WebRequest -Uri "$WebUrl/tracker/vibehub-tracker.cjs" -OutFile $Bin -UseBasicParsing

Write-Host "-> saving token"
node $Bin login $Token --api-url $ApiUrl
# $ErrorActionPreference only governs PowerShell cmdlets — a native exe's non-zero
# exit code doesn't throw on its own, so `login`'s exit(1) on a rejected token
# (round 5) would otherwise be silently ignored and the script would carry on to
# start a daemon with a token it already knows is bad. Check explicitly.
if ($LASTEXITCODE -ne 0) {
  Write-Error "Login failed — see the message above."
}

Write-Host "-> starting daemon"
try { node $Bin stop | Out-Null } catch {}
node $Bin start

Write-Host ""
Write-Host "OK  VibeHub tracker is running."
Write-Host "    Open your VibeHub tab - 'Connect your tools' flips to Connected within ~30s."
Write-Host "    status:  node $Bin status"
Write-Host "    stop:    node $Bin stop"
Write-Host "    after reboot:  node $Bin start"
