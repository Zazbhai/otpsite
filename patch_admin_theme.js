const fs = require('fs');
const path = require('path');

// Simple script to read all HTML files in views/admin and replace hardcoded rgba/hex colors with variables

function getFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getFiles(filePath, fileList);
    } else if (filePath.endsWith('.html')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const adminFiles = getFiles(path.join(__dirname, 'views', 'admin'));

adminFiles.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // Backgrounds
  content = content.replace(/background:\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.0[1-5]\s*\)/g, 'background:var(--surface-container-low)');
  content = content.replace(/background:\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.[1-9]\s*\)/g, 'background:var(--surface-container-high)');
  
  // Borders
  content = content.replace(/border:\s*1px\s*solid\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.0[1-9]\s*\)/g, 'border: 1px solid var(--outline-variant)');
  content = content.replace(/border-bottom:\s*1px\s*solid\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.0[1-9]\s*\)/g, 'border-bottom: 1px solid var(--outline-variant)');
  content = content.replace(/border-color:\s*'rgba\(255,\s*255,\s*255,\s*0\.1\)'/g, 'border-color: "var(--outline-variant)"');
  
  // Chart Grids (Chart.js expects a string for color)
  content = content.replace(/color:\s*\"rgba\(255,255,255,0\.0[1-9]\)\"/g, 'color: "var(--outline-variant)"');
  
  // Chart text colors
  content = content.replace(/color:\s*\"#94a3b8\"/g, 'color: "var(--on-surface-variant)"');
  content = content.replace(/color:\s*'#94a3b8'/g, 'color: "var(--on-surface-variant)"');

  // Hardcoded panel borders
  content = content.replace(/border:\s*2px\s*solid\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.3\s*\)/g, 'border: 2px solid var(--outline-variant)');

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log('Patched: ' + file);
  }
});
