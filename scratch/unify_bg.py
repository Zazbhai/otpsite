import re
import os

path = 'public/css/main.css'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update :root --bg to #0D0D0D
content = re.sub(r'--bg:\s+#[a-fA-F0-9]+;', '--bg: #0D0D0D;', content, count=1)

# 2. Remove --bg from [data-theme=...] blocks
# We look for [data-theme="..."] { ... } and remove --bg: ...;
def remove_bg(match):
    block = match.group(0)
    # Don't remove if it's the root block (though regex below targets themes)
    new_block = re.sub(r'^\s+--bg:\s+[^;]+;\s*\n?', '', block, flags=re.MULTILINE)
    return new_block

content = re.sub(r'\[data-theme="[^"]+"\]\s*\{[^}]+\}', remove_bg, content)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Main CSS backgrounds unified to #0D0D0D")
