# VibeHub device connector. Setup only unless -Start is explicitly supplied.
# Invoke with & ([scriptblock]::Create((irm '<web>/tracker/connect.ps1' -TimeoutSec 60))) -Start
# Separate from legacy install.ps1. ASCII only, no BOM; Windows PowerShell 5.1+.
# Official Node v24.21.0 SHASUMS256.txt checked 2026-09-16. No Node origin/hash override.
param([switch]$Start)

$VibeHubStartTime = Get-Date
$UseColor = $false
$UseUtf8 = $false
try {
  if (-not $env:NO_COLOR -and -not [Console]::IsOutputRedirected) {
    $VtSignature = @'
using System;
using System.Runtime.InteropServices;
public static class VibeHubVt {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr GetStdHandle(int nStdHandle);
}
'@
    Add-Type -TypeDefinition $VtSignature -Language CSharp -ErrorAction Stop
    $StdHandle = [VibeHubVt]::GetStdHandle(-11)
    $ConsoleMode = 0
    if ([VibeHubVt]::GetConsoleMode($StdHandle, [ref]$ConsoleMode)) {
      if ([VibeHubVt]::SetConsoleMode($StdHandle, ($ConsoleMode -bor 0x0004))) { $UseColor = $true }
    }
    try { if ([Console]::OutputEncoding.CodePage -eq 65001) { $UseUtf8 = $true } } catch {}
  }
} catch { $UseColor = $false; $UseUtf8 = $false }
$Esc = [char]27
if ($UseColor) {
  $CBold = "$Esc[1m"; $CDim = "$Esc[2m"; $CGreen = "$Esc[32m"; $CRed = "$Esc[31m"; $CYellow = "$Esc[33m"; $CReset = "$Esc[0m"
} else {
  $CBold = ''; $CDim = ''; $CGreen = ''; $CRed = ''; $CYellow = ''; $CReset = ''
}
if ($UseUtf8) { $GCheck = [string][char]0x2713; $GCross = [string][char]0x2717; $GDash = [string][char]0x2014; $BH = [string][char]0x2500 }
else { $GCheck = '+'; $GCross = 'x'; $GDash = '-'; $BH = '-' }
Write-Host "${CBold}VibeHub${CReset}"
Write-Host 'Connecting this device'

$Token = $env:VIBEHUB_TOKEN
Remove-Item Env:VIBEHUB_TOKEN -ErrorAction SilentlyContinue
$OldErrorAction = $ErrorActionPreference
$OldProgress = $ProgressPreference
$OldNodeOptions = $env:NODE_OPTIONS
$OldNodePath = $env:NODE_PATH
$OldTls = [Net.ServicePointManager]::SecurityProtocol
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Stage = $null
$Lock = $null
$Failure = $null
$AttemptedStart = $false
$NodeVersion = 'v24.21.0'
$NodeOrigin = 'https://nodejs.org/dist'

function Stop-Connect([string]$Message) {
  $problem = New-Object System.InvalidOperationException($Message)
  $problem.Data['VibeHubSafe'] = $true
  throw $problem
}

function Get-Origin([string]$Value) {
  # Deliberately the same narrow origin grammar as connect.sh.
  if ($Value -cnotmatch '^(https?)://([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?|\[::1\])(:([0-9]{1,5}))?/?\z') {
    Stop-Connect 'Use an HTTPS deployment origin, without a path or credentials.'
  }
  $scheme = $Matches[1]
  $hostName = $Matches[2].ToLowerInvariant()
  $portNumber = $Matches[5]
  if ($portNumber -and ([int]$portNumber -lt 1 -or [int]$portNumber -gt 65535)) { Stop-Connect 'Invalid deployment port.' }
  if ($scheme -eq 'http' -and $hostName -notin @('localhost', '127.0.0.1', '[::1]')) {
    Stop-Connect 'HTTP is allowed only on loopback for development.'
  }
  if ($hostName -ne '[::1]') {
    foreach ($label in $hostName.Split('.')) {
      if ($label.Length -gt 63 -or $label -notmatch '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$') { Stop-Connect 'Invalid deployment hostname.' }
    }
  }
  $parsed = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$parsed)) { Stop-Connect 'Invalid deployment origin.' }
  return $Value.TrimEnd('/')
}

