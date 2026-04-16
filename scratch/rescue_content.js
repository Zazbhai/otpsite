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
      if (file.endsWith('.html') || file.endsWith('.css') || file.endsWith('.js')) {
        filelist.push(filePath);
      }
    }
  });
  return filelist;
}

const files = walkSync('.');

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('—') && content.length > 100) {
      // Check if it's "character—character—character"
      const sample = content.substring(0, 100);
      const dashCount = (sample.match(/—/g) || []).length;
      if (dashCount > 20) {
          console.log(`DE-CORRUPTING: ${file}`);
          // Remove EVERY em-dash
          content = content.split('—').join('');
          fs.writeFileSync(file, content, 'utf8');
      }
  }
});
