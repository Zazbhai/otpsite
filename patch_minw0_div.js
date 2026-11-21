const fs = require('fs');
const path = require('path');

const files = [
  'dashboard.html',
  'wallet.html',
  'buy.html',
  'orders.html',
  'profile.html',
  'referrals.html',
  'accounts.html'
];

files.forEach(file => {
  const filePath = path.join(__dirname, 'views', file);
  if (!fs.existsSync(filePath)) return;
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Find <div class="flex-1 max-w-[1200px]...
  content = content.replace(/<div class="([^"]*max-w-\[1200px\][^"]*)"/g, (match, classes) => {
    if (!classes.includes('min-w-0')) {
      return `<div class="${classes} min-w-0"`;
    }
    return match;
  });
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Patched container min-w-0 on', file);
});
