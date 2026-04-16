$path = "public/css/main.css"
$content = Get-Content $path -Raw
$content = $content -replace '--bg-1:\s*#[0-9a-zA-Z]{6};', '--bg-1: #000000;'
$content = $content -replace '--bg-2:\s*#[0-9a-zA-Z]{6};', '--bg-2: #050505;'
$content = $content -replace '--bg:\s*#[0-9a-zA-Z]{6};', '--bg: #000000;'
$content = $content -replace '\[data-theme="light"\] \{[^}]+\}', '[data-theme="light"] { }'
Set-Content -Path $path -Value $content -Encoding UTF8
