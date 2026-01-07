[CmdletBinding()]
param(
  [string]$RepoRoot = "C:\Users\J-ROB\OneDrive\Documentos\Desktop\nodejs\radiology-ai-viewer",
  [string]$FocusFile = "src\RadiologyColombiaViewer.tsx",
  [int]$Context = 40,
  [switch]$Clean,
  [switch]$Install,
  [switch]$AutoFix,
  [switch]$OpenReport,
  [switch]$Pause
)

$ErrorActionPreference = "Stop"

function NowStamp { Get-Date -Format "yyyyMMdd_HHmmss" }

function Read-Utf8NoBom([string]$p) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::ReadAllText($p, $enc)
}
function Write-Utf8NoBom([string]$p, [string]$t) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $t, $enc)
}
function Backup-File([string]$p) {
  $stamp = NowStamp
  $bak = "$p.bak_$stamp"
  Copy-Item -LiteralPath $p -Destination $bak -Force
  return $bak
}
function Normalize-Path([string]$p) {
  try { return ([System.IO.Path]::GetFullPath($p)) } catch { return $p }
}
function Get-Indent([string]$s) {
  if ($s -match '^(\s*)') { return $matches[1] }
  return ""
}

# Report builder
$script:Report = New-Object System.Text.StringBuilder
function R([string]$s) { [void]$script:Report.AppendLine($s) }

function Assert-Path([string]$p, [string]$label) {
  if (-not (Test-Path -LiteralPath $p)) { R(("- [MISSING] {0}: {1}" -f $label, $p)); return $false }
  R(("- [OK] {0}: {1}" -f $label, $p)); return $true
}

function Get-CommandVersion([string]$cmd, [string]$args) {
  try {
    $tmpOut = Join-Path $env:TEMP "doctor_cmd_out.txt"
    $tmpErr = Join-Path $env:TEMP "doctor_cmd_err.txt"
    if (Test-Path $tmpOut) { Remove-Item $tmpOut -Force -ErrorAction SilentlyContinue }
    if (Test-Path $tmpErr) { Remove-Item $tmpErr -Force -ErrorAction SilentlyContinue }

    $p = Start-Process -FilePath $cmd -ArgumentList $args -NoNewWindow -Wait -PassThru -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
    $out = ""
    if (Test-Path $tmpOut) { $out = (Get-Content $tmpOut -Raw).Trim() }
    if (-not $out -and (Test-Path $tmpErr)) { $out = (Get-Content $tmpErr -Raw).Trim() }
    return @{ ok=$true; exit=$p.ExitCode; text=$out }
  } catch {
    return @{ ok=$false; exit=$null; text="$_" }
  }
}

function Invoke-LoggedCmd {
  param(
    [Parameter(Mandatory=$true)][string]$Title,
    [Parameter(Mandatory=$true)][string]$WorkDir,
    [Parameter(Mandatory=$true)][string]$FilePath,
    [Parameter(Mandatory=$true)][string[]]$ArgumentList,
    [Parameter(Mandatory=$true)][string]$StdOutPath,
    [Parameter(Mandatory=$true)][string]$StdErrPath
  )

  R("")
  R(("## {0}" -f $Title))

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkDir -NoNewWindow -Wait -PassThru -RedirectStandardOutput $StdOutPath -RedirectStandardError $StdErrPath
  $sw.Stop()

  R(("- ExitCode: **{0}**" -f $p.ExitCode))
  R(("- Duration: **{0:n2}s**" -f $sw.Elapsed.TotalSeconds))
  R(("- Stdout: {0}" -f $StdOutPath))
  R(("- Stderr: {0}" -f $StdErrPath))

  return $p.ExitCode
}

function Read-AllTextSafe([string]$p) {
  if (-not (Test-Path -LiteralPath $p)) { return "" }
  try { return (Get-Content -LiteralPath $p -Raw) } catch { return "" }
}

function Get-PackageScripts([string]$pkgJsonPath) {
  try {
    $j = Get-Content -LiteralPath $pkgJsonPath -Raw | ConvertFrom-Json
    $h = @{}
    if ($j.scripts) { $j.scripts.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value } }
    return $h
  } catch { return @{} }
}

