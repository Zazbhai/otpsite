const fs = require('fs');
const path = require('path');

const MOJIBAKE_MAP = {
  '═': '═',
  '═': '═',
  '': '',
  '': '',
  '──': '──',
  '─': '─',
  '⚡': '⚡',
  '⚡': '⚡',
  '��': '��',
  '��': '��',
  '��': '��',
  '��': '��',
  '����': '����',
  '✓': '✓',
  '✓': '✓',
  '✓œ': '✓',
  '✅': '✅',
  '��': '��',
  '��': '��',
  '��': '��',
  '��': '��',
  '��': '��',
  '��': '��',
  '✕': '✕',
  '✓¢': '✕',
  '©': '©',
  '▶': '▶',
  '→': '→',
  '': '', // Non-breaking space often gets messed up
  '': '', // BOM marker
};

function walkSync(dir, filelist = []) {
  const files = fs.readdirSync(dir);
  files.forEach(function(file) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      if (!file.includes('node_modules') && !file.includes('.git')) {
        filelist = walkSync(filePath, filelist);
      }
    } else {
      if (file.endsWith('.html') || file.endsWith('.css') || file.endsWith('.js') || file.endsWith('.json')) {
        filelist.push(filePath);
      }
    }
  });
  return filelist;
}

const files = walkSync('.');
console.log(`Found ${files.length} candidate files for repair.`);

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // Remove BOM if present
  if (content.charCodeAt(0) === 0xFEFF || content.startsWith('')) {
    content = content.substring(content.charCodeAt(0) === 0xFEFF ? 1 : 3);
  }
  
  // Fix specific corrupted characters
  for (const [bad, good] of Object.entries(MOJIBAKE_MAP)) {
    if (content.includes(bad)) {
        content = content.split(bad).join(good);
    }
  }

  // Handle the '?' at start of index.html
  if (file.includes('index.html') && content.startsWith('?')) {
      content = content.substring(1);
  }

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`REPAIRED: ${file}`);
  }
});

console.log("Repair complete.");
