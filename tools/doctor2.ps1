[CmdletBinding()]
param(
  [string]$RepoRoot = "C:\Users\J-ROB\OneDrive\Documentos\Desktop\nodejs\radiology-ai-viewer",
  [switch]$Fix,
  [switch]$SkipBuild,
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
function Add-Result($results, [string]$name, [string]$status, [string]$details) {
  $results.Add([pscustomobject]@{ Check=$name; Status=$status; Details=$details }) | Out-Null
}
function Get-Indent([string]$s) {
  if ($s -match '^(\s*)') { return $matches[1] }
  return ""
}

$results = New-Object System.Collections.Generic.List[object]

$viewerPath = Join-Path $RepoRoot "src\RadiologyColombiaViewer.tsx"
$pkgPath    = Join-Path $RepoRoot "package.json"

if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) {
  Add-Result $results "Repo path exists" "FAIL" "Not found: $RepoRoot"
  $results | Format-Table -AutoSize
  if ($Pause) { Read-Host "Press Enter to close" }
  $global:LASTEXITCODE = 1
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
  $global:LASTEXITCODE = 1
  return 1
}
Add-Result $results "RadiologyColombiaViewer.tsx exists" "PASS" "OK"

$needleSpacer = "Spacer so fixed topbar does not cover content"

if ($Fix) {
  $bak = Backup-File $viewerPath
  Add-Result $results "Backup created" "PASS" $bak

  $code0 = Read-Utf8NoBom $viewerPath
  $lines = New-Object System.Collections.Generic.List[string]
  ($code0 -split "`r?`n", 0, "Regex") | ForEach-Object { [void]$lines.Add($_) }

  # 1) Remove ALL spacer trios anywhere (comment + 2 divs)
  $removed = 0
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -like "*$needleSpacer*") {
      if (($i + 2) -lt $lines.Count) {
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
  Add-Result $results "Spacer blocks removed" "PASS" ("Removed={0}" -f $removed)

  # 2) If spacer lines were mistakenly inserted INSIDE a style={{ ... }} object, remove them.
  # We detect style blocks and delete any JSX-ish lines inside them that reference the spacer.
  $styleFixes = 0
  for ($i=0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "style=\{\{\s*$" -or $lines[$i] -match "style=\{\{") {
      $start = $i
      $end = -1
      for ($j=$i+1; $j -lt [Math]::Min($lines.Count, $i+220); $j++) {
        if ($lines[$j] -match "^\s*\}\}\s*[>,]?\s*$" -or $lines[$j] -match "\}\}\s*$") { $end = $j; break }
      }
      if ($end -gt $start) {
        $changedHere = $false
        for ($k=$end-1; $k -gt $start; $k--) {
          $t = $lines[$k].Trim()
          $isBadSpacer =
            ($t -like "*$needleSpacer*") -or
            ($t -like "*uiShellTopH*height:*") -or
            ($t -like "*uiShellThumbStripH*height:*") -or
            ($t.StartsWith("{/*")) -or
            ($t.StartsWith("<div")) -or
            ($t.StartsWith("</"))
          if ($isBadSpacer) {
            $lines.RemoveAt($k)
            $changedHere = $true
          }
        }
        if ($changedHere) { $styleFixes++ }
        $i = $end
      }
    }
  }
  Add-Result $results "Spacer removed from style objects" "PASS" ("Style blocks cleaned={0}" -f $styleFixes)

  # 3) Re-insert ONE clean spacer block immediately before the Top bar container.
  # Anchor: find the first "position: 'fixed'" line, then walk up to the owning <div.
  $posFixedIdx = -1
  for ($i=0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'position\s*:\s*["' + "'" + ']fixed["' + "'" + ']') { $posFixedIdx = $i; break }
  }

  if ($posFixedIdx -lt 0) {
    Add-Result $results "Top bar anchor (position: fixed)" "WARN" "Could not find position: 'fixed'. Spacer not re-inserted."
  } else {
    $divStart = -1
    for ($j=$posFixedIdx; $j -ge [Math]::Max(0, $posFixedIdx-40); $j--) {
      $trim = $lines[$j].Trim()
      if ($trim -eq "<div" -or $trim -match "^<div\b") { $divStart = $j; break }
    }

    if ($divStart -lt 0) {
      Add-Result $results "Top bar <div start" "WARN" "Could not find owning <div> for the fixed header. Spacer not re-inserted."
    } else {
      # Guard: do not insert if it is already within 40 lines above divStart
      $from = [Math]::Max(0, $divStart - 40)
      $win = ($lines[$from..$divStart] -join "`n")
      if ($win -match [regex]::Escape("<div style={{ height: uiShellTopH }} />")) {
        Add-Result $results "Spacer re-insert" "PASS" "Already present near Top bar."
      } else {
        $indent = Get-Indent $lines[$divStart]
        $insert = @(
          ($indent + "{/* Spacer so fixed topbar does not cover content */}"),
          ($indent + "<div style={{ height: uiShellTopH }} />"),
          ($indent + "<div style={{ height: uiShellThumbStripH }} />"),
          ($indent + "")
        )
        for ($k=0; $k -lt $insert.Count; $k++) {
          $lines.Insert($divStart + $k, $insert[$k])
        }
        Add-Result $results "Spacer re-insert" "PASS" "Inserted clean spacer block before Top bar <div>."
      }
    }
  }

  $newText = ($lines -join "`r`n")
  if ($newText -ne $code0) {
    Write-Utf8NoBom $viewerPath $newText
    Add-Result $results "Write TSX" "PASS" "Patched RadiologyColombiaViewer.tsx"
  } else {
    Add-Result $results "Write TSX" "PASS" "No changes needed"
  }
}

