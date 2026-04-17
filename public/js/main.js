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
  fetchWithTimeout: async (url, options = {}) => {
    const { timeout = 45000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      return response;
    } catch (e) {
      clearTimeout(id);
      throw e;
    }
  },
  get:   (url, options = {}) => API.fetchWithTimeout(url, { headers: authHeaders(), ...options }).then(handleRes),
  post:  (url, body, options = {}) => API.fetchWithTimeout(url, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body), ...options }).then(handleRes),
  patch: (url, body, options = {}) => API.fetchWithTimeout(url, { method: "PATCH", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body), ...options }).then(handleRes),
  put:   (url, body, options = {}) => API.fetchWithTimeout(url, { method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body), ...options }).then(handleRes),
  del:   (url, options = {}) => API.fetchWithTimeout(url, { method: "DELETE", headers: authHeaders(), ...options }).then(handleRes),
  delete: (url, options = {}) => API.del(url, options),
  upload: (url, formData, method = "POST", options = {}) => API.fetchWithTimeout(url, { method: method, headers: authHeaders(), body: formData, ...options }).then(handleRes),
};

function authHeaders() {
  const token = localStorage.getItem("otp_token") || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleRes(res) {
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : { error: await res.text() };
  if (!res.ok) {
    console.error("API Error:", data.error);
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data;
}


// ── Unified Theme System ─────────────────────────────────────────────────
// Single canonical THEMES list used everywhere (settings preview + runtime)
const THEME_STORAGE_KEY = "otp_theme";
window.THEMES = [
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
window.applyTheme = function(themeId, isPreview = false) {
  const theme = window.THEMES.find(t => t.id === themeId) || window.THEMES[0];
  const root = document.documentElement;

  // Always set the data-theme attribute so CSS [data-theme="x"] rules fire
  root.setAttribute('data-theme', theme.id);

  // Clear any previous inline accent/grad overrides so CSS variables take over
  root.style.removeProperty('--accent');
  root.style.removeProperty('--accent-rgb');
  root.style.removeProperty('--grad-primary');

  if (!isPreview) {
    // Persist for page loads
    localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  }
  // For preview-only we still want the native CSS variables to show (via data-theme),
  // no need to set inline styles — the CSS ruleset does it.
};

window.getThemePreference = function() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return (window.THEMES.find(t => t.id === saved) ? saved : 'dark');
};

function getThemePreference() { return window.getThemePreference(); }

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'light' ? 'dark' : 'light');
}

let siteSettings = {
  site_name: "Website Name",
  primary_color: "#3b82f6",
  site_logo: null
};


