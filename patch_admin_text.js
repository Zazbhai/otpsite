const fs = require('fs');
const path = require('path');
const getFiles = (dir, fileList = []) => {
  fs.readdirSync(dir).forEach(file => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) getFiles(filePath, fileList);
    else if (filePath.endsWith('.html')) fileList.push(filePath);
  });
  return fileList;
};

const adminFiles = getFiles(path.join(__dirname, 'views', 'admin'));

adminFiles.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // Fix hardcoded #fff text colors which are invisible in light theme
  content = content.replace(/color:\s*#fff/g, 'color:var(--on-surface)');
  content = content.replace(/color:\s*\"#fff\"/g, 'color: "var(--on-surface)"');
  content = content.replace(/color:\s*'#fff'/g, "color: 'var(--on-surface)'");
  
  // Fix specifically the referral analytics header
  content = content.replace(/color:#fff/g, 'color:var(--on-surface)');

  // Fix borders using #fff for spinner/loader
  content = content.replace(/border-top-color:\s*#fff/g, 'border-top-color: var(--on-surface)');

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log('Patched text colors in: ' + file);
  }
});
