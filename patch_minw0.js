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
  
  // Find <main class="... flex-1 md:ml-64 flex flex-col min-h-screen relative pb-20 md:pb-0">
  // Just look for <main class=" and add min-w-0 if not there
  content = content.replace(/<main class="([^"]+)"/, (match, classes) => {
    if (!classes.includes('min-w-0')) {
      return `<main class="${classes} min-w-0"`;
    }
    return match;
  });
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Patched main min-w-0 on', file);
});
