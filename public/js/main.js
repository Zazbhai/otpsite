/* ── Shared JS helpers ── */

/**
 * Generates skeleton table rows
 * @param {number} rows 
 * @param {number} cols 
 */
function skeletonTable(rows = 5, cols = 4) {
  let html = '';
  for (let i = 0; i < rows; i++) {
    html += '<tr>' + Array(cols).fill('<td><div class="skeleton skeleton-text"></div></td>').join('') + '</tr>';
  }
  return html;
}

/**
 * Generates skeleton grid items
 * @param {number} count 
 * @param {string} className 
 */
function skeletonGrid(count = 4, className = 'card') {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `<div class="${className}"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text short"></div></div>`;
  }
  return html;
}

const API = {
  fetchRequest: (url, options = {}) => fetch(url, options),
  get:   (url, options = {}) => API.fetchRequest(url, { headers: authHeaders(), ...options }).then(handleRes),
  post:  (url, body, options = {}) => API.fetchRequest(url, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body), ...options }).then(handleRes),
  patch: (url, body, options = {}) => API.fetchRequest(url, { method: "PATCH", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body), ...options }).then(handleRes),
  put:   (url, body, options = {}) => API.fetchRequest(url, { method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body), ...options }).then(handleRes),
  del:   (url, options = {}) => API.fetchRequest(url, { method: "DELETE", headers: authHeaders(), ...options }).then(handleRes),
  delete: (url, options = {}) => API.del(url, options),
  upload: (url, formData, method = "POST", options = {}) => API.fetchRequest(url, { method: method, headers: authHeaders(), body: formData, ...options }).then(handleRes),
};

function authHeaders() {
  const token = (typeof getToken === 'function' ? getToken() : null) || localStorage.getItem("otp_token") || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleRes(res) {
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : { error: await res.text() };
  if (!res.ok) {
    console.error("API Error:", data.error);
    if (res.status === 401) {
      localStorage.removeItem("otp_token");
      localStorage.removeItem("otp_user");
      window.location.href = "/index.html?login=1";
    }
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data;
}


// ── Unified Theme System ─────────────────────────────────────────────────
// Single canonical THEMES list used everywhere (settings preview + runtime)
const THEME_STORAGE_KEY = "otp_theme";
window.THEMES = [
  { id: 'light',     label: 'Light Mode',      icon: '☀️', accent: '#3b82f6', grad: 'linear-gradient(135deg, #3b82f6, #6366f1)' },
  { id: 'dark',      label: 'Eclipse Dark',   icon: '🌑', accent: '#3b82f6', grad: 'linear-gradient(135deg, #3b82f6, #6366f1)' },
  { id: 'midnight',  label: 'Midnight',        icon: '🌌', accent: '#818cf8', grad: 'linear-gradient(135deg, #818cf8, #a78bfa)' },
  { id: 'ocean',     label: 'Ocean',           icon: '🌊', accent: '#38bdf8', grad: 'linear-gradient(135deg, #38bdf8, #06b6d4)' },
  { id: 'sunset',    label: 'Sunset',          icon: '🌅', accent: '#fb923c', grad: 'linear-gradient(135deg, #fb923c, #f97316)' },
  { id: 'forest',    label: 'Forest',          icon: '🌲', accent: '#22c55e', grad: 'linear-gradient(135deg, #22c55e, #15803d)' },
  { id: 'lavender',  label: 'Lavender',        icon: '💜', accent: '#8b5cf6', grad: 'linear-gradient(135deg, #8b5cf6, #a78bfa)' },
  { id: 'aurora',    label: 'Aurora',          icon: '🌠', accent: '#22d3ee', grad: 'linear-gradient(135deg, #22d3ee, #8b5cf6)' },
  { id: 'ember',     label: 'Ember',           icon: '🔥', accent: '#f97316', grad: 'linear-gradient(135deg, #f97316, #ef4444)' },
  { id: 'citrus',    label: 'Citrus',          icon: '🍋', accent: '#a3e635', grad: 'linear-gradient(135deg, #a3e635, #84cc16)' },
  { id: 'neon',      label: 'Neon Cyber',      icon: '🤖', accent: '#06b6d4', grad: 'linear-gradient(135deg, #06b6d4, #c026d3)' },
  { id: 'coral',     label: 'Coral',           icon: '🪸', accent: '#fb7185', grad: 'linear-gradient(135deg, #fb7185, #f97316)' },
  { id: 'rose',      label: 'Rose',            icon: '🌹', accent: '#fb7185', grad: 'linear-gradient(135deg, #fb7185, #f43f5e)' },
  { id: 'violet',    label: 'Violet',          icon: '🔮', accent: '#a78bfa', grad: 'linear-gradient(135deg, #a78bfa, #8b5cf6)' },
  { id: 'mint',      label: 'Mint',            icon: '🌿', accent: '#34d399', grad: 'linear-gradient(135deg, #34d399, #10b981)' },
  { id: 'cherry',    label: 'Cherry',          icon: '🍒', accent: '#ef4444', grad: 'linear-gradient(135deg, #ef4444, #dc2626)' },
  { id: 'sky',       label: 'Sky Blue',        icon: '☁️', accent: '#0ea5e9', grad: 'linear-gradient(135deg, #0ea5e9, #0284c7)' },
  { id: 'berry',     label: 'Berry',           icon: '🫐', accent: '#8b5cf6', grad: 'linear-gradient(135deg, #8b5cf6, #7c3aed)' },
  { id: 'peach',     label: 'Peach',           icon: '🍑', accent: '#fb923c', grad: 'linear-gradient(135deg, #fb923c, #f97316)' },
  { id: 'teal',      label: 'Teal',            icon: '🫧', accent: '#14b8a6', grad: 'linear-gradient(135deg, #14b8a6, #0d9488)' },
  { id: 'copper',    label: 'Copper',          icon: '🟤', accent: '#d97706', grad: 'linear-gradient(135deg, #d97706, #b45309)' },
  { id: 'maroon',    label: 'Maroon',          icon: '🍷', accent: '#dc2626', grad: 'linear-gradient(135deg, #dc2626, #b91c1c)' },
  { id: 'gold',      label: 'Prestige Gold',   icon: '👑', accent: '#eab308', grad: 'linear-gradient(135deg, #eab308, #ca8a04)' },
  { id: 'sage',      label: 'Sage',            icon: '🌾', accent: '#6ee7b7', grad: 'linear-gradient(135deg, #6ee7b7, #34d399)' },
  { id: 'dawn',      label: 'Dawn',            icon: '🌸', accent: '#ec4899', grad: 'linear-gradient(135deg, #ec4899, #f43f5e)' },
  { id: 'stone',     label: 'Stone',           icon: '🪨', accent: '#64748b', grad: 'linear-gradient(135deg, #64748b, #475569)' },
  { id: 'slate',     label: 'Slate',           icon: '🩶', accent: '#64748b', grad: 'linear-gradient(135deg, #64748b, #475569)' },
  { id: 'silver',    label: 'Silver',          icon: '🥈', accent: '#9ca3af', grad: 'linear-gradient(135deg, #9ca3af, #6b7280)' },
  { id: 'bronze',    label: 'Bronze',          icon: '🥉', accent: '#b45309', grad: 'linear-gradient(135deg, #b45309, #92400e)' },
  { id: 'cyber',     label: 'Cyber',           icon: '💻', accent: '#06b6d4', grad: 'linear-gradient(135deg, #06b6d4, #22d3ee)' },
  { id: 'retro',     label: 'Retro',           icon: '📺', accent: '#fbc02d', grad: 'linear-gradient(135deg, #fbc02d, #f9a825)' },
  { id: 'matrix',    label: 'Matrix',          icon: '🖥️', accent: '#22c55e', grad: 'linear-gradient(135deg, #22c55e, #16a34a)' },
  { id: 'pastel',    label: 'Pastel',          icon: '🎨', accent: '#ec4899', grad: 'linear-gradient(135deg, #ec4899, #db2777)' },
];

/**
 * Apply a theme by ID.
 * @param {string} themeId  - must match a THEMES[n].id
 * @param {boolean} isPreview - if true, does NOT write to localStorage
 */
window.applyTheme = function(themeId, isPreview = false, isUserChoice = false) {
  // Force light theme globally to match the new Stitch redesign which is light-only
  themeId = 'light';
  
  const theme = window.THEMES.find(t => t.id === themeId) || window.THEMES[0]; // Index 0 is now light
  const root = document.documentElement;

  // Always set the data-theme attribute so CSS [data-theme="x"] rules fire
  root.setAttribute('data-theme', theme.id);
  root.className = theme.id;

  // Clear any previous inline accent/grad overrides so CSS variables take over
  root.style.removeProperty('--accent');
  root.style.removeProperty('--accent-rgb');
  root.style.removeProperty('--grad-primary');

  if (!isPreview) {
    // Persist for page loads
    localStorage.setItem(THEME_STORAGE_KEY, theme.id);
    // Track if user explicitly made this choice vs it being the admin default
    if (isUserChoice) {
      localStorage.setItem('otp_theme_user_choice', theme.id);
    }
  }
  
  // Notify other components (like background particles)
  window.dispatchEvent(new CustomEvent('themeChanged', { detail: { themeId: theme.id } }));
};

window.getThemePreference = function() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return (window.THEMES.find(t => t.id === saved) ? saved : 'dark');
};

function getThemePreference() { return window.getThemePreference(); }

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'light' ? 'dark' : 'light', false, true); // isUserChoice=true
}

let siteSettings = {
  site_name: "Website Name",
  primary_color: "#3b82f6",
  site_logo: null
};


window.applyBranding = async function(force = false) {
  try {
    const s = await API.get("/api/auth/settings" + (force ? '?t=' + Date.now() : ''));
    siteSettings = { ...siteSettings, ...s };
    localStorage.setItem('site_settings', JSON.stringify(siteSettings));
    
    const name = siteSettings.site_name || "Website Name";
    const oldNames = ["Rapid OTP", "Zaz", "{{SITE_NAME}}"];
    
    // 1. Update Document Title
    if (document.title.includes("{{SITE_NAME}}") || document.title.includes("Rapid OTP")) {
      document.title = document.title.replace(/{{SITE_NAME}}|Rapid OTP/g, name);
    }
    
    // 2. Targeted DOM Updates (Fast)
    document.querySelectorAll(".nav-logo, .footer-logo, .site-name-text").forEach(el => {
      if (el.textContent.includes("{{SITE_NAME}}") || el.textContent.includes("Rapid OTP")) {
        el.innerHTML = el.innerHTML.replace(/{{SITE_NAME}}|Rapid OTP/g, name);
      }
    });

    // 3. Update Favicon
    if (siteSettings.site_favicon) {
      let fav = document.querySelector("link[rel*='icon']");
      if (!fav) {
        fav = document.createElement('link');
        fav.rel = 'shortcut icon';
        document.head.appendChild(fav);
      }
      fav.href = siteSettings.site_favicon;
    }

    // Branding Version Check — force global theme if admin just changed it
    const bv = siteSettings.branding_version || '1';
    const localBv = localStorage.getItem('otp_branding_version');
    if (bv !== localBv) {
      localStorage.removeItem('otp_theme_user_choice');
      localStorage.setItem('otp_branding_version', bv);
    }

    // Apply admin default_theme unless user has explicitly chosen a different one
    const adminTheme = siteSettings.default_theme;
    const userExplicitChoice = localStorage.getItem('otp_theme_user_choice');
    
    // If branding version changed, we often want to reset the user to the new admin theme once
    if (adminTheme) {
      const effectiveTheme = userExplicitChoice || adminTheme;
      window.applyTheme(effectiveTheme);
      if (!userExplicitChoice) localStorage.setItem(THEME_STORAGE_KEY, adminTheme);
    } else if (!localStorage.getItem(THEME_STORAGE_KEY)) {
      window.applyTheme('dark');
    }

    // 4. Custom Colors & CSS
    if (siteSettings.primary_color) {
      document.documentElement.style.setProperty('--accent', siteSettings.primary_color);
    }
    if (siteSettings.custom_css) {
       const styleId = "custom-branding-css";
       let style = document.getElementById(styleId);
       if (!style) {
         style = document.createElement("style");
         style.id = styleId;
         document.head.appendChild(style);
       }
       style.textContent = siteSettings.custom_css;
    }
  } catch (e) {
    console.warn("Branding failed to load", e);
    // Fallback to local
    const local = JSON.parse(localStorage.getItem('site_settings') || '{}');
    if (local.site_name) {
       // Minimal apply if offline
       document.title = document.title.replace(/{{SITE_NAME}}/g, local.site_name);
    }
  }
};
// ── Legacy Preloaders Removed (Consolidated to preloader.js) ───────
// Redirect legacy loader calls for backward compatibility
window.showLoader = () => { if(window.showPageLoader) window.showPageLoader(); };
window.hideLoader = () => {};
window.hidePageLoader = () => {};
// ──────────────────────────────────────────────────────────────────

// Legacy cleanup complete















// Redirect legacy loader calls
window.showLoader = () => { if(window.showPageLoader) window.showPageLoader(); };
window.hideLoader = () => {};
window.hidePageLoader = () => {};

// End of legacy preloader cleanup


// Update all balance displays on the page
window.updateBalanceDisplay = async function() {
  try {
    const data = await API.get('/api/user/dashboard');
    const balStr = typeof fmtMoney === "function" ? fmtMoney(data.balance) : `₹${(+data.balance || 0).toFixed(2)}`;
    document.querySelectorAll("#nav-global-wallet-bal, #nav-wallet-bal, #stat-balance, #p-balance, #wallet-bal, #gnav-user-balance").forEach(el => {
      el.classList.remove("loading-shimmer", "gnav-loading");
      el.textContent = balStr;
    });
    return data;
  } catch (e) { console.error("Balance sync failed", e); }
};

