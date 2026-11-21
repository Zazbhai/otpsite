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
  content = content.replace(/src=\"\/js\/ambient-bg\.js(\?v=[0-9\.]+)?\"/g, 'src="/js/ambient-bg.js?v=' + Date.now() + '"');
  
  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log('Cache busted ambient: ' + file);
  }
});
console.log('Cache busted ambient-bg.js in admin templates');