function Assert-Directory([string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      Stop-Connect 'Install directories must be real directories, not links or junctions.'
    }
  }
}

function Assert-File([string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      Stop-Connect 'Unexpected existing tracker/config/runtime path; no setup was attempted.'
    }
  }
}

function Get-Download([string]$Url, [string]$Target, [long]$Limit, [int]$Seconds, [string]$Credential = '') {
  # ResponseContentRead keeps the entire body inside HttpClient's cancellation
  # deadline on .NET Framework too. The buffer cap applies without Content-Length.
  # Never use a headers-only timeout followed by an unbounded ReadAsStream loop.
  $handler = New-Object Net.Http.HttpClientHandler
  $handler.AllowAutoRedirect = $false
  $client = New-Object Net.Http.HttpClient($handler)
  $client.MaxResponseContentBufferSize = $Limit
  $client.Timeout = [TimeSpan]::FromSeconds($Seconds)
  $response = $null
  try {
    if ($Credential) { $client.DefaultRequestHeaders.Authorization = New-Object Net.Http.Headers.AuthenticationHeaderValue('Bearer', $Credential) }
    $response = $client.GetAsync($Url).GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) { Stop-Connect 'The selected service returned a non-success response. Redirects are not followed.' }
    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $expected = $response.Content.Headers.ContentLength
    if ($bytes.LongLength -eq 0 -or $bytes.LongLength -gt $Limit -or ($null -ne $expected -and $bytes.LongLength -ne $expected)) {
      Stop-Connect 'Download was empty, incomplete or exceeded its size limit.'
    }
    [IO.File]::WriteAllBytes($Target, $bytes)
  } catch {
    if ($_.Exception.Data['VibeHubSafe']) { throw }
    Stop-Connect 'Download or token verification failed (network, HTTP error or timeout). Retry when the selected service is available.'
  } finally {
    if ($response) { $response.Dispose() }
    $client.Dispose()
  }
}

function Test-CompatibleNode([string]$Candidate) {
  if (-not $Candidate -or -not (Test-Path -LiteralPath $Candidate -PathType Leaf)) { return $false }
  try {
    $version = (@(& $Candidate --version 2>$null) -join "`n").Trim()
    return ($LASTEXITCODE -eq 0 -and $version -cmatch '^v([0-9]+)\.[0-9]+\.[0-9]+$' -and [int]$Matches[1] -ge 18)
  } catch { return $false }
}

function Promote-File([string]$Source, [string]$Destination) {
  Assert-File $Destination
  if (Test-Path -LiteralPath $Destination) {
    # ReplaceFile is atomic on the same local volume. If an old exe is locked,
    # fail instead of deleting it or stopping whoever is using it.
    $backup = Join-Path $Stage ([Guid]::NewGuid().ToString('N') + '.previous')
    try { [IO.File]::Replace($Source, $Destination, $backup) } catch {
      if (-not (Test-Path -LiteralPath $Destination) -and (Test-Path -LiteralPath $backup)) { [IO.File]::Move($backup, $Destination) }
      Stop-Connect 'Could not replace an installed file. The previous file was kept; close the previous setup and retry. No tracker was stopped.'
    }
  } else { [IO.File]::Move($Source, $Destination) }
}

