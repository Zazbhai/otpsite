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
  content = content.replace(/<script src=\"\/js\/ambient-bg\.js.*?><\/script>/g, '');
  
  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log('Removed ambient-bg.js from: ' + file);
  }
});
console.log('Done');