function Choose-PackageManager([string]$root) {
  if (Test-Path (Join-Path $root "pnpm-lock.yaml")) { return @{ name="pnpm"; install=@("pnpm","install"); ci=$null } }
  if (Test-Path (Join-Path $root "yarn.lock"))      { return @{ name="yarn"; install=@("yarn","install","--frozen-lockfile"); ci=$null } }
  if (Test-Path (Join-Path $root "package-lock.json")) { return @{ name="npm"; install=@("npm","install"); ci=@("npm","ci") } }
  return @{ name="npm"; install=@("npm","install"); ci=$null }
}

function Remove-IfExists([string]$p) {
  if (Test-Path -LiteralPath $p) {
    try { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Stop; return $true } catch { return $false }
  }
  return $false
}

function Parse-ErrorLocationsFromText([string]$text) {
  $locs = New-Object System.Collections.Generic.List[object]

  # path:line:col: ERROR
  $rxA = [regex]'(?m)([A-Za-z]:[^\r\n:]+?\.(ts|tsx|js|jsx|mjs|cjs)):(\d+):(\d+):\s*(ERROR|WARN)\b'
  foreach ($m in $rxA.Matches($text)) {
    $locs.Add([pscustomobject]@{
      File = Normalize-Path $m.Groups[1].Value
      Line = [int]$m.Groups[3].Value
      Col  = [int]$m.Groups[4].Value
      Raw  = $m.Value.Trim()
    }) | Out-Null
  }

  # file: path:line:col
  $rxB = [regex]'(?m)\bfile:\s*([A-Za-z]:[^\r\n:]+?\.(ts|tsx|js|jsx|mjs|cjs)):(\d+):(\d+)'
  foreach ($m in $rxB.Matches($text)) {
    $locs.Add([pscustomobject]@{
      File = Normalize-Path $m.Groups[1].Value
      Line = [int]$m.Groups[3].Value
      Col  = [int]$m.Groups[4].Value
      Raw  = $m.Value.Trim()
    }) | Out-Null
  }

  # TS errors: path(line,col): error TSxxxx:
  $rxC = [regex]'(?m)([A-Za-z]:[^\r\n]+?\.(ts|tsx))\((\d+),(\d+)\):\s*error\s*(TS\d+)\s*:'
  foreach ($m in $rxC.Matches($text)) {
    $locs.Add([pscustomobject]@{
      File = Normalize-Path $m.Groups[1].Value
      Line = [int]$m.Groups[3].Value
      Col  = [int]$m.Groups[4].Value
      Raw  = $m.Value.Trim()
    }) | Out-Null
  }

  return $locs
}

function Write-CodeFrameToReport([string]$file, [int]$line, [int]$col, [int]$context) {
  R(("### Code Frame: {0}:{1}:{2}" -f $file, $line, $col))
  R("")

  if (-not (Test-Path -LiteralPath $file)) {
    R("> File not found on disk.")
    return
  }

  $content = Read-Utf8NoBom $file
  $lines = [regex]::Split($content, "\r?\n")
  $total = $lines.Length
  $from = [Math]::Max(1, $line - $context)
  $to   = [Math]::Min($total, $line + $context)

  R('```tsx')
  for ($i=$from; $i -le $to; $i++) {
    $prefix = ("{0,6} | " -f $i)
    $textLine = $lines[$i-1]
    if ($i -eq $line) {
      R($prefix + $textLine)
      $caretPad = " " * ([Math]::Max(0, ($prefix.Length + $col - 1)))
      R($caretPad + "^")
    } else {
      R($prefix + $textLine)
    }
  }
  R('```')
}

function Normalize-UiShellCommentLines([System.Collections.Generic.List[string]]$L) {
  $changed = $false
  for ($i=0; $i -lt $L.Count; $i++) {
    if ($L[$i] -match '^\s*\/\*\s*(UI_SHELL_[A-Z0-9_]+)\s*\*\/\s*$') {
      $ind = Get-Indent $L[$i]
      $tag = $matches[1]
      $L[$i] = $ind + '{/* ' + $tag + ' */}'
      $changed = $true
    }
  }
  return $changed
}

