# PowerShell スクリプト
# C:\ncd-worker\ncd-worker → C:\ncd-app に移動整理する

# 新しいルートフォルダ
$newRoot = "C:\ncd-app"

# フォルダがなければ作成
if (-Not (Test-Path $newRoot)) {
    New-Item -ItemType Directory -Path $newRoot
}

# 移動対象のフォルダ
$oldPath = "C:\ncd-worker\ncd-worker"

# 中身をすべて移動
Get-ChildItem -Path $oldPath | ForEach-Object {
    Move-Item -Path $_.FullName -Destination $newRoot -Force
}

Write-Host "✅ フォルダを $oldPath から $newRoot に移動しました"