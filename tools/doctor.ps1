[CmdletBinding()]
param(
  [string]$RepoRoot = "C:\Users\J-ROB\OneDrive\Documentos\Desktop\nodejs\radiology-ai-viewer",
  [switch]$Fix,
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
function Add-Result([System.Collections.Generic.List[object]]$results, [string]$name, [string]$status, [string]$details) {
  $results.Add([pscustomobject]@{ Check=$name; Status=$status; Details=$details }) | Out-Null
}

$results = New-Object System.Collections.Generic.List[object]

$viewerPath = Join-Path $RepoRoot "src\RadiologyColombiaViewer.tsx"
$pkgPath    = Join-Path $RepoRoot "package.json"

if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) {
  Add-Result $results "Repo path exists" "FAIL" "Not found: $RepoRoot"
  $results | Format-Table -AutoSize
  if ($Pause) { Read-Host "Press Enter to close" }
  return 1
}
Add-Result $results "Repo path exists" "PASS" $RepoRoot

if (-not (Test-Path -LiteralPath $pkgPath -PathType Leaf)) {
  Add-Result $results "package.json exists" "FAIL" "Not found: $pkgPath"
} else {
  Add-Result $results "package.json exists" "PASS" "OK"
}

if (-not (Test-Path -LiteralPath $viewerPath -PathType Leaf)) {
  Add-Result $results "RadiologyColombiaViewer.tsx exists" "FAIL" "Not found: $viewerPath"
  $results | Format-Table -AutoSize
  if ($Pause) { Read-Host "Press Enter to close" }
  return 1
}
Add-Result $results "RadiologyColombiaViewer.tsx exists" "PASS" "OK"

$code0 = Read-Utf8NoBom $viewerPath
$code  = $code0

# Remove marker artifacts
$code = [regex]::Replace($code, "(?m)^\s*##__[^`r`n]*__##\s*(\r?\n)?", "")

# Fix any PowerShell operator tokens accidentally pasted into TSX
$code = [regex]::Replace($code, '(?<=\s)-and(?=\s)', '&&')
$code = [regex]::Replace($code, '(?<=\s)-or(?=\s)',  '||')
$code = [regex]::Replace($code, '(?<=\s)-not(?=\s)', '!')

# Read lines for targeted JSX repairs
$lines = New-Object System.Collections.Generic.List[string]
($code -split "`r?`n", 0, "Regex") | ForEach-Object { [void]$lines.Add($_) }

# Helpers
function Find-First([string]$rx, [int]$start=0) {
  for ($i=$start; $i -lt $lines.Count; $i++) { if ($lines[$i] -match $rx) { return $i } }
  return -1
}

$needleSpacer = "Spacer so fixed topbar does not cover content"
$topBarRx = "\{\s*/\*\s*Top\s+bar\s*\*/\s*\}"

# Locate Top bar anchor
$topBarIdx = Find-First $topBarRx 0