function Find-Marker([System.Collections.Generic.List[string]]$L, [string]$pattern) {
  for ($i=0; $i -lt $L.Count; $i++) { if ($L[$i] -match $pattern) { return $i } }
  return -1
}

function Is-InsideStyleObject([System.Collections.Generic.List[string]]$L, [int]$markerIdx) {
  $styleOpen = -1
  for ($i=$markerIdx; $i -ge 0; $i--) {
    if ($L[$i] -match 'style\s*=\s*\{\{') { $styleOpen = $i; break }
    if ($L[$i] -match '^\s*<\w') { break }
  }
  if ($styleOpen -lt 0) { return $false }

  $styleClose = -1
  for ($i=$styleOpen; $i -lt $L.Count; $i++) {
    if ($L[$i] -match '^\s*\}\}\s*,?\s*$') { $styleClose = $i; break }
  }
  if ($styleClose -lt 0) { return $false }

  return ($markerIdx -gt $styleOpen -and $markerIdx -lt $styleClose)
}

function Move-ThumbBlock-OutOfStyle([System.Collections.Generic.List[string]]$L) {
  $beginIdx = Find-Marker $L 'UI_SHELL_THUMB_STRIP_RENDER_BEGIN'
  $endIdx   = Find-Marker $L 'UI_SHELL_THUMB_STRIP_RENDER_END'
  if ($beginIdx -lt 0 -or $endIdx -lt 0 -or $endIdx -le $beginIdx) { return @{ moved=$false; reason="Markers not found" } }

  if (-not (Is-InsideStyleObject $L $beginIdx)) { return @{ moved=$false; reason="Not inside style object" } }

  # Locate styleOpen/styleClose
  $styleOpen = -1
  for ($i=$beginIdx; $i -ge 0; $i--) { if ($L[$i] -match 'style\s*=\s*\{\{') { $styleOpen = $i; break } }
  $styleClose = -1
  for ($i=$styleOpen; $i -lt $L.Count; $i++) { if ($L[$i] -match '^\s*\}\}\s*,?\s*$') { $styleClose = $i; break } }
  if ($styleOpen -lt 0 -or $styleClose -lt 0) { return @{ moved=$false; reason="Could not locate style bounds" } }

  # Extract block
  $block = New-Object System.Collections.Generic.List[string]
  for ($i=$beginIdx; $i -le $endIdx; $i++) { [void]$block.Add($L[$i]) }

  # Remove block from bottom to top
  for ($i=$endIdx; $i -ge $beginIdx; $i--) { $L.RemoveAt($i) }

  # Adjust styleClose index after removal
  $removed = ($endIdx - $beginIdx + 1)
  $styleClose2 = $styleClose - $removed

  # Find end of opening tag after style={{...}} which is a line containing only ">" or ends with ">"
  $insertAt = -1
  $searchMax = [Math]::Min($L.Count - 1, $styleClose2 + 140)
  for ($i=$styleClose2; $i -le $searchMax; $i++) {
    $ln = $L[$i]
    if ($ln -match '^\s*>\s*$') { $insertAt = $i + 1; break }
    if (($ln -match '>\s*$') -and ($ln -notmatch '=>')) { $insertAt = $i + 1; break }
  }
  if ($insertAt -lt 0) { $insertAt = [Math]::Min($L.Count, $styleClose2 + 1) }

  # Normalize marker lines to JSX comment form
  for ($k=0; $k -lt $block.Count; $k++) {
    if ($block[$k] -match 'UI_SHELL_THUMB_STRIP_RENDER_BEGIN') {
      $ind = Get-Indent $block[$k]
      $block[$k] = $ind + '{/* UI_SHELL_THUMB_STRIP_RENDER_BEGIN */}'
    }
    if ($block[$k] -match 'UI_SHELL_THUMB_STRIP_RENDER_END') {
      $ind = Get-Indent $block[$k]
      $block[$k] = $ind + '{/* UI_SHELL_THUMB_STRIP_RENDER_END */}'
    }
  }

  # Insert block into JSX children
  for ($k=0; $k -lt $block.Count; $k++) { $L.Insert($insertAt + $k, $block[$k]) }

  return @{ moved=$true; reason=("Moved block to JSX children at index {0}" -f $insertAt) }
}

