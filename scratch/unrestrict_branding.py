import os

filepath = r"c:\Users\zgarm\OneDrive\Desktop\Otp Site\public\js\main.js"
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Update line 570 (isBasicTheme) to always true for now or just ignore it in conditions
# Actually I'll just change the conditions.

for i in range(len(lines)):
    if 'if (settings.primary_color && isBasicTheme) {' in lines[i]:
        lines[i] = lines[i].replace('&& isBasicTheme', '')
    if 'if (settings.text_color && isBasicTheme) {' in lines[i]:
        lines[i] = lines[i].replace('&& isBasicTheme', '')

with open(filepath, 'w', encoding='utf-8') as f:
    f.writelines(lines)
