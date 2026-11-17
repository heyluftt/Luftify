# Builds Luftify and publishes it as a release on GitHub, without the update
# server. Installed apps find the release by themselves and offer the download.
#
#   powershell -ExecutionPolicy Bypass -File scripts/Publish-GitHub.ps1 -Version 0.1.37
#
# What is new comes from apps/desktop/release-notes.md (German) and
# release-notes.en.md (English): "# 0.1.37" on top and one "- point" per line.
# The release text holds the English points, a "---" line and the German ones;
# the app shows the part in its language.
#
# Steps: checks, version into tauri.conf.json, build, commit "Version x.y.z"
# here, public copy (scripts/export-public.py) committed and pushed, release
# with the installer. Everything meant for the release has to be committed.
#
# -SkipBuild uses an installer of that version that is already built.
# -DryRun runs the checks and shows the release text; nothing is changed.
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [switch]$SkipBuild,
  [switch]$DryRun,
  [string]$Repository = "heyluftt/Luftify",
  [string]$PublicCopy
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root "apps/desktop"
if (-not $PublicCopy) { $PublicCopy = Join-Path (Split-Path -Parent $root) "Luftify-Public" }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version bitte als 1.2.3 angeben." }

# Native programs report on stderr. With ErrorActionPreference Stop, Windows
# PowerShell 5.1 turns that into a terminating error, so they run with
# Continue; the exit code decides.
function Invoke-Native([string]$Directory, [scriptblock]$Command) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  Push-Location $Directory
  try { $output = (& $Command 2>&1 | ForEach-Object { "$_" }) -join "`n" }
  finally { Pop-Location; $ErrorActionPreference = $previous }
  return [pscustomobject]@{ Code = $LASTEXITCODE; Output = $output }
}
function Assert-Native([string]$Directory, [string]$What, [scriptblock]$Command) {
  $result = Invoke-Native $Directory $Command
  if ($result.Code -ne 0) { throw "$What fehlgeschlagen.`n$($result.Output)" }
  return $result.Output
}

$confPath = Join-Path $root "apps/desktop/src-tauri/tauri.conf.json"
$conf = Get-Content $confPath -Raw | ConvertFrom-Json
if ([version]$Version -lt [version]$conf.version) { throw "Version $Version ist älter als $($conf.version)." }

