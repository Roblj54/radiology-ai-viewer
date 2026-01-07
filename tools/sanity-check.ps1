[CmdletBinding()]
param(
  [string]$RepoRoot = "C:\Users\J-ROB\OneDrive\Documentos\Desktop\nodejs\radiology-ai-viewer",
  [switch]$Fix,
  [switch]$SkipBuild,
  [switch]$Pause
)

$ErrorActionPreference = "Stop"

function Add-Result([System.Collections.Generic.List[object]]$results, [string]$name, [string]$status, [string]$details) {
  $results.Add([pscustomobject]@{
    Check   = $name
    Status  = $status
    Details = $details
  }) | Out-Null
}

function Read-Utf8NoBom([string]$p) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::ReadAllText($p, $utf8NoBom)
}

function Write-Utf8NoBom([string]$p, [string]$t) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $t, $utf8NoBom)
}

function Backup-File([string]$p) {
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$p.bak_$stamp"
  Copy-Item -LiteralPath $p -Destination $bak -Force
  $bak
}

function Fix-SpacerReturnWrapper([string]$code) {
  $lines = $code -split "`r?`n", 0, "Regex"
  $list  = New-Object System.Collections.Generic.List[string]
  $list.AddRange($lines)

  $needle = "Spacer so fixed topbar does not cover content"
  $spIdx = -1
  for ($i=0; $i -lt $list.Count; $i++) {
    if ($list[$i] -like "*$needle*") { $spIdx = $i; break }
  }
  if ($spIdx -lt 0) { return @{ Changed=$false; Code=$code; Why="Spacer marker not found" } }

  $fnStart = -1
  for ($i=$spIdx; $i -ge 0; $i--) {
    if ($list[$i] -match "=>\s*{\s*$") { $fnStart = $i; break }
  }
  if ($fnStart -lt 0) { return @{ Changed=$false; Code=$code; Why="No enclosing '=> {' found above spacer" } }

  $fnIndent = ($list[$fnStart] -replace "^(\s*).*$",'$1')

  $closeIdx = -1
  $closeRx = ('^(?:' + [regex]::Escape($fnIndent) + ')\}\s*;?\s*$')
  for ($i=$spIdx; $i -lt $list.Count; $i++) {
    if ($list[$i] -match $closeRx) { $closeIdx = $i; break }
  }
  if ($closeIdx -lt 0) { return @{ Changed=$false; Code=$code; Why="Could not find function closing brace" } }

  $guardStart = [Math]::Max(0, $spIdx - 12)
  $guard = ($list[$guardStart..$spIdx] -join "`n")
  if ($guard -match "return\s*\(") {
    return @{ Changed=$false; Code=$code; Why="Return wrapper already present" }
  }

  $insertAt = $spIdx
  $list.Insert($insertAt, $fnIndent + "return (")
  $list.Insert($insertAt + 1, $fnIndent + "<>")
  $spIdx += 2
  $closeIdx += 2

  $list.Insert($closeIdx, $fnIndent + "</>")
  $closeIdx += 1
  $list.Insert($closeIdx, $fnIndent + ");")

  return @{ Changed=$true; Code=($list -join "`r`n"); Why="Inserted return (<>...</>);" }
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

$code0 = Read-Utf8NoBom $viewerPath
$code  = $code0

if ($code -match "(?m)^\s*##__") {
  Add-Result $results "No marker artifacts" "FAIL" "Found ##__...__## lines"
} else {
  Add-Result $results "No marker artifacts" "PASS" "OK"
}

$psOps = [regex]::Matches($code, "\-(and|or|not|xor|eq|ne|gt|lt|ge|le)\b", "IgnoreCase")
if ($psOps.Count -gt 0) {
  Add-Result $results "No PowerShell operators in TSX" "FAIL" ("Found {0} token(s), example: {1}" -f $psOps.Count, $psOps[0].Value)
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

function Check-Adjacency([string]$setLineRx, [string]$goLineRx) {
  $m = [regex]::Match($code, $setLineRx, "Multiline")
  if (-not $m.Success) { return @{ Status="FAIL"; Msg="Setter line not found" } }
  $tail = $code.Substring($m.Index)
  $ls = $tail -split "`r?`n"
  $window = ($ls[0..([Math]::Min(6, $ls.Count-1))] -join "`n")
  if ($window -match $goLineRx) { return @{ Status="PASS"; Msg="goTo present within next 6 lines" } }
  return @{ Status="FAIL"; Msg="goTo not found near setter line" }
}

$adj1 = Check-Adjacency '^\s*uiShellSetImageIndex\(\s*pj\.idx0\s*\);\s*$' 'void\s+goTo\(\s*pj\.idx0\s*\);'
Add-Result $results "PendingJump goTo adjacency" $adj1.Status $adj1.Msg

$adj2 = Check-Adjacency '^\s*uiShellSetImageIndex\(\s*idx0\s*\);\s*$' 'void\s+goTo\(\s*idx0\s*\);'
Add-Result $results "GoToFinding goTo adjacency" $adj2.Status $adj2.Msg

$needle = "Spacer so fixed topbar does not cover content"
if ($code -like "*$needle*") {
  $spPos = $code.IndexOf($needle, [System.StringComparison]::Ordinal)
  $pre = $code.Substring([Math]::Max(0, $spPos - 700), [Math]::Min(700, $spPos))
  $looksWrapped = ($pre -match "return\s*\(")

  if ($looksWrapped) {
    Add-Result $results "Spacer JSX return wrapper" "PASS" "Looks wrapped with return(...)"
  } else {
    if ($Fix) {
      $bak = Backup-File $viewerPath
      $fix = Fix-SpacerReturnWrapper $code
      if ($fix.Changed) {
        Write-Utf8NoBom $viewerPath $fix.Code
        $code = $fix.Code
        Add-Result $results "Spacer JSX return wrapper" "PASS" ("Fixed automatically. Backup: {0}" -f $bak)
      } else {
        Add-Result $results "Spacer JSX return wrapper" "FAIL" ("Not wrapped and auto-fix could not apply: {0}" -f $fix.Why)
      }
    } else {
      Add-Result $results "Spacer JSX return wrapper" "FAIL" "Not wrapped. Run with -Fix."
    }
  }
} else {
  Add-Result $results "Spacer JSX marker present" "WARN" "Spacer marker not found"
}

if ($code -match "const\s+uiShellActiveSeriesIdx\s*=\s*sliceIndex\s*;") {
  Add-Result $results "Series idx binding sanity" "WARN" "uiShellActiveSeriesIdx maps to sliceIndex (multi-series will be wrong)."
} else {
  Add-Result $results "Series idx binding sanity" "PASS" "OK"
}

if (-not $SkipBuild) {
  try {
    Push-Location $RepoRoot
    $npm = Get-Command npm -ErrorAction Stop
    $out = & $npm.Path run build 2>&1
    $exit = $LASTEXITCODE
    Pop-Location

    if ($exit -eq 0) {
      Add-Result $results "npm run build" "PASS" "Build succeeded"
    } else {
      Add-Result $results "npm run build" "FAIL" ("Build failed. First line: {0}" -f ($out | Select-Object -First 1))
    }
  } catch {
    try { Pop-Location } catch {}
    Add-Result $results "npm run build" "FAIL" ("Build exception: {0}" -f $_.Exception.Message)
  }
} else {
  Add-Result $results "npm run build" "WARN" "Skipped"
}

Write-Host ""
$results | Format-Table -AutoSize

$failCount = ($results | Where-Object { $_.Status -eq "FAIL" }).Count
Write-Host ""
if ($failCount -gt 0) {
  Write-Host ("Sanity check finished with FAIL count: {0}" -f $failCount) -ForegroundColor Red
  $global:LASTEXITCODE = 1
} else {
  Write-Host "Sanity check finished with no FAIL results." -ForegroundColor Green
  $global:LASTEXITCODE = 0
}

if ($Pause) {
  Write-Host ""
  Read-Host "Press Enter to close"
}

return $global:LASTEXITCODE