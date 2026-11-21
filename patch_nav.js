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

const menuItems = [
  { id: 'dashboard', href: '/dashboard', icon: 'dashboard', text: 'Dashboard' },
  { id: 'wallet', href: '/dashboard/wallet', icon: 'account_balance_wallet', text: 'Wallet' },
  { id: 'buy', href: '/dashboard/buy', icon: 'add_shopping_cart', text: 'Buy Number' },
  { id: 'accounts', href: '/dashboard/accounts', icon: 'folder_special', text: 'Accounts' },
  { id: 'orders', href: '/dashboard/orders', icon: 'receipt_long', text: 'Orders' },
  { id: 'referrals', href: '/dashboard/referrals', icon: 'group', text: 'Referrals' },
  { id: 'profile', href: '/dashboard/profile', icon: 'person', text: 'Profile' }
];

const inactiveClass = 'flex items-center gap-3 px-4 py-3 text-on-surface-variant hover:bg-surface-container-high transition-all duration-200 ease-in-out font-label-md text-label-md rounded-lg';
const activeClass = 'flex items-center gap-3 px-4 py-3 text-primary bg-primary-container/10 border-l-4 border-primary rounded-r-lg transition-all duration-200 ease-in-out font-label-md text-label-md';

function generateNav(activeId) {
  let html = '  <nav class="flex-1 px-4 space-y-2">\n';
  for (const item of menuItems) {
    const cls = item.id === activeId ? activeClass : inactiveClass;
    html += `    <a href="${item.href}" class="${cls}">\n`;
    html += `      <span class="material-symbols-outlined">${item.icon}</span> ${item.text}\n`;
    html += `    </a>\n`;
  }
  html += '  </nav>';
  return html;
}

files.forEach(file => {
  const filePath = path.join(__dirname, 'views', file);
  if (!fs.existsSync(filePath)) return;
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Find <nav class="flex-1 px-4 space-y-2"> ... </nav>
  const navRegex = /<nav class="flex-1 px-4 space-y-2">[\s\S]*?<\/nav>/;
  
  const activeId = file.replace('.html', '');
  
  const newNav = generateNav(activeId);
  
  content = content.replace(navRegex, newNav);
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Patched', file);
});