// Global Balance Heartbeat
function startBalanceHeartbeat() {
  if (!isLoggedIn()) return;
  // Poll every 10s on dashboard/billing, 30s elsewhere
  const isPriorityPage = window.location.pathname.includes('/dashboard') || window.location.pathname.includes('/wallet');
  const interval = isPriorityPage ? 30000 : 60000;
  
  setInterval(() => {
    // Only poll if tab is active to save resources
  if (document.visibilityState === 'visible') {
      window.updateBalanceDisplay();
      // Prevent overlapping dashboard refreshes
      if (typeof window.initDashboard === 'function' && window.location.pathname === '/dashboard' && !window.dashboardLoading) {
        window.dashboardLoading = true;
        window.initDashboard().finally(() => window.dashboardLoading = false);
      }
      // If on orders list and initOrders exists, refresh it
      if (typeof window.initOrders === 'function' && window.location.pathname === '/dashboard/orders' && !window.ordersLoading) {
        window.ordersLoading = true;
        window.initOrders().finally(() => window.ordersLoading = false);
      }
    }
  }, interval);
}

// Start heartbeat if logged in
if (isLoggedIn()) {
  startBalanceHeartbeat();
}


// ── Auth helpers ──────────────────────────────────────────────────
function getToken() {
  let token = localStorage.getItem("otp_token");
  if (!token) {
    const match = document.cookie.match(new RegExp('(^| )token=([^;]+)'));
    if (match) {
      token = match[2];
      localStorage.setItem("otp_token", token);
    }
  }
  return token;
}
function getUser()    { try { return JSON.parse(localStorage.getItem("otp_user") || "null"); } catch { return null; } }
function isLoggedIn() { return !!getToken(); }
function isAdmin()    { try { return getUser()?.is_admin || false; } catch { return false; } }

function saveAuth(token, user) {
  localStorage.setItem("otp_token", token);
  localStorage.setItem("otp_user", JSON.stringify(user));
  try { sessionStorage.setItem("just_logged_in", "1"); } catch(e) {}
}

// applyTheme and getThemePreference are defined above (unified implementation)

let _settingsCache = null;
let _settingsCacheTime = 0;

async function getSiteSettings(force = false) {
  const now = Date.now();
  if (!force && _settingsCache && (now - _settingsCacheTime < 60000)) return _settingsCache;
  
  return API.get("/api/auth/settings").then(s => {
    _settingsCache = s;
    _settingsCacheTime = Date.now();
    if (s.exchange_rates) {
      try {
        window.exchangeRates = typeof s.exchange_rates === 'string' ? JSON.parse(s.exchange_rates) : s.exchange_rates;
      } catch (e) { console.error("Failed to parse exchange rates", e); }
    }
    return s;
  }).catch(() => ({}));
  return _settingsPromise;
}

window.exchangeRates = { "INR": 1, "USD": 0.012, "RUB": 1, "EUR": 0.011 }; // Fallback defaults

// Start proactive fetch
getSiteSettings();

const SERVICE_GRADIENTS = [
  'linear-gradient(135deg, #3b82f6, #2563eb)',
  'linear-gradient(135deg, #10b981, #059669)',
  'linear-gradient(135deg, #f59e0b, #d97706)',
  'linear-gradient(135deg, #ef4444, #dc2626)',
  'linear-gradient(135deg, #8b5cf6, #7c3aed)',
  'linear-gradient(135deg, #ec4899, #db2777)',
  'linear-gradient(135deg, #06b6d4, #0891b2)',
  'linear-gradient(135deg, #f97316, #ea580c)',
];

window.getServiceIcon = function(service, size = '100%') {
  if (!service) return '';
  const name = service.name || service.service_name || 'Service';
  
  if (service.image_url) {
    // Add timestamp for cache-busting to ensure latest logo shows immediately
    const buster = `?t=${Date.now()}`;
    return `<img src="${service.image_url}${buster}" 
                 alt="${name}" 
                 style="width:${size};height:${size};object-fit:cover;" 
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
            <div style="display:none; width:${size}; height:${size}; border-radius:inherit; background:${service.icon_color || '#3b82f6'}; align-items:center; justify-content:center; color:#fff; font-weight:800; font-size:calc(${size} * 0.4)">
               ${name.charAt(0).toUpperCase()}
            </div>`;
  }
  
  const color = service.icon_color || SERVICE_GRADIENTS[Math.abs(name.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % SERVICE_GRADIENTS.length];
  const fontSize = size === '100%' ? '18px' : '14px';
  
  return `<div style="width:${size};height:${size};display:flex;align-items:center;justify-content:center;background:${color};color:#fff;font-weight:800;font-size:${fontSize};text-shadow:0 2px 4px rgba(0,0,0,0.1);border-radius:inherit">${name.charAt(0).toUpperCase()}</div>`;
}

window.renderSkeleton = function(type, count = 1) {
  const layouts = {
    'card': `<div class="skeleton skeleton-card" style="margin-bottom:12px"></div>`,
    'text': `<div class="skeleton skeleton-text"></div>`,
    'title': `<div class="skeleton skeleton-title"></div>`,
    'list': `<div style="display:flex;flex-direction:column;gap:12px">
        <div class="skeleton" style="height:60px;width:100%;border-radius:12px"></div>
        <div class="skeleton" style="height:60px;width:100%;border-radius:12px"></div>
        <div class="skeleton" style="height:60px;width:100%;border-radius:12px"></div>
      </div>`,
    'grid': `<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(200px,1fr));gap:16px">
        ${Array(6).fill('<div class="skeleton skeleton-card"></div>').join('')}
      </div>`
  };
  return Array(count).fill(layouts[type] || layouts['text']).join('');
}

async function applySiteSettings(forceRefresh = false) {
  try {
    const settings = await getSiteSettings(forceRefresh);
    if (!settings) return;

    // 0. Maintenance Mode Check
    const path = window.location.pathname;
    const isMaint = (settings.maintenance_mode === "true" || settings.maintenance_mode === true);
    const isMaintPage = path === "/maintenance" || path === "/maintenance.html";
    const isAdminArea = path.startsWith("/admin");

    if (isMaint && !isAdminArea && !isMaintPage) {
      window.location.href = "/maintenance";
      return;
    }
    // Auto-exit maintenance page if mode is OFF
    if (!isMaint && isMaintPage) {
      window.location.href = "/";
      return;
    }

    if (settings.disable_immersive_animation !== undefined) {
      localStorage.setItem('disable_immersive_animations', settings.disable_immersive_animation.toString());
    }

    // Branding Version Check — force global theme if admin just changed it
    const bv = settings.branding_version || '1';
    const localBv = localStorage.getItem('otp_branding_version');
    if (bv !== localBv) {
      localStorage.removeItem('otp_theme_user_choice');
      localStorage.setItem('otp_branding_version', bv);
    }

    // 1. Apply Theme — admin default_theme is baseline; user explicit choice overrides it
    const adminDefaultTheme = settings.default_theme;
    const userExplicitChoice = localStorage.getItem('otp_theme_user_choice');
    if (adminDefaultTheme) {
      const effectiveTheme = userExplicitChoice || adminDefaultTheme;
      applyTheme(effectiveTheme);
      localStorage.setItem(THEME_STORAGE_KEY, effectiveTheme);
    } else {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      applyTheme(saved || 'dark');
    }
    
    // 2. Apply Brand Color Overrides — only for dark/light base themes
    const root = document.documentElement;
    // Read the actual applied theme attribute (after applyTheme may have just changed it)
    const activeTheme = root.getAttribute('data-theme') || 'dark';
    const isBasicTheme = activeTheme === 'dark' || activeTheme === 'light';

    if (settings.primary_color && isBasicTheme) {
      root.style.setProperty('--accent', settings.primary_color);
      const rgb = hexToRgb(settings.primary_color);
      if (rgb) root.style.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
      root.style.setProperty('--grad-primary', `linear-gradient(135deg, ${settings.primary_color}, ${adjustColor(settings.primary_color, -20)})`);
    } else {
      // Colored theme — ensure no inline overrides from previous dark-mode brand color bleed through
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-rgb');
      root.style.removeProperty('--grad-primary');
    }

    // 3. Identity
    if (settings.site_name) {
      document.title = settings.site_name;
      document.querySelectorAll('.nav-logo').forEach(el => {
        el.childNodes.forEach(node => { if(node.nodeType === 3) node.textContent = settings.site_name + ' '; });
        
        // Ensure logo redirects to /dashboard/buy for logged-in users
        if (isLoggedIn()) {
          if (el.tagName === 'A') {
            el.href = '/dashboard/buy';
          } else {
            el.style.cursor = 'pointer';
            el.onclick = () => window.location.href = '/dashboard/buy';
          }
        }
      });
    }

    if (settings.site_logo) {
      document.querySelectorAll('.nav-logo').forEach(el => {
        let img = el.querySelector('img');
        if (!img) { img = document.createElement('img'); img.style.height = '24px'; img.style.marginRight = '8px'; el.prepend(img); }
        img.src = settings.site_logo;
      });
    }

    if (settings.site_favicon) {
      let link = document.querySelector("link[rel~='icon']");
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = settings.site_favicon;
    }

    // 4. SEO & External Code
    if (settings.seo_title && (location.pathname === "/" || location.pathname === "/index.html")) document.title = settings.seo_title;
    if (settings.seo_description) {
      let meta = document.querySelector('meta[name="description"]');
      if (!meta) { meta = document.createElement('meta'); meta.name = "description"; document.head.appendChild(meta); }
      meta.content = settings.seo_description;
    }

    if (settings.custom_css) {
      let style = document.getElementById("custom-site-css");
      if (!style) { style = document.createElement('style'); style.id = "custom-site-css"; document.head.appendChild(style); }
      style.textContent = settings.custom_css;
    }

    // Dynamic Scripts
    if (!window._scriptsInjected) {
      const inject = (html, target) => {
        if (!html) return;
        const frag = document.createRange().createContextualFragment(html);
        target.appendChild(frag);
      };
      inject(settings.head_scripts, document.head);
      inject(settings.foot_scripts, document.body);
      window._scriptsInjected = true;
    }

  } catch (e) { console.error("Identity retrieval failed", e); }
}

// Capture Referral Code immediately
(function() {
  const urlParams = new URLSearchParams(window.location.search);
  const ref = urlParams.get('ref');
  if (ref) {
    localStorage.setItem('pending_ref', ref);
    console.log("[Referral] Captured pending ref:", ref);
  }
})();

document.addEventListener("DOMContentLoaded", () => {
  // A. Apply cached theme for zero flicker
  applyTheme(getThemePreference());
  
  // B. Sync with authoritative truth
  applySiteSettings();

  // D. Lightweight init
  if (isLoggedIn()) {
    updateBalanceDisplay();
    injectAdminLinks();

    // Ensure logo redirects to /dashboard/buy for logged-in users immediately
    document.querySelectorAll('.nav-logo').forEach(el => {
      if (el.tagName === 'A') {
        el.href = '/dashboard/buy';
      } else {
        el.style.cursor = 'pointer';
        el.onclick = () => window.location.href = '/dashboard/buy';
      }
    });
  }
});

window.injectAdminLinks = function() {
  if (!isAdmin()) return;
  const sidebar = document.querySelector('.sidebar');
  if (sidebar && !sidebar.querySelector('a[href="/admin"]')) {
     const div = document.createElement('div'); div.className = 'sidebar-divider';
     const a = document.createElement('a'); a.href = "/admin"; a.className = "sidebar-item";
     a.style.color = "var(--warning)"; a.style.fontWeight = "800"; a.innerHTML = "🛡️ Admin Panel";
     const logout = [...sidebar.childNodes].find(n => n.textContent && n.textContent.includes('Logout'));
     if (logout) { sidebar.insertBefore(div, logout); sidebar.insertBefore(a, logout); }
     else { sidebar.appendChild(div); sidebar.appendChild(a); }
  }
  const nav = document.getElementById('nav-links');
  if (nav && !nav.querySelector('a[href="/admin"]')) {
     const a = document.createElement('a'); a.href = "/admin"; a.style.color = "var(--warning)";
     a.style.fontWeight = "700"; a.textContent = "Admin";
     const btn = [...nav.querySelectorAll('button, a')].find(b => b.textContent.includes('Logout'));
     if (btn) nav.insertBefore(a, btn); else nav.appendChild(a);
  }
};

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
}

function adjustColor(hex, amt) {
  let usePound = false;
  if (hex[0] == "#") { hex = hex.slice(1); usePound = true; }
  let num = parseInt(hex, 16);
  let r = (num >> 16) + amt;
  if (r > 255) r = 255; else if (r < 0) r = 0;
  let b = ((num >> 8) & 0x00FF) + amt;
  if (b > 255) b = 255; else if (b < 0) b = 0;
  let g = (num & 0x0000FF) + amt;
  if (g > 255) g = 255; else if (g < 0) g = 0;
  return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16).padStart(6, '0');
}

window.logout = async function() {
  try { await API.post("/api/auth/logout"); } catch(e) {}
  localStorage.removeItem("otp_token");
  localStorage.removeItem("otp_user");
  // Ensure we go to the actual home page root
  window.location.href = "/index.html";
};

/**
 * Robust copy to clipboard helper that works in non-secure contexts (HTTP/IP)
 * @param {string} text - Text to copy
 * @param {HTMLElement} btn - Optional button element to show feedback on
 * @param {string} successMsg - Optional toast message
 */
