[CmdletBinding()]
param(
  [string]$RepoRoot = "C:\Users\J-ROB\OneDrive\Documentos\Desktop\nodejs\radiology-ai-viewer",
  [switch]$Pause
)

$ErrorActionPreference = "Stop"

function Read-Utf8NoBom([string]$p) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::ReadAllText($p, $enc)
}
function Write-Utf8NoBom([string]$p, [string]$t) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $t, $enc)
}
function Backup-File([string]$p) {
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$p.bak_$stamp"
  Copy-Item -LiteralPath $p -Destination $bak -Force
  $bak
}
function Get-Indent([string]$s) {
  if ($s -match '^(\s*)') { return $matches[1] }
  return ""
}

$viewerPath = Join-Path $RepoRoot "src\RadiologyColombiaViewer.tsx"
if (-not (Test-Path -LiteralPath $viewerPath -PathType Leaf)) { throw "File not found: $viewerPath" }

$bak = Backup-File $viewerPath
Write-Host "Backup created: $bak" -ForegroundColor DarkGray

$code0 = Read-Utf8NoBom $viewerPath
$lines = New-Object System.Collections.Generic.List[string]
($code0 -split "`r?`n", 0, "Regex") | ForEach-Object { [void]$lines.Add($_) }

$needle = "Spacer so fixed topbar does not cover content"

# Helper: detect whether an index is inside a JSX return(...) block
function Is-InJsxReturn([int]$idx) {
  $lookback = 450
  $start = [Math]::Max(0, $idx - $lookback)

  $lastReturn = -1
  $lastClose  = -1

  for ($i = $idx; $i -ge $start; $i--) {
    if ($lastReturn -lt 0 -and $lines[$i] -match '^\s*return\s*\(\s*$') { $lastReturn = $i }
    if ($lastClose  -lt 0 -and $lines[$i] -match '^\s*\);\s*$')        { $lastClose  = $i }
    if ($lastReturn -ge 0 -and $lastClose -ge 0) { break }
  }

  if ($lastReturn -lt 0) { return $false }
  if ($lastClose -lt 0)  { return $true }
  return ($lastReturn -gt $lastClose)
}

# 1) Find spacer blocks (comment + top div + thumb div)
$spacerStarts = New-Object System.Collections.Generic.List[int]
for ($i=0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -like "*$needle*") {
    if (($i + 2) -lt $lines.Count) {
      $okTop   = ($lines[$i+1] -match '<div\s+style=\{\{\s*height:\s*uiShellTopH\s*\}\}\s*/>\s*$')
      $okThumb = ($lines[$i+2] -match '<div\s+style=\{\{\s*height:\s*uiShellThumbStripH\s*\}\}\s*/>\s*$')
      if ($okTop -and $okThumb) { [void]$spacerStarts.Add($i) }
    }
  }
}

# 2) For each spacer block that is OUTSIDE JSX return, comment out a whole "orphan JSX run"
# This prevents the parser from choking on standalone JSX or attribute continuation lines.
$commentedRuns = 0
for ($s = $spacerStarts.Count - 1; $s -ge 0; $s--) {
  $i = $spacerStarts[$s]
  if (Is-InJsxReturn $i) { continue }

  $runStart = $i
  $runEnd   = [Math]::Min($lines.Count - 1, $i + 2)

  for ($k = $runEnd + 1; $k -lt $lines.Count; $k++) {
    $t = $lines[$k].Trim()

    if ($t -eq "") { $runEnd = $k; continue }

    # Lines that commonly appear as JSX or JSX continuation:
    $isJsxish =
      $t.StartsWith("<") -or
      $t.StartsWith("</") -or
      $t.StartsWith("{/*") -or
      $t.StartsWith("{") -or
      $t.StartsWith("}") -or
      ($t -match '^[A-Za-z_][\w-]*\s*=\s*') -or
      ($t -match '^\s*\/?>\s*$') -or
      ($t -match '^\s*\)\s*;?\s*$')

    if ($isJsxish) { $runEnd = $k; continue }

    # Stop when code-looking line begins
    if ($t -match '^(const|let|var|function|type|interface|export|import|if|for|while|switch|try|catch|return)\b') { break }

    # Conservative: if it's not JSX-ish and not obviously code, stop
    break
  }

  for ($x = $runStart; $x -le $runEnd; $x++) {
    if ($lines[$x].TrimStart().StartsWith("//")) { continue }
    $lines[$x] = "// " + $lines[$x]
  }

  $commentedRuns++
}

if ($commentedRuns -gt 0) {
  Write-Host "Commented orphan JSX run(s): $commentedRuns" -ForegroundColor Cyan
} else {
  Write-Host "No orphan spacer JSX runs found to comment." -ForegroundColor DarkGray
}

