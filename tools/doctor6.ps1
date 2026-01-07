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
  return $bak
}
function Get-Indent([string]$s) {
  if ($s -match '^(\s*)') { return $matches[1] }
  return ""
}

$viewerPath = Join-Path $RepoRoot "src\RadiologyColombiaViewer.tsx"
if (-not (Test-Path -LiteralPath $viewerPath -PathType Leaf)) { throw "File not found: $viewerPath" }

$code0 = Read-Utf8NoBom $viewerPath
$code  = $code0

# Fix mojibake if present
$code = $code.Replace("AÃºn no hay series cargadas.", "Aún no hay series cargadas.")

# Detect naming variants
$activeVar = ""
if ($code -match '\buiShellActiveSeriesIdx\b') { $activeVar = "uiShellActiveSeriesIdx" }
elseif ($code -match '\buiShellActiveSeriesIndex\b') { $activeVar = "uiShellActiveSeriesIndex" }

$setFn = ""
if ($code -match '\bsetUiShellActiveSeriesIdx\b') { $setFn = "setUiShellActiveSeriesIdx" }
elseif ($code -match '\bsetUiShellActiveSeriesIndex\b') { $setFn = "setUiShellActiveSeriesIndex" }

$typeCard = "UiShellSeriesCard"
if ($code -notmatch '\bUiShellSeriesCard\b') { $typeCard = "any" }

$activeDecl = "const active = false;"
if ($activeVar) { $activeDecl = "const active = idx === $activeVar;" }

$onClickAttr = "onClick={() => {}}"
if ($setFn) { $onClickAttr = "onClick={() => $setFn(idx)}" }