window.copyToClipboard = function(text, btn = null, successMsg = "Copied to clipboard!") {
  if (!text) return;

  function showFeedback() {
    if (btn) {
      const oldText = btn.textContent;
      const hasIcon = btn.querySelector('i, svg, .icon');
      
      if (btn.tagName === 'BUTTON' || btn.tagName === 'A') {
        btn.classList.add('copy-success');
        const originalContent = btn.innerHTML;
        
        // If it's a simple text button, change text
        if (!hasIcon && btn.innerText.length < 20) {
          btn.innerText = "Copied!";
        }
        
        setTimeout(() => {
          btn.classList.remove('copy-success');
          if (!hasIcon && btn.innerText === "Copied!") {
            btn.innerText = oldText;
          }
        }, 2000);
      }
    }
    if (window.toast) window.toast(successMsg, "success");
  }

  // 1. Try Navigator API (Modern, requires Secure Context)
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text)
      .then(showFeedback)
      .catch(err => {
        console.error("Clipboard API failed, falling back", err);
        fallbackCopy();
      });
  } else {
    fallbackCopy();
  }

  // 2. Fallback using invisible textarea (Legacy, works on HTTP)
  function fallbackCopy() {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      const successful = document.execCommand('copy');
      if (successful) showFeedback();
      else throw new Error("execCommand failed");
    } catch (err) {
      console.error('Fallback copy failed', err);
      // Last resort: just try to show the toast anyway if we think it might have worked
      // or if we want to lie to the user to keep them happy (not recommended but sometimes better than nothing)
      // Actually, let's just toast the error.
      if (window.toast) window.toast("Failed to copy. Please copy manually.", "error");
    }
    document.body.removeChild(textArea);
  }
};

window.setCache = function(key, data, ttlSeconds) {
  const item = {
    data: data,
    expiry: Date.now() + (ttlSeconds * 1000)
  };
  localStorage.setItem(key, JSON.stringify(item));
};

window.getCache = function(key) {
  const itemStr = localStorage.getItem(key);
  if (!itemStr) return null;
  try {
    const item = JSON.parse(itemStr);
    if (Date.now() > item.expiry) {
      localStorage.removeItem(key);
      return null;
    }
    return item.data;
  } catch(e) {
    return null;
  }
};


window.requireLogin = function() {
  if (!isLoggedIn()) { window.location.href = "/index.html?login=1"; return false; }
  return true;
};


// Async version — checks server, not just localStorage
window.requireAdmin = async function() {
  if (!isLoggedIn()) { window.location.href = "/index.html"; return false; }
  try {
    const data = await API.get("/api/auth/me");
    // Refresh localStorage with latest user data
    saveAuth(getToken(), data.user);
    if (!data.user.is_admin) { window.location.href = "/dashboard"; return false; }
    
    // Auto-reveal admin content if protected
    const adminEl = document.querySelector('[data-admin-route]');
    if (adminEl) {
      adminEl.classList.add("admin-ready");
      adminEl.style.visibility = "visible";
      adminEl.style.opacity = "1";
    }
    
    return true;
  } catch {
    window.location.href = "/index.html";
    return false;
  }
};

// ── Toast ─────────────────────────────────────────────────────────
function createToastContainer() {
  if (!document.getElementById("toast-styles")) {
    const s = document.createElement("style");
    s.id = "toast-styles";
    s.innerHTML = `
      #toast-container {
        position: fixed;
        top: 24px;
        right: 24px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        z-index: 2147483647;
        pointer-events: none;
        max-width: 400px;
        width: calc(100vw - 32px);
      }
      .toast {
        position: relative;
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 16px 20px;
        background: var(--surface-container-lowest, #ffffff);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid var(--outline-variant, #c3c5d7);
        border-radius: 16px;
        color: var(--on-surface, #0b1c30);
        font-family: 'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif;
        font-size: 14.5px;
        font-weight: 600;
        line-height: 1.45;
        box-shadow: 0 16px 40px rgba(11, 28, 48, 0.16), 0 4px 12px rgba(11, 28, 48, 0.08);
        pointer-events: all;
        overflow: hidden;
        transition: all 0.35s cubic-bezier(0.23, 1, 0.32, 1);
        animation: toastBounceIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
        cursor: pointer;
      }
      .toast.removing {
        animation: toastFadeOut 0.35s forwards cubic-bezier(0.4, 0, 1, 1);
      }
      @keyframes toastBounceIn {
        0% { opacity: 0; transform: translateY(-24px) scale(0.9); }
        70% { transform: translateY(4px) scale(1.02); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes toastFadeOut {
        0% { opacity: 1; transform: translateY(0) scale(1); }
        100% { opacity: 0; transform: translateY(-16px) scale(0.92); }
      }
      .toast-icon {
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        border-radius: 50%;
        font-size: 15px;
        font-weight: 800;
      }
      .toast-success .toast-icon {
        background: rgba(0, 105, 71, 0.12);
        color: var(--tertiary, #006947);
        border: 1px solid rgba(0, 105, 71, 0.25);
      }
      .toast-error .toast-icon {
        background: rgba(186, 26, 26, 0.12);
        color: var(--error, #ba1a1a);
        border: 1px solid rgba(186, 26, 26, 0.25);
      }
      .toast-info .toast-icon {
        background: rgba(16, 80, 212, 0.12);
        color: var(--primary, #1050d4);
        border: 1px solid rgba(16, 80, 212, 0.25);
      }
      .toast-content {
        flex: 1;
        word-break: break-word;
      }
      .toast-progress {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 3px;
        background: var(--primary, #1050d4);
        width: 100%;
        transform-origin: left;
      }
      .toast-success .toast-progress { background: var(--tertiary, #006947); }
      .toast-error .toast-progress { background: var(--error, #ba1a1a); }
      .toast-info .toast-progress { background: var(--primary, #1050d4); }
      .toast:hover { transform: translateY(-2px); box-shadow: 0 20px 48px rgba(11, 28, 48, 0.22); }
    `;
    document.head.appendChild(s);
  }
  if (!document.getElementById("toast-container")) {
    const c = document.createElement("div");
    c.id = "toast-container";
    document.body.appendChild(c);
  }
}

window.toast = function(msg, type = "success", duration = 3500) {
  createToastContainer();
  const container = document.getElementById("toast-container");
  
  // Enforce max capacity of 3
  const activeToasts = container.querySelectorAll('.toast:not(.removing)');
  if (activeToasts.length >= 3) {
    for (let i = 0; i <= activeToasts.length - 3; i++) {
      const oldest = activeToasts[i];
      oldest.classList.add('removing');
      setTimeout(() => { if (oldest.parentElement) oldest.remove(); }, 350);
    }
  }

  const t = document.createElement("div");
  t.className = `toast toast-${type}`;
  
  const icon = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";
  
  t.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">${msg}</div>
    <div class="toast-progress"></div>
  `;
  
  container.appendChild(t);

  // Progress bar animation
  const progress = t.querySelector('.toast-progress');
  if (progress) {
    progress.style.transition = `transform ${duration}ms linear`;
    requestAnimationFrame(() => {
      progress.style.transform = 'scaleX(0)';
    });
  }

  const remove = () => {
    if (t.parentElement) {
      t.classList.add('removing');
      setTimeout(() => { if (t.parentElement) t.remove(); }, 350);
    }
  };

  t.onclick = remove;
  setTimeout(remove, duration);
};

// ── Formatting ────────────────────────────────────────────────────
window.fmtMoney = function(n) {
  const user = getUser();
  const currency = user?.currency || localStorage.getItem("guest_currency") || "INR";
  const rates = window.exchangeRates || { "INR": 1 };
  const rate = rates[currency] || 1;
  const symbols = { "INR": "₹", "USD": "$", "RUB": "₽", "EUR": "€", "USDT": "₮" };
  const symbol = symbols[currency] || (currency + " ");
  
  const converted = Number(n || 0) * rate;
  
  // Format based on currency type
  let locale = "en-IN";
  if (currency === "USD" || currency === "EUR") locale = "en-US";
  if (currency === "RUB") locale = "ru-RU";
  
  // Format the number and return
  // Prevent returning 'NaN' if properties are not fully initialized
  return symbol + (!isNaN(converted) ? converted.toLocaleString(locale, { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  }) : "0.00");
};

window.changeCurrency = async function(newCurrency) {
  try {
    if (isLoggedIn()) {
      const res = await API.patch('/api/user/currency', { currency: newCurrency });
      if (res.success) {
        const user = getUser();
        if (user) {
          user.currency = newCurrency;
          localStorage.setItem("otp_user", JSON.stringify(user));
        }
      }
    } else {
      localStorage.setItem("guest_currency", newCurrency);
    }
    
    // Update active dropdowns if any
    document.querySelectorAll('.nav-currency-select').forEach(el => el.value = newCurrency);
    
    if (typeof window.updateBalanceDisplay === 'function') window.updateBalanceDisplay();
    toast(`Currency changed to ${newCurrency}`, "success");
    setTimeout(() => window.location.reload(), 800);
  } catch (e) {
    toast(e.message, "error");
  }
};
window.fmtDate = function(d)        { return new Date(d).toLocaleString(); };
window.fmtDateShort = function(d)   { return new Date(d).toLocaleDateString(); };

window.statusBadge = function(s) {
  const map = { active: "badge-active", completed: "badge-completed", refunded: "badge-refunded", expired: "badge-expired", cancelled: "badge-expired" };
  const labelMap = { 
    active: "⚡ Active", 
    completed: "✅ Completed", 
    refunded: "💰 Refunded", 
    expired: "⌛ Cancelled", 
    cancelled: "⌛ Cancelled" 
  };
  const label = labelMap[s] || s;
  return `<span class="badge ${map[s] || ''}">${label}</span>`;
};
window.txBadge = function(type) {
  const map = { deposit: "badge-deposit", purchase: "badge-purchase", refund: "badge-active", bonus: "badge-deposit", deduction: "badge-purchase" };
  return `<span class="badge ${map[type] || ''}">${type}</span>`;
};
window.txSign = function(type, amount) {
  const pos = ["deposit", "refund", "bonus"].includes(type);
  return `<span class="${pos ? 'text-success' : 'text-danger'}">${pos ? '+' : ''}${fmtMoney(amount)}</span>`;
};

// ── Skeleton UI Helpers ─────────────────────────────────────────────
window.skeletonTable = (cols, rows = 5) => {
  let h = '';
  for(let i=0; i<rows; i++) {
    let cells = '';
    for(let j=0; j<cols; j++) {
      cells += '<td><div class="skeleton" style="height:20px;width:100%;border-radius:4px"></div></td>';
    }
    h += `<tr>${cells}</tr>`;
  }
  return h;
};

window.skeletonCards = (count = 6) => {
  let h = '';
  for(let i=0; i<count; i++) {
    h += `<div class="skeleton" style="height:120px;width:100%;border-radius:16px;margin-bottom:12px"></div>`;
  }
  return h;
};

window.skeletonList = (count = 5) => {
  let h = '';
  for(let i=0; i<count; i++) {
    h += `<div class="skeleton" style="height:48px;width:100%;border-radius:12px;margin-bottom:8px"></div>`;
  }
  return h;
};

window.renderSkeleton = function(type = 'list', rows = 5) {
  let html = '';
  if (type === 'list') {
    for (let i = 0; i < rows; i++) {
      html += `
        <div class="skeleton-row" style="display:flex; gap:16px; align-items:center; padding: 12px 0; border-bottom: 1px solid var(--border)">
          <div class="skeleton" style="width:40px; height:40px; border-radius:50%; flex-shrink:0"></div>
          <div style="flex:1; display:flex; flex-direction:column; gap:8px">
            <div class="skeleton" style="width:140px; height:12px; border-radius:4px"></div>
            <div class="skeleton" style="width:80px; height:8px; border-radius:4px"></div>
          </div>
          <div class="skeleton" style="width:100px; height:12px; border-radius:4px"></div>
          <div class="skeleton" style="width:60px; height:24px; border-radius:12px"></div>
        </div>`;
    }
  } else if (type === 'card') {
    html = `<div class="skeleton" style="width:100%; height:180px; border-radius:20px"></div>`;
  }
  return html;
};

window.skeletonStats = () => {
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px">
    <div class="skeleton" style="height:120px;border-radius:20px"></div>
    <div class="skeleton" style="height:120px;border-radius:20px"></div>
    <div class="skeleton" style="height:120px;border-radius:20px"></div>
    <div class="skeleton" style="height:120px;border-radius:20px"></div>
  </div>`;
};

window.showSkeleton = (elementId, skeletonHtml) => {
  const el = document.getElementById(elementId);
  if (el) el.innerHTML = skeletonHtml;
};

window.hideSkeleton = (elementId, realContent) => {
  const el = document.getElementById(elementId);
  if (el) el.innerHTML = realContent;
};


window.userAvatar = function(user, size = 36) {
  const avatars = [
    "/images/avatars/avatar_1.png", "/images/avatars/avatar_2.png", "/images/avatars/avatar_3.png",
    "/images/avatars/avatar_4.png", "/images/avatars/avatar_5.png", "/images/avatars/avatar_6.png",
    "/images/avatars/avatar_7.png", "/images/avatars/avatar_8.png", "/images/avatars/avatar_9.png",
    "/images/avatars/avatar_10.png", "/images/avatars/avatar_11.png", "/images/avatars/avatar_12.png",
    "/images/avatars/avatar_13.png", "/images/avatars/avatar_14.png", "/images/avatars/avatar_15.png",
    "/images/avatars/avatar_16.png", "/images/avatars/avatar_17.png", "/images/avatars/avatar_18.png",
    "/images/avatars/avatar_19.png", "/images/avatars/avatar_20.png"
  ];

  let avatarUrl = user?.avatar_url;
  
  if (!avatarUrl && user) {
    const idStr = String(user._id || user.id || "");
    if (idStr) {
      let hash = 0;
      for (let i = 0; i < idStr.length; i++) {
        hash = idStr.charCodeAt(i) + ((hash << 5) - hash);
      }
      const index = Math.abs(hash) % avatars.length;
      avatarUrl = avatars[index];
    }
  }

  if (avatarUrl) {
    return `<div class="avatar-3d-wrap skeleton" style="width:${size}px; height:${size}px; border-radius:50%; overflow:hidden; background:var(--bg-2, #1e293b); border:2px solid var(--border-2, rgba(255,255,255,0.1)); flex-shrink:0; display:flex; align-items:center; justify-content:center; position:relative;">
              <img src="${avatarUrl}" style="width:100%; height:100%; object-fit:cover; opacity:0; transition:opacity 0.3s;" 
                   onload="this.style.opacity='1'; this.parentElement.classList.remove('skeleton')" 
                   onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'; this.parentElement.classList.remove('skeleton')">
              <div style="display:none; width:100%; height:100%; align-items:center; justify-content:center; background:${user?.avatar_color || '#3b82f6'}; color:#fff; font-weight:700; font-size:${Math.round(size*0.4)}px;">
                ${(user?.display_name || user?.username || "?")[0].toUpperCase()}
              </div>
            </div>`;
  }

  const initial = (user?.display_name || user?.username || "?")[0].toUpperCase();
  const color   = user?.avatar_color || "#3b82f6";
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${Math.round(size*0.4)}px;color:#fff;flex-shrink:0">${initial}</div>`;
};