function Focus-Checks([string]$focusAbs) {
  R("")
  R("## Focus File Checks")

  if (-not (Test-Path -LiteralPath $focusAbs)) { R(("- [MISSING] Focus file: {0}" -f $focusAbs)); return }

  $raw = Read-Utf8NoBom $focusAbs
  $arr = [regex]::Split($raw, "\r?\n")
  $L = New-Object System.Collections.Generic.List[string]
  foreach ($x in $arr) { [void]$L.Add($x) }

  $beginIdx = Find-Marker $L 'UI_SHELL_THUMB_STRIP_RENDER_BEGIN'
  if ($beginIdx -ge 0) {
    if (Is-InsideStyleObject $L $beginIdx) {
      R("- [FAIL] UI_SHELL_THUMB_STRIP_RENDER_BEGIN appears inside style={{ ... }} (this causes 'Expected identifier but found {').")
    } else {
      R("- [OK] UI_SHELL_THUMB_STRIP_RENDER_BEGIN not detected inside a style object.")
    }
  } else {
    R("- [INFO] UI_SHELL_THUMB_STRIP_RENDER_BEGIN marker not found.")
  }

  $bad = @()
  for ($i=0; $i -lt $L.Count; $i++) {
    if ($L[$i] -match '\/\*\s*UI_SHELL_' -and $L[$i] -notmatch '^\s*\{\/\*') { $bad += ($i+1) }
  }
  if ($bad.Count -gt 0) { R(("- [WARN] UI_SHELL comments not JSX-wrapped at lines: {0}" -f ($bad -join ", "))) }
  else { R("- [OK] UI_SHELL comment lines look JSX-safe.") }
}

# -------------------- START --------------------
$stamp = NowStamp
$toolsDir = Join-Path $RepoRoot "tools"
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
$reportPath = Join-Path $toolsDir ("doctor_max_report_{0}.md" -f $stamp)

$pkgJson = Join-Path $RepoRoot "package.json"
$tsconfig = Join-Path $RepoRoot "tsconfig.json"
$viteTs = Join-Path $RepoRoot "vite.config.ts"
$viteJs = Join-Path $RepoRoot "vite.config.js"
$focusAbs = Normalize-Path (Join-Path $RepoRoot $FocusFile)

R(("# Doctor Max Report - {0}" -f $stamp))
R("")
R("## Preflight")
R(("- RepoRoot: {0}" -f $RepoRoot))
R(("- PowerShell: {0}" -f $PSVersionTable.PSVersion))
R(("- OS: {0}" -f ([System.Environment]::OSVersion.VersionString)))
R(("- User: {0}" -f $env:USERNAME))
R("")

$okRepo = $true
if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) { $okRepo = $false; R("- [MISSING] RepoRoot folder not found.") }
if (-not (Assert-Path $pkgJson "package.json")) { $okRepo = $false }
Assert-Path $tsconfig "tsconfig.json" | Out-Null
Assert-Path $viteTs "vite.config.ts" | Out-Null
Assert-Path $viteJs "vite.config.js" | Out-Null
Assert-Path $focusAbs ("FocusFile (" + $FocusFile + ")") | Out-Null

R("")
R("## Tooling Versions")
$node = Get-CommandVersion "node" "-v"
$npm  = Get-CommandVersion "npm"  "-v"
$git  = Get-CommandVersion "git"  "--version"
R(("- Node: {0}" -f ($(if ($node.ok) { $node.text } else { "[MISSING] " + $node.text }))))
R(("- npm: {0}"  -f ($(if ($npm.ok)  { $npm.text }  else { "[MISSING] " + $npm.text }))))
R(("- git: {0}"  -f ($(if ($git.ok)  { $git.text }  else { "[MISSING] " + $git.text }))))

