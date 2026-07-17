$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "Checking LocalDev MCP files..." -ForegroundColor Cyan

$required = @(
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "projects.json",
    "src\index.ts"
)

foreach ($item in $required) {
    $path = Join-Path $root $item

    if (-not (Test-Path -LiteralPath $path)) {
        throw "Missing required file: $item"
    }

    if ((Get-Item -LiteralPath $path).Length -eq 0) {
        throw "File is empty: $item. Re-download and extract the ZIP again."
    }
}

# Windows PowerShell 5.1 ConvertFrom-Json cannot parse package-lock v3
# because package-lock.json contains an intentionally empty property name ("").
# Use Node.js for standards-compliant JSON validation instead.
$jsonFiles = @("package.json", "package-lock.json", "tsconfig.json", "projects.json")
foreach ($jsonFile in $jsonFiles) {
    $jsonPath = Join-Path $root $jsonFile
    & node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));" $jsonPath

    if ($LASTEXITCODE -ne 0) {
        throw "$jsonFile is not valid JSON."
    }
}

Write-Host "Files are valid." -ForegroundColor Green
Write-Host "Installing dependencies..." -ForegroundColor Cyan
& npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }

Write-Host "Building..." -ForegroundColor Cyan
& npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }

Write-Host "Type checking..." -ForegroundColor Cyan
& npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "npm run typecheck failed with exit code $LASTEXITCODE" }

Write-Host "LocalDev MCP installation passed." -ForegroundColor Green