// ── Modal helpers ─────────────────────────────────────────────────
window.openModal = function(id)  { 
  const el = document.getElementById(id);
  if (el) {
    el.style.display = "flex";
    el.classList.remove("closing");
    el.classList.add("open");
  }
};

window.closeModal = function(id) { 
  const el = document.getElementById(id);
  if (el) {
    el.classList.add("closing");
    setTimeout(() => {
      el.style.display = "none";
      el.classList.remove("open");
      el.classList.remove("closing");
    }, 450);
  }
};

window.uiAlert = function(message) {
  return new Promise(resolve => {
    let m = document.createElement("div");
    m.className = "glass-modal-overlay";
    m.style.zIndex = "99999";
    m.innerHTML = `
      <div class="glass-modal-box">
        <h3 style="margin-bottom:16px;text-align:center;font-size:20px;color:var(--text)">Notice</h3>
        <p style="color:var(--text-2);text-align:center;margin-bottom:24px;font-size:15px;line-height:1.5">${message}</p>
        <button class="btn btn-primary w-full" id="gl-ok-btn">OK</button>
      </div>`;
    document.body.appendChild(m);
    document.getElementById("gl-ok-btn").onclick = () => {
      m.classList.add("closing");
      setTimeout(() => { m.remove(); resolve(); }, 450);
    };
  });
};

window.uiConfirm = function(message) {
  return new Promise(resolve => {
    let m = document.createElement("div");
    m.className = "glass-modal-overlay";
    m.style.zIndex = "99999";
    m.innerHTML = `
      <div class="glass-modal-box" style="background:#ffffff; border:1px solid #e2e8f0; border-radius:16px;">
        <h3 style="margin-bottom:16px;text-align:center;font-size:20px;color:#1e293b;font-weight:700;">Action Required</h3>
        <p style="color:#475569;text-align:center;margin-bottom:24px;font-size:15px;line-height:1.5">${message}</p>
        <div style="display:flex;gap:12px">
          <button class="btn btn-secondary w-full" id="gl-no-btn" style="background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;">Cancel</button>
          <button class="btn btn-primary w-full" id="gl-yes-btn" style="background:#3b82f6;color:#ffffff;border:none;box-shadow:0 4px 12px rgba(59,130,246,0.3)">Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    document.getElementById("gl-yes-btn").onclick = () => {
      m.classList.add("closing");
      setTimeout(() => { m.remove(); resolve(true); }, 450);
    };
    document.getElementById("gl-no-btn").onclick = () => {
      m.classList.add("closing");
      setTimeout(() => { m.remove(); resolve(false); }, 450);
    };
  });
};

document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-backdrop")) e.target.classList.remove("open");
});

// ── Pagination ────────────────────────────────────────────────────
window.renderPagination = function(containerId, currentPage, totalPages, onPageChange) {
  const c = document.getElementById(containerId);
  if (!c || totalPages <= 1) { if (c) c.innerHTML = ""; return; }
  let fnName = "";
  if (typeof onPageChange === 'string') {
    fnName = onPageChange;
  } else if (typeof onPageChange === 'function') {
    fnName = onPageChange.name;
    if (!fnName) {
      for (let k in window) { if (window[k] === onPageChange) { fnName = k; break; } }
    }
  }
  if (!fnName) {
    console.error("renderPagination requires a globally accessible function name.", onPageChange);
    return;
  }
  let html = '<div class="pagination">';
  html += `<button class="page-btn" onclick="${fnName}(${currentPage - 1})" ${currentPage === 1 ? "disabled" : ""}>‹</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 1) {
      html += `<button class="page-btn ${i === currentPage ? "active" : ""}" onclick="${fnName}(${i})">${i}</button>`;
    } else if (Math.abs(i - currentPage) === 2) {
      html += `<span style="color:var(--text-3);padding:0 4px">…</span>`;
    }
  }
  html += `<button class="page-btn" onclick="${fnName}(${currentPage + 1})" ${currentPage === totalPages ? "disabled" : ""}>›</button></div>`;
  c.innerHTML = html;
}

// ── Countdown ─────────────────────────────────────────────────────
function countdown(targetDate, el) {
  const tick = () => {
    const diff = new Date(targetDate) - Date.now();
    if (diff <= 0) { if (el) el.textContent = "00:00"; return; }
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (el) el.textContent = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  };
  tick();
  return setInterval(tick, 1000);
}

// ── Login/Register form handler ───────────────────────────────────
async function doLogin(email, password) {
  const data = await API.post("/api/auth/login", { email, password });
  saveAuth(data.token, data.user);
  return data;
}

async function doRegister(username, email, password, referral_code = null) {
  const data = await API.post("/api/auth/register", { username, email, password, referral_code });
  saveAuth(data.token, data.user);
  return data;
}

