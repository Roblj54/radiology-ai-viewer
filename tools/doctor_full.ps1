[CmdletBinding()]
param(
  [string]$RepoRoot = "C:\Users\J-ROB\OneDrive\Documentos\Desktop\nodejs\radiology-ai-viewer",
  [switch]$Install,       # optional: run install (npm ci / npm install)
  [switch]$Clean,         # optional: remove node_modules + dist/docs build outputs
  [string]$FocusFile = "src\RadiologyColombiaViewer.tsx",
  [int]$Context = 35,     # code frame lines before/after
  [switch]$OpenReport     # optional: open the report at the end
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

function Add-ReportLine([string]$s) {
  $script:Report.AppendLine($s) | Out-Null
}

function Assert-Path([string]$p, [string]$label) {
  if (-not (Test-Path -LiteralPath $p)) {
    Add-ReportLine ("- [MISSING] {0}: {1}" -f $label, $p)
    return $false
  } else {
    Add-ReportLine ("- [OK] {0}: {1}" -f $label, $p)
    return $true
  }
}

function Get-CommandVersion([string]$cmd, [string]$args = "--version") {
  try {
    $p = Start-Process -FilePath $cmd -ArgumentList $args -NoNewWindow -Wait -PassThru -RedirectStandardOutput "$env:TEMP\doctor_cmd_out.txt" -RedirectStandardError "$env:TEMP\doctor_cmd_err.txt"
    $out = ""
    if (Test-Path "$env:TEMP\doctor_cmd_out.txt") { $out = (Get-Content "$env:TEMP\doctor_cmd_out.txt" -Raw).Trim() }
    if (-not $out) { $out = (Get-Content "$env:TEMP\doctor_cmd_err.txt" -Raw).Trim() }
    return @{ ok = $true; exit = $p.ExitCode; text = $out }
  } catch {
    return @{ ok = $false; exit = $null; text = "$_" }
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

  Add-ReportLine ""
  Add-ReportLine ("## {0}" -f $Title)

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkDir -NoNewWindow -Wait -PassThru -RedirectStandardOutput $StdOutPath -RedirectStandardError $StdErrPath
  $sw.Stop()

  Add-ReportLine ("- ExitCode: **{0}**" -f $p.ExitCode)
  Add-ReportLine ("- Duration: **{0:n2}s**" -f $sw.Elapsed.TotalSeconds)
  Add-ReportLine ("- Stdout: `{0}`" -f $StdOutPath)
  Add-ReportLine ("- Stderr: `{0}`" -f $StdErrPath)

  return $p.ExitCode
}

function Read-AllTextSafe([string]$p) {
  if (-not (Test-Path -LiteralPath $p)) { return "" }
  try { return (Get-Content -LiteralPath $p -Raw) } catch { return "" }
}

function Normalize-Path([string]$p) {
  try { return ([System.IO.Path]::GetFullPath($p)) } catch { return $p }
}

function Get-PackageScripts([string]$pkgJsonPath) {
  try {
    $j = Get-Content -LiteralPath $pkgJsonPath -Raw | ConvertFrom-Json
    $h = @{}
    if ($j.scripts) {
      $j.scripts.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value }
    }
    return $h
  } catch {
    return @{}
  }
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
  # Return objects: File, Line, Col, Raw
  $locs = New-Object System.Collections.Generic.List[object]

  # Pattern A: path:line:col: ERROR:
  $rxA = [regex]'(?m)([A-Za-z]:[^\r\n:]+?\.(ts|tsx|js|jsx|mjs|cjs)):(\d+):(\d+):\s*(ERROR|WARN)\b'
  foreach ($m in $rxA.Matches($text)) {
    $locs.Add([pscustomobject]@{
      File = Normalize-Path $m.Groups[1].Value
      Line = [int]$m.Groups[3].Value
      Col  = [int]$m.Groups[4].Value
      Raw  = $m.Value.Trim()
    }) | Out-Null
  }

  # Pattern B: file: path:line:col
  $rxB = [regex]'(?m)\bfile:\s*([A-Za-z]:[^\r\n:]+?\.(ts|tsx|js|jsx|mjs|cjs)):(\d+):(\d+)'
  foreach ($m in $rxB.Matches($text)) {
    $locs.Add([pscustomobject]@{
      File = Normalize-Path $m.Groups[1].Value
      Line = [int]$m.Groups[3].Value
      Col  = [int]$m.Groups[4].Value
      Raw  = $m.Value.Trim()
    }) | Out-Null
  }

  # Pattern C: TypeScript TS errors: path(line,col): error TSxxxx:
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
  if (-not (Test-Path -LiteralPath $file)) {
    Add-ReportLine ("### Code Frame: {0}:{1}:{2}" -f $file, $line, $col)
    Add-ReportLine ""
    Add-ReportLine "> File not found on disk."
    return
  }

  $lines = [regex]::Split((Read-Utf8NoBom $file), "\r?\n")
  $total = $lines.Length
  $from = [Math]::Max(1, $line - $context)
  $to   = [Math]::Min($total, $line + $context)

  Add-ReportLine ("### Code Frame: {0}:{1}:{2}" -f $file, $line, $col)
  Add-ReportLine ""
  Add-ReportLine "```tsx"
  for ($i=$from; $i -le $to; $i++) {
    $prefix = ("{0,6} | " -f $i)
    $textLine = $lines[$i-1]
    if ($i -eq $line) {
      Add-ReportLine ($prefix + $textLine)
      $caretPad = " " * ([Math]::Max(0, ($prefix.Length + $col - 1)))
      Add-ReportLine ($caretPad + "^")
    } else {
      Add-ReportLine ($prefix + $textLine)
    }
  }
  Add-ReportLine "```"
}

function Quick-UiShellChecks([string]$focusAbs) {
  Add-ReportLine ""
  Add-ReportLine "## Focus File Checks"

  if (-not (Test-Path -LiteralPath $focusAbs)) {
    Add-ReportLine ("- Focus file missing: `{0}`" -f $focusAbs)
    return
  }

  $raw = Read-Utf8NoBom $focusAbs
  $lines = [regex]::Split($raw, "\r?\n")

  # 1) Marker inside style={{ ... }} detection
  $begin = -1
  for ($i=0; $i -lt $lines.Length; $i++) { if ($lines[$i] -match 'UI_SHELL_THUMB_STRIP_RENDER_BEGIN') { $begin = $i; break } }
  if ($begin -ge 0) {
    $styleOpen = -1
    for ($i=$begin; $i -ge 0; $i--) { if ($lines[$i] -match 'style\s*=\s*\{\{') { $styleOpen = $i; break } }
    $styleClose = -1
    if ($styleOpen -ge 0) {
      for ($i=$styleOpen; $i -lt $lines.Length; $i++) { if ($lines[$i] -match '^\s*\}\}\s*,?\s*$') { $styleClose = $i; break } }
    }
    if ($styleOpen -ge 0 -and $styleClose -ge 0 -and $begin -gt $styleOpen -and $begin -lt $styleClose) {
      Add-ReportLine ("- [FAIL] UI_SHELL_THUMB_STRIP_RENDER_BEGIN appears inside `style={{{{ ... }}}}` between lines {0} and {1}." -f ($styleOpen+1), ($styleClose+1))
      Add-ReportLine "  - This typically triggers esbuild errors like `Expected identifier but found '{'`."
    } else {
      Add-ReportLine "- [OK] UI_SHELL_THUMB_STRIP_RENDER_BEGIN is not detected inside a style object."
    }
  } else {
    Add-ReportLine "- [INFO] UI_SHELL_THUMB_STRIP_RENDER_BEGIN marker not found in focus file."
  }

  # 2) JSX comment validity scan for UI_SHELL markers
  $badComments = @()
  for ($i=0; $i -lt $lines.Length; $i++) {
    if ($lines[$i] -match '\/\*\s*UI_SHELL_' -and $lines[$i] -notmatch '^\s*\{\s*\/\*') {
      $badComments += ($i+1)
    }
  }
  if ($badComments.Count -gt 0) {
    Add-ReportLine ("- [WARN] Found UI_SHELL comments not wrapped as JSX comments (`{/* ... */}`) at lines: {0}" -f ($badComments -join ", "))
  } else {
    Add-ReportLine "- [OK] UI_SHELL marker comments look JSX-safe."
  }

  # 3) Quick JSX tag balance scan (best effort, not a full parser)
  $stack = New-Object System.Collections.Generic.Stack[string]
  $void = @("area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr")
  $rxTag = [regex]'(?s)<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:_-]*)\b([^>]*?)>'
  $selfCloseRx = [regex]'\/\s*>$'

  $tagMismatches = New-Object System.Collections.Generic.List[string]
  $text = $raw

  foreach ($m in $rxTag.Matches($text)) {
    $isClose = ($m.Groups[1].Value -eq "/")
    $name = $m.Groups[2].Value
    $full = $m.Value

    # skip doctype / fragments like <> or </> (handled poorly by regex)
    if ($name -eq "") { continue }

    # ignore void tags and self-closing
    $isSelf = $selfCloseRx.IsMatch($full)
    if (-not $isClose) {
      if ($void -contains $name.ToLower()) { continue }
      if ($isSelf) { continue }
      $stack.Push($name) | Out-Null
    } else {
      if ($stack.Count -eq 0) {
        $tagMismatches.Add("Closing </$name> found with empty stack.") | Out-Null
        continue
      }
      $top = $stack.Pop()
      if ($top -ne $name) {
        $tagMismatches.Add("Tag mismatch: expected </$top> but found </$name>.") | Out-Null
      }
    }
  }

  if ($tagMismatches.Count -gt 0) {
    Add-ReportLine "- [WARN] Quick JSX scan found possible mismatches:"
    foreach ($x in ($tagMismatches | Select-Object -First 10)) { Add-ReportLine ("  - {0}" -f $x) }
    if ($tagMismatches.Count -gt 10) { Add-ReportLine ("  - ... plus {0} more" -f ($tagMismatches.Count - 10)) }
    Add-ReportLine "  - Use the build error locations below to confirm with exact code frames."
  } else {
    Add-ReportLine "- [OK] Quick JSX scan did not detect obvious mismatches (not a guarantee)."
  }
}

# -------------------- START REPORT --------------------
$stamp = NowStamp
$toolsDir = Join-Path $RepoRoot "tools"
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
$reportPath = Join-Path $toolsDir ("doctor_full_report_{0}.md" -f $stamp)

$script:Report = New-Object System.Text.StringBuilder
Add-ReportLine ("# Doctor Full Report - {0}" -f $stamp)
Add-ReportLine ""

# -------------------- PREFLIGHT --------------------
Add-ReportLine "## Preflight"

Add-ReportLine ("- RepoRoot: `{0}`" -f $RepoRoot)
Add-ReportLine ("- PowerShell: `{0}`" -f $PSVersionTable.PSVersion)
Add-ReportLine ("- OS: `{0}`" -f ([System.Environment]::OSVersion.VersionString))
Add-ReportLine ("- User: `{0}`" -f $env:USERNAME)
Add-ReportLine ""

$pkgJson = Join-Path $RepoRoot "package.json"
$tsconfig = Join-Path $RepoRoot "tsconfig.json"
$viteA = Join-Path $RepoRoot "vite.config.ts"
$viteB = Join-Path $RepoRoot "vite.config.js"
$focusAbs = Normalize-Path (Join-Path $RepoRoot $FocusFile)

$okRepo = $true
if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) { $okRepo = $false; Add-ReportLine "- [MISSING] RepoRoot folder not found." }
if (-not (Assert-Path $pkgJson "package.json")) { $okRepo = $false }
Assert-Path $tsconfig "tsconfig.json" | Out-Null
Assert-Path $viteA "vite.config.ts" | Out-Null
Assert-Path $viteB "vite.config.js" | Out-Null
Assert-Path $focusAbs ("FocusFile (" + $FocusFile + ")") | Out-Null

