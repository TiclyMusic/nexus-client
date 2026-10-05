# Pubblicazione MANUALE degli installer su Cloudflare (la pagina su Netlify li legge da lì).
# Il modo normale è la CI: `git tag vX.Y.Z; git push origin vX.Y.Z` compila Windows, macOS e Linux
# e pubblica tutto (.github/workflows/release.yml).
#
# Uso (dalla cartella site/):  ./deploy.ps1          → copia l'installer Windows locale e pubblica
#                              ./deploy.ps1 -Force   → pubblica anche se mancano Mac/Linux
# Prima compila il launcher dalla root del progetto con `npm run tauri build`.
param([switch]$Force)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$bundle = Join-Path $root "src-tauri\target\release\bundle"
$out = Join-Path $PSScriptRoot "cdn\download"
New-Item -ItemType Directory -Force $out | Out-Null

$exe = Get-ChildItem (Join-Path $bundle "nsis\*-setup.exe") -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$msi = Get-ChildItem (Join-Path $bundle "msi\*.msi") -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { throw "Nessun installer trovato in $bundle\nsis. Esegui prima: npm run tauri build" }
Copy-Item $exe.FullName (Join-Path $out "nexus-launcher-setup.exe") -Force
if ($msi) { Copy-Item $msi.FullName (Join-Path $out "nexus-launcher.msi") -Force }

# wrangler pubblica la cartella cdn/ così com'è: i file che mancano qui spariscono dal sito.
$missing = @("nexus-launcher.dmg", "nexus-launcher.AppImage", "nexus-launcher.deb", "nexus-launcher.rpm") |
  Where-Object { -not (Test-Path (Join-Path $out $_)) }
if ($missing -and -not $Force) {
  throw "Mancano $($missing -join ', '): pubblicando ora verrebbero rimossi da nexusmc.online. Usa la CI (tag vX.Y.Z) oppure ./deploy.ps1 -Force."
}

node (Join-Path $PSScriptRoot "scripts\write-latest.mjs") | Out-Null
Write-Host "Pubblico gli installer..."
Push-Location $PSScriptRoot
try { npx wrangler deploy } finally { Pop-Location }
Write-Host "Fatto. Netlify va ripubblicato solo se hai modificato la pagina (public/)."