# 4) Sanity checks that catch the exact regression you hit
$code = Read-Utf8NoBom $viewerPath

# Spacer must not be inside style={{ ... }}
$badInsideStyle = $false
if ($code -match "(?s)style=\{\{.*?\{\/\*\s*Spacer so fixed topbar does not cover content\s*\*\/\}.*?\}\}") {
  $badInsideStyle = $true
}
if ($badInsideStyle) {
  Add-Result $results "Spacer not inside style object" "FAIL" "Spacer comment detected inside a style={{...}} block."
} else {
  Add-Result $results "Spacer not inside style object" "PASS" "OK"
}

# GoTo wiring quick checks
$cntPj  = ([regex]::Matches($code, "void\s+goTo\(\s*pj\.idx0\s*\);")).Count
$cntIdx = ([regex]::Matches($code, "void\s+goTo\(\s*idx0\s*\);")).Count
if ($cntPj -eq 1 -and $cntIdx -eq 1) {
  Add-Result $results "GoTo wiring counts" "PASS" "pj.idx0=1, idx0=1"
} else {
  Add-Result $results "GoTo wiring counts" "WARN" ("Expected pj.idx0=1 and idx0=1, got pj.idx0={0}, idx0={1}" -f $cntPj, $cntIdx)
}

# Multi-series warning
if ($code -match "const\s+uiShellActiveSeriesIdx\s*=\s*sliceIndex\s*;") {
  Add-Result $results "Series idx binding sanity" "WARN" "uiShellActiveSeriesIdx maps to sliceIndex (multi-series will be wrong)."
} else {
  Add-Result $results "Series idx binding sanity" "PASS" "OK"
}

# 5) Build (unless skipped) with clean log capture
$exit = 0
$blog = ""
if (-not $SkipBuild) {
  $toolsDir = Join-Path $RepoRoot "tools"
  New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $blog  = Join-Path $toolsDir "build_doctor2_$stamp.txt"

  $cmd = 'cd /d "{0}" && npm run build > "{1}" 2>&1' -f $RepoRoot, $blog
  cmd.exe /c $cmd | Out-Null
  $exit = $LASTEXITCODE

  if ($exit -eq 0) {
    Add-Result $results "npm run build" "PASS" "Build succeeded"
  } else {
    Add-Result $results "npm run build" "FAIL" ("Build failed. Log: {0}" -f $blog)
  }
} else {
  Add-Result $results "npm run build" "WARN" "Skipped"
}

Write-Host ""
$results | Format-Table -AutoSize
Write-Host ""

if (-not $SkipBuild) {
  Write-Host ("Build exit code: {0}" -f $exit) -ForegroundColor Yellow
  Write-Host ("Build log: {0}" -f $blog) -ForegroundColor Cyan

  if ($exit -ne 0 -and (Test-Path -LiteralPath $blog)) {
    $b = Get-Content -LiteralPath $blog
    $rx = '(?i)(error during build|\[vite:esbuild\]|transform failed|syntaxerror|rolluperror|expected\s+["' + "'" + ']?;|unexpected token|cannot find module|failed to resolve import)'
    $hits = $b | Select-String -Pattern $rx -ErrorAction SilentlyContinue
    if ($hits) {
      $h = $hits | Select-Object -Last 1
      Write-Host ""
      Write-Host "=== BUILD ERROR CONTEXT ===" -ForegroundColor Red
      $i = [Math]::Max(0, $h.LineNumber - 20)
      $j = [Math]::Min($b.Count - 1, $h.LineNumber + 80)
      $b[$i..$j] | ForEach-Object { $_ }
    }
  }
}

$failCount = ($results | Where-Object { $_.Status -eq "FAIL" }).Count
$global:LASTEXITCODE = $exit
if ($Pause) {
  Write-Host ""
  Read-Host ("Press Enter to close (FAIL count: {0})" -f $failCount)
}
return $exit