// ── Nav burger ────────────────────────────────────────────────────
function initNavBurger() {
  const burger = document.getElementById("nav-burger");
  const navLinks = document.getElementById("nav-links");
  if (!burger || !navLinks) return;

  // Prevent multiple attachments
  if (burger.dataset.init === "1") return;
  burger.dataset.init = "1";

  const toggle = (force) => {
    const isOpen = typeof force === 'boolean' ? force : !navLinks.classList.contains("mobile-open");
    navLinks.classList.toggle("mobile-open", isOpen);
    burger.classList.toggle("is-open", isOpen);
    burger.innerHTML = isOpen ? "✕" : "☰";
    burger.setAttribute("aria-expanded", isOpen ? "true" : "false");
  };

  burger.onclick = (e) => {
    e.stopPropagation();
    toggle();
  };

  document.addEventListener("click", (e) => {
    if (navLinks.classList.contains("mobile-open") && !navLinks.contains(e.target) && !burger.contains(e.target)) {
      toggle(false);
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 768 && navLinks.classList.contains("mobile-open")) toggle(false);
  });

  navLinks.querySelectorAll("a").forEach(a => {
    a.addEventListener("click", () => toggle(false));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initNavBurger();
  applyTheme(getThemePreference());
});

// ── Currency Navbar Injection ─────────────────────────────────────
function injectCurrencySelector() {
  const user = getUser();
  const current = user?.currency || localStorage.getItem("guest_currency") || "INR";
  
  const optionsHtml = `
    <option value="INR" ${current === 'INR' ? 'selected' : ''}>INR (₹)</option>
    <option value="USD" ${current === 'USD' ? 'selected' : ''}>USD ($)</option>
    <option value="RUB" ${current === 'RUB' ? 'selected' : ''}>RUB (₽)</option>
    <option value="EUR" ${current === 'EUR' ? 'selected' : ''}>EUR (€)</option>
    <option value="USDT" ${current === 'USDT' ? 'selected' : ''}>USDT (₮)</option>
  `;

  // 1. Inject into Navbar
  const container = document.querySelector('.navbar .container');
  if (container && !document.getElementById('global-currency-selector')) {
    const wrapper = document.createElement('div');
    wrapper.id = 'global-currency-selector';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.marginLeft = 'auto'; 
    wrapper.style.marginRight = '12px';
    
    wrapper.innerHTML = `
      <select class="nav-currency-select" onchange="changeCurrency(this.value)" style="background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:4px 8px;font-size:13px;cursor:pointer;outline:none;font-weight:600;">
        ${optionsHtml}
      </select>
    `;
    
    const rightGrp = container.querySelector('div[style*="margin-left:auto"], div[style*="margin-left: auto"]');
    if (rightGrp) {
      rightGrp.insertBefore(wrapper, rightGrp.firstChild);
      wrapper.style.marginLeft = '0';
    } else {
      const burger = document.getElementById('nav-burger');
      if (burger) container.insertBefore(wrapper, burger);
      else container.appendChild(wrapper);
    }
  }

  // 2. Inject into Dashboard/Content Section if target exists
  const homeTarget = document.getElementById('home-currency-selector');
  if (homeTarget && !homeTarget.querySelector('.nav-currency-select')) {
    homeTarget.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;background:var(--surface-2);border:1px solid var(--border);border-radius:14px;padding:6px 14px;box-shadow:var(--shadow)">
        <span style="font-size:16px">💱</span>
        <select class="nav-currency-select" onchange="changeCurrency(this.value)" style="background:transparent;border:none;color:var(--text);font-size:14px;cursor:pointer;outline:none;font-weight:700;">
          ${optionsHtml}
        </select>
      </div>
    `;
  }
}

document.addEventListener("DOMContentLoaded", injectCurrencySelector);

// ── SPA Engine (Disabled) ─────────────────────────────────────────
window.renderMobileBottomNav = function(path = window.location.pathname) {
  // Disabled
  return;
};

const SPA = {
  active: false,
  init() {},
  navigate(url) {
    if (typeof window.showPageLoader === "function") window.showPageLoader();
    window.location.href = url;
  },
  updateNavStates(url) {
    const path = url.split('?')[0];
    document.querySelectorAll(".nav-links a").forEach(a => {
      const href = a.getAttribute("href");
      if (href) a.classList.toggle("active", path === href);
    });
    document.querySelectorAll(".sidebar-item").forEach(a => {
      const href = a.getAttribute("href");
      if (!href) return;
      const isActive = (path === href) || (href !== "/dashboard" && href !== "/admin" && path.startsWith(href));
      a.classList.toggle("active", isActive);
    });
  },
  refreshMobileNav(path) {}
};

window.SPA = SPA;
document.addEventListener("DOMContentLoaded", () => SPA.init());

// ── Welcome & Support Popup (First Login) ────────────────────────
window.showSupportWelcomeModal = function() {
  const existing = document.getElementById("support-welcome-backdrop");
  if (existing) existing.remove();

  const m = document.createElement("div");
  m.id = "support-welcome-backdrop";
  m.className = "modal-backdrop";
  m.style.cssText = "position: fixed; inset: 0; z-index: 2147483647; background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; padding: 16px; opacity: 0; pointer-events: none; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);";
  
  m.innerHTML = `
    <div data-theme="light" class="modal" style="text-align: center; max-width: 480px; width: 100%; background: var(--surface-container-lowest, #ffffff); border: 1px solid var(--outline-variant, #c3c5d7); border-radius: var(--r-2xl, 24px); box-shadow: 0 25px 70px rgba(11,28,48,0.25), 0 0 50px rgba(16,185,129,0.12); padding: 32px 28px; position: relative; transform: translateY(20px) scale(0.94); transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s; max-height: 90vh; overflow-y: auto; color: var(--on-surface, #0b1c30);">
      <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #10b981, #00c1fd, #1050d4); border-radius: 24px 24px 0 0;"></div>
      <button id="sw-close" class="gnav-icon-btn" style="position: absolute; top: 16px; right: 16px; width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--outline-variant, #c3c5d7); background: var(--surface, #f8f9ff); color: var(--on-surface-variant, #434654); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s;" title="Close">✕</button>
      
      <div style="width: 72px; height: 72px; border-radius: 22px; background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(0, 193, 253, 0.15)); border: 1px solid rgba(16, 185, 129, 0.3); display: flex; align-items: center; justify-content: center; font-size: 36px; margin: 0 auto 20px; box-shadow: 0 10px 30px rgba(16, 185, 129, 0.15);">🤝</div>
      
      <h3 style="font-size: 24px; font-weight: 900; margin-bottom: 10px; color: var(--on-surface, #0b1c30);">Welcome to <span class="site-name-text">${window.siteSettings?.site_name || document.getElementById('gnav-left')?.textContent?.trim() || 'Our Service'}</span>!</h3>
      <p style="font-size: 15px; color: var(--on-surface-variant, #434654); line-height: 1.6; margin-bottom: 24px; text-align: center;">We're thrilled to have you! To ensure you have the smoothest experience buying numbers and managing instant deposits, our dedicated support team is available 24/7.</p>
      
      <div style="background: var(--surface, #f8f9ff); border: 1px solid var(--outline-variant, #e5eeff); border-radius: 16px; padding: 18px; text-align: left; margin-bottom: 26px; display: flex; flex-direction: column; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 38px; height: 38px; border-radius: 10px; background: rgba(16, 80, 212, 0.1); color: #1050d4; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;">💬</div>
          <div>
            <div style="font-weight: 800; font-size: 14px; color: var(--on-surface);">Live Support Channels</div>
            <div style="font-size: 12px; color: var(--on-surface-variant);">Instant assistance for UPI deposits and orders</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 38px; height: 38px; border-radius: 10px; background: rgba(16, 185, 129, 0.1); color: #10b981; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;">⚡</div>
          <div>
            <div style="font-weight: 800; font-size: 14px; color: var(--on-surface);">Instant & Automated Credits</div>
            <div style="font-size: 12px; color: var(--on-surface-variant);">All payments and OTP allocations are 100% automated</div>
          </div>
        </div>
      </div>
      
      <div style="display: flex; gap: 12px; flex-direction: column;">
        <a href="/support" class="btn btn-primary w-full" id="sw-action" style="height: 48px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 15px; background: linear-gradient(135deg, #10b981, #059669); color: #fff; border-radius: 14px; text-decoration: none; box-shadow: 0 6px 20px rgba(16, 185, 129, 0.35);">Check Support Guidelines & FAQs</a>
        <button class="btn btn-secondary w-full" id="sw-dismiss" style="height: 48px; font-weight: 700; font-size: 15px; border-radius: 14px;">Got it, let's get started!</button>
      </div>
    </div>
  `;
  document.body.appendChild(m);

  const dismiss = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    m.style.opacity = "0";
    m.style.pointerEvents = "none";
    const innerModal = m.querySelector(".modal");
    if (innerModal) {
      innerModal.style.transform = "translateY(20px) scale(0.94)";
      innerModal.style.opacity = "0";
    }
    setTimeout(() => { if (m.parentNode) m.remove(); }, 300);
    document.removeEventListener("keydown", escHandler);
  };

  const escHandler = (e) => {
    if (e.key === "Escape") dismiss(e);
  };
  document.addEventListener("keydown", escHandler);

  m.onclick = (e) => {
    if (e.target === m) dismiss(e);
  };
  const closeBtn = document.getElementById("sw-close");
  if (closeBtn) closeBtn.onclick = dismiss;
  const dismissBtn = document.getElementById("sw-dismiss");
  if (dismissBtn) dismissBtn.onclick = dismiss;
  const actionBtn = document.getElementById("sw-action");
  if (actionBtn) actionBtn.onclick = dismiss;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      m.classList.add("open");
      m.style.opacity = "1";
      m.style.pointerEvents = "all";
      const innerModal = m.querySelector(".modal");
      if (innerModal) {
        innerModal.style.transform = "translateY(0) scale(1)";
        innerModal.style.opacity = "1";
      }
    });
  });
};

// ── Broadcast System ───────────────────────────────────────────
window.triggerBroadcastModal = function(bc) {
  if (!bc) return;
  const existing = document.getElementById("broadcast-modal-backdrop");
  if (existing) existing.remove();

  const m = document.createElement("div");
  m.id = "broadcast-modal-backdrop";
  m.className = "modal-backdrop";
  m.style.cssText = "position: fixed; inset: 0; z-index: 2147483647; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 16px; opacity: 0; pointer-events: none; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);";
  
  // Basic markdown strip safely
  const rawText = String(bc.text || "");
  const cleanText = rawText.replace(/\*(.*?)\*/g, "<strong>$1</strong>").replace(/_(.*?)_/g, "<em>$1</em>");
  
  m.innerHTML = `
    <div data-theme="light" class="modal" style="text-align: center; max-width: 440px; width: 100%; background: var(--surface-container-lowest, #ffffff); border: 1px solid var(--outline-variant, #c3c5d7); border-radius: var(--r-xl, 20px); box-shadow: 0 20px 60px rgba(11,28,48,0.15), 0 0 40px rgba(59,130,246,0.08); padding: 28px; position: relative; transform: translateY(16px) scale(0.95); transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s; max-height: 90vh; overflow-y: auto; color: var(--on-surface, #0b1c30);">
      <div class="modal-accent-line" style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, var(--primary, #1050d4), var(--secondary-container, #00c1fd)); border-radius: 20px 20px 0 0;"></div>
      <button id="bc-close" class="gnav-icon-btn" style="position: absolute; top: 16px; right: 16px; width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--outline-variant, #c3c5d7); background: var(--surface, #f8f9ff); color: var(--on-surface-variant, #434654); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s;" title="Close">✕</button>
      <div style="width: 64px; height: 64px; border-radius: 18px; background: rgba(16, 80, 212, 0.08); border: 1px solid rgba(16, 80, 212, 0.2); display: flex; align-items: center; justify-content: center; font-size: 32px; margin: 0 auto 18px; box-shadow: 0 8px 24px rgba(16, 80, 212, 0.1);">📢</div>
      <h3 style="font-size: 22px; font-weight: 800; margin-bottom: 14px; color: var(--on-surface, #0b1c30);">Important Update</h3>
      <div style="font-size: 15px; color: var(--on-surface-variant, #434654); line-height: 1.65; margin-bottom: 26px; white-space: pre-wrap; text-align: left; background: var(--surface, #f8f9ff); border: 1px solid var(--outline-variant, #e5eeff); padding: 16px 18px; border-radius: 12px; max-height: 45vh; overflow-y: auto;">${cleanText}</div>
      <div style="display: flex; gap: 12px; flex-direction: column;">
        ${bc.btn_url ? `<a href="${bc.btn_url}" class="btn btn-primary w-full" target="_blank" id="bc-action" style="height: 46px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px;">${bc.btn_text || "Check it out"}</a>` : ""}
        <button class="btn btn-secondary w-full" id="bc-dismiss" style="height: 46px; font-weight: 700; font-size: 15px;">Got it, thanks</button>
      </div>
    </div>
  `;
  document.body.appendChild(m);

  const dismiss = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    let readList = JSON.parse(localStorage.getItem("read_broadcasts") || "[]");
    if (!readList.includes(bc.id)) {
      readList.push(bc.id);
      localStorage.setItem("read_broadcasts", JSON.stringify(readList));
    }
    if (typeof window.refreshNotifications === "function") window.refreshNotifications();
    m.style.opacity = "0";
    m.style.pointerEvents = "none";
    const innerModal = m.querySelector(".modal");
    if (innerModal) {
      innerModal.style.transform = "translateY(16px) scale(0.95)";
      innerModal.style.opacity = "0";
    }
    setTimeout(() => { if (m.parentNode) m.remove(); }, 280);
    const badge = document.getElementById("gnav-bell-badge");
    if (badge && window.__lastBroadcasts) {
      window.refreshNotifications();
    }
    document.removeEventListener("keydown", escHandler);
  };

  const escHandler = (e) => {
    if (e.key === "Escape") dismiss(e);
  };
  document.addEventListener("keydown", escHandler);

  m.onclick = (e) => {
    if (e.target === m) dismiss(e);
  };
  const closeBtn = document.getElementById("bc-close");
  if (closeBtn) closeBtn.onclick = dismiss;
  const dismissBtn = document.getElementById("bc-dismiss");
  if (dismissBtn) dismissBtn.onclick = dismiss;
  const actionBtn = document.getElementById("bc-action");
  if (actionBtn) actionBtn.onclick = dismiss;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      m.classList.add("open");
      m.style.opacity = "1";
      m.style.pointerEvents = "all";
      const innerModal = m.querySelector(".modal");
      if (innerModal) {
        innerModal.style.transform = "translateY(0) scale(1)";
        innerModal.style.opacity = "1";
      }
    });
  });
};

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const path = window.location.pathname;
    const isAuthPage = path === "/" || path === "/index.html" || path === "/login" || path === "/register" || document.getElementById("auth-container") || document.querySelector('form[onsubmit*="handleLogin"]');
    const token = localStorage.getItem("token");
    if (isAuthPage || !token) return;

    // Check if user just logged in and hasn't seen the first-login support modal yet
    try {
      const userObj = JSON.parse(localStorage.getItem("otp_user") || "{}");
      const uid = userObj.id || userObj._id || userObj.email || "default";
      const justLoggedIn = sessionStorage.getItem("just_logged_in") === "1";
      const hasSeenSupport = localStorage.getItem("has_seen_first_login_support_" + uid) === "true";

      if (justLoggedIn && !hasSeenSupport) {
        sessionStorage.removeItem("just_logged_in");
        localStorage.setItem("has_seen_first_login_support_" + uid, "true");
        
        const checkAndShowSupport = () => {
          const preloader = document.getElementById("initial-preloader");
          if (preloader && !preloader.classList.contains("fade-out") && preloader.style.opacity !== "0") {
            setTimeout(checkAndShowSupport, 200);
            return;
          }
          if (typeof window.showSupportWelcomeModal === "function") window.showSupportWelcomeModal();
        };
        setTimeout(checkAndShowSupport, 400);
        return; // Don't show broadcast modal right on top of welcome support modal
      }
    } catch(e) {}

    const res = await fetch("/api/auth/broadcast", { headers: { "Authorization": `Bearer ${token}` } }).then(r => r.json());
    if (res.active && Array.isArray(res.data) && res.data.length > 0) {
      const latest = res.data[0];
      const readList = JSON.parse(localStorage.getItem("read_broadcasts") || "[]");
      if (!readList.includes(latest.id)) {
        const checkAndTrigger = () => {
          const preloader = document.getElementById("initial-preloader");
          if (preloader && !preloader.classList.contains("fade-out") && preloader.style.opacity !== "0") {
            setTimeout(checkAndTrigger, 200);
            return;
          }
          window.triggerBroadcastModal(latest);
        };
        setTimeout(checkAndTrigger, 300);
      }
    }
  } catch(e) {}
});

// ── Global Top Navbar Injection (Dashboard) ──────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const path = window.location.pathname;
  if (!path.startsWith("/dashboard") && path !== "/api-docs") return;

  const container = document.querySelector(".navbar .container") || document.querySelector("header.sticky.top-0") || document.querySelector("header");
  const navbar    = document.querySelector(".navbar");
  const burger    = document.getElementById("nav-burger");
  if (!container) return;

  if (navbar) navbar.classList.add("user-ui-navbar");
  if (container.tagName.toLowerCase() === "header") container.classList.add("user-ui-navbar");

  // ── Styles ────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    .user-ui-navbar .nav-burger { display: none !important; }
    .user-ui-navbar #nav-links  { display: none !important; }

    /* Spacer pushes everything to the right */
    #gnav-spacer { flex: 1; }

    /* Icon button base */
    .gnav-icon-btn {
      position: relative;
      display: inline-flex; align-items: center; justify-content: center;
      width: 36px; height: 36px;
      border-radius: 50%;
      border: 1.5px solid var(--border, rgba(255,255,255,0.12));
      background: var(--surface, rgba(255,255,255,0.05));
      color: var(--text-2, #a0aec0);
      cursor: pointer; text-decoration: none;
      transition: background 0.2s, color 0.2s, transform 0.15s;
      flex-shrink: 0;
    }
    .gnav-icon-btn:hover {
      background: rgba(59,130,246,0.15);
      color: var(--accent, #3b82f6);
      transform: translateY(-1px);
    }
    .gnav-icon-btn svg { width: 18px; height: 18px; }

    /* Badge */
    .gnav-badge {
      position: absolute; top: -4px; right: -4px;
      min-width: 16px; height: 16px; padding: 0 3px;
      background: var(--accent, #3b82f6); color: #fff;
      border-radius: 8px; font-size: 9px; font-weight: 800;
      display: flex; align-items: center; justify-content: center;
      border: 2px solid var(--bg-1, #0a0a0f);
      line-height: 1;
    }
    .gnav-badge.danger { background: #ef4444; }

    /* Wallet pill with dynamic effects - sleek desktop size */
    #gnav-wallet-pill {
      display: inline-flex; align-items: stretch;
      height: 32px; border-radius: 16px; overflow: hidden;
      border: 1px solid rgba(16,185,129,0.4);
      background: linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(59,130,246,0.08) 100%);
      box-shadow: 0 3px 12px rgba(16,185,129,0.1), inset 0 1px 0 rgba(255,255,255,0.3);
      position: relative;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      flex-shrink: 0;
    }
    #gnav-wallet-pill::after {
      content: ''; position: absolute; top: 0; left: -150%; width: 100%; height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
      animation: walletShimmerEffect 3.5s infinite ease-in-out;
      pointer-events: none;
    }
    @keyframes walletShimmerEffect {
      0%, 60% { left: -150%; }
      100% { left: 150%; }
    }
    #gnav-wallet-pill:hover {
      transform: translateY(-1px) scale(1.02);
      box-shadow: 0 6px 18px rgba(16,185,129,0.2), inset 0 1px 0 rgba(255,255,255,0.6);
      border-color: rgba(16,185,129,0.65);
    }
    .gnav-wallet-bal {
      display: flex; align-items: center; gap: 5px;
      padding: 0 12px;
      color: #10b981; font-weight: 800; font-size: 13px;
      text-decoration: none; white-space: nowrap;
    }
    .wallet-icon-effect {
      font-size: 14px;
      display: inline-block;
      animation: walletBounceIcon 3s infinite ease-in-out;
    }
    @keyframes walletBounceIcon {
      0%, 100% { transform: scale(1) rotate(0deg); }
      50% { transform: scale(1.1) rotate(4deg); }
    }
    .gnav-wallet-add {
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 100%;
      border-left: 1px solid rgba(16,185,129,0.25);
      color: #10b981; font-weight: 800; font-size: 16px;
      text-decoration: none; cursor: pointer;
      transition: background 0.2s, color 0.2s;
    }
    .gnav-wallet-add:hover { background: rgba(16,185,129,0.25); color: #ffffff; }

    /* Currency chip */
    #gnav-currency-btn {
      display: inline-flex; align-items: center; gap: 5px;
      height: 32px; padding: 0 12px;
      border-radius: 16px;
      border: 1.5px solid var(--border, rgba(255,255,255,0.12));
      background: var(--surface, rgba(255,255,255,0.05));
      color: var(--text-2, #a0aec0); font-size: 12px; font-weight: 700;
      cursor: pointer; text-decoration: none;
      transition: background 0.2s, color 0.2s;
      flex-shrink: 0;
    }
    #gnav-currency-btn:hover { background: rgba(59,130,246,0.12); color: var(--accent,#3b82f6); }
    #gnav-currency-btn svg { width: 16px; height: 16px; }

    /* Avatar */
    #gnav-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      border: 2px solid var(--primary, #1050d4);
      background: var(--grad-primary, linear-gradient(135deg,#1050d4,#00c1fd));
      color: #fff; font-weight: 800; font-size: 14px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; flex-shrink: 0; overflow: hidden;
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s;
      box-shadow: 0 3px 10px rgba(16,80,212,0.15);
      text-decoration: none;
    }
    #gnav-avatar:hover { transform: scale(1.08); box-shadow: 0 0 0 4px rgba(16,80,212,0.25), 0 6px 18px rgba(16,80,212,0.2); }
    #gnav-avatar img { width: 100%; height: 100%; object-fit: cover; }

    /* Navbar right group */
    #gnav-right {
      display: flex; align-items: center; gap: 8px;
      margin-left: auto;
      flex-shrink: 0;
    }

    /* Left group containment */
    #gnav-left {
      display: flex; align-items: center; gap: 10px;
      min-width: 0; flex-shrink: 1; overflow: hidden;
    }
    #gnav-left a {
      display: flex; align-items: center; gap: 8px;
      min-width: 0; overflow: hidden; text-decoration: none;
    }
    #gnav-left h1 {
      margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    @keyframes gnav-shimmer { 0%,100%{opacity:.4} 50%{opacity:1} }
    .gnav-loading { animation: gnav-shimmer 1.2s infinite; }

    /* Avatar & Notif Containers */
    #gnav-avatar-container, #gnav-notif-container { position: relative; flex-shrink: 0; }
    
    .gnav-dropdown {
      position: absolute; top: calc(100% + 12px); right: 0;
      min-width: 200px; background: var(--bg-1, #0a0a0f);
      border: 1px solid var(--border, rgba(255,255,255,0.12));
      border-radius: 14px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);
      padding: 8px; z-index: 1000;
      display: none; flex-direction: column; gap: 4px;
      animation: gnav-drop 0.2s ease-out;
    }
    .gnav-dropdown.show { display: flex; }
    
    /* Notification specific */
    #gnav-notif-dropdown { min-width: 280px; max-width: 340px; padding: 0; overflow: hidden; }
    .gnav-notif-header { 
      padding: 14px 16px; font-size: 11px; font-weight: 800; 
      color: var(--text-2, #a0aec0); text-transform: uppercase; letter-spacing: 0.8px;
      display: flex; justify-content: space-between; align-items: center;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    #gnav-notif-list { 
      max-height: 380px; overflow-y: auto; 
      scrollbar-width: thin; scrollbar-color: var(--accent) transparent;
    }
    #gnav-notif-list::-webkit-scrollbar { width: 4px; }
    #gnav-notif-list::-webkit-scrollbar-thumb { background: var(--accent); border-radius: 10px; }
    
    .gnav-notif-empty { padding: 30px 20px; text-align: center; color: var(--text-2); font-size: 13px; opacity: 0.6; }
    .gnav-notif-item {
      display: flex; flex-direction: column; gap: 4px;
      padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.06);
      cursor: pointer; transition: all 0.2s;
    }
    .gnav-notif-item:last-child { border-bottom: none; }
    .gnav-notif-item:hover { background: rgba(255,255,255,0.04); }
    .gnav-notif-item.unread { background: rgba(59,130,246,0.03); }
    .gnav-notif-item.unread:hover { background: rgba(59,130,246,0.06); }
    
    .gnav-notif-title { font-weight: 700; font-size: 13px; color: var(--text); }
    .gnav-notif-text { font-size: 12px; color: var(--text-2); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .gnav-notif-time { font-size: 10px; color: var(--text-2); margin-top: 6px; font-weight: 500; opacity: 0.7; }
    
    @keyframes gnav-drop { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }

    .gnav-drop-item {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px; border-radius: 10px;
      color: var(--text-2, #a0aec0); text-decoration: none;
      font-size: 13px; font-weight: 600; cursor: pointer;
      transition: background 0.2s, color 0.2s;
      border: none; background: transparent; width: 100%; text-align: left;
    }
    .gnav-drop-item:hover { background: rgba(255,255,255,0.05); color: #fff; }
    .gnav-drop-item svg { width: 16px; height: 16px; opacity: 0.7; }
    .gnav-drop-item.danger:hover { background: rgba(239,68,68,0.1); color: #ef4444; }
    .gnav-drop-sep { height: 1px; background: rgba(255,255,255,0.06); margin: 4px 8px; }

    /* Responsive adjustments so title never overflows and wallet stays compact */
    @media (max-width: 768px) {
      .user-ui-navbar { padding: 0 12px !important; gap: 8px !important; }
      .user-ui-navbar .container { padding: 0 12px; gap: 6px; }
      #gnav-left { flex-shrink: 1 !important; min-width: 0 !important; }
      #gnav-left h1 { font-size: 17px !important; }
      #gnav-right { gap: 6px !important; flex-shrink: 0 !important; }
      #gnav-wallet-pill { height: 26px !important; border-radius: 13px !important; }
      .gnav-wallet-bal { font-size: 11px !important; padding: 0 8px !important; gap: 4px !important; }
      .wallet-icon-effect { font-size: 12px !important; }
      .gnav-wallet-add { width: 22px !important; font-size: 14px !important; }
      .gnav-icon-btn { width: 30px !important; height: 30px !important; }
      .gnav-icon-btn svg { width: 15px !important; height: 15px !important; }
      #gnav-avatar { width: 30px !important; height: 30px !important; font-size: 12px !important; }
      #gnav-currency-btn { display: none !important; }
      #gnav-notif-dropdown { right: -40px; }
    }
    @media (max-width: 480px) {
      .user-ui-navbar { padding: 0 8px !important; gap: 6px !important; }
      #gnav-left h1 { font-size: 15.5px !important; }
      #gnav-right { gap: 4px !important; }
      #gnav-wallet-pill { height: 25px !important; border-radius: 12.5px !important; }
      .gnav-wallet-bal { padding: 0 6px !important; font-size: 10.5px !important; }
      .gnav-wallet-add { width: 20px !important; font-size: 13px !important; }
      .gnav-icon-btn, #gnav-avatar { width: 28px !important; height: 28px !important; }
    }
  `;
  document.head.appendChild(style);

  // ── Spacer ────────────────────────────────────────────────────
  const spacer = document.createElement("div");
  spacer.id = "gnav-spacer";

  if (!isLoggedIn()) {
    const loginBtn = document.createElement("a");
    loginBtn.href = "/login";
    loginBtn.className = "btn btn-primary";
    loginBtn.style.cssText = "padding: 8px 22px; border-radius: 12px; font-size: 13px; font-weight: 800; text-decoration: none;";
    loginBtn.textContent = "Sign In";
    
    container.appendChild(spacer);
    container.appendChild(loginBtn);
    return;
  }

  // ── Right group ───────────────────────────────────────────────
  const right = document.createElement("div");
  right.id = "gnav-right";

  // 1. Wallet pill
  const walletPill = document.createElement("div");
  walletPill.id = "gnav-wallet-pill";
  walletPill.innerHTML = `
    <a href="/dashboard/wallet" class="gnav-wallet-bal" title="My Wallet">
      <span class="wallet-icon-effect">💰</span>
      <span id="nav-global-wallet-bal" class="gnav-loading font-bold">···</span>
    </a>
    <a href="/dashboard/wallet" class="gnav-wallet-add" title="Add Funds">+</a>
  `;

  // 2. Currency selector chip
  const curBtn = document.createElement("a");
  curBtn.id = "gnav-currency-btn";
  curBtn.href = "#";
  curBtn.title = "Change Currency";
  const curCodes = { INR: "₹", USD: "$", EUR: "€", RUB: "₽", USDT: "₮" };
  const user = getUser();
  const currentCur = user?.currency || localStorage.getItem("guest_currency") || "INR";
  curBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
    <span id="gnav-cur-label">${currentCur}</span>
  `;
  curBtn.addEventListener("click", (e) => {
    e.preventDefault();
    // Cycle through currencies
    const all = Object.keys(curCodes);
    const idx = all.indexOf(document.getElementById("gnav-cur-label")?.textContent || "INR");
    const next = all[(idx + 1) % all.length];
    if (typeof window.changeCurrency === "function") window.changeCurrency(next);
    const lbl = document.getElementById("gnav-cur-label");
    if (lbl) lbl.textContent = next;
  });

  // 3. Notification Hub (Dropdown)
  const notifContainer = document.createElement("div");
  notifContainer.id = "gnav-notif-container";

  const bellBtn = document.createElement("button");
  bellBtn.className = "gnav-icon-btn";
  bellBtn.type = "button";
  bellBtn.title = "Notifications";
  bellBtn.id = "gnav-bell-btn";
  bellBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  `;
  
  const bellBadge = document.createElement("span");
  bellBadge.className = "gnav-badge danger";
  bellBadge.id = "gnav-bell-badge";
  bellBadge.style.display = "none";
  bellBtn.appendChild(bellBadge);

  const notifDropdown = document.createElement("div");
  notifDropdown.id = "gnav-notif-dropdown";
  notifDropdown.className = "gnav-dropdown";
  notifDropdown.innerHTML = `
    <div class="gnav-notif-header">
      <span>Notifications</span>
      <button id="gnav-notif-perm-btn" style="display:none; font-size:10px; background:var(--accent); color:white; border:none; padding:4px 8px; border-radius:6px; cursor:pointer; font-weight:700;">🔔 Enable Alerts</button>
    </div>
    <div id="gnav-notif-list" class="gnav-notif-empty">
      Loading notifications...
    </div>
  `;

  notifContainer.appendChild(bellBtn);
  notifContainer.appendChild(notifDropdown);

  const permBtn = notifDropdown.querySelector("#gnav-notif-perm-btn");
  if (permBtn && "Notification" in window) {
    if (Notification.permission === "default") {
      permBtn.style.display = "block";
    }
    permBtn.onclick = async (e) => {
      e.stopPropagation();
      const res = await Notification.requestPermission();
      if (res === "granted") {
        permBtn.style.display = "none";
        toast("Notifications enabled! 🚀", "success");
        sendBrowserNotification("Notifications Active", "You will now receive alerts for incoming OTPs.");
      }
    };
  }

  bellBtn.onclick = (e) => {
    e.stopPropagation();
    const isOpening = !notifDropdown.classList.contains("show");
    notifDropdown.classList.toggle("show");
    dropdown.classList.remove("show"); // Close avatar dropdown
    
    if (isOpening) {
      // Mark all currently visible notifications as read locally
      if (window.__lastActiveOrders) {
        window.__lastActiveOrders.forEach(o => {
          if (o.otp) localStorage.setItem(`read_otp_${o.order_id}_${o.otp}`, '1');
          if (o.all_otps) o.all_otps.forEach(code => localStorage.setItem(`read_otp_${o.order_id}_${code}`, '1'));
        });
      }
      if (window.__lastBroadcasts) {
        const readList = JSON.parse(localStorage.getItem("read_broadcasts") || "[]");
        window.__lastBroadcasts.forEach(b => {
          if (!readList.includes(b.id)) readList.push(b.id);
        });
        localStorage.setItem("read_broadcasts", JSON.stringify(readList));
      }
      
      // Update UI immediately
      const badge = document.getElementById("gnav-bell-badge");
      if (badge) badge.style.display = "none";
      document.querySelectorAll('.gnav-notif-item.unread').forEach(item => item.classList.remove('unread'));
      
      // Sync total count to avoid replay sound
      sessionStorage.setItem("__lastTotalUnread", "0");
    }
  };

  window.refreshNotifications = async function() {
    try {
      const token = localStorage.getItem("otp_token") || localStorage.getItem("token");
      if (!token) return;

      const [bcRes, orderRes] = await Promise.all([
        fetch("/api/auth/broadcast", { headers: { "Authorization": `Bearer ${token}` } }).then(r => r.json()),
        fetch("/api/user/orders?status=active&limit=100", { headers: { "Authorization": `Bearer ${token}` } }).then(r => r.json())
      ]);

      const list = document.getElementById("gnav-notif-list");
      if (!list) return;

      const activeOrders = orderRes.orders || [];
      const broadcasts = bcRes.active ? (bcRes.data || []) : [];
      window.__lastActiveOrders = activeOrders;
      window.__lastBroadcasts = broadcasts;
      const readList = JSON.parse(localStorage.getItem("read_broadcasts") || "[]");

      // Show badge if ANY unread broadcast OR any active order with an OTP
      const hasUnreadBc = broadcasts.some(b => !readList.includes(b.id));
      const hasOtpInActive = activeOrders.some(o => o.otp);
      
      const currentPath = window.location.pathname;
      const currentOrderIdOnPage = currentPath.startsWith('/dashboard/orders/') ? currentPath.split('/').pop() : null;

      const unreadBcCount = broadcasts.filter(b => !readList.includes(b.id)).length;
      let unreadOtpCount = 0;
      activeOrders.forEach(o => {
        if (o.order_id === currentOrderIdOnPage) return;
        const otps = o.all_otps && o.all_otps.length > 0 ? o.all_otps : (o.otp ? [o.otp] : []);
        otps.forEach(code => {
          if (!localStorage.getItem(`read_otp_${o.order_id}_${code}`)) unreadOtpCount++;
        });
      });

      const totalUnread = unreadBcCount + unreadOtpCount;

      const badge = document.getElementById("gnav-bell-badge");
      if (badge) {
        if (totalUnread > 0) {
          const lastTotal = parseInt(sessionStorage.getItem("__lastTotalUnread") || "0");
          const isInitialized = sessionStorage.getItem("__notifInitDone") === "true";

          if (isInitialized && totalUnread > lastTotal) {
            const isActiveOrdersPage = window.location.pathname === '/dashboard/orders' || window.location.pathname.startsWith('/dashboard/orders/');
            if (!isActiveOrdersPage && typeof window.playOtpSound === "function") {
              window.playOtpSound();
            }
          }
          
          sessionStorage.setItem("__lastTotalUnread", totalUnread);
          sessionStorage.setItem("__notifInitDone", "true");

          badge.style.display = "flex";
          badge.textContent = totalUnread > 9 ? "9+" : totalUnread;
        } else {
          badge.style.display = "none";
          sessionStorage.setItem("__lastTotalUnread", "0");
          sessionStorage.setItem("__notifInitDone", "true");
        }
      }

      if (activeOrders.length === 0 && broadcasts.length === 0) {
        list.className = "gnav-notif-empty";
        list.innerHTML = "No new notifications";
        return;
      }

      list.className = "";
      let html = "";

      // 1. Show Active Orders with OTPs first
      if (activeOrders.length > 0) {
        const currentPath = window.location.pathname;
        const currentOrderIdOnPage = currentPath.startsWith('/dashboard/orders/') ? currentPath.split('/').pop() : null;
        
        // Filter out the order currently being viewed to avoid redundancy
        const filteredOrders = activeOrders.filter(o => o.order_id !== currentOrderIdOnPage);

        if (filteredOrders.length > 0) {
          html += `<div style="padding:10px 16px; font-size:10px; font-weight:800; color:var(--accent); text-transform:uppercase; letter-spacing:1px; background:rgba(59,130,246,0.05); display:flex; align-items:center; gap:6px;">
            <span style="width:6px; height:6px; background:var(--accent); border-radius:50%; animation:pulse 1.5s infinite"></span>
            Active Orders
          </div>`;
          filteredOrders.forEach(o => {
            const latestOtp = o.otp;
            const isNew = latestOtp && !localStorage.getItem(`read_otp_${o.order_id}_${latestOtp}`);
            
            html += `
              <div class="gnav-notif-item ${isNew ? 'unread' : ''}" onclick="if('${latestOtp}') localStorage.setItem('read_otp_${o.order_id}_${latestOtp}', '1'); window.location.href='/dashboard/orders/${o.order_id}'">
                <div class="gnav-notif-title" style="display:flex; justify-content:space-between; align-items:center;">
                  <span>📱 ${o.service_name}</span>
                  <span style="font-size:10px; opacity:0.6">${o.order_id}</span>
                </div>
                <div class="gnav-notif-text" style="color:${latestOtp ? 'var(--accent)' : 'inherit'}; font-weight:${latestOtp ? '700' : 'normal'}">
                  ${latestOtp ? `OTP: ${latestOtp}` : '<em>Waiting for code...</em>'}
                </div>
                <div class="gnav-notif-time">${o.phone || 'No number yet'}</div>
              </div>
            `;
          });
        }
      }

      // 2. Show Broadcasts
      if (broadcasts.length > 0) {
        html += `<div style="padding:10px 16px; font-size:10px; font-weight:800; color:var(--text-2); text-transform:uppercase; letter-spacing:1px; border-top:1px solid rgba(255,255,255,0.05)">Updates</div>`;
        broadcasts.forEach(bc => {
          const isRead = readList.includes(bc.id);
          const date = bc.createdAt ? new Date(bc.createdAt) : new Date(parseInt(bc.id));
          const timeStr = date.toLocaleDateString() === new Date().toLocaleDateString() 
            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : date.toLocaleDateString();

          html += `
            <div class="gnav-notif-item ${isRead ? '' : 'unread'}" 
                 onclick="showBroadcastDetail('${bc.id}', '${encodeURIComponent(JSON.stringify(bc))}')">
              <div class="gnav-notif-title">📢 Site Update</div>
              <div class="gnav-notif-text">${bc.text.replace(/\*/g, '').substring(0, 80)}${bc.text.length > 80 ? '...' : ''}</div>
              <div class="gnav-notif-time">${timeStr}</div>
            </div>
          `;
        });
      }

      list.innerHTML = html;
    } catch (err) {
      console.error("Refresh Notifs Error:", err);
      const list = document.getElementById("gnav-notif-list");
      if (list && list.innerHTML.includes("Loading")) list.innerHTML = "No notifications";
    }
  }

  // Global helper for detail view
  window.showBroadcastDetail = (id, dataJson) => {
    try {
       const bc = JSON.parse(decodeURIComponent(dataJson));
       
       // Mark as read
       let readList = JSON.parse(localStorage.getItem("read_broadcasts") || "[]");
       if (!readList.includes(id)) {
         readList.push(id);
         localStorage.setItem("read_broadcasts", JSON.stringify(readList));
       }

       if (typeof window.triggerBroadcastModal === 'function') {
         window.triggerBroadcastModal(bc);
       } else {
         toast("Broadcast: " + bc.text);
       }
       refreshNotifications();
    } catch(e) {}
  };

  refreshNotifications();

  // 4. Avatar / Profile with Dropdown
  const avatarContainer = document.createElement("div");
  avatarContainer.id = "gnav-avatar-container";
  
  const avatar = document.createElement("div");
  avatar.id = "gnav-avatar";
  const uname = user?.name || user?.username || user?.email || "U";
  
  let uPhoto = null;
  if (user?.avatar_url && user.avatar_url !== 'null' && user.avatar_url !== 'undefined') uPhoto = user.avatar_url;
  else if (user?.profile_photo && user.profile_photo !== 'null' && user.profile_photo !== 'undefined') uPhoto = user.profile_photo;
  else if (user?.avatar && user.avatar !== 'null' && user.avatar !== 'undefined') uPhoto = user.avatar;

  const bgColor = user?.avatar_color || "var(--accent)";

  if (uPhoto) {
    avatar.innerHTML = `<img src="${uPhoto}" alt="${uname}" style="width:100%; height:100%; object-fit:cover; border-radius:50%" onerror="this.style.display='none'; this.parentElement.innerText='${uname.charAt(0).toUpperCase()}'; this.parentElement.style.background='${bgColor}'; this.parentElement.style.color='#fff';">`;
  } else {
    avatar.textContent = uname.charAt(0).toUpperCase();
    avatar.style.background = bgColor;
    avatar.style.color = "#ffffff";
  }

  // Create dropdown menu
  const dropdown = document.createElement("div");
  dropdown.className = "gnav-dropdown";
  dropdown.innerHTML = `
    <div class="gnav-drop-item" id="gnav-drop-cur">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      <span>Currency: <strong id="gnav-cur-label">${currentCur}</strong></span>
    </div>
    <a href="/dashboard/profile" class="gnav-drop-item">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <span>My Profile</span>
    </a>
    <div class="gnav-drop-sep"></div>
    <button class="gnav-drop-item danger" id="gnav-logout-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      <span>Logout</span>
    </button>
  `;

  avatarContainer.appendChild(avatar);
  avatarContainer.appendChild(dropdown);

  // Toggle dropdown
  avatar.onclick = (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("show");
  };
  document.addEventListener("click", () => {
    dropdown.classList.remove("show");
    notifDropdown.classList.remove("show");
  });

  // Currency logic in dropdown
  const dropCur = dropdown.querySelector("#gnav-drop-cur");
  if (dropCur) {
    dropCur.onclick = (e) => {
      e.stopPropagation();
      const all = Object.keys(curCodes);
      const idx = all.indexOf(document.getElementById("gnav-cur-label")?.textContent || "INR");
      const next = all[(idx + 1) % all.length];
      if (typeof window.changeCurrency === "function") window.changeCurrency(next);
      const lbl = document.getElementById("gnav-cur-label");
      if (lbl) lbl.textContent = next;
    };
  }

  // Logout logic
  const logoutBtn = dropdown.querySelector("#gnav-logout-btn");
  if (logoutBtn) {
    logoutBtn.onclick = () => window.logout();
  }

  // Assemble right group
  right.appendChild(walletPill);
  right.appendChild(notifContainer);
  right.appendChild(avatarContainer);

  // Insert spacer + right group before burger (or append/replace)
  if (container.tagName.toLowerCase() === "header") {
    const existingRight = container.querySelector("#gnav-right") || container.querySelector("#top-nav-actions");
    if (existingRight) {
      existingRight.replaceWith(right);
    } else {
      container.appendChild(right);
    }
  } else if (burger) {
    container.insertBefore(spacer, burger);
    container.insertBefore(right, burger);
  } else {
    container.appendChild(spacer);
    container.appendChild(right);
  }

  // ── Balance polling ───────────────────────────────────────────
    async function updateNavBalance() {
    try {
      const data = await API.get("/api/user/dashboard");
      const bal = data.balance ?? data.wallet ?? 0;
      const balStr = typeof fmtMoney === "function" ? fmtMoney(bal) : `₹${(+bal).toFixed(2)}`;
      document.querySelectorAll("#nav-global-wallet-bal, #nav-wallet-bal, #stat-balance, #p-balance, #wallet-bal, #gnav-user-balance").forEach(el => {
        el.textContent = balStr;
        el.classList.remove("gnav-loading", "loading-shimmer");
      });

      // Update avatar if missing or different
      if (data.avatar_url) {
        const avatarImg = document.querySelector("#gnav-avatar img");
        if (avatarImg) {
          if (!avatarImg.src.includes(data.avatar_url)) avatarImg.src = data.avatar_url;
        } else {
          const avatarDiv = document.getElementById("gnav-avatar");
          if (avatarDiv) {
            avatarDiv.innerHTML = `<img src="${data.avatar_url}" alt="User" style="width:100%; height:100%; object-fit:cover; border-radius:50%">`;
          }
        }
        // Persist to local storage for other pages
        const cachedUser = getUser() || {};
        localStorage.setItem("otp_user", JSON.stringify({ ...cachedUser, ...data }));
      }

      // Refresh notifications periodically to show new broadcasts
      refreshNotifications();
    } catch (_) {}
  }

  if (isLoggedIn()) {
    updateNavBalance();
    setInterval(() => {
      if (document.visibilityState === "visible") updateNavBalance();
    }, 10000);
  }

  // Also update on socket balance event
  window.addEventListener("socket:balance", (e) => {
    const bal = e.detail?.balance;
    if (bal == null) return;
    const balStr = typeof fmtMoney === "function" ? fmtMoney(bal) : `₹${(+bal).toFixed(2)}`;
    document.querySelectorAll("#nav-global-wallet-bal, #nav-wallet-bal, #stat-balance, #p-balance, #wallet-bal, #gnav-user-balance").forEach(el => {
      el.textContent = balStr;
      el.classList.remove("gnav-loading", "loading-shimmer");
    });
  });
});

// Final initialization (Site-wide)
document.addEventListener("DOMContentLoaded", () => {
  applyBranding();
});




// Inject Glassmorphism CSS for modals
(function(){
  const s = document.createElement("style");
  s.textContent = `
    .glass-modal-overlay {
      background: rgba(0, 0, 0, 0.85) !important;
      display: flex !important;
      align-items: center;
      justify-content: center;
      position: fixed; inset: 0;
      z-index: 10000 !important;
      animation: genieFadeIn 0.25s ease-out forwards;
    }
    .glass-modal-box {
      background: #0A0A0A;
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 15px 45px rgba(0,0,0,0.7);
      border-radius: 20px !important;
      padding: 24px;
      width: 95%; max-width: 400px;
      animation: genieMaximize 0.35s cubic-bezier(0.25, 1, 0.5, 1) forwards;
    }
    .glass-modal-overlay.closing { animation: genieFadeOut 0.25s ease-in forwards; }
    .glass-modal-overlay.closing .glass-modal-box { animation: genieMinimize 0.25s ease-in forwards; }
    
    @keyframes genieFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes genieFadeOut { from { opacity: 1; } to { opacity: 0; } }
    
    @keyframes genieMaximize { 
      from { transform: scale(0.9) translateY(20px); opacity: 0; }
      to { transform: scale(1) translateY(0); opacity: 1; }
    }
    @keyframes genieMinimize {
      from { transform: scale(1) translateY(0); opacity: 1; }
      to { transform: scale(0.9) translateY(20px); opacity: 0; }
    }
  `;
  document.head.appendChild(s);
})();

// Real-time synchronization handled at the end of the file.

// ── PWA Install Manager ──────────────────────────────────────────
// Captures the beforeinstallprompt early so the More menu install
// button can trigger it at any time.
window.__pwaInstallPrompt = null;
window.__pwaIsInstalled = window.matchMedia('(display-mode: standalone)').matches
  || window.navigator.standalone === true;

// ── Audio Notification System (Global) ───────────────────
let audioCtx = null;
let _audioUnlocked = false;

function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
}

function unlockAudio() {
  if (_audioUnlocked) return;
  initAudio();
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => { _audioUnlocked = true; });
  } else {
    _audioUnlocked = true;
  }
}
['click', 'keydown', 'touchstart', 'pointerdown'].forEach(evt =>
  document.addEventListener(evt, unlockAudio, { once: false, passive: true })
);

