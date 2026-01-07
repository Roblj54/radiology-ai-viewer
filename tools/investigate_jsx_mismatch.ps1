$ErrorActionPreference = "Stop"

$RepoRoot = "C:\Users\J-ROB\OneDrive\Documentos\Desktop\nodejs\radiology-ai-viewer"
$FileAbs  = Join-Path $RepoRoot "src\RadiologyColombiaViewer.tsx"
$ToolsDir = Join-Path $RepoRoot "tools"
New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null

if (!(Test-Path -LiteralPath $RepoRoot)) { throw "Missing repo root: $RepoRoot" }
if (!(Test-Path -LiteralPath $FileAbs))  { throw "Missing file: $FileAbs" }

$stamp   = Get-Date -Format "yyyyMMdd_HHmmss"
$bakPath = "$FileAbs.bak_$stamp"
Copy-Item -LiteralPath $FileAbs -Destination $bakPath -Force

$logPath = Join-Path $ToolsDir "jsx_mismatch_report_$stamp.txt"

function Write-Log([string]$s) {
  $s | Tee-Object -FilePath $logPath -Append
}

Write-Log "=== JSX Mismatch Investigation ($stamp) ==="
Write-Log "Repo:   $RepoRoot"
Write-Log "File:   $FileAbs"
Write-Log "Backup: $bakPath"
Write-Log ""

Push-Location $RepoRoot
try {
  Write-Log "--- npm run build (capturing output) ---"

  # IMPORTANT: do not let npm/node failure terminate the script
  $oldEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $buildOut = & npm run build 2>&1
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $oldEap

  if ($buildOut -isnot [System.Array]) { $buildOut = @($buildOut) }
  $buildOut | ForEach-Object { Write-Log $_ }

  Write-Log ""
  Write-Log "Build exit code: $exitCode"
  Write-Log ""

  # Try to extract failing line/col
  $lineNum = $null
  $colNum  = $null
  $m = ($buildOut | Select-String -Pattern "RadiologyColombiaViewer\.tsx:(\d+):(\d+):\s+ERROR" -AllMatches | Select-Object -First 1)
  if ($m -and $m.Matches.Count -gt 0) {
    $lineNum = [int]$m.Matches[0].Groups[1].Value
    $colNum  = [int]$m.Matches[0].Groups[2].Value
  }

  if (-not $lineNum) {
    $lineNum = 1031
    $colNum  = 1
    Write-Log "Could not parse failing line from build output. Using fallback line $lineNum."
  } else {
    Write-Log "Parsed failing position: line $lineNum, col $colNum"
  }

  $lines = Get-Content -LiteralPath $FileAbs -Encoding UTF8
  $total = $lines.Count

  $context = 90
  $start = [Math]::Max(1, $lineNum - $context)
  $end   = [Math]::Min($total, $lineNum + $context)

  Write-Log ""
  Write-Log "--- File snippet (L$start to L$end) ---"
  for ($i = $start; $i -le $end; $i++) {
    $prefix = if ($i -eq $lineNum) { ">>" } else { "  " }
    $ln = $i.ToString().PadLeft(5, ' ')
    Write-Log ("{0}{1}: {2}" -f $prefix, $ln, $lines[$i-1])
  }

  Write-Log ""
  Write-Log "--- Tag stack scan (div/button) within snippet ---"

  $tagRegex = [regex]'<\s*(/?)\s*(div|button)\b([^>]*?)>'
  $stack  = New-Object System.Collections.Generic.List[object]
  $issues = New-Object System.Collections.Generic.List[string]

  for ($i = $start; $i -le $end; $i++) {
    $text = $lines[$i-1]
    $matches = $tagRegex.Matches($text)
    foreach ($mt in $matches) {
      $isClose = ($mt.Groups[1].Value -eq "/")
      $name    = $mt.Groups[2].Value.ToLowerInvariant()
      $rest    = $mt.Groups[3].Value
      $isSelfClosing = ($mt.Value -match "/\s*>$") -or ($rest -match "/\s*$")

      if ($isClose) {
        if ($stack.Count -eq 0) {
          $issues.Add(("L{0}: Closing </{1}> with empty stack" -f $i, $name))
        } else {
          $top = $stack[$stack.Count - 1]
          if ($top.Name -ne $name) {
            $issues.Add(("L{0}: Closing </{1}> mismatches stack top <{2}> opened at L{3}" -f $i, $name, $top.Name, $top.Line))
          } else {
            $stack.RemoveAt($stack.Count - 1)
          }
        }
      } elseif (-not $isSelfClosing) {
        $stack.Add([pscustomobject]@{ Name = $name; Line = $i; Text = $mt.Value.Trim() })
      }
    }
  }

  if ($issues.Count -eq 0) {
    Write-Log "No div/button mismatches detected by the heuristic scan in this snippet."
  } else {
    Write-Log "Potential issues found:"
    $issues | ForEach-Object { Write-Log ("- " + $_) }
  }

  if ($stack.Count -gt 0) {
    Write-Log ""
    Write-Log "Unclosed tags still on stack (most recent first):"
    for ($j = $stack.Count - 1; $j -ge 0; $j--) {
      $t = $stack[$j]
      Write-Log ("- <{0}> opened at L{1}" -f $t.Name, $t.Line)
    }
  } else {
    Write-Log ""
    Write-Log "Tag stack ended clean in this snippet."
  }

  Write-Log ""
  Write-Log "Saved report: $logPath"
  Write-Host ""
  Write-Host "Report saved to: $logPath"
}
finally {
  Pop-Location
}