Add-ReportLine ""
Add-ReportLine "## Tooling Versions"

$node = Get-CommandVersion "node" "-v"
$npm  = Get-CommandVersion "npm"  "-v"
$git  = Get-CommandVersion "git"  "--version"

if ($node.ok) { Add-ReportLine ("- Node: `{0}`" -f $node.text) } else { Add-ReportLine ("- Node: [MISSING] {0}" -f $node.text) }
if ($npm.ok)  { Add-ReportLine ("- npm: `{0}`" -f $npm.text) }   else { Add-ReportLine ("- npm: [MISSING] {0}" -f $npm.text) }
if ($git.ok)  { Add-ReportLine ("- git: `{0}`" -f $git.text) }   else { Add-ReportLine ("- git: [MISSING] {0}" -f $git.text) }

# -------------------- CLEAN / INSTALL --------------------
if (-not $okRepo) {
  Add-ReportLine ""
  Add-ReportLine "## STOP"
  Add-ReportLine "Repo preflight failed. Fix missing items above first."
  Write-Utf8NoBom $reportPath $script:Report.ToString()
  Write-Host ("Report written: {0}" -f $reportPath) -ForegroundColor Yellow
  if ($OpenReport) { Start-Process $reportPath | Out-Null }
  exit 2
}

$pm = Choose-PackageManager $RepoRoot
Add-ReportLine ""
Add-ReportLine "## Package Manager"
Add-ReportLine ("- Detected: **{0}**" -f $pm.name)