if (-not $okRepo) {
  R("")
  R("## STOP")
  R("Repo preflight failed. Fix missing items above first.")
  Write-Utf8NoBom $reportPath $script:Report.ToString()
  Write-Host ("Report written: {0}" -f $reportPath) -ForegroundColor Yellow
  if ($OpenReport) { Start-Process $reportPath | Out-Null }
  exit 2
}

# Optional clean
if ($Clean) {
  R("")
  R("## Clean")
  $removed = @()
  if (Remove-IfExists (Join-Path $RepoRoot "node_modules")) { $removed += "node_modules" }
  if (Remove-IfExists (Join-Path $RepoRoot "dist")) { $removed += "dist" }
  if (Remove-IfExists (Join-Path $RepoRoot "docs\assets")) { $removed += "docs\assets" }
  R(("- Removed: {0}" -f ($(if ($removed.Count -gt 0) { $removed -join ", " } else { "(none)" }))))
}

# Optional install
$pm = Choose-PackageManager $RepoRoot
R("")
R("## Package Manager")
R(("- Detected: {0}" -f $pm.name))

if ($Install) {
  R("")
  R("## Install")
  $out = Join-Path $toolsDir ("install_{0}.out.txt" -f $stamp)
  $err = Join-Path $toolsDir ("install_{0}.err.txt" -f $stamp)

  $cmd = $pm.install
  if ($pm.name -eq "npm" -and $pm.ci -ne $null -and (Test-Path (Join-Path $RepoRoot "package-lock.json"))) {
    $cmd = $pm.ci
    R("- Using npm ci (lockfile present).")
  }

  $exitInstall = Invoke-LoggedCmd -Title "Install dependencies" -WorkDir $RepoRoot -FilePath $cmd[0] -ArgumentList ($cmd[1..($cmd.Length-1)]) -StdOutPath $out -StdErrPath $err
  if ($exitInstall -ne 0) {
    R("")
    R("### Install Failed")
    R("Stop here and fix install errors first.")
    Write-Utf8NoBom $reportPath $script:Report.ToString()
    Write-Host ("Report written: {0}" -f $reportPath) -ForegroundColor Yellow
    if ($OpenReport) { Start-Process $reportPath | Out-Null }
    exit 3
  }
}

# AutoFix on focus file (safe, targeted)
if ($AutoFix) {
  R("")
  R("## AutoFix (safe)")
  if (Test-Path -LiteralPath $focusAbs) {
    $bak = Backup-File $focusAbs
    R(("- Backup created: {0}" -f $bak))

    $raw = Read-Utf8NoBom $focusAbs
    $arr = [regex]::Split($raw, "\r?\n")
    $L = New-Object System.Collections.Generic.List[string]
    foreach ($x in $arr) { [void]$L.Add($x) }

    $changed = $false

    # Mojibake fix
    for ($i=0; $i -lt $L.Count; $i++) {
      if ($L[$i] -like "*AÃºn no hay series cargadas.*") {
        $L[$i] = $L[$i].Replace("AÃºn no hay series cargadas.", "Aún no hay series cargadas.")
        $changed = $true
      }
    }

    # Make UI_SHELL comment-only lines JSX safe
    if (Normalize-UiShellCommentLines $L) { $changed = $true }

    # Critical fix: move thumb strip block out of style object if needed
    $mv = Move-ThumbBlock-OutOfStyle $L
    if ($mv.moved) { R(("- Fixed: {0}" -f $mv.reason)); $changed = $true }
    else { R(("- AutoFix note: {0}" -f $mv.reason)) }

    if ($changed) {
      $newText = ($L -join "`r`n")
      Write-Utf8NoBom $focusAbs $newText
      R("- Focus file updated.")
    } else {
      R("- No changes applied.")
    }
  } else {
    R("- Focus file missing. AutoFix skipped.")
  }
}

# Discover scripts
R("")
R("## package.json scripts")
$scripts = Get-PackageScripts $pkgJson
if ($scripts.Count -eq 0) { R("- (none detected or JSON parse failed)") }
else { foreach ($k in ($scripts.Keys | Sort-Object)) { R(("- {0}: {1}" -f $k, $scripts[$k])) } }

# Run build, typecheck, lint
$results = New-Object System.Collections.Generic.List[object]

