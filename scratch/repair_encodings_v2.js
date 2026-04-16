const fs = require('fs');
const path = require('path');

// Deep Repair Mapping for Mojibake
const MOJIBAKE_MAP = {
  '��': '��',
  '��': '��',
  '��': '��',
  '��': '��',
  '��': '��',
  '��': '��',
  '��': '��',
  '��': '��',
  '��': '��',
  '����': '����',
  '��': '��',
  '��': '��',
  '��': '��',
  '��': '��',
  '��': '��',
  '��': '��',
  '��': '��',
  '': '', // The replacement character usually comes from broken em-dashes
  '═': '═',
  '──': '──',
  '⚡': '⚡',
  '': '',
  'ðŸ’³': '��',
  'ðŸ“‹': '��',
  'ðŸ‘¤': '��',
  'ðŸšª': '��',
  'Ã¢Å¡Â¡': '⚡',
  'Ã¢â€¢Â': '═'
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
  let original = content;

  // Generic patterns
  for (const [bad, good] of Object.entries(MOJIBAKE_MAP)) {
      content = content.split(bad).join(good);
  }

  // Handle specific cases like "ðŸ  Home" (often has invisible spaces)
  content = content.replace(/ðŸ\s* /g, '��'); 
  content = content.replace(/�� /g, '��');

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`FIXED: ${file}`);
  }
});