if ($Clean) {
  Add-ReportLine ""
  Add-ReportLine "## Clean"
  $removed = @()
  if (Remove-IfExists (Join-Path $RepoRoot "node_modules")) { $removed += "node_modules" }
  if (Remove-IfExists (Join-Path $RepoRoot "dist")) { $removed += "dist" }
  if (Remove-IfExists (Join-Path $RepoRoot "docs\assets")) { $removed += "docs\assets" }
  Add-ReportLine ("- Removed: {0}" -f ($(if ($removed.Count -gt 0) { $removed -join ", " } else { "(none)" })))
}

if ($Install) {
  Add-ReportLine ""
  Add-ReportLine "## Install"
  $out = Join-Path $toolsDir ("install_{0}.out.txt" -f $stamp)
  $err = Join-Path $toolsDir ("install_{0}.err.txt" -f $stamp)

  $cmd = $pm.install
  if ($pm.name -eq "npm" -and $pm.ci -ne $null -and (Test-Path (Join-Path $RepoRoot "package-lock.json"))) {
    $cmd = $pm.ci
    Add-ReportLine "- Using npm ci (lockfile present)."
  }

  $exitInstall = Invoke-LoggedCmd -Title "Install dependencies" -WorkDir $RepoRoot -FilePath $cmd[0] -ArgumentList ($cmd[1..($cmd.Length-1)]) -StdOutPath $out -StdErrPath $err
  if ($exitInstall -ne 0) {
    Add-ReportLine ""
    Add-ReportLine "### Install Failed"
    Add-ReportLine "Stop here and fix install errors first."
    Write-Utf8NoBom $reportPath $script:Report.ToString()
    Write-Host ("Report written: {0}" -f $reportPath) -ForegroundColor Yellow
    if ($OpenReport) { Start-Process $reportPath | Out-Null }
    exit 3
  }
}