# 3) Insert spacer inside the main JSX return block (last JSX-looking return in the file)
# Find candidate returns where the first non-empty line after return looks like JSX (<... or <>)
$jsxReturns = New-Object System.Collections.Generic.List[int]
for ($i=0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^\s*return\s*\(\s*$') {
    for ($j=$i+1; $j -lt [Math]::Min($lines.Count, $i+20); $j++) {
      $t = $lines[$j].Trim()
      if ($t -eq "") { continue }
      if ($t.StartsWith("<")) { [void]$jsxReturns.Add($i); break }
      # allow JSX comments/expressions as first content
      if ($t.StartsWith("{/*")) { [void]$jsxReturns.Add($i); break }
      break
    }
  }
}
if ($jsxReturns.Count -eq 0) { throw "Could not find a JSX return( ... ) block to insert the spacer into." }

$mainRet = $jsxReturns[$jsxReturns.Count - 1]

# Locate the first non-empty line after return( to identify root
$rootIdx = -1
for ($j=$mainRet+1; $j -lt [Math]::Min($lines.Count, $mainRet+40); $j++) {
  $t = $lines[$j].Trim()
  if ($t -eq "") { continue }
  $rootIdx = $j
  break
}
if ($rootIdx -lt 0) { throw "Could not locate root JSX line after main return(" }

# If spacer already exists inside this return, skip insert
$winEnd = [Math]::Min($lines.Count - 1, $mainRet + 200)
$window = ($lines[$mainRet..$winEnd] -join "`n")
if ($window -match [regex]::Escape("<div style={{ height: uiShellTopH }} />")) {
  Write-Host "Spacer already present inside main JSX return. No insert needed." -ForegroundColor DarkGray
} else {
  $rootTrim = $lines[$rootIdx].Trim()
  $childIndent = (Get-Indent $lines[$rootIdx]) + "  "

  # Insert after fragment opener <> or after the root opening tag line
  $insertAt = $rootIdx + 1
  if ($rootTrim -eq "<>" -or $rootTrim -eq "<React.Fragment>") {
    $insertAt = $rootIdx + 1
  } else {
    # If root is a self-closing tag, safest is to insert immediately after return( and wrap with fragment manually later.
    if ($rootTrim -match '/>\s*$') {
      Write-Host "WARNING: Root JSX line appears self-closing. Spacer insert may not be meaningful." -ForegroundColor Yellow
    }
  }

  $insert = @(
    ($childIndent + "{/* Spacer so fixed topbar does not cover content */}"),
    ($childIndent + "<div style={{ height: uiShellTopH }} />"),
    ($childIndent + "<div style={{ height: uiShellThumbStripH }} />"),
    ($childIndent + "")
  )

  for ($k=0; $k -lt $insert.Count; $k++) {
    $lines.Insert($insertAt + $k, $insert[$k])
  }
  Write-Host "Inserted spacer into main JSX return." -ForegroundColor Green
}

# Write file
$newText = ($lines -join "`r`n")
if ($newText -ne $code0) {
  Write-Utf8NoBom $viewerPath $newText
  Write-Host "Patched: $viewerPath" -ForegroundColor Green
} else {
  Write-Host "No changes were necessary." -ForegroundColor DarkGray
}

# 4) Build under cmd.exe and show error context if it fails
$toolsDir = Join-Path $RepoRoot "tools"
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
$blog = Join-Path $toolsDir ("build_fix_{0}.txt" -f (Get-Date -Format "yyyyMMdd_HHmmss"))

$cmd = 'cd /d "{0}" && npm run build > "{1}" 2>&1' -f $RepoRoot, $blog
cmd.exe /c $cmd | Out-Null
$exit = $LASTEXITCODE

Write-Host ""
Write-Host ("Build exit code: {0}" -f $exit) -ForegroundColor Yellow
Write-Host ("Build log: {0}" -f $blog) -ForegroundColor Cyan

if ($exit -ne 0) {
  $b = Get-Content -LiteralPath $blog
  $rx = '(?i)(error during build|\[vite:esbuild\]|transform failed|syntaxerror|rolluperror|expected\s+["' + "'" + ']?;|unexpected token)'
  $hit = ($b | Select-String -Pattern $rx | Select-Object -First 1)

  Write-Host ""
  Write-Host "=== BUILD ERROR CONTEXT ===" -ForegroundColor Red

  if ($hit) {
    $i = [Math]::Max(0, $hit.LineNumber - 20)
    $j = [Math]::Min($b.Count - 1, $hit.LineNumber + 60)
    $b[$i..$j] | ForEach-Object { $_ }
  } else {
    $start = [Math]::Max(0, $b.Count - 160)
    $b[$start..($b.Count - 1)] | ForEach-Object { $_ }
  }
}

if ($Pause) {
  Write-Host ""
  Read-Host "Press Enter to close"
}

$global:LASTEXITCODE = $exit
return $exit