window.sendBrowserNotification = function(title, body, orderId = null) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  
  const options = {
    body: body,
    icon: siteSettings.site_logo || "/icon-512.png",
    badge: "/icon-512.png",
    vibrate: [200, 100, 200],
    tag: orderId ? `otp-${orderId}` : 'generic-notif',
    renotify: true
  };

  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then(reg => { reg.showNotification(title, options); });
  } else {
    new Notification(title, options);
  }
};

const activeOrderCache = new Map();

window.playOtpSound = function() {
  initAudio();
  if (!audioCtx) return;
  const resume = audioCtx.state === 'suspended' ? audioCtx.resume() : Promise.resolve();
  resume.then(() => {
    const now = audioCtx.currentTime;
    const masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.4, now);
    masterGain.connect(audioCtx.destination);
    function tone(freq, startAt, duration, gainPeak = 0.6) {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startAt);
      g.gain.setValueAtTime(0, startAt);
      g.gain.linearRampToValueAtTime(gainPeak, startAt + 0.025);
      g.gain.setValueAtTime(gainPeak, startAt + duration * 0.3);
      g.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
      osc.connect(g); g.connect(masterGain);
      osc.start(startAt); osc.stop(startAt + duration + 0.01);
    }
    tone(659.25, now, 0.38, 0.7);
    tone(1318.5, now, 0.20, 0.15);
    tone(880.00, now + 0.22, 0.42, 0.7);
    tone(1760.0, now + 0.22, 0.22, 0.12);
  });
};

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__pwaInstallPrompt = e;
  // Reveal install button if the More menu is already rendered
  const btn = document.getElementById('mb-pwa-install-btn');
  if (btn) btn.style.display = 'flex';
});