# Only the points under the newest heading count; older sections stay as history.
function Read-Notes([string]$file) {
  $path = Join-Path $desktop $file
  if (-not (Test-Path $path)) { throw "apps/desktop/$file fehlt." }
  $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
  $heading = [regex]::Match($text, '(?m)^#\s*v?(\d+\.\d+\.\d+)')
  if (-not $heading.Success) { throw "$file braucht oben eine Zeile wie `"# $Version`"." }
  if ($heading.Groups[1].Value -ne $Version) { throw "$file beschreibt $($heading.Groups[1].Value), nicht $Version. Bitte zuerst anpassen." }
  $points = @()
  foreach ($line in ($text.Substring($heading.Index + $heading.Length) -split "`r?`n")) {
    $line = $line.Trim()
    if ($line -match '^#\s*v?\d+\.\d+\.\d+') { break }
    if ($line -and -not $line.StartsWith("#")) { $points += $line }
  }
  if (-not $points) { throw "$file enthält für $Version keine Punkte." }
  return ($points -join "`n")
}
$notes = Read-Notes "release-notes.md"
$notesEn = Read-Notes "release-notes.en.md"
$body = "$notesEn`n`n---`n`n$notes`n"

# Problems that stop a real run are only listed in a dry run.
$problems = @()
function Stop-Or-Note([string]$message) {
  if ($DryRun) { $script:problems += $message } else { throw $message }
}

# Installed apps ask the public repository without signing in.
$visibility = Invoke-Native $root { gh repo view $Repository --json visibility --jq .visibility }
if ($visibility.Code -ne 0) { Stop-Or-Note "Repository $Repository nicht gefunden (gh angemeldet?)." }
elseif ($visibility.Output.Trim() -ne "PUBLIC") { Stop-Or-Note "Repository $Repository ist nicht öffentlich; installierte Apps sähen das Release nicht." }

# Installed apps compare version numbers only.
$latest = Invoke-Native $root { gh release view --repo $Repository --json tagName --jq .tagName }
if ($latest.Code -eq 0 -and $latest.Output.Trim() -match '^v?(\d+\.\d+\.\d+)$' -and [version]$Version -le [version]$Matches[1]) {
  Stop-Or-Note "Auf GitHub ist schon $($Matches[1]). Bitte eine höhere Version angeben."
}

# The public copy is written from the last commit here.
$changed = @((Assert-Native $root "git diff" { git diff --ignore-cr-at-eol --name-only HEAD }) -split "`n") +
  @((Assert-Native $root "git ls-files" { git ls-files --others --exclude-standard }) -split "`n") |
  Where-Object { $_ -and $_ -notmatch '^warning:' -and $_ -ne "apps/desktop/src-tauri/tauri.conf.json" }
if ($changed) { Stop-Or-Note "Nicht committete Änderungen, die im Release fehlen würden:`n  $($changed -join "`n  ")" }

if (-not (Test-Path (Join-Path $PublicCopy ".git"))) { Stop-Or-Note "Öffentliche Kopie fehlt: $PublicCopy (python scripts/export-public.py, dann git init und Remote setzen)." }
else {
  $remote = Invoke-Native $PublicCopy { git remote get-url origin }
  if ($remote.Code -ne 0) { Stop-Or-Note "Die öffentliche Kopie hat kein Remote `"origin`" (https://github.com/$Repository.git)." }
  elseif ($remote.Output.Trim() -notmatch [regex]::Escape($Repository)) { Stop-Or-Note "Das Remote der öffentlichen Kopie zeigt auf $($remote.Output.Trim()), nicht auf $Repository." }
}

if ($DryRun) {
  Write-Host "Probelauf für Luftify $Version, nichts wurde geändert."
  Write-Host "`nRelease-Text:`n$body"
  if ($problems) { Write-Host "Vor dem echten Lauf zu klären:"; $problems | ForEach-Object { Write-Host "  - $_" } }
  else { Write-Host "Alle Prüfungen bestanden." }
  return
}

# Typecheck and tests first: a broken version should not reach anyone.
foreach ($check in @("typecheck", "test")) {
  Write-Host "Prüfe ($check) …"
  Assert-Native $desktop "Prüfung ($check)" { pnpm $check } | Out-Null
}

if ($conf.version -ne $Version) {
  $raw = Get-Content $confPath -Raw
  $raw = $raw -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`""
  [System.IO.File]::WriteAllText($confPath, $raw, (New-Object System.Text.UTF8Encoding $false))
}

$bundle = Join-Path $root "target/release/bundle/nsis"
if (-not $SkipBuild) {
  Write-Host "Baue Luftify $Version …"
  Push-Location $root
  try {
    pnpm build:app
    if ($LASTEXITCODE -ne 0) { throw "Build fehlgeschlagen." }
  } finally { Pop-Location }
}
$installer = Get-ChildItem $bundle -Filter "*_$($Version)_x64-setup.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $installer) { throw "Installer für $Version nicht gefunden in $bundle. Ohne -SkipBuild erneut starten." }

# The version number alone, so the public copy carries it.
$versionChanged = Invoke-Native $root { git diff --ignore-cr-at-eol --quiet HEAD -- apps/desktop/src-tauri/tauri.conf.json }
if ($versionChanged.Code -ne 0) {
  Assert-Native $root "Commit der Version" { git commit -q -m "Version $Version" -- apps/desktop/src-tauri/tauri.conf.json } | Out-Null
}

Write-Host "Schreibe die öffentliche Kopie …"
Assert-Native $root "Export" { python scripts/export-public.py $PublicCopy } | Out-Null
Assert-Native $PublicCopy "git add" { git add -A } | Out-Null
$staged = Invoke-Native $PublicCopy { git diff --cached --quiet }
if ($staged.Code -ne 0) {
  Assert-Native $PublicCopy "Commit der öffentlichen Kopie" { git commit -q -m "Version $Version" } | Out-Null
}
Assert-Native $PublicCopy "Push" { git push origin HEAD } | Out-Null

$notesFile = Join-Path $env:TEMP "luftify-release-notes.md"
[System.IO.File]::WriteAllText($notesFile, $body, (New-Object System.Text.UTF8Encoding $false))
try {
  Write-Host "Lege das Release an ($([math]::Round($installer.Length / 1MB, 1)) MB) …"
  Assert-Native $root "Release" { gh release create "v$Version" $installer.FullName --repo $Repository --title "Luftify $Version" --notes-file $notesFile --latest } | Out-Null
} finally { Remove-Item $notesFile -ErrorAction SilentlyContinue }

Write-Host "Luftify $Version ist veröffentlicht: https://github.com/$Repository/releases/tag/v$Version"
Write-Host "Installierte Apps ab 0.1.37 melden das Update innerhalb einer Stunde."
