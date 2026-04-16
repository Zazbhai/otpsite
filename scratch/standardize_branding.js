const fs = require('fs');
const path = require('path');

function walkSync(dir, filelist = []) {
  const files = fs.readdirSync(dir);
  files.forEach(function(file) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      if (!file.includes('node_modules') && !file.includes('.git')) {
        filelist = walkSync(filePath, filelist);
      }
    } else {
      if (file.endsWith('.html') || file.endsWith('.js')) {
        filelist.push(filePath);
      }
    }
  });
  return filelist;
}

const files = walkSync('views');
// Also main.js
files.push('public/js/main.js');

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // Replace branding variants with placeholder
  content = content.replace(/Rapid OTP/g, '{{SITE_NAME}}');
  content = content.replace(/Zaz/g, '{{SITE_NAME}}');
  
  // Strip BOM if it somehow sneaked back in
  if (content.charCodeAt(0) === 0xFEFF) {
      content = content.substring(1);
  }

  if (content !== original) {
    fs.writeFileSync(file, content, { encoding: 'utf8' });
  }
});