window.addEventListener('appinstalled', () => {
  window.__pwaIsInstalled = true;
  window.__pwaInstallPrompt = null;
  const btn = document.getElementById('mb-pwa-install-btn');
  if (btn) btn.style.display = 'none';
});

window.triggerPWAInstall = async function() {
  if (!window.__pwaInstallPrompt) return;
  window.__pwaInstallPrompt.prompt();
  const { outcome } = await window.__pwaInstallPrompt.userChoice;
  if (outcome === 'accepted') {
    window.__pwaIsInstalled = true;
    window.__pwaInstallPrompt = null;
    const btn = document.getElementById('mb-pwa-install-btn');
    if (btn) btn.style.display = 'none';
  }
};

// ── Custom Select Dropdown Utilities ─────────────────────────────
// Used by buy.html, servers.html, users.html etc. for custom dropdowns.

window.toggleDropdown = function(name) {
  const wrapper = document.getElementById('select-' + name);
  if (!wrapper) return;
  const isOpen = wrapper.classList.contains('open');
  // Close all first
  window.closeAllDropdowns();
  // Then open this one if it was closed
  if (!isOpen) {
    wrapper.classList.add('open');
    const dropdown = wrapper.querySelector('.select-dropdown');
    if (dropdown) dropdown.style.display = 'block';
    // Focus search input if present
    const search = wrapper.querySelector('input[type="text"]');
    if (search) setTimeout(() => search.focus(), 50);
  }
};