function Install-PrivateNode([string]$Architecture) {
  if ([Environment]::OSVersion.Version.Major -lt 10) { Stop-Connect 'Automatic Node setup requires Windows 10/Server 2016 or newer.' }
  $hash = switch ($Architecture) {
    'x64' { '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541' }
    'arm64' { '8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921' }
    default { Stop-Connect 'Only Windows x64 and arm64 devices have a verified runtime.' }
  }
  $name = "node-$NodeVersion-win-$Architecture"
  $archive = Join-Path $Stage 'node.zip'
  Write-Host "  ${CDim}Downloading private Node.js $NodeVersion (win-$Architecture) from nodejs.org, SHA-256 verified before use${CReset}"
  Get-Download "$NodeOrigin/$NodeVersion/$name.zip" $archive 201326592 180
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $hash) {
    Stop-Connect 'Node SHA-256 mismatch. The download was not extracted or executed; retry with a fresh command.'
  }
  # Open only after hashing. Extract exactly node.exe + LICENSE, never ZIP paths,
  # npm installers or scripts. A changed archive layout fails closed.
  $zip = [IO.Compression.ZipFile]::OpenRead($archive)
  $candidate = Join-Path $Stage 'node.exe'
  $license = Join-Path $Stage 'LICENSE'
  try {
    foreach ($member in @('node.exe', 'LICENSE')) {
      $entry = $zip.GetEntry("$name/$member")
      if (-not $entry -or $entry.Length -le 0 -or $entry.Length -gt 201326592) { Stop-Connect 'Unexpected or incomplete Node archive layout.' }
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $Stage $member), $false)
    }
  } finally { $zip.Dispose() }
  try { $version = (@(& $candidate --version 2>$null) -join "`n").Trim() } catch { Stop-Connect 'The verified Node runtime cannot run on this Windows version. The previous runtime was kept.' }
  if ($LASTEXITCODE -ne 0 -or $version -cne $NodeVersion) { Stop-Connect 'Downloaded Node could not run or reported the wrong version. The previous runtime was kept.' }
  New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
  # Nothing fallible remains after the critical executable promotion: a failed
  # license write must leave the previously working node.exe untouched.
  Promote-File $license (Join-Path $Runtime 'LICENSE')
  Promote-File $candidate (Join-Path $Runtime 'node.exe')
  return (Join-Path $Runtime 'node.exe')
}