if ($Fix) {
  $bak = Backup-File $viewerPath
  Add-Result $results "Backup created" "PASS" $bak

  # 1) Repair half-commented style={{ ... }} near Top bar (this is your current build blocker)
  if ($topBarIdx -ge 0) {
    $from = [Math]::Max(0, $topBarIdx - 120)
    $to   = [Math]::Min($lines.Count - 1, $topBarIdx + 120)

    for ($i=$from; $i -le $to; $i++) {
      # Un-comment lines like: //   style={{   or  // }}
      if ($lines[$i] -match '^(\s*)//\s*(style=\{\{\s*)$') { $lines[$i] = $matches[1] + "style={{"; continue }
      if ($lines[$i] -match '^(\s*)//\s*(\}\}\s*)$')       { $lines[$i] = $matches[1] + "}}";      continue }

      # Also un-comment obvious JSX tag/attr lines in that region (conservative)
      if ($lines[$i] -match '^(\s*)//\s*(<div\b.*)$')      { $lines[$i] = $matches[1] + $matches[2]; continue }
      if ($lines[$i] -match '^(\s*)//\s*(</div>.*)$')      { $lines[$i] = $matches[1] + $matches[2]; continue }
      if ($lines[$i] -match '^(\s*)//\s*(className=.+)$')  { $lines[$i] = $matches[1] + $matches[2]; continue }
      if ($lines[$i] -match '^(\s*)//\s*(on[A-Z]\w+=.+)$') { $lines[$i] = $matches[1] + $matches[2]; continue }
    }

    Add-Result $results "Top bar style block repair" "PASS" "Un-commented style={{ / }} and nearby JSX lines near Top bar"
  } else {
    Add-Result $results "Top bar style block repair" "WARN" "Could not find '{/* Top bar */}' anchor"
  }

  # 2) Normalize spacer block: remove any existing spacer trio, then insert one clean block right before Top bar
  $removed = 0
  for ($i=0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -like "*$needleSpacer*") {
      if (($i+2) -lt $lines.Count) {
        $okTop   = ($lines[$i+1] -match "<div\s+style=\{\{\s*height:\s*uiShellTopH\s*\}\}\s*/>\s*$")
        $okThumb = ($lines[$i+2] -match "<div\s+style=\{\{\s*height:\s*uiShellThumbStripH\s*\}\}\s*/>\s*$")
        if ($okTop -and $okThumb) {
          $lines.RemoveAt($i+2)
          $lines.RemoveAt($i+1)
          $lines.RemoveAt($i)
          $removed++
          $i = [Math]::Max(-1, $i - 1)
        }
      }
    }
  }

  if ($topBarIdx -ge 0) {
    $indent = ($lines[$topBarIdx] -replace "^(\s*).*$", '$1')
    $insert = @(
      ($indent + "{/* Spacer so fixed topbar does not cover content */}"),
      ($indent + "<div style={{ height: uiShellTopH }} />"),
      ($indent + "<div style={{ height: uiShellThumbStripH }} />"),
      ($indent + "")
    )

    # Guard: do not insert if it already exists within 30 lines above Top bar
    $from2 = [Math]::Max(0, $topBarIdx - 30)
    $win = ($lines[$from2..$topBarIdx] -join "`n")
    if ($win -notmatch [regex]::Escape("<div style={{ height: uiShellTopH }} />")) {
      for ($k=0; $k -lt $insert.Count; $k++) { $lines.Insert($topBarIdx + $k, $insert[$k]) }
      Add-Result $results "Spacer block" "PASS" ("Removed={0}, Inserted=YES" -f $removed)
    } else {
      Add-Result $results "Spacer block" "PASS" ("Removed={0}, Inserted=NO (already present)" -f $removed)
    }
  } else {
    Add-Result $results "Spacer block" "WARN" ("Removed={0}, Inserted=NO (no Top bar anchor)" -f $removed)
  }

  # Write file back
  $newText = ($lines -join "`r`n")
  if ($newText -ne $code0) {
    Write-Utf8NoBom $viewerPath $newText
    Add-Result $results "Write TSX" "PASS" "Patched RadiologyColombiaViewer.tsx"
  } else {
    Add-Result $results "Write TSX" "PASS" "No changes needed"
  }

  # Refresh code after fixes
  $code = Read-Utf8NoBom $viewerPath
}

# Checks after optional fix
if ($code -match "(?m)^\s*##__") {
  Add-Result $results "No marker artifacts" "FAIL" "Found ##__...__## lines"
} else {
  Add-Result $results "No marker artifacts" "PASS" "OK"
}

$psOps = [regex]::Matches($code, "\-(and|or|not|xor|eq|ne|gt|lt|ge|le)\b", "IgnoreCase")
if ($psOps.Count -gt 0) {
  Add-Result $results "No PowerShell operators in TSX" "FAIL" ("Found {0}, example: {1}" -f $psOps.Count, $psOps[0].Value)
} else {
  Add-Result $results "No PowerShell operators in TSX" "PASS" "OK"
}

$cntPj  = ([regex]::Matches($code, "void\s+goTo\(\s*pj\.idx0\s*\);")).Count
$cntIdx = ([regex]::Matches($code, "void\s+goTo\(\s*idx0\s*\);")).Count
if ($cntPj -eq 1 -and $cntIdx -eq 1) {
  Add-Result $results "GoTo wiring counts" "PASS" "pj.idx0=1, idx0=1"
} else {
  Add-Result $results "GoTo wiring counts" "FAIL" ("Expected pj.idx0=1 and idx0=1, got pj.idx0={0}, idx0={1}" -f $cntPj, $cntIdx)
}

# Build (always)
$toolsDir = Join-Path $RepoRoot "tools"
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
$blog = Join-Path $toolsDir ("build_doctor_{0}.txt" -f (Get-Date -Format "yyyyMMdd_HHmmss"))

$cmd = 'cd /d "{0}" && npm run build > "{1}" 2>&1' -f $RepoRoot, $blog
cmd.exe /c $cmd | Out-Null
$exit = $LASTEXITCODE

if ($exit -eq 0) {
  Add-Result $results "npm run build" "PASS" "Build succeeded"
} else {
  Add-Result $results "npm run build" "FAIL" ("Build failed. Log: {0}" -f $blog)
}

Write-Host ""
$results | Format-Table -AutoSize

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
    $j = [Math]::Min($b.Count - 1, $hit.LineNumber + 80)
    $b[$i..$j] | ForEach-Object { $_ }
  } else {
    $start = [Math]::Max(0, $b.Count - 200)
    $b[$start..($b.Count - 1)] | ForEach-Object { $_ }
  }
}

if ($Pause) {
  Write-Host ""
  Read-Host "Press Enter to close"
}

$global:LASTEXITCODE = $exit
return $exit