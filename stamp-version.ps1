<#
  Stamp a version onto the script and stylesheet tags so a push actually reaches
  the browser.

  WHY
  GitHub Pages serves app.js with a long cache lifetime. Reloading the page picks
  up new HTML and keeps the OLD JavaScript, which is worse than no deploy at all:
  the page looks updated - new labels, new sections - while the code behind it is
  yesterday's. That is exactly how a SHAPE row appeared with no buttons in it.

  Run this before committing. It rewrites every local asset reference to
  ?v=<git short sha>-<UTC stamp>, so each deploy is a different URL and the
  browser has nothing to reuse.

  Usage:  ./stamp-version.ps1
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# The sha is the useful half - it says WHICH build a stale tab is on. The time
# makes it unique even when re-stamping the same commit.
$sha = (& git -C $root rev-parse --short HEAD 2>$null)
if (-not $sha) { $sha = 'dev' }
$ver = "$sha-" + (Get-Date -Format 'yyyyMMddHHmm')

$assets = 'app.js','animate-ui.js','animate.css','style.css'
$changed = @()

Get-ChildItem -LiteralPath $root -Filter *.html -File | ForEach-Object {
  $p = $_.FullName
  $txt = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)
  $orig = $txt
  foreach ($a in $assets) {
    # Matches the bare name and any existing ?v=..., so re-running replaces
    # rather than stacking query strings.
    $esc = [regex]::Escape($a)
    $txt = [regex]::Replace($txt, "(src|href)=""$esc(\?v=[^""]*)?""", "`$1=""$a`?v=$ver""")
  }
  if ($txt -ne $orig) {
    [IO.File]::WriteAllText($p, $txt, (New-Object Text.UTF8Encoding($false)))
    $changed += $_.Name
  }
}

if ($changed.Count) { Write-Host "  stamped $ver into: $($changed -join ', ')" }
else                { Write-Host "  nothing to stamp" }