function Quote-PowerShell([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }

# >>> vibehub-launcher v1 -- extracted verbatim by tracker/test/installShimWindows.test.ts
# The `vibehub-tracker` command on Windows.
#
# Directory: %LOCALAPPDATA%\Programs\VibeHub. Per user, no administrator, no UAC prompt,
# and the same place VS Code and other per-user apps install to. Deliberately NOT
# %ProgramFiles% (needs elevation, and an ordinary user could then never remove it) and
# not the Node runtime folder (that belongs to the runtime, not to a command).
#
# The launcher is a .cmd, so both `cmd.exe` and PowerShell run it by bare name once the
# directory is on PATH, and a vendor's hook runner - which spawns commands through cmd -
# can invoke it as ONE quoted token instead of two nested quoted paths.
#
# Paths are written as %USERPROFILE%-relative whenever they sit under the home. A batch
# file is read in the console's OEM code page, so an absolute path through a home
# directory with non-ASCII characters would be mangled; %USERPROFILE% is expanded by cmd
# at run time and sidesteps that entirely.
$VibeHubShimMark = '# vibehub-tracker shim v1 (managed by VibeHub; safe to delete)'

function Get-VibeHubUserProfile {
  # The same variable the .cmd expands at run time, so the two always agree. ($HOME is
  # read-only in PowerShell and equals this on Windows anyway.)
  if ($env:USERPROFILE) { return $env:USERPROFILE }
  return $HOME
}

function Get-VibeHubLauncherDir {
  $base = $env:LOCALAPPDATA
  if (-not $base) { $base = Join-Path (Get-VibeHubUserProfile) 'AppData\Local' }
  return (Join-Path $base 'Programs\VibeHub')
}

function ConvertTo-VibeHubPortablePath([string]$Value) {
  $profileDir = (Get-VibeHubUserProfile).TrimEnd('\')
  if ($Value.StartsWith($profileDir + '\', [StringComparison]::OrdinalIgnoreCase)) {
    return '%USERPROFILE%' + $Value.Substring($profileDir.Length)
  }
  return $Value
}

function Get-VibeHubLauncherText([string]$Root, [string]$NodePath, [string]$CjsPath) {
  # Each concatenated element is parenthesised on purpose: in PowerShell the comma
  # operator binds TIGHTER than `+`, so `'a' + $x + 'b', 'c'` parses as
  # `'a' + $x + ('b', 'c')` and the rest of the array is swallowed into one element.
  $lines = @(
    '@echo off',
    "rem $VibeHubShimMark",
    'rem Rewritten by every VibeHub install. Removes itself once VibeHub is gone.',
    'setlocal',
    ('set "VIBEHUB_ROOT=' + (ConvertTo-VibeHubPortablePath $Root) + '"'),
    ('set "VIBEHUB_NODE=' + (ConvertTo-VibeHubPortablePath $NodePath) + '"'),
    ('set "VIBEHUB_CJS=' + (ConvertTo-VibeHubPortablePath $CjsPath) + '"'),
    'if not exist "%VIBEHUB_ROOT%\" goto vibehub_gone',
    'if not exist "%VIBEHUB_NODE%" goto vibehub_incomplete',
    'if not exist "%VIBEHUB_CJS%" goto vibehub_incomplete',
    '"%VIBEHUB_NODE%" "%VIBEHUB_CJS%" %*',
    'exit /b %ERRORLEVEL%',
    ':vibehub_gone',
    '>&2 echo vibehub-tracker: VibeHub was removed, so this command removed itself.',
    'endlocal',
    'rem cmd re-reads a batch file by byte offset, so a script that deletes itself and then',
    'rem carries on prints "cannot find the file" and exits 1. `(goto) 2>nul` pops the batch',
    'rem context first, after which the delete and the exit code both behave. Measured, not',
    'rem assumed: the three other spellings were tried and this is the one that returns 127.',
    '(goto) 2>nul & del /f /q "%~f0" >nul 2>&1 & exit /b 127',
    ':vibehub_incomplete',
    '>&2 echo vibehub-tracker: this VibeHub install is incomplete.',
    '>&2 echo   missing: %VIBEHUB_NODE% or %VIBEHUB_CJS%',
    '>&2 echo   reinstall VibeHub to repair it.',
    'exit /b 127'
  )
  # CRLF on purpose: a .cmd is a Windows-native file and cmd.exe is happiest with it.
  return (($lines -join "`r`n") + "`r`n")
}

# Returns: 'written' | 'foreign' | 'failed'. Never throws; the explicit node+path
# commands printed by Show-Controls always work regardless.
function Install-VibeHubLauncher([string]$Root, [string]$NodePath, [string]$CjsPath) {
  try {
    $dir = Get-VibeHubLauncherDir
    $target = Join-Path $dir 'vibehub-tracker.cmd'
    if (Test-Path -LiteralPath $target) {
      $item = Get-Item -LiteralPath $target -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { return 'foreign' }
      if (-not ($item -is [IO.FileInfo])) { return 'foreign' }
      $existing = [IO.File]::ReadAllText($target)
      if (-not $existing.Contains($VibeHubShimMark)) { return 'foreign' }
    }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $text = Get-VibeHubLauncherText $Root $NodePath $CjsPath
    # ASCII while it can be: a batch file is read in the console's OEM code page.
    $encoding = if ($text -cmatch '[^\u0000-\u007F]') {
      [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
    } else { [Text.Encoding]::ASCII }
    $temp = Join-Path $dir ('vibehub-tracker.cmd.new.' + [Guid]::NewGuid().ToString('N'))
    [IO.File]::WriteAllText($temp, $text, $encoding)
    [IO.File]::Copy($temp, $target, $true)
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    return 'written'
  } catch { return 'failed' }
}

function Test-VibeHubOnPath([string]$Directory) {
  $entries = @()
  foreach ($scope in @('User', 'Machine')) {
    $value = [Environment]::GetEnvironmentVariable('Path', $scope)
    if ($value) { $entries += $value.Split(';') }
  }
  if ($env:Path) { $entries += $env:Path.Split(';') }
  foreach ($entry in $entries) {
    if ($entry -and $entry.TrimEnd('\') -eq $Directory.TrimEnd('\')) { return $true }
  }
  return $false
}
# <<< vibehub-launcher v1

function Show-Controls {
  $ruleTop = (([string]$BH) * 3) + ' Installed in ~/.vibehub ' + (([string]$BH) * 22)
  $ruleBottom = ([string]$BH) * 52
  Write-Host "${CBold}$ruleTop${CReset}"
  foreach ($verb in @('start', 'status', 'stop')) { Write-Host ('  ' + ($verb + ':').PadRight(8) + '& ' + (Quote-PowerShell $Node) + ' ' + (Quote-PowerShell $Bin) + ' ' + $verb) }
  Write-Host ''
  $launcherDir = Get-VibeHubLauncherDir
  $launcher = Join-Path $launcherDir 'vibehub-tracker.cmd'
  switch ($LauncherState) {
    'written' {
      Write-Host "${CBold}Command installed${CReset} $GDash $launcher"
      if (Test-VibeHubOnPath $launcherDir) {
        Write-Host '  vibehub-tracker status'
        Write-Host '  vibehub-tracker hooks install cursor'
        Write-Host '  vibehub-tracker hooks install windsurf'
      } else {
        Write-Host "  ${CYellow}$launcherDir is not on your PATH. Add it for your account, then reopen the terminal:${CReset}"
        Write-Host ("    [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';" + $launcherDir + "', 'User')")
        Write-Host "  ${CDim}(that is the User scope, so no administrator is needed. setx would also work but truncates PATH at 1024 characters, which is why it is not the advice here.)${CReset}"
        Write-Host '  Until then, call it by path:'
        Write-Host ('    & ' + (Quote-PowerShell $launcher) + ' hooks install cursor')
        Write-Host ('    & ' + (Quote-PowerShell $launcher) + ' hooks install windsurf')
      }
      Write-Host "  ${CDim}Deleting ~/.vibehub disables it; the command then removes itself the next time you run it.${CReset}"
    }
    'foreign' { Write-Host "${CYellow}${GDash}${CReset} A different vibehub-tracker.cmd is already at $launcher $GDash left untouched; use the commands above." }
    default { Write-Host "${CYellow}${GDash}${CReset} Could not create $launcher $GDash use the commands above." }
  }
  Write-Host ''
  Write-Host "Open VibeHub $GDash it turns green after the first ping."
  Write-Host "${CDim}Connection is confirmed in VibeHub only after a fresh server heartbeat, not by this command.${CReset}"
  Write-Host "${CBold}$ruleBottom${CReset}"
}

try {
  Remove-Item Env:NODE_OPTIONS, Env:NODE_PATH -ErrorAction SilentlyContinue
  if ($args.Count -ne 0) { Stop-Connect 'Unknown option. Use -Start to explicitly allow background tracking, or omit it for setup only.' }
  if ($PSVersionTable.PSVersion -lt [version]'5.1' -or [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    Stop-Connect 'Use Windows PowerShell 5.1+ on Windows, or the macOS/Linux connector on those systems.'
  }
  $WebUrl = Get-Origin $(if ($env:VIBEHUB_WEB_URL) { $env:VIBEHUB_WEB_URL } else { 'https://web-production-da778.up.railway.app' })
  $ApiUrl = Get-Origin $(if ($env:VIBEHUB_API_URL) { $env:VIBEHUB_API_URL } else { 'https://server-production-cc06.up.railway.app' })
  Add-Type -AssemblyName System.Net.Http
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [Net.ServicePointManager]::SecurityProtocol = $OldTls -bor [Net.SecurityProtocolType]::Tls12

  if (-not $Token) {
    Write-Host "${CBold}Pairing this PC with VibeHub${CReset}"
    $computerName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'Windows PC' }
    $pairPayload = '{"deviceName":"' + $computerName.Replace('\','\\').Replace('"','\"') + '","os":"windows"}'
    $pHandler = New-Object Net.Http.HttpClientHandler
    $pHandler.AllowAutoRedirect = $false
    $pClient = New-Object Net.Http.HttpClient($pHandler)
    $pClient.Timeout = [TimeSpan]::FromSeconds(20)
    $pReq = New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Post, "$ApiUrl/api/v1/tracker/pair/request")
    $pReq.Content = New-Object Net.Http.StringContent($pairPayload, [Text.Encoding]::UTF8, 'application/json')
    $pResp = $null
    $pairData = $null
    try {
      $pResp = $pClient.SendAsync($pReq).GetAwaiter().GetResult()
      if (-not $pResp.IsSuccessStatusCode) { Stop-Connect 'Could not initiate device pairing with server.' }
      $pairData = ($pResp.Content.ReadAsStringAsync().GetAwaiter().GetResult()) | ConvertFrom-Json
    } catch {
      if ($_.Exception.Data['VibeHubSafe']) { throw }
      Stop-Connect 'Could not reach pairing service. Ensure network connection.'
    } finally {
      if ($pResp) { $pResp.Dispose() }
      $pClient.Dispose()
    }
    if (-not $pairData -or -not $pairData.deviceCode -or -not $pairData.userCode) {
      Stop-Connect 'Invalid pairing response from server.'
    }
    $deviceCode = $pairData.deviceCode
    $userCode = $pairData.userCode
    $verificationUri = $pairData.verificationUri
    Write-Host "  Opening browser to approve pairing..."
    Write-Host "  Code: ${CBold}$userCode${CReset}"
    Write-Host "  If browser does not open, visit: $verificationUri"
    try { Start-Process $verificationUri } catch {}
    Write-Host "  Waiting for approval in your browser..."
    $pollStart = Get-Date
    while ($true) {
      Start-Sleep -Seconds 2
      if (((Get-Date) - $pollStart).TotalSeconds -gt 300) {
        Stop-Connect 'Pairing timed out. Run the command again to retry.'
      }
      $pollClient = New-Object Net.Http.HttpClient($pHandler)
      $pollClient.Timeout = [TimeSpan]::FromSeconds(10)
      $pollReq = New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Post, "$ApiUrl/api/v1/tracker/pair/poll")
      $pollReq.Content = New-Object Net.Http.StringContent(('{"deviceCode":"' + $deviceCode + '"}'), [Text.Encoding]::UTF8, 'application/json')
      $pollResp = $null
      $pollData = $null
      try {
        $pollResp = $pollClient.SendAsync($pollReq).GetAwaiter().GetResult()
        if ($pollResp.IsSuccessStatusCode) {
          $pollData = ($pollResp.Content.ReadAsStringAsync().GetAwaiter().GetResult()) | ConvertFrom-Json
        }
      } catch {} finally {
        if ($pollResp) { $pollResp.Dispose() }
        $pollClient.Dispose()
      }
      if ($pollData -and $pollData.status -eq 'approved') {
        $Token = $pollData.token
        Write-Host "${CGreen}${GCheck}${CReset} Approved by @$($pollData.username)!"
        break
      }
      if ($pollData -and $pollData.status -eq 'expired') {
        Stop-Connect 'Pairing code expired. Run the command again to retry.'
      }
    }
  } elseif ($Token -cnotmatch '^[A-Za-z0-9_][A-Za-z0-9_-]{7,511}\z') {
    Stop-Connect 'Set VIBEHUB_TOKEN to a device token from VibeHub Settings > Tracker.'
  }
  if ($HOME -notmatch '^[A-Za-z]:[\\/].+' -or -not (Test-Path -LiteralPath $HOME -PathType Container)) { Stop-Connect 'An existing local user HOME directory is required; do not run as an administrator.' }
  try { $osArchitecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() } catch {
    $osArchitecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  }
  $Architecture = switch ($osArchitecture) { { $_ -in @('X64', 'AMD64') } { 'x64' } 'Arm64' { 'arm64' } default { Stop-Connect 'Only Windows x64 and arm64 devices are supported. No runtime was installed.' } }
  $Base = Join-Path $HOME '.vibehub'
  $App = Join-Path $Base 'app'
  $Bin = Join-Path $App 'vibehub-tracker.cjs'
  $Runtime = Join-Path $Base 'runtime'
  $LauncherState = 'failed'
  foreach ($dir in @($Base, $App, $Runtime)) { Assert-Directory $dir }
  foreach ($file in @($Bin, (Join-Path $Base 'config.json'), (Join-Path $Runtime 'node.exe'), (Join-Path $Runtime 'LICENSE'))) { Assert-File $file }
  New-Item -ItemType Directory -Force -Path $Base | Out-Null
  $lockPath = Join-Path $Base '.connect.lock'
  try { New-Item -ItemType Directory -Path $lockPath | Out-Null } catch {
    Stop-Connect 'Another setup may be in progress. Wait for it; if interrupted, remove only the empty .vibehub\.connect.lock directory and retry.'
  }
  $Lock = $lockPath
  $Stage = Join-Path $Base ('.connect.' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $Stage | Out-Null

  Write-Host "${CBold}What this does${CReset}"
  foreach ($line in @(
    'One device installation covers supported tools. It does not install AI apps or connect their accounts.',
    'Local reads: session logs (JSONL) of Claude Code (~/.claude/projects), Codex (~/.codex/sessions) and Quadcode AI only; no other apps, processes, windows, browsing or Git are read.',
    "Cursor and Windsurf are off until you run 'vibehub-tracker hooks install cursor' or 'vibehub-tracker hooks install windsurf'. Their own hook then writes tool, time, model and project name to ~/.vibehub/attested.jsonl, which is read only while that hook is installed. No prompt, response, transcript, path or email is read.",
    'Tokens: measured for Claude Code and Codex. Quadcode AI, Cursor and Windsurf report none, so none are shown and none are estimated.',
    'Parsing may temporarily read records containing prompts, code and tool output. These contents are not saved or sent.',
    'Uploads: tool, model, timing, token counts and a bounded project alias only.',
    'Profiles and statistics, including recent activity, are public. Live presence cards are shared with accepted friends.',
    'Connected means a recent server-accepted tracker connection. Idle means no recent supported AI activity, not an idle computer.',
    "This does not fix the collector's privacy limitations. Setup updates the saved device token; a running tracker may pick it up."
  )) { Write-Host "  ${CDim}$line${CReset}" }
  if ($Start) { Write-Host "  ${CDim}-Start allows background tracking until stopped or reboot. The tracker start command can replace an older running tracker. No OS autostart is added.${CReset}" }
  else { Write-Host "  ${CDim}Setup only: no start, stop or restart is requested.${CReset}" }

  $Node = Join-Path $Runtime 'node.exe'
  $NodeSource = 'private runtime'
  if (-not (Test-CompatibleNode $Node)) {
    $command = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command -and (Test-CompatibleNode $command.Source)) { $Node = $command.Source; $NodeSource = 'system Node' }
    else { $Node = Install-PrivateNode $Architecture }
  }
  $NodeVersionDisplay = (@(& $Node --version 2>$null) -join "`n").Trim()
  Write-Host "${CGreen}${GCheck}${CReset} [1/5] Node.js ready ($NodeVersionDisplay, $NodeSource)"
  $stagedBin = Join-Path $Stage 'vibehub-tracker.cjs'
  Get-Download "$WebUrl/tracker/vibehub-tracker.cjs" $stagedBin 8388608 120
  if ((Get-Item -LiteralPath $stagedBin).Length -lt 1024) { Stop-Connect 'The response is too small to be the tracker. The existing app was kept.' }
  & $Node --check $stagedBin *> $null
  if ($LASTEXITCODE -ne 0) { Stop-Connect 'The downloaded tracker failed its syntax check. The existing app was kept.' }
  Write-Host "${CGreen}${GCheck}${CReset} [2/5] Tracker downloaded"

  $verification = Join-Path $Stage 'verify.json'
  Get-Download "$ApiUrl/api/v1/tracker/verify" $verification 16384 20 $Token
  try { $verified = Get-Content -LiteralPath $verification -Raw | ConvertFrom-Json } catch { Stop-Connect 'The selected server did not return valid token verification JSON.' }
  if ($verified.username -isnot [string] -or -not $verified.username.Trim()) { Stop-Connect 'The selected server did not return a valid token verification response.' }
  Write-Host "${CGreen}${GCheck}${CReset} [3/5] Device token verified as @$($verified.username)"
  $loginOutput = @(& $Node $stagedBin login $Token --api-url $ApiUrl 2>&1) -join "`n"
  if ($LASTEXITCODE -ne 0) { Stop-Connect 'Login failed. No start was requested. Check your device token and selected server, then retry.' }
  if ($loginOutput -notmatch '(?m)^Logged in as ') { Stop-Connect 'Login did not confirm token verification. Configuration may have been saved, but no start was requested; retry when the server is available.' }
  Write-Host "${CGreen}${GCheck}${CReset} [4/5] Configuration saved"
  $Token = $null
  New-Item -ItemType Directory -Force -Path $App | Out-Null
  Promote-File $stagedBin $Bin
  # Everything VibeHub documents is `vibehub-tracker <command>`; make that name real.
  # Never fatal: the explicit node+path commands below always work.
  $LauncherState = Install-VibeHubLauncher $Base $Node $Bin

  # vibehub-start-anchor: explicit tracker start begins below
  if ($Start) {
    $AttemptedStart = $true
    $startOutput = @(& $Node $Bin start 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0) { Stop-Connect 'Tracker start failed. Setup remains installed; inspect it with the status command above. No connection was confirmed.' }
    if ($startOutput -notmatch '(?m)^Tracker (started \(pid [1-9][0-9]*\)|is already running \(pid [1-9][0-9]*\))') {
      Stop-Connect 'Tracker did not acknowledge a successful start. Use the status command above; no connection was confirmed.'
    }
    $statusOutput = @(& $Node $Bin status 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0 -or $statusOutput -notmatch '(?m)^Daemon:\s+running \(pid [1-9][0-9]*\)') {
      Stop-Connect 'Tracker is not running after start. Use the status command above; no connection was confirmed.'
    }
    if ($statusOutput -match '(?im)^Connected: no.*token rejected') { Stop-Connect 'The running tracker reports a rejected token. Use the status/stop commands above; no connection was confirmed.' }
    $startPid = [regex]::Match($startOutput, 'pid (\d+)').Groups[1].Value
    Write-Host "${CGreen}${GCheck}${CReset} [5/5] Start running (pid $startPid)"
  } else { Write-Host "${CYellow}${GDash}${CReset} [5/5] Start skipped (setup only)" }
  Show-Controls
  $elapsed = [math]::Round(((Get-Date) - $VibeHubStartTime).TotalSeconds)
  Write-Host "Done in ${elapsed}s."
} catch {
  $Failure = if ($_.Exception.Data['VibeHubSafe']) { $_.Exception.Message } else { 'Setup failed at the last progress step. No connection was confirmed; retry or inspect the printed status command.' }
  Write-Host "${CRed}${GCross}${CReset} $Failure"
  if (-not $AttemptedStart) { Write-Host "${CDim}Nothing was started.${CReset}" }
  else { Write-Host "${CDim}A start was attempted; check its status before retrying.${CReset}" }
} finally {
  $Token = $null
  Remove-Item Env:VIBEHUB_TOKEN -ErrorAction SilentlyContinue
  if ($Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue }
  if ($Lock) { Remove-Item -LiteralPath $Lock -ErrorAction SilentlyContinue }
  $env:NODE_OPTIONS = $OldNodeOptions
  $env:NODE_PATH = $OldNodePath
  [Net.ServicePointManager]::SecurityProtocol = $OldTls
  $ProgressPreference = $OldProgress
  $ErrorActionPreference = $OldErrorAction
}
if ($Failure) { $global:LASTEXITCODE = 1; throw $Failure }
$global:LASTEXITCODE = 0