# -------------------- SCRIPTS DISCOVERY --------------------
Add-ReportLine ""
Add-ReportLine "## package.json scripts"
$scripts = Get-PackageScripts $pkgJson
if ($scripts.Count -eq 0) {
  Add-ReportLine "- (none detected or JSON parse failed)"
} else {
  foreach ($k in ($scripts.Keys | Sort-Object)) {
    Add-ReportLine ("- **{0}**: `{1}`" -f $k, $scripts[$k])
  }
}

# -------------------- RUN COMMANDS --------------------
$results = New-Object System.Collections.Generic.List[object]

function Run-NpmScriptIfExists([string]$scriptName, [string]$title) {
  if (-not $scripts.ContainsKey($scriptName)) {
    Add-ReportLine ""
    Add-ReportLine ("## {0}" -f $title)
    Add-ReportLine ("- Skipped: script `{0}` not found in package.json" -f $scriptName)
    return $null
  }

  $out = Join-Path $toolsDir ("{0}_{1}.out.txt" -f $scriptName, $stamp)
  $err = Join-Path $toolsDir ("{0}_{1}.err.txt" -f $scriptName, $stamp)

  $exit = Invoke-LoggedCmd -Title $title -WorkDir $RepoRoot -FilePath "npm" -ArgumentList @("run",$scriptName) -StdOutPath $out -StdErrPath $err
  $results.Add([pscustomobject]@{ name=$scriptName; title=$title; exit=$exit; out=$out; err=$err }) | Out-Null
  return $exit
}

