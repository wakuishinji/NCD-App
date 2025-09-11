Write-Host "=== Restructure NCD folders ==="

$root = "C:\ncd-app"

# Create target folders
$folders = @("nakano-medical", "worker", "settings")
foreach ($f in $folders) {
    $path = Join-Path $root $f
    if (!(Test-Path $path)) {
        New-Item -ItemType Directory -Force -Path $path | Out-Null
        Write-Host "Created: $path"
    } else {
        Write-Host "Exists:  $path"
    }
}

# Move web files (index.html, etc.) to nakano-medical
$webFiles = Get-ChildItem $root -File | Where-Object { $_.Name -match "index|\.html|\.config" }
foreach ($file in $webFiles) {
    Move-Item $file.FullName (Join-Path $root "nakano-medical") -Force
    Write-Host "Moved web file: $($file.Name)"
}

# Move worker-related files
$workerFiles = @("package.json","package-lock.json","wrangler.toml","worker_api_generate.js","worker_settings.js","setup.ps1")
foreach ($wf in $workerFiles) {
    $src = Join-Path $root $wf
    if (Test-Path $src) {
        Move-Item $src (Join-Path $root "worker") -Force
        Write-Host "Moved worker file: $wf"
    }
}

Write-Host "=== Restructure Done ==="