window.closeAllDropdowns = function() {
  document.querySelectorAll('.custom-select.open').forEach(el => {
    el.classList.remove('open');
    const dropdown = el.querySelector('.select-dropdown');
    if (dropdown) dropdown.style.display = '';
  });
};

// Close dropdowns when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.custom-select')) {
    window.closeAllDropdowns();
  }
});

// ── Consolidated Real-Time Event System (SSE) ──────────────────────
(function() {
  let es = null;
  let retryDelay = 2000;
  
  function initSSE() {
    const token = (typeof getToken === 'function' ? getToken() : null) || localStorage.getItem("otp_token") || localStorage.getItem("token");
    if (!token) return;
    if (es) es.close();

    es = new EventSource(`/api/auth/stream?token=${encodeURIComponent(token)}`);
    
    es.addEventListener("connected", () => {
      console.log("⚡ Real-time stream connected");
      retryDelay = 2000;
    });

    es.addEventListener("balance", (e) => {
       try {
         const data = JSON.parse(e.data);
         const balance = data.balance;
         if (balance !== undefined) {
           const fmt = typeof fmtMoney === "function" ? fmtMoney(balance) : `$${(+balance).toFixed(2)}`;
           document.querySelectorAll("#gnav-user-balance, #nav-global-wallet-bal, #stat-balance, #p-balance, #wallet-bal").forEach(el => {
             el.textContent = fmt;
             el.classList.remove("loading-shimmer");
           });
           window.dispatchEvent(new CustomEvent("socket:balance", { detail: data }));
         }
       } catch(err) {}
    });

    es.addEventListener("order", (e) => {
      try {
        const data = JSON.parse(e.data);
        const orderId = data.orderId || data.id;
        console.log("📨 SSE Order Event Received:", orderId, data);
        if (!orderId) return;

        window.dispatchEvent(new CustomEvent("socket:order", { detail: data }));
        
        const prev = activeOrderCache.get(orderId);
        const prevOtp = prev?.otp || "";
        const newOtp = data.otp || "";
        const isNewOtp = newOtp && newOtp !== prevOtp;
        activeOrderCache.set(orderId, data);

        if (isNewOtp) {
          const isActiveOrdersPage = window.location.pathname === '/dashboard/orders' || window.location.pathname.startsWith('/dashboard/orders/');
          
          if (!isActiveOrdersPage) {
            if (typeof window.playOtpSound === "function") window.playOtpSound();
            
            const cleanOtp = newOtp.match(/\d{4,8}/)?.[0] || "Received";
            if (typeof window.sendBrowserNotification === "function") {
              window.sendBrowserNotification(
                `✨ OTP Received: ${data.service_name || 'Order'}`,
                `Your code is: ${cleanOtp} (Order ${orderId})`,
                orderId
              );
            }

            toast(`✨ Order ${orderId}: OTP ${cleanOtp}`, "success", 15000);
            if (typeof window.refreshNotifications === "function") window.refreshNotifications();
          }
        }

        // NOTE: order-detail.html listens to the 'socket:order' custom event dispatched above.
        // Do NOT call handleRealtimeOrderUpdate directly here — it would double-invoke the handler.
      } catch(err) { console.error("SSE Order Error:", err); }
    });

    es.addEventListener("broadcast", (e) => {
       try {
         const data = JSON.parse(e.data);
         if (typeof window.refreshNotifications === "function") window.refreshNotifications();
         if (typeof window.triggerBroadcastModal === "function") window.triggerBroadcastModal(data);
         window.dispatchEvent(new CustomEvent("socket:broadcast", { detail: data }));
       } catch(err) {}
    });

    es.addEventListener("broadcast_deleted", (e) => {
       try {
         const data = JSON.parse(e.data);
         if (typeof window.refreshNotifications === "function") window.refreshNotifications();
         window.dispatchEvent(new CustomEvent("socket:broadcast_deleted", { detail: data }));
       } catch(err) {}
    });

    es.addEventListener("settings", () => {
       console.log("⚙️ Site settings updated. Syncing branding...");
       localStorage.removeItem("site_settings");
       if (typeof window.applyBranding === "function") {
         window.applyBranding(true).then(() => {
           toast("Appearance updated!", "info");
         });
       }
       window.dispatchEvent(new CustomEvent("socket:settings_updated"));
    });
    
    es.addEventListener("price_update", (e) => {
       try {
         const data = JSON.parse(e.data);
         toast(data.msg || "Personalized prices updated!", "info");
         window.dispatchEvent(new CustomEvent("socket:price_update", { detail: data }));
       } catch(err) {}
    });

    es.onerror = () => {
      es.close();
      setTimeout(initSSE, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSSE);
  } else {
    initSSE();
  }

  // ── Legacy Layout Burger Menu (Admin Pages) ──────────────────────
  // Handles the ☰ nav-burger button in the legacy navbar + sidebar layout
  document.addEventListener('DOMContentLoaded', () => {
    let burger = document.getElementById('nav-burger');
    const navLinks = document.getElementById('nav-links');
    const sidebar = document.querySelector('.sidebar');
    
    if (!burger) return;

    // Clone the burger to wipe any previous event listeners (e.g. from initNavBurger)
    const newBurger = burger.cloneNode(true);
    burger.replaceWith(newBurger);
    burger = newBurger;

    // For admin pages that also have a sidebar, make it a slide-in drawer
    if (sidebar && window.location.pathname.startsWith('/admin')) {
      // Create overlay if not present
      let overlay = document.getElementById('admin-sidebar-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'admin-sidebar-overlay';
        overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;backdrop-filter:blur(4px);';
        document.body.appendChild(overlay);
      }

      burger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = sidebar.classList.contains('mobile-open');
        if (isOpen) {
          const layout = document.querySelector('.layout');
          if (layout && sidebar.parentNode !== layout) layout.prepend(sidebar);
          sidebar.classList.remove('mobile-open');
          overlay.style.display = 'none';
          burger.classList.remove('is-open');
          document.body.style.overflow = '';
        } else {
          document.body.appendChild(sidebar);
          sidebar.classList.add('mobile-open');
          overlay.style.display = 'block';
          burger.classList.add('is-open');
          document.body.style.overflow = 'hidden';
          // Ensure navLinks are hidden
          if (navLinks) navLinks.classList.remove('mobile-open');
        }
      });

      overlay.addEventListener('click', () => {
        const layout = document.querySelector('.layout');
        if (layout && sidebar.parentNode !== layout) layout.prepend(sidebar);
        sidebar.classList.remove('mobile-open');
        overlay.style.display = 'none';
        burger.classList.remove('is-open');
        document.body.style.overflow = '';
      });
      
      // Stop here! Don't add the standard navLinks toggler for admin pages.
      return;
    }

    // Handle standard desktop nav links dropdown for non-admin pages
    if (navLinks) {
      burger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = navLinks.classList.contains('mobile-open');
        navLinks.classList.toggle('mobile-open', !isOpen);
        burger.classList.toggle('is-open', !isOpen);
      });
      document.addEventListener('click', (e) => {
        if (!burger.contains(e.target) && !navLinks.contains(e.target)) {
          navLinks.classList.remove('mobile-open');
          burger.classList.remove('is-open');
        }
      });
    }
  });
  // ──────────────────────────────────────────────────────────────────

  // ── Global Navigation Preloader Trigger ──────────────────────────
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    
    const href = link.getAttribute('href');
    const target = link.getAttribute('target');
    
    // Ignore cases where we don't want the loader
    if (!href || 
        href.startsWith('#') || 
        href.startsWith('javascript:') || 
        target === '_blank' || 
        link.hasAttribute('download') ||
        e.ctrlKey || e.shiftKey || e.metaKey || e.button === 1 // Mid-click
    ) return;

    // Check if it's an internal navigation
    const isInternal = link.hostname === window.location.hostname || !link.hostname;
    if (!isInternal) return;

    // Optional: Avoid triggering for currency selector or other JS-only links
    if (link.classList.contains('gnav-wallet-bal') && href === '/dashboard/wallet') { /* allow */ }
    
    // Show preloader
    if (typeof window.showPageLoader === 'function') {
      window.showPageLoader();
    }
  });

  // ── Universal Bottom Navbar Modal Auto-Hider (Safe & Non-Looping) ──
  window.updateBottomNavVisibility = () => {
    const activeModals = document.querySelectorAll('.fixed.inset-0:not(.hidden), [id$="-modal"]:not(.hidden), [id$="-backdrop"]:not(.hidden), .modal:not(.hidden)');
    const bottomNav = document.querySelector('nav.fixed.bottom-0');
    const hasOpenModal = activeModals && activeModals.length > 0;
    
    if (hasOpenModal && !document.body.classList.contains('modal-open')) {
      document.body.classList.add('modal-open');
      if (bottomNav) bottomNav.style.setProperty('display', 'none', 'important');
    } else if (!hasOpenModal && document.body.classList.contains('modal-open')) {
      document.body.classList.remove('modal-open');
      if (bottomNav) bottomNav.style.removeProperty('display');
    }
  };

  // Check once on load and when any modal triggers open/close via JS
  window.addEventListener('DOMContentLoaded', () => window.updateBottomNavVisibility());
  window.addEventListener('click', (e) => {
    if (e.target.closest('button, a, [onclick], .modal, .fixed')) {
      setTimeout(() => window.updateBottomNavVisibility(), 50);
    }
  });
})();

// ── Global Number Checker Service Utilities & Badges ─────────────────
window.SUPPORTED_CHECKER_SERVICES = {
  gosats: 'GoSats',
  bigbasket: 'BigBasket',
  meesho: 'Meesho',
  plutos: 'Plutos',
  starexch: 'StarExch',
  swiggy: 'Swiggy',
  flipkart: 'Flipkart',
  shein: 'Shein',
  myntra: 'Myntra',
  oyo: 'OYO',
  mantrimall: 'MantriMall',
  blinkit: 'Blinkit',
  brevistay: 'BreviStay',
  ajio: 'Ajio',
  amazon: 'Amazon',
  jio: 'Jio',
  crownit: 'Crownit',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  habuildyoga: 'Habuild Yoga'
};

window.getCheckerKey = function(serviceName) {
  if (!serviceName || typeof serviceName !== 'string') return null;
  const s = serviceName.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  if (window.SUPPORTED_CHECKER_SERVICES[s]) return s;

  // Strict Jio rule: ONLY strict jio/reliancejio/myjio. Reject jiomart, jiocinema, etc.
  if (s.includes('jiomart') || s.includes('jiocinema') || s.includes('jiogames') || s.includes('jiomeet') || s.includes('jiopay')) {
    return null;
  }
  if (s === 'jio' || s === 'myjio' || s === 'reliancejio' || s === 'jiosim') {
    return 'jio';
  }

  if (s.includes('gosats') || s === 'sats') return 'gosats';
  if (s.includes('bigbasket') || s === 'bb') return 'bigbasket';
  if (s.includes('meesho')) return 'meesho';
  if (s.includes('plutos')) return 'plutos';
  if (s.includes('starexch') || s.includes('starexchange')) return 'starexch';
  if (s.includes('swiggy')) return 'swiggy';
  if (s.includes('flipkart') || s === 'fk') return 'flipkart';
  if (s.includes('shein')) return 'shein';
  if (s.includes('myntra')) return 'myntra';
  if (s.includes('oyo')) return 'oyo';
  if (s.includes('mantrimall') || s === 'mantri') return 'mantrimall';
  if (s.includes('blinkit') || s.includes('grofers')) return 'blinkit';
  if (s.includes('brevistay') || s.includes('brevi')) return 'brevistay';
  if (s.includes('ajio')) return 'ajio';
  if (s.includes('amazon') || s === 'amz') return 'amazon';
  if (s.includes('crownit')) return 'crownit';
  if (s.includes('telegram') || s === 'tg') return 'telegram';
  if (s.includes('whatsapp') || s === 'wa') return 'whatsapp';
  if (s.includes('habuildyoga') || s.includes('habuild')) return 'habuildyoga';

  return null;
};

window.isCheckerSupported = function(serviceName) {
  return window.getCheckerKey(serviceName) !== null;
};

window.getCheckerDisplayName = function(serviceName) {
  const key = window.getCheckerKey(serviceName);
  if (key && window.SUPPORTED_CHECKER_SERVICES[key]) {
    return window.SUPPORTED_CHECKER_SERVICES[key];
  }
  return serviceName || 'Service';
};

window.getCheckerBadgeHtml = function(serviceName, customStyle = '') {
  if (!window.isCheckerSupported(serviceName)) return '';
  return `<span class="checker-supported-badge" style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;background:rgba(59,130,246,0.12);color:var(--accent,#3b82f6);border:1px solid rgba(59,130,246,0.28);line-height:1;vertical-align:middle;flex-shrink:0;${customStyle}" title="Number registration checker available for ${window.getCheckerDisplayName(serviceName)}">
    <span class="material-symbols-outlined" style="font-size:12px;font-variation-settings:'FILL' 1;">verified</span>
    <span>Checker</span>
  </span>`;
};