window.applyBranding = async function(force = false) {
  try {
    const s = await API.get("/api/auth/settings");
    siteSettings = { ...siteSettings, ...s };
    localStorage.setItem('site_settings', JSON.stringify(siteSettings));
    
    const name = siteSettings.site_name || "Website Name";
    const oldNames = ["Rapid OTP", "Zaz", "{{SITE_NAME}}"];
    
    // 1. Update Document Title
    oldNames.forEach(old => {
      if (document.title.includes(old)) {
        document.title = document.title.replace(new RegExp(old, 'g'), name);
      }
    });

    // 2. Comprehensive DOM Replacement
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while(node = walker.nextNode()) {
      if (node.parentElement && (node.parentElement.tagName === "SCRIPT" || node.parentElement.tagName === "STYLE")) continue;
      oldNames.forEach(old => {
        if (node.nodeValue.includes(old)) {
          node.nodeValue = node.nodeValue.replace(new RegExp(old, 'g'), name);
        }
      });
    }

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

    if (siteSettings.default_theme && !localStorage.getItem('theme_pref')) {
      applyTheme(siteSettings.default_theme);
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
(function() {
  if (document.getElementById("pl-style")) return;
  
  const style = document.createElement("style");
  style.id = "pl-style";
  style.textContent = `
    /* Common Loader Container */
    .pl-container {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: #000; display: none; align-items: center; justify-content: center;
      z-index: 9999999 !important; opacity: 0; transition: opacity 0.4s ease;
      overflow: hidden; font-family: 'Courier New', monospace;
    }
    .pl-container.visible { display: flex; opacity: 1; }
    .pl-container.glass { background: rgba(5, 6, 11, 0.85); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }

    /* Premium Phone Animation */
    .pl-scene { position: relative; width: 400px; height: 500px; display: flex; align-items: center; justify-content: center; }
    .pl-phone {
      position: relative; width: 130px; height: 240px;
      background: linear-gradient(160deg, #1c1c38 0%, #0e0e22 100%);
      border-radius: 28px; border: 2.5px solid #2e2e5a;
      box-shadow: 0 0 40px #5533ff33, 0 0 80px #3311ff18, inset 0 1px 0 #ffffff14;
      z-index: 10; display: flex; align-items: center; justify-content: center;
      animation: plPhoneShake 0.3s ease-in-out infinite;
    }
    .pl-notch { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); width: 36px; height: 9px; background: #0e0e22; border-radius: 0 0 10px 10px; }
    .pl-home-bar { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); width: 40px; height: 4px; background: #2e2e5a; border-radius: 4px; }
    .pl-screen { width: 106px; height: 200px; background: #07071a; border-radius: 14px; overflow: hidden; position: relative; }
    .pl-matrix-col { position: absolute; top: 0; display: flex; flex-direction: column; animation: plMatrixFall linear infinite; font-size: 11px; line-height: 1.5; letter-spacing: 1px; }
    .pl-screen-flash { position: absolute; inset: 0; background: radial-gradient(circle at 50% 50%, #7766ff66 0%, transparent 70%); animation: plFlashPulse 0.6s ease-in-out infinite; pointer-events: none;}
    .pl-crack-svg { position: absolute; inset: 0; pointer-events: none; opacity: 0.7; }
    .pl-glow-ring { position: absolute; width: 150px; height: 260px; border-radius: 32px; border: 1px solid #5544ff44; animation: plRingPulse 0.8s ease-in-out infinite; pointer-events: none;}
    .pl-glow-ring:nth-of-type(2) { width: 170px; height: 280px; border-color: #4433ff22; animation-delay: 0.2s; }
    .pl-particle { position: absolute; font-family: 'Courier New', monospace; font-weight: 700; pointer-events: none; z-index: 20; left: 50%; top: 50%; animation: plBurst var(--dur) var(--delay) ease-out infinite; }
    .pl-loading-text { position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%); color: #5544cc; font-size: 11px; letter-spacing: 4px; text-transform: uppercase; animation: plTextBlink 1s step-end infinite; white-space: nowrap; }
    .pl-sub-text { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); color: rgba(255,255,255,0.2); font-size: 9px; letter-spacing: 1px; white-space: nowrap; text-transform: uppercase; font-weight: 600; }
    .pl-trail { position: absolute; width: 1px; height: 40px; background: linear-gradient(to bottom, transparent, #5533ff88, transparent); transform-origin: center center; animation: plTrailFly var(--dur) var(--delay) ease-out infinite; left: 50%; top: 50%; opacity: 0; }

    /* Orbital Animation */
    .cyber-orbital-scene { position: relative; width: 120px; height: 120px; display: flex; align-items: center; justify-content: center; }
    .orbital-ring { position: absolute; border-radius: 50%; border: 2px solid transparent; animation: plOrbit linear infinite; }
    .ring-1 { width: 100px; height: 100px; border-top-color: var(--accent); border-bottom-color: var(--accent); animation-duration: 2s; opacity: 0.8; }
    .ring-2 { width: 75px; height: 75px; border-left-color: var(--accent-2); border-right-color: var(--accent-2); animation-duration: 1.5s; animation-direction: reverse; opacity: 0.6; }
    .ring-3 { width: 50px; height: 50px; border-top-color: #fff; border-left-color: #fff; animation-duration: 1s; opacity: 0.4; }
    .orbital-core { width: 12px; height: 12px; background: #fff; border-radius: 50%; box-shadow: 0 0 20px #fff, 0 0 40px var(--accent); animation: plPulseCore 2s ease-in-out infinite; }
    .orbital-text { position: absolute; bottom: -40px; left: 50%; transform: translateX(-50%); color: var(--accent); font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 800; letter-spacing: 4px; text-shadow: 0 0 10px var(--accent); animation: plTextBlink 1.5s step-end infinite; white-space: nowrap; }

    /* Keyframes */
    @keyframes plPhoneShake { 0%, 100% { transform: translate(0, 0) rotate(0deg); } 25% { transform: translate(-2px, 1px) rotate(-0.5deg); } 50% { transform: translate(2px, -1px) rotate(0.5deg); } 75% { transform: translate(-1px, 2px) rotate(-0.3deg); } }
    @keyframes plMatrixFall { 0% { transform: translateY(-100%); opacity: 1; } 100% { transform: translateY(100%); opacity: 0; } }
    @keyframes plFlashPulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
    @keyframes plRingPulse { 0%, 100% { transform: scale(1); opacity: 0.8; } 50% { transform: scale(1.04); opacity: 0.3; } }
    @keyframes plBurst { 0% { transform: translate(-50%, -50%) scale(0.3); opacity: 1; filter: blur(2px); } 15% { opacity: 1; filter: blur(0px); } 100% { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(var(--ts)); opacity: 0; filter: blur(3px); } }
    @keyframes plTrailFly { 0% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--angle)) scaleY(0.2); } 20% { opacity: 0.6; transform: translate(-50%, -50%) rotate(var(--angle)) translateY(calc(var(--dist) * -0.3)) scaleY(1); } 100% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--angle)) translateY(calc(var(--dist) * -1)) scaleY(0.3); } }
    @keyframes plOrbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes plPulseCore { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.6; } }
    @keyframes plTextBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

    /* Hidden Nav Logic */
    body.pl-active { overflow: hidden; }
  `;
  document.head.appendChild(style);

  // Inject Premium Loader (Used for BUY page/specific actions)
  const pl = document.createElement("div");
  pl.id = "page-loader";
  pl.className = "pl-container";
  pl.innerHTML = `
    <div class="pl-scene" id="pl-scene">
      <div class="pl-glow-ring"></div>
      <div class="pl-glow-ring"></div>
      <div class="pl-phone" id="pl-phone"><div class="pl-notch"></div><div class="pl-screen" id="pl-screen"><div class="pl-screen-flash"></div><svg class="pl-crack-svg" viewBox="0 0 106 200"><polyline points="53,0 47,35 62,65 35,110 52,155 44,200" fill="none" stroke="#8877ff" stroke-width="1" opacity="0.8"/></svg></div><div class="pl-home-bar"></div></div>
      <div class="pl-loading-text" id="pl-main-text">OVERFLOW</div>
      <div class="pl-sub-text" id="pl-sub-text">Waiting for allocation...</div>
    </div>
  `;
  document.body.appendChild(pl);
})();

// Show/Hide simple page loader
window.showPageLoader = () => {
  let loader = document.getElementById("simple-page-loader");
  if (!loader) {
    loader = document.createElement("div");
    loader.id = "simple-page-loader";
    loader.innerHTML = `
      <div class="cyber-orbital-scene">
        <div class="orbital-ring ring-1"></div>
        <div class="orbital-ring ring-2"></div>
        <div class="orbital-ring ring-3"></div>
        <div class="orbital-core"></div>
        <div class="orbital-scan"></div>
        <div class="orbital-text">LOADING</div>
      </div>
    `;
    const style = document.createElement("style");
    style.textContent = `
      #simple-page-loader {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(5, 6, 11, 0.7);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        display: none; align-items: center; justify-content: center; z-index: 10001;
        opacity: 0; transition: opacity 0.3s ease;
      }
      #simple-page-loader.visible { display: flex; opacity: 1; }
      
      .cyber-orbital-scene { position: relative; width: 120px; height: 120px; display: flex; align-items: center; justify-content: center; }
      
      .orbital-ring {
        position: absolute; border-radius: 50%;
        border: 2px solid transparent;
        animation: orbit linear infinite;
      }
      .ring-1 { width: 100px; height: 100px; border-top-color: var(--accent); border-bottom-color: var(--accent); animation-duration: 2s; opacity: 0.8; }
      .ring-2 { width: 75px; height: 75px; border-left-color: var(--accent-2); border-right-color: var(--accent-2); animation-duration: 1.5s; animation-direction: reverse; opacity: 0.6; }
      .ring-3 { width: 50px; height: 50px; border-top-color: #ffffff; border-left-color: #ffffff; animation-duration: 1s; opacity: 0.4; }
      
      .orbital-core {
        width: 12px; height: 12px; background: #fff; border-radius: 50%;
        box-shadow: 0 0 20px #fff, 0 0 40px var(--accent);
        animation: pulseCore 2s ease-in-out infinite;
      }
      
      .orbital-scan {
        position: absolute; width: 140px; height: 2px;
        background: linear-gradient(90deg, transparent, var(--accent), transparent);
        opacity: 0.3; animation: scanMove 4s linear infinite;
      }
      
      .orbital-text {
        position: absolute; bottom: -40px; left: 50%; transform: translateX(-50%);
        color: var(--accent); font-family: 'JetBrains Mono', monospace;
        font-size: 10px; font-weight: 800; letter-spacing: 4px;
        text-shadow: 0 0 10px var(--accent); animation: textBlink 1.5s step-end infinite;
      }

      @keyframes orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes pulseCore { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.6; } }
      @keyframes scanMove { 0% { transform: rotate(0deg) translateY(-80px); } 100% { transform: rotate(360deg) translateY(-80px); } }
      @keyframes textBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    `;
    document.head.appendChild(style);
    document.body.appendChild(loader);
  }
  document.body.classList.add("pl-active"); // Hide navbar
  loader.style.display = "flex";
  setTimeout(() => loader.classList.add("visible"), 10);
};

window.hidePageLoader = () => {
  const loader = document.getElementById("simple-page-loader");
  if (!loader) return;
  document.body.classList.remove("pl-active"); // Show navbar
  loader.classList.remove("visible");
  setTimeout(() => { if(!loader.classList.contains("visible")) loader.style.display = "none"; }, 300);
};

// Original showLoader/hideLoader for number allocation (keep as is)
window.showLoader = (text, subtext) => {
  const loader = document.getElementById("page-loader");
  if (!loader) return;
  if (text) loader.querySelector("#pl-main-text").textContent = text;
  if (subtext) loader.querySelector("#pl-sub-text").textContent = subtext;
  document.body.classList.add("pl-active"); // Hide navbar/etc
  loader.style.display = "flex";
  setTimeout(() => loader.classList.add("visible"), 10);
};

window.hideLoader = () => {
  const loader = document.getElementById("page-loader");
  if (!loader) return;
  document.body.classList.remove("pl-active"); // Show navbar/etc
  loader.classList.remove("visible");
  setTimeout(() => { 
    if(!loader.classList.contains("visible")) {
      loader.style.display = "none";
      loader.querySelector("#pl-main-text").textContent = "LOADING";
      loader.querySelector("#pl-sub-text").textContent = "Please wait...";
    }
  }, 400);
};

// Update all balance displays on the page
window.updateBalanceDisplay = async function() {
  try {
    const data = await API.get('/api/user/dashboard');
    // Top nav global balance
    const globalBal = document.getElementById("nav-global-wallet-bal");
    if (globalBal) {
      globalBal.classList.remove("loading-shimmer");
      globalBal.textContent = fmtMoney(data.balance);
    }
    // Dashboard stat card
    const statBal = document.getElementById("stat-balance");
    if (statBal) statBal.textContent = fmtMoney(data.balance);
    // Profile page balance
    const profileBal = document.getElementById("p-balance");
    if (profileBal) profileBal.textContent = fmtMoney(data.balance);
    // Ready-made accounts balance
    const accountsBal = document.getElementById('wallet-bal');
    if (accountsBal) accountsBal.textContent = fmtMoney(data.balance);
    
    return data;
  } catch (e) { console.error("Balance sync failed", e); }
};

// Global Balance Heartbeat
function startBalanceHeartbeat() {
  if (!isLoggedIn()) return;
  // Poll every 10s on dashboard/billing, 30s elsewhere
  const isPriorityPage = window.location.pathname.includes('/dashboard') || window.location.pathname.includes('/wallet');
  const interval = isPriorityPage ? 10000 : 30000;
  
  setInterval(() => {
    // Only poll if tab is active to save resources
    if (document.visibilityState === 'visible') {
      window.updateBalanceDisplay();
      // If on dashboard and initDashboard exists, refresh it for real-time order states
      if (typeof window.initDashboard === 'function' && window.location.pathname === '/dashboard') {
        window.initDashboard();
      }
      // If on orders list and initOrders exists, refresh it
      if (typeof window.initOrders === 'function' && window.location.pathname === '/dashboard/orders') {
        window.initOrders();
      }
    }
  }, interval);
}

// Start heartbeat if logged in
if (isLoggedIn()) {
  startBalanceHeartbeat();
}


// ── Auth helpers ──────────────────────────────────────────────────
function getToken()   { return localStorage.getItem("otp_token"); }
function getUser()    { try { return JSON.parse(localStorage.getItem("otp_user") || "null"); } catch { return null; } }
function isLoggedIn() { return !!getToken(); }
function isAdmin()    { try { return getUser()?.is_admin || false; } catch { return false; } }

function saveAuth(token, user) {
  localStorage.setItem("otp_token", token);
  localStorage.setItem("otp_user", JSON.stringify(user));
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

function getServiceIcon(service, size = '100%') {
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

function renderSkeleton(type, count = 1) {
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

    // 1. Apply Theme — admin default_theme wins only if user has no preference saved
    const userSavedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (settings.default_theme && (!userSavedTheme || forceRefresh)) {
      applyTheme(settings.default_theme);
    } else if (!userSavedTheme) {
      applyTheme('dark');
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

document.addEventListener("DOMContentLoaded", () => {
  // A. Apply cached theme for zero flicker
  applyTheme(getThemePreference());
  
  // B. Sync with authoritative truth
  applySiteSettings();

  // C. Lightweight init
  if (isLoggedIn()) updateBalanceDisplay();
});

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

window.logout = function() {
  localStorage.removeItem("otp_token");
  localStorage.removeItem("otp_user");
  window.location.href = "/";
};

window.requireLogin = function() {
  if (!isLoggedIn()) { window.location.href = "/?login=1"; return false; }
  return true;
};

// Async version — checks server, not just localStorage
window.requireAdmin = async function() {
  if (!isLoggedIn()) { window.location.href = "/"; return false; }
  try {
    const data = await API.get("/api/auth/me");
    // Refresh localStorage with latest user data
    saveAuth(getToken(), data.user);
    if (!data.user.is_admin) { window.location.href = "/dashboard"; return false; }
    return true;
  } catch {
    window.location.href = "/";
    return false;
  }
};

// ── Toast ─────────────────────────────────────────────────────────
function createToastContainer() {
  if (document.getElementById("toast-container")) return;
  const c = document.createElement("div");
  c.id = "toast-container";
  document.body.appendChild(c);
}

window.toast = function(msg, type = "success", duration = 3500) {
  createToastContainer();
  const container = document.getElementById("toast-container");
  const t = document.createElement("div");
  t.className = `toast toast-${type}`;
  
  const icon = type === "success" ? "✓" : type === "error" ? "×" : "ℹ";
  
  t.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">${msg}</div>
    <div class="toast-progress"></div>
  `;
  
  container.appendChild(t);

  // Progress bar animation
  const progress = t.querySelector('.toast-progress');
  progress.style.transition = `transform ${duration}ms linear`;
  requestAnimationFrame(() => {
    progress.style.transform = 'scaleX(0)';
  });

  const remove = () => {
    if (t.parentElement) {
      t.classList.add('removing');
      setTimeout(() => t.remove(), 400);
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
  const labelMap = { expired: "cancelled" };
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

window.skeletonStats = () => {
  return `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">
    <div class="skeleton" style="height:80px;border-radius:16px"></div>
    <div class="skeleton" style="height:80px;border-radius:16px"></div>
    <div class="skeleton" style="height:80px;border-radius:16px"></div>
    <div class="skeleton" style="height:80px;border-radius:16px"></div>
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


// ── Avatar (letter-based, no Telegram photo) ─────────────────────
window.userAvatar = function(user, size = 36) {
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
      <div class="glass-modal-box">
        <h3 style="margin-bottom:16px;text-align:center;font-size:20px;color:var(--text)">Action Required</h3>
        <p style="color:var(--text-2);text-align:center;margin-bottom:24px;font-size:15px;line-height:1.5">${message}</p>
        <div style="display:flex;gap:12px">
          <button class="btn btn-secondary w-full" id="gl-no-btn">Cancel</button>
          <button class="btn btn-primary w-full" id="gl-yes-btn" style="box-shadow:0 4px 12px rgba(59,130,246,0.3)">Confirm</button>
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
function renderPagination(containerId, currentPage, totalPages, onPageChange) {
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
  if (burger && navLinks) {
    const newBurger = burger.cloneNode(true);
    burger.parentNode.replaceChild(newBurger, burger);
    const setOpenState = (isOpen) => {
      navLinks.classList.toggle("mobile-open", isOpen);
      newBurger.classList.toggle("is-open", isOpen);
      newBurger.setAttribute("aria-expanded", isOpen ? "true" : "false");
    };
    newBurger.setAttribute("aria-expanded", "false");
    newBurger.addEventListener("click", () => setOpenState(!navLinks.classList.contains("mobile-open")));
    document.addEventListener("click", (e) => {
      if (!navLinks.classList.contains("mobile-open")) return;
      if (newBurger.contains(e.target) || navLinks.contains(e.target)) return;
      setOpenState(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setOpenState(false);
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 768) setOpenState(false);
    });
    navLinks.querySelectorAll("a, button").forEach((el) => {
      el.addEventListener("click", () => setOpenState(false));
    });
  }
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
const SPA = {
  active: false,
  
  init() {
    // SPA disabled - using full page reloads
  },

  navigate(url) {
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

  refreshMobileNav(path) {
    if (typeof renderMobileBottomNav === "function") {
      renderMobileBottomNav(path);
    }
  }
};

window.SPA = SPA;

// Start SPA (does nothing since active=false)
document.addEventListener("DOMContentLoaded", () => SPA.init());

// ── Mobile Bottom Navbar Injection ───────────────────────────────
let currentNavRole = null; // 'admin' or 'user'

function closeMobileMoreMenu() {
  const menu = document.getElementById("mb-nav-more-menu");
  const moreBtn = document.getElementById("mb-nav-more-btn");
  if (menu) menu.classList.add("hidden");
  if (moreBtn) moreBtn.classList.remove("open");
}

window.renderMobileBottomNav = function(path = window.location.pathname) {
  const allowedPublic = ["/support", "/how-it-works", "/terms"];
  if (!path.startsWith("/dashboard") && !path.startsWith("/admin") && !allowedPublic.includes(path)) {
    const existing = document.getElementById("mb-bottom-nav-container");
    if (existing) existing.classList.remove("visible");
    closeMobileMoreMenu();
    return;
  }

  const isCurrentPageAdmin = path.startsWith("/admin");
  const role = isCurrentPageAdmin ? 'admin' : 'user';
  
  let container = document.getElementById("mb-bottom-nav-container");
  if (!container) {
    container = document.createElement("nav");
    container.id = "mb-bottom-nav-container";
    container.className = "mobile-bottom-nav visible";
    container.innerHTML = `<div class="mobile-bottom-nav-inner"></div>`;
    document.body.appendChild(container);
  }
  container.classList.add("visible");

  // Only re-render full HTML if role changed or first load
  if (currentNavRole !== role) {
    const inner = container.querySelector(".mobile-bottom-nav-inner");
    const adminLinks = [
      { href: "/admin", icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`, text: "Home" },
      { href: "/admin/users", icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`, text: "Users" },
      { href: "/admin/orders", icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`, text: "Orders" }
    ];
    const userLinks = [
      { href: "/dashboard", icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`, text: "Home" },
      { href: "/dashboard/orders", icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`, text: "Orders" },
      { href: "/dashboard/buy", icon: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`, text: "Buy", center: true },
      { href: "/dashboard/wallet", icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12z"/></svg>`, text: "Wallet" },
    ];

    const adminMore = [
      { href: "/admin/analytics", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`, text: "Analytics" },
      { href: "/admin/transactions", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>`, text: "Txns" },
      { href: "/admin/referrals", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`, text: "Referrals" },
      { href: "/admin/services", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1-2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`, text: "Services" },
      { href: "/admin/servers", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6" y2="6"/><line x1="6" y1="18" x2="6" y2="18"/></svg>`, text: "Servers" },
      { href: "/admin/payments", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`, text: "Payments" },
      { href: "/admin/broadcast", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`, text: "Broadcast" },
      { href: "/admin/settings", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1-2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`, text: "Settings" }
    ];
    const userMore = [
      { href: "/dashboard/accounts", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`, text: "Accounts" },
      { href: "/dashboard/profile", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`, text: "Profile" },
      { href: "/dashboard/referrals", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`, text: "Referrals" },
      { href: "/support", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`, text: "Support" },
    ];
    
    if (typeof isAdmin === 'function' && isAdmin()) {
      userMore.push({ href: "/admin", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`, text: "Admin" });
    }

    const moreLinks = isCurrentPageAdmin ? adminMore : userMore;
    
    let moreMenu = document.getElementById("mb-nav-more-menu");
    if (moreMenu) moreMenu.remove();
    moreMenu = document.createElement("div");
    moreMenu.id = "mb-nav-more-menu";
    moreMenu.className = "mb-more-menu hidden";
    moreMenu.innerHTML = `<div class="mb-more-menu-content">
      ${moreLinks.map((l, i) => `<a href="${l.href}" class="mb-more-item" data-href="${l.href}" style="animation-delay: ${0.05 + (i * 0.04)}s"><span class="mb-more-icon">${l.icon}</span><span>${l.text}</span></a>`).join("")}
    </div>`;
    document.body.appendChild(moreMenu);

    const btn = document.getElementById("mb-nav-more-btn");
    if (btn) btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      moreMenu.classList.toggle("hidden");
    };
  }

  // Always get the menu and setup handlers
  moreMenu = document.getElementById("mb-nav-more-menu");
  
  // Attach click handler to More button (runs every time)
  if (moreBtn) {
    moreBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isHidden = moreMenu.classList.toggle("hidden");
      moreBtn.classList.toggle("open", !isHidden);
    };
  }

  if (moreMenu) {
    moreMenu.querySelectorAll(".mb-more-item").forEach(item => {
      item.addEventListener("click", () => closeMobileMoreMenu());
    });
    
    // Update active states
    let someMoreActive = false;
    moreMenu.querySelectorAll(".mb-more-item").forEach(mi => {
      const mhref = mi.getAttribute("data-href");
      const active = path === mhref || (mhref !== "/admin" && mhref !== "/dashboard" && path.startsWith(mhref));
      mi.classList.toggle("active", active);
      if (active) someMoreActive = true;
    });

    if (moreBtn) moreBtn.classList.toggle("active", someMoreActive);
  }

  container.querySelectorAll(".mb-nav-item[data-href]").forEach(item => {
    const ihref = item.getAttribute("data-href");
    const active = path === ihref || (ihref !== "/admin" && ihref !== "/dashboard" && path.startsWith(ihref));
    item.classList.toggle("active", active);
  });
};

document.addEventListener("DOMContentLoaded", () => renderMobileBottomNav());
document.addEventListener("click", (e) => {
  const menu = document.getElementById("mb-nav-more-menu");
  const moreBtn = document.getElementById("mb-nav-more-btn");
  if (menu && !menu.classList.contains("hidden")) {
     if (!e.target.closest("#mb-nav-more-btn") && !e.target.closest("#mb-nav-more-menu")) {
       menu.classList.add("hidden");
       if (moreBtn) moreBtn.classList.remove("open");
     }
  }
});

// ── Broadcast Popup ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const res = await fetch("/api/auth/broadcast", { headers: { "Authorization": `Bearer ${localStorage.getItem("token") || ""}` } }).then(r => r.json());
    if (res.active && res.data) {
      const bc = res.data;
      if (localStorage.getItem("ack_broadcast") !== bc.id) {
        const m = document.createElement("div");
        m.className = "modal-backdrop open";
        m.style.zIndex = "9999";
        // basic markdown strip
        const cleanText = bc.text.replace(/\*(.*?)\*/g, "<strong>$1</strong>").replace(/_(.*?)_/g, "<em>$1</em>");
        m.innerHTML = `
          <div class="modal" style="text-align:center;max-width:400px;background:var(--bg-1);border:1px solid rgba(59,130,246,0.3);box-shadow:0 0 40px rgba(59,130,246,0.15)">
            <div style="font-size:48px;margin-bottom:16px">📢</div>
            <h3 style="font-size:22px;margin-bottom:16px;color:var(--text)">Important Update</h3>
            <div style="font-size:15px;color:var(--text-2);line-height:1.6;margin-bottom:28px;white-space:pre-wrap;text-align:left;background:rgba(255,255,255,0.03);padding:16px;border-radius:var(--r-md)">${cleanText}</div>
            <div style="display:flex;gap:12px;flex-direction:column">
              ${bc.btn_url ? `<a href="${bc.btn_url}" class="btn btn-primary w-full" target="_blank" id="bc-action">${bc.btn_text || "Check it out"}</a>` : ""}
              <button class="btn btn-secondary w-full" id="bc-dismiss">Got it, thanks</button>
            </div>
          </div>
        `;
        document.body.appendChild(m);
        const dismiss = () => {
          localStorage.setItem("ack_broadcast", bc.id);
          m.classList.remove("open");
          setTimeout(() => m.remove(), 300);
        };
        document.getElementById("bc-dismiss").onclick = dismiss;
        if(document.getElementById("bc-action")) {
          document.getElementById("bc-action").onclick = dismiss;
        }
      }
    }
  } catch(e) {}
});

// ── Global Top Navbar Balance Injection ─────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const path = window.location.pathname;
  if (!path.startsWith("/dashboard") && path !== "/api-docs") return;
  
  const container = document.querySelector(".navbar .container");
  const navbar = document.querySelector(".navbar");
  const burger = document.getElementById("nav-burger");
  if (!container) return;
  const isUserUi = path.startsWith("/dashboard");
  if (isUserUi && navbar) {
    navbar.classList.add("user-ui-navbar");
  }

  // Inject responsive layout rules for the navbar global wrapper
  const style = document.createElement("style");
  style.textContent = `
    @media (max-width: 768px) {
      #global-bal-wrap { margin-left: auto; margin-right: 4px; height: 24px; border-radius: 6px; }
      .gl-bal-left { font-size: 11px; padding: 0 7px; font-weight: 700; gap: 4px; }
      .gl-add-btn { font-size: 11px; padding: 0 7px; }
      .gl-logout-btn { width: 24px; height: 24px; font-size: 12px; }
      .user-ui-navbar .nav-burger { display: none !important; }
      .user-ui-navbar #nav-links { display: none !important; }
      .user-ui-navbar #global-bal-wrap { margin-right: 0; }
    }
    @media (min-width: 769px) {
      #nav-links { margin-left: auto; margin-right: 16px; }
    }
    #global-bal-wrap {
      display: inline-flex; align-items: stretch;
      background: rgba(59, 130, 246, 0.1);
      border: 1px solid rgba(59, 130, 246, 0.3);
      border-radius: var(--r-md);
      overflow: hidden; height: 30px;
    }
    .gl-bal-left {
      display: flex; align-items: center; padding: 0 10px;
      color: var(--accent); font-weight: 800; text-decoration: none; font-size: 12px;
      gap: 6px;
    }
    .gl-add-btn {
      display: flex; align-items: center; padding: 0 8px;
      background: rgba(59, 130, 246, 0.15); border-left: 1px solid rgba(59, 130, 246, 0.2);
      color: var(--accent); font-weight: 800; font-size: 12px; text-decoration: none; 
      transition: background 0.2s;
    }
    .gl-add-btn:hover { background: rgba(59, 130, 246, 0.3); }
    .gl-logout-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      margin-left: 6px;
      border-radius: var(--r-md);
      border: 1px solid rgba(239, 68, 68, 0.35);
      background: rgba(239, 68, 68, 0.12);
      color: #fca5a5;
      font-size: 14px;
      cursor: pointer;
      transition: background 0.2s, transform 0.2s;
    }
    .gl-logout-btn:hover {
      background: rgba(239, 68, 68, 0.22);
      transform: translateY(-1px);
    }
    @keyframes shimmer-pulse {
      0% { opacity: 0.5; }
      50% { opacity: 1; }
      100% { opacity: 0.5; }
    }
    .loading-shimmer { animation: shimmer-pulse 1s infinite ease-in-out; }
  `;
  document.head.appendChild(style);

  const wrap = document.createElement("div");
  wrap.id = "global-bal-wrap";
  
  // Left: Balance area
  const balArea = document.createElement("a");
  balArea.href = "/dashboard/wallet";
  balArea.className = "gl-bal-left";
  balArea.title = "View Wallet";
  balArea.innerHTML = `💳 <span id="nav-global-wallet-bal" class="loading-shimmer">Wait...</span>`;

  // Right: Add icon
  const addBtn = document.createElement("a");
  addBtn.href = "/dashboard/wallet";
  addBtn.className = "gl-add-btn";
  addBtn.title = "Add Funds";
  addBtn.innerHTML = `➕`;

  wrap.appendChild(balArea);
  wrap.appendChild(addBtn);

  let logoutBtn = null;
  if (isUserUi && isLoggedIn()) {
    logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.className = "gl-logout-btn";
    logoutBtn.title = "Logout";
    logoutBtn.setAttribute("aria-label", "Logout");
    logoutBtn.innerHTML = `↩`;
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem("otp_token");
      localStorage.removeItem("otp_user");
      window.location.href = "/";
    });
  }

  // Insert before nav-burger
  if (burger) {
    container.insertBefore(wrap, burger);
    if (logoutBtn) {
      container.insertBefore(logoutBtn, burger);
    }
  } else {
    container.appendChild(wrap);
    if (logoutBtn) {
      container.appendChild(logoutBtn);
    }
  }

  if (isLoggedIn()) {
    updateBalanceDisplay();
    // Global poll every 10s
    setInterval(() => {
      if (document.visibilityState === "visible") updateBalanceDisplay();
    }, 10000);
  }
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
      background: rgba(0, 0, 0, 0.8) !important;
      backdrop-filter: blur(12px) !important;
      -webkit-backdrop-filter: blur(12px) !important;
      display: flex !important;
      align-items: center;
      justify-content: center;
      position: fixed; inset: 0;
      z-index: 10000 !important;
      animation: genieFadeIn 0.3s forwards;
    }
    .glass-modal-box {
      background: #0D0D0D;
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 50px 100px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.05);
      border-radius: 24px !important;
      padding: 24px;
      width: 95%; max-width: 420px;
      transform-origin: bottom center;
      animation: genieMaximize 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    }
    .glass-modal-overlay.closing { animation: genieFadeOut 0.4s forwards; }
    .glass-modal-overlay.closing .glass-modal-box { animation: genieMinimize 0.4s cubic-bezier(0.55, 0, 1, 0.45) forwards; }
    
    @keyframes genieFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes genieFadeOut { from { opacity: 1; } to { opacity: 0; } }
    
    @keyframes genieMaximize { 
      0% { transform: scale(0.3, 0.5) translateY(200px); opacity: 0; filter: blur(10px); }
      40% { transform: scale(1.1, 0.9) translateY(-20px); opacity: 1; filter: blur(0); }
      70% { transform: scale(0.98, 1.02) translateY(5px); }
      100% { transform: scale(1, 1) translateY(0); opacity: 1; }
    }
    @keyframes genieMinimize {
      0% { transform: scale(1, 1) translateY(0); opacity: 1; filter: blur(0); }
      30% { transform: scale(1.1, 0.8) translateY(-10px); }
      100% { transform: scale(0.1, 0.4) translateY(500px); opacity: 0; filter: blur(20px); }
    }
  `;
  document.head.appendChild(s);
})();

// ── Universal Real-time SSE Client ──────────────────────────────
// Connects to /api/auth/stream and handles server-pushed events
// for ALL pages - no page refreshes needed.
(function initSSE() {
  if (!window.EventSource) return; // No SSE support → fall back to heartbeat
  if (!isLoggedIn()) return;       // Only connect when logged in

  let retryDelay = 2000;
  let retryTimer = null;

  function connect() {
    const token = localStorage.getItem("otp_token") || "";
    const url = `/api/auth/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.addEventListener("connected", () => {
      retryDelay = 2000; // Reset backoff on successful connect
    });

    // ── Balance Update ──────────────────────────────────────────
    es.addEventListener("balance", (e) => {
      try {
        const { balance } = JSON.parse(e.data);
        const fmt = typeof fmtMoney === "function" ? fmtMoney(balance) : `$${(+balance).toFixed(2)}`;
        [
          document.getElementById("nav-global-wallet-bal"),
          document.getElementById("stat-balance"),
          document.getElementById("p-balance"),
          document.getElementById("wallet-bal"),
        ].forEach(el => { if (el) { el.classList.remove("loading-shimmer"); el.textContent = fmt; } });
      } catch (_) {}
    });

    // ── Order/OTP Update ────────────────────────────────────────
    es.addEventListener("order", (e) => {
      try {
        const data = JSON.parse(e.data);
        const { orderId } = data;
        const path = window.location.pathname;

        // If currently on the order detail page for this order, refresh it
        if (path.includes(orderId) && typeof window.handleRealtimeOrderUpdate === "function") {
          window.handleRealtimeOrderUpdate(data);
          return;
        }
        // Refresh dashboard or orders list silently
        if (typeof window.initDashboard === "function" && (path === "/dashboard" || path === "/dashboard/")) {
          window.initDashboard();
        }
        if (typeof window.initOrders === "function" && path.startsWith("/dashboard/orders")) {
          window.initOrders();
        }
      } catch (_) {}
    });

    // ── Settings Update ─────────────────────────────────────────
    es.addEventListener("settings", () => {
      if (typeof window.applyBranding === "function") window.applyBranding(true);
    });

    // ── Broadcast Message ───────────────────────────────────────
    es.addEventListener("broadcast", (e) => {
      try {
        const bc = JSON.parse(e.data);
        if (!bc || !bc.text || !bc.id) return;
        if (localStorage.getItem("ack_broadcast") === bc.id) return;
        if (document.querySelector(".modal-backdrop[data-bc]")) return;

        const m = document.createElement("div");
        m.className = "modal-backdrop open";
        m.setAttribute("data-bc", bc.id);
        m.style.zIndex = "9999";
        const cleanText = bc.text.replace(/\*(.*?)\*/g, "<strong>$1</strong>").replace(/_(.*?)_/g, "<em>$1</em>");
        m.innerHTML = `
          <div class="modal" style="text-align:center;max-width:400px;background:var(--bg-1);border:1px solid rgba(59,130,246,0.3);box-shadow:0 0 40px rgba(59,130,246,0.15)">
            <div style="font-size:48px;margin-bottom:16px">📢</div>
            <h3 style="font-size:22px;margin-bottom:16px;color:var(--text)">Important Update</h3>
            <div style="font-size:15px;color:var(--text-2);line-height:1.6;margin-bottom:28px;white-space:pre-wrap;text-align:left;background:rgba(255,255,255,0.03);padding:16px;border-radius:var(--r-md)">${cleanText}</div>
            <div style="display:flex;gap:12px;flex-direction:column">
              ${bc.btn_url ? `<a href="${bc.btn_url}" class="btn btn-primary w-full" target="_blank" id="bc-rt-action">${bc.btn_text || "Check it out"}</a>` : ""}
              <button class="btn btn-secondary w-full" id="bc-rt-dismiss">Got it, thanks</button>
            </div>
          </div>`;
        document.body.appendChild(m);
        const dismiss = () => { localStorage.setItem("ack_broadcast", bc.id); m.classList.remove("open"); setTimeout(() => m.remove(), 300); };
        const db = document.getElementById("bc-rt-dismiss");
        if (db) db.onclick = dismiss;
        const ab = document.getElementById("bc-rt-action");
        if (ab) ab.onclick = dismiss;
      } catch (_) {}
    });

    // ── Auto-reconnect with exponential backoff ─────────────────
    es.onerror = () => {
      es.close();
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryDelay = Math.min(retryDelay * 1.5, 30000);
        connect();
      }, retryDelay);
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", connect);
  } else {
    connect();
  }
})();
