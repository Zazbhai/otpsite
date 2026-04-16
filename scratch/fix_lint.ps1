$p = "public/css/main.css"
$c = Get-Content $p -Raw
$c = $c -replace '\[data-theme="light"\] \{ \}', '[data-theme="light"] { /* v1 */ }'
$c = $c -replace '\[data-theme="dark"\] \{[^}]+\}', '[data-theme="dark"] { /* v1 */ }'
Set-Content $p -Value $c -Encoding UTF8