function Run-NpmScriptIfExists([string]$scriptName, [string]$title) {
  if (-not $scripts.ContainsKey($scriptName)) {
    R("")
    R(("## {0}" -f $title))
    R(("- Skipped: script not found: {0}" -f $scriptName))
    return $null
  }

  $out = Join-Path $toolsDir ("{0}_{1}.out.txt" -f $scriptName, $stamp)
  $err = Join-Path $toolsDir ("{0}_{1}.err.txt" -f $scriptName, $stamp)
  $exit = Invoke-LoggedCmd -Title $title -WorkDir $RepoRoot -FilePath "npm" -ArgumentList @("run",$scriptName) -StdOutPath $out -StdErrPath $err
  $results.Add([pscustomobject]@{ name=$scriptName; title=$title; exit=$exit; out=$out; err=$err }) | Out-Null
  return $exit
}

Run-NpmScriptIfExists "build" "Build (vite build)" | Out-Null

# Typecheck
if ($scripts.ContainsKey("typecheck")) {
  Run-NpmScriptIfExists "typecheck" "Typecheck (package.json script)" | Out-Null
} else {
  $tsc = Join-Path $RepoRoot "node_modules\typescript\bin\tsc"
  if (Test-Path $tsc) {
    $out = Join-Path $toolsDir ("tsc_{0}.out.txt" -f $stamp)
    $err = Join-Path $toolsDir ("tsc_{0}.err.txt" -f $stamp)
    $exit = Invoke-LoggedCmd -Title "Typecheck (npx tsc --noEmit)" -WorkDir $RepoRoot -FilePath "npx" -ArgumentList @("tsc","--noEmit","--pretty","false") -StdOutPath $out -StdErrPath $err
    $results.Add([pscustomobject]@{ name="tsc"; title="Typecheck (npx tsc --noEmit)"; exit=$exit; out=$out; err=$err }) | Out-Null
  } else {
    R("")
    R("## Typecheck")
    R("- Skipped: no typecheck script and TypeScript not present in node_modules.")
  }
}

Run-NpmScriptIfExists "lint" "Lint" | Out-Null

# Focus checks
Focus-Checks $focusAbs

# Parse logs and print code frames
R("")
R("## Error Locations and Code Frames")

$allText = ""
foreach ($r in $results) {
  $allText += "`n===== " + $r.title + " (stdout) =====`n" + (Read-AllTextSafe $r.out)
  $allText += "`n===== " + $r.title + " (stderr) =====`n" + (Read-AllTextSafe $r.err)
}

$locs = Parse-ErrorLocationsFromText $allText

if ($locs.Count -eq 0) {
  R("- No file:line:col patterns detected in logs.")
} else {
  $uniq = @{}
  foreach ($l in $locs) {
    $k = "{0}|{1}|{2}" -f $l.File, $l.Line, $l.Col
    if (-not $uniq.ContainsKey($k)) { $uniq[$k] = $l }
  }

  foreach ($k in ($uniq.Keys | Sort-Object)) {
    $l = $uniq[$k]
    R("")
    R(("- Location: {0}:{1}:{2}" -f $l.File, $l.Line, $l.Col))
    R(("- Raw: {0}" -f $l.Raw))
    Write-CodeFrameToReport -file $l.File -line $l.Line -col $l.Col -context $Context
  }
}

# Summary
R("")
R("## Summary")
$failed = $results | Where-Object { $_.exit -ne 0 }
if ($failed.Count -eq 0) {
  R("- All executed steps returned ExitCode 0.")
} else {
  R(("- Failing steps: {0}" -f (($failed | ForEach-Object { $_.title + " (ExitCode " + $_.exit + ")" }) -join "; ")))
  R("- Fix the first syntax error reported (lowest line in the first failing file), then rebuild.")
}

Write-Utf8NoBom $reportPath $script:Report.ToString()

Write-Host ""
Write-Host ("Doctor complete. Report written: {0}" -f $reportPath) -ForegroundColor Green

if ($OpenReport) { Start-Process $reportPath | Out-Null }
if ($Pause) { Read-Host "Press Enter to close" }

exit 0