# 1) Build
Run-NpmScriptIfExists "build" "Build (vite build)" | Out-Null

# 2) Typecheck
$ranTypecheck = $false
if ($scripts.ContainsKey("typecheck")) {
  Run-NpmScriptIfExists "typecheck" "Typecheck (package.json: typecheck)" | Out-Null
  $ranTypecheck = $true
} else {
  # If tsc exists in node_modules, run it directly: tsc --noEmit --pretty false
  $tscJs = Join-Path $RepoRoot "node_modules\typescript\bin\tsc"
  if (Test-Path $tscJs) {
    $out = Join-Path $toolsDir ("tsc_{0}.out.txt" -f $stamp)
    $err = Join-Path $toolsDir ("tsc_{0}.err.txt" -f $stamp)
    $exit = Invoke-LoggedCmd -Title "Typecheck (tsc --noEmit)" -WorkDir $RepoRoot -FilePath "npx" -ArgumentList @("tsc","--noEmit","--pretty","false") -StdOutPath $out -StdErrPath $err
    $results.Add([pscustomobject]@{ name="tsc"; title="Typecheck (tsc --noEmit)"; exit=$exit; out=$out; err=$err }) | Out-Null
    $ranTypecheck = $true
  } else {
    Add-ReportLine ""
    Add-ReportLine "## Typecheck"
    Add-ReportLine "- Skipped: no `typecheck` script and TypeScript not found in node_modules."
  }
}

# 3) Lint (optional)
Run-NpmScriptIfExists "lint" "Lint" | Out-Null

# -------------------- FOCUS FILE CHECKS --------------------
Quick-UiShellChecks $focusAbs

# -------------------- PARSE LOGS AND PRINT CODE FRAMES --------------------
Add-ReportLine ""
Add-ReportLine "## Error Locations and Code Frames"

$allText = ""
foreach ($r in $results) {
  $allText += "`n===== " + $r.title + " (stdout) =====`n"
  $allText += (Read-AllTextSafe $r.out)
  $allText += "`n===== " + $r.title + " (stderr) =====`n"
  $allText += (Read-AllTextSafe $r.err)
}

$locs = Parse-ErrorLocationsFromText $allText

if ($locs.Count -eq 0) {
  Add-ReportLine "- No file:line:col patterns detected in captured logs."
  Add-ReportLine "  - If build still failed, scroll the raw logs listed above."
} else {
  # Deduplicate
  $uniq = @{}
  foreach ($l in $locs) {
    $k = "{0}|{1}|{2}" -f $l.File, $l.Line, $l.Col
    if (-not $uniq.ContainsKey($k)) { $uniq[$k] = $l }
  }

  foreach ($k in ($uniq.Keys | Sort-Object)) {
    $l = $uniq[$k]
    Add-ReportLine ""
    Add-ReportLine ("- Location: `{0}:{1}:{2}`" -f $l.File, $l.Line, $l.Col)
    Add-ReportLine ("  - Raw: `{0}`" -f $l.Raw)
    Write-CodeFrameToReport -file $l.File -line $l.Line -col $l.Col -context $Context
  }
}

# -------------------- SUMMARY --------------------
Add-ReportLine ""
Add-ReportLine "## Summary"

$failed = $results | Where-Object { $_.exit -ne 0 }
if ($failed.Count -eq 0) {
  Add-ReportLine "- All executed steps returned ExitCode 0."
} else {
  Add-ReportLine ("- Failing steps: {0}" -f (($failed | ForEach-Object { $_.title + " (ExitCode " + $_.exit + ")" }) -join "; "))
  Add-ReportLine "- Use the code frames above to fix the first syntax error, then rebuild."
  Add-ReportLine "- JSX closing tag mismatch errors usually mean a real nesting problem in TSX and must be fixed at the first reported location."
}

# -------------------- WRITE REPORT --------------------
Write-Utf8NoBom $reportPath $script:Report.ToString()

Write-Host ""
Write-Host ("Doctor complete. Report written: {0}" -f $reportPath) -ForegroundColor Green

if ($OpenReport) { Start-Process $reportPath | Out-Null }

exit 0