# Compiles ONLY the installer wizard (build/win32/code.iss) for fast UI testing.
#
# WHAT THIS IS FOR:
#   Iterating on the "Required Dependencies" wizard page + dependency install
#   flow without building the whole IDE. It stubs a minimal SourceDir so ISCC
#   can package something, injects all required /d defs, and produces a runnable
#   SIIDSetup.exe in a temp folder.
#
# WHAT THIS IS NOT:
#   A shippable installer. The packaged payload is a FAKE Siid.exe + empty tools
#   dir - the wizard runs, but there is no real IDE inside. To build the real,
#   installable product use:  npx gulp vscode-win32-x64-user-setup
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\test-installer.ps1        # build only
#   powershell -ExecutionPolicy Bypass -File .\test-installer.ps1 -Run   # build + launch
# The script prints the SIIDSetup.exe path; step to the "Required Dependencies" page.
# (Close any previously-run SIIDSetup.exe first, or the rebuild will be locked.)

param(
  # Launch the built installer automatically once compiled.
  [switch]$Run
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path .).Path
$iscc = Join-Path $repo 'node_modules\innosetup\bin\ISCC.exe'
if (-not (Test-Path $iscc)) { throw "ISCC not found at $iscc" }

# --- Build a throwaway workspace: stub SourceDir + output dir ------------------
$work    = Join-Path $env:TEMP 'siid-installer-test'
$srcDir  = Join-Path $work 'src'          # stands in for the built VSCode-win32 app
$outDir  = Join-Path $work 'out'
$toolsDir = Join-Path $srcDir 'tools'
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $srcDir, $outDir, $toolsDir | Out-Null

# [Files] does `Source: "*"` from SourceDir and `Source: "tools\*"`, and needs a
# product.json to copy in. Give it the bare minimum so packaging succeeds.
Set-Content -Path (Join-Path $srcDir 'Siid.exe') -Value 'stub' -Encoding ascii
Set-Content -Path (Join-Path $toolsDir 'placeholder.txt') -Value 'stub' -Encoding ascii
$productJson = Join-Path $outDir 'product.json'
Copy-Item (Join-Path $repo 'product.json') $productJson -Force

# --- All /d definitions the script references --------------------------------
$defs = @{
  NameLong               = 'Salesforce Intelligence Integrated Development'
  NameShort              = 'Siid'
  DirName                = 'Siid'
  Version                = '1.115.0'
  RawVersion             = '1.115.0'
  NameVersion            = 'Salesforce Intelligence Integrated Development'
  ExeBasename            = 'Siid'
  RegValueName           = 'Siid'
  ShellNameShort         = 'Siid'
  AppMutex               = 'siid'
  TunnelMutex            = 'siid-tunnel'
  TunnelServiceMutex     = 'siid-tunnelservice'
  TunnelApplicationName  = 'siid-tunnel'
  ApplicationName        = 'siid'
  Arch                   = 'x64'
  AppId                  = '{{4DA0B567-9F3E-6FA4-D7E5-AC1B4E8G6D9F}'  # user AppId
  IncompatibleTargetAppId = '{{2B8E9A45-7F1C-4D82-B5E3-8A9F2C6E4B7D}' # system AppId
  AppUserId              = 'Conscendo.SalesforceIntelligenceIDE'
  ArchitecturesAllowed   = 'x64'
  ArchitecturesInstallIn64BitMode = 'x64'
  SourceDir              = $srcDir
  RepoDir                = $repo
  OutputDir              = $outDir
  InstallTarget          = 'user'
  ProductJsonPath        = $productJson
  Quality                = 'stable'
}

$defArgs = $defs.GetEnumerator() | ForEach-Object { "/d$($_.Key)=$($_.Value)" }
$iss = Join-Path $repo 'build\win32\code.iss'

Write-Host "Compiling installer (UI test build)..." -ForegroundColor Cyan
& $iscc $iss @defArgs
if ($LASTEXITCODE -ne 0) { throw "ISCC failed with exit code $LASTEXITCODE" }

$exe = Join-Path $outDir 'SIIDSetup.exe'
Write-Host ""
Write-Host "OK. Installer built at:" -ForegroundColor Green
Write-Host "  $exe"
Write-Host ""
Write-Host "To run it:" -ForegroundColor Yellow
Write-Host "  Start-Process '$exe'"
Write-Host "  (or re-run this script with -Run to launch it automatically)"
Write-Host ""
Write-Host "Click through to the 'Required Dependencies' page to see the UI." -ForegroundColor Yellow
Write-Host "It is a real installer stub - use a throwaway install dir, or just Cancel after the page." -ForegroundColor Yellow

if ($Run) {
  Write-Host ""
  Write-Host "Launching installer..." -ForegroundColor Cyan
  Start-Process $exe
}
