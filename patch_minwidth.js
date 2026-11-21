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
  
  // Find <main class="... min-w-0"> and replace with style="min-width: 0;"
  content = content.replace(/<main class="([^"]+?)\s*min-w-0"/g, '<main class="$1" style="min-width: 0;"');
  // If min-w-0 was not there, just add style="min-width: 0;" to <main
  content = content.replace(/<main class="([^"]+?)"(?!.*style="min-width: 0;")/g, '<main class="$1" style="min-width: 0;"');

  // Same for the div
  content = content.replace(/<div class="([^"]+?)\s*min-w-0"/g, '<div class="$1" style="min-width: 0;"');
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Patched style="min-width: 0;" on', file);
});