if ($Fix) {
  $bak = Backup-File $viewerPath
  Write-Host ("Backup created: {0}" -f $bak) -ForegroundColor DarkGray

  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($ln in ([regex]::Split($code, "\r?\n"))) { [void]$lines.Add($ln) }

  # Find END marker for thumb strip
  $endIdx = -1
  for ($i=0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'UI_SHELL_THUMB_STRIP_RENDER_END') { $endIdx = $i; break }
  }
  if ($endIdx -lt 0) { throw "Could not find UI_SHELL_THUMB_STRIP_RENDER_END in TSX." }

  # Find BEGIN marker above it, or nearest UI_SHELL_THUMB_STRIP_RENDER line, or fallback to uiShellFilmstripRef
  $startIdx = -1
  for ($i=$endIdx; $i -ge 0; $i--) {
    if ($lines[$i] -match 'UI_SHELL_THUMB_STRIP_RENDER_BEGIN') { $startIdx = $i; break }
  }
  if ($startIdx -lt 0) {
    for ($i=$endIdx; $i -ge 0; $i--) {
      if ($lines[$i] -match 'UI_SHELL_THUMB_STRIP_RENDER' -and $lines[$i] -notmatch 'END') { $startIdx = $i; break }
    }
  }
  if ($startIdx -lt 0) {
    for ($i=$endIdx; $i -ge 0; $i--) {
      if ($lines[$i] -match 'uiShellFilmstripRef') { $startIdx = [Math]::Max(0, $i-6); break }
    }
  }
  if ($startIdx -lt 0) { throw "Could not determine start of thumb strip section." }

  $indent = Get-Indent $lines[$startIdx]

  $block = @(
    "$indent/* UI_SHELL_THUMB_STRIP_RENDER_BEGIN */",
    "$indent{(() => {",
    "$indent  const items = uiShellSeriesItems ?? [];",
    "$indent  if (items.length === 0) return null;",
    "$indent  return (",
    "$indent    <div",
    "$indent      ref={uiShellFilmstripRef}",
    "$indent      style={{",
    "$indent        display: ""flex"",",
    "$indent        gap: 8,",
    "$indent        overflowX: ""auto"",",
    "$indent        padding: ""8px 10px"",",
    "$indent        alignItems: ""center"",",
    "$indent        scrollSnapType: ""x proximity"",",
    "$indent      }}",
    "$indent      aria-label={uiShellT(""Series thumbnails"", ""Miniaturas de series"")}",
    "$indent    >",
    "$indent      {items.map((s: $typeCard, idx: number) => {",
    "$indent        const anyS = s as any;",
    "$indent        const tUrl = anyS.thumbUrl || anyS.thumbnailUrl || anyS.previewUrl || anyS.url || """";",
    "$indent        const label = anyS.label || anyS.seriesDescription || anyS.description || `Series ${idx + 1}`;",
    "$indent        const mod = anyS.modality || anyS.mod || """";",
    "$indent        const count = (anyS.count ?? anyS.instances ?? anyS.slices ?? anyS.images ?? 0) as number;",
    "$indent        const key = anyS.id ?? anyS.seriesUid ?? anyS.seriesInstanceUID ?? anyS.seriesId ?? idx;",
    "$indent        $activeDecl",
    "",
    "$indent        return (",
    "$indent          <button",
    "$indent            key={key}",
    "$indent            type=""button""",
    "$indent            $onClickAttr",
    "$indent            style={{",
    "$indent              ...uiShellBtnBase,",
    "$indent              padding: 0,",
    "$indent              borderRadius: 14,",
    "$indent              display: ""flex"",",
    "$indent              alignItems: ""center"",",
    "$indent              gap: 10,",
    "$indent              background: active ? ""rgba(255,255,255,0.10)"" : ""transparent"",",
    "$indent              border: active ? ""1px solid rgba(255,255,255,0.25)"" : ""1px solid rgba(255,255,255,0.10)"",",
    "$indent              scrollSnapAlign: ""center"",",
    "$indent            }}",
    "$indent            aria-pressed={active}",
    "$indent            title={label}",
    "$indent          >",
    "$indent            <div",
    "$indent              style={{",
    "$indent                width: 56,",
    "$indent                height: 56,",
    "$indent                borderRadius: 12,",
    "$indent                overflow: ""hidden"",",
    "$indent                background: ""rgba(255,255,255,0.06)"",",
    "$indent                border: ""1px solid rgba(255,255,255,0.10)"",",
    "$indent                display: ""flex"",",
    "$indent                alignItems: ""center"",",
    "$indent                justifyContent: ""center"",",
    "$indent                flexShrink: 0,",
    "$indent              }}",
    "$indent            >",
    "$indent              {tUrl ? (",
    "$indent                <img src={tUrl} alt="""" style={{ width: ""100%"", height: ""100%"", objectFit: ""cover"" }} />",
    "$indent              ) : (",
    "$indent                <span style={{ fontWeight: 800, fontSize: 14, opacity: 0.85 }}>",
    "$indent                  {String(mod || label || ""??"").slice(0, 2)}",
    "$indent                </span>",
    "$indent              )}",
    "$indent            </div>",
    "",
    "$indent            <div style={{ display: ""flex"", flexDirection: ""column"", alignItems: ""flex-start"", paddingRight: 10 }}>",
    "$indent              <div",
    "$indent                style={{",
    "$indent                  fontWeight: 800,",
    "$indent                  fontSize: 12,",
    "$indent                  lineHeight: 1.1,",
    "$indent                  maxWidth: 200,",
    "$indent                  overflow: ""hidden"",",
    "$indent                  textOverflow: ""ellipsis"",",
    "$indent                  whiteSpace: ""nowrap"",",
    "$indent                }}",
    "$indent              >",
    "$indent                {label}",
    "$indent              </div>",
    "$indent              <div style={{ display: ""flex"", gap: 6, marginTop: 6, alignItems: ""center"", flexWrap: ""wrap"" }}>",
    "$indent                <span style={{ ...uiShellPill, padding: ""3px 8px"", fontSize: 11 }}>{mod}</span>",
    "$indent                <span style={{ ...uiShellPill, padding: ""3px 8px"", fontSize: 11 }}>",
    "$indent                  {uiShellT(""Slices"", ""Cortes"")}: {count}",
    "$indent                </span>",
    "$indent              </div>",
    "$indent            </div>",
    "$indent          </button>",
    "$indent        );",
    "$indent      })}",
    "$indent    </div>",
    "$indent  );",
    "$indent})()}",
    "$indent/* UI_SHELL_THUMB_STRIP_RENDER_END */"
  )

  # Replace start..end with block
  for ($i=$endIdx; $i -ge $startIdx; $i--) { $lines.RemoveAt($i) }
  for ($k=0; $k -lt $block.Count; $k++) { $lines.Insert($startIdx + $k, $block[$k]) }

  # Fix the broken Modality line (missing leading "{", missing closing "}")
  for ($i=0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'uiShellT\("Modality",\s*"Modalidad"\)\}:\s*\{sum\.modality') {
      $ind = Get-Indent $lines[$i]
      $lines[$i] = $ind + '{uiShellT("Modality", "Modalidad")}: {sum.modality || uiShellT("-", "-")}'
    }
  }

  $newText = ($lines -join "`r`n")
  if ($newText -ne $code0) {
    Write-Utf8NoBom $viewerPath $newText
    Write-Host ("Patched: {0}" -f $viewerPath) -ForegroundColor Green
  } else {
    Write-Host "No changes were necessary." -ForegroundColor Yellow
  }
}

# Build and show context
$toolsDir = Join-Path $RepoRoot "tools"
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
$blog = Join-Path $toolsDir ("build_doctor6_{0}.txt" -f (Get-Date -Format "yyyyMMdd_HHmmss"))

$cmd  = 'cd /d "{0}" && npm run build > "{1}" 2>&1' -f $RepoRoot, $blog
cmd.exe /c $cmd | Out-Null
$exit = $LASTEXITCODE

Write-Host ""
Write-Host ("Build exit code: {0}" -f $exit) -ForegroundColor Yellow
Write-Host ("Build log: {0}" -f $blog) -ForegroundColor Cyan

if ($exit -ne 0) {
  $b = Get-Content -LiteralPath $blog
  $rx = '(?i)(error during build|\[vite:esbuild\]|transform failed|syntaxerror|rolluperror|unexpected closing|does not match opening|expected\s+["' + "'" + ']?;|expected\s+\{|is not valid inside a jsx element)'
  $hits = $b | Select-String -Pattern $rx -ErrorAction SilentlyContinue
  Write-Host ""
  Write-Host "=== BUILD ERROR CONTEXT (log) ===" -ForegroundColor Red
  if ($hits) {
    $h = $hits | Select-Object -Last 1
    $i = [Math]::Max(0, $h.LineNumber - 25)
    $j = [Math]::Min($b.Count - 1, $h.LineNumber + 90)
    $b[$i..$j] | ForEach-Object { $_ }
  } else {
    $start = [Math]::Max(0, $b.Count - 220)
    $b[$start..($b.Count - 1)] | ForEach-Object { $_ }
  }
}

$global:LASTEXITCODE = $exit
if ($Pause) { Read-Host "Press Enter to close" }
return $exit