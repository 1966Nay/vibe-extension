# VibeEscape Extractor — one-time setup
# Downloads JSZip into lib/ so the extension can bundle it locally.
# Chrome MV3 extensions cannot load scripts from external CDN URLs due to CSP.

$libDir = Join-Path $PSScriptRoot "lib"
$dest   = Join-Path $libDir "jszip.min.js"
$url    = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"

if (-not (Test-Path $libDir)) {
    New-Item -ItemType Directory -Force -Path $libDir | Out-Null
}

Write-Host "Downloading JSZip 3.10.1 from cdnjs..." -ForegroundColor Cyan
try {
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
    $size = (Get-Item $dest).Length
    Write-Host "Saved to $dest ($size bytes)" -ForegroundColor Green
} catch {
    Write-Host "Download failed: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Setup complete. To load the extension in Chrome:" -ForegroundColor Yellow
Write-Host "  1. Go to chrome://extensions"
Write-Host "  2. Enable 'Developer mode' (top-right toggle)"
Write-Host "  3. Click 'Load unpacked'"
Write-Host "  4. Select this folder: $PSScriptRoot"
Write-Host ""
Write-Host "The extension icon turns purple on any GHL AI Studio page with ?view=codeEditor in the URL." -ForegroundColor Cyan
