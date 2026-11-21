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

const mobileNavItems = [
  { id: 'dashboard', href: '/dashboard', icon: 'home', text: 'Home' },
  { id: 'buy', href: '/dashboard/buy', icon: 'add_shopping_cart', text: 'Buy' },
  { id: 'orders', href: '/dashboard/orders', icon: 'history_edu', text: 'History' },
  { id: 'accounts', href: '/dashboard/accounts', icon: 'folder_special', text: 'Accounts' },
  { id: 'wallet', href: '/dashboard/wallet', icon: 'account_balance_wallet', text: 'Wallet' }
];

const inactiveClass = 'flex flex-col items-center justify-center text-on-surface-variant active:bg-surface-container scale-95 active:scale-90 transition-transform px-4 py-1 rounded-xl';
const activeClass = 'flex flex-col items-center justify-center text-primary bg-primary-container/20 rounded-xl px-4 py-1 scale-95 transition-transform';

function generateMobileNav(activeId) {
  let html = '<nav class="md:hidden fixed bottom-0 w-full z-50 rounded-t-xl bg-surface/90 backdrop-blur-lg border-t border-outline-variant/20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] shadow-lg flex justify-around items-center h-16 px-2 pb-safe">\n';
  for (const item of mobileNavItems) {
    // Determine if this item should be considered active.
    let isActive = false;
    if (activeId === item.id) {
        isActive = true;
    } else if (activeId === 'referrals' && item.id === 'dashboard') {
        isActive = false; // no active state for non-bottom nav links
    } else if (activeId === 'profile' && item.id === 'dashboard') {
        isActive = false;
    }

    const cls = isActive ? activeClass : inactiveClass;
    const fw = isActive ? ' font-bold' : '';
    html += `  <a class="${cls}" href="${item.href}">\n`;
    html += `    <span class="material-symbols-outlined">${item.icon}</span>\n`;
    html += `    <span class="font-label-md text-[10px] mt-1${fw}">${item.text}</span>\n`;
    html += `  </a>\n`;
  }
  html += '</nav>';
  return html;
}

files.forEach(file => {
  const filePath = path.join(__dirname, 'views', file);
  if (!fs.existsSync(filePath)) return;
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Find <nav class="md:hidden ..."> ... </nav>
  const navRegex = /<nav class="md:hidden fixed bottom-0 w-full z-50[\s\S]*?<\/nav>/;
  
  const activeId = file.replace('.html', '');
  
  const newNav = generateMobileNav(activeId);
  
  content = content.replace(navRegex, newNav);
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Patched Mobile', file);
});
