/* ── Shared JS helpers ── */

const API = {
  get:   (url, options = {}) => fetch(url, { headers: authHeaders(), ...options }).then(handleRes),
  post:  (url, body, options = {}) => fetch(url, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body), ...options }).then(handleRes),
  patch: (url, body, options = {}) => fetch(url, { method: "PATCH", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body), ...options }).then(handleRes),
  put:   (url, body, options = {}) => fetch(url, { method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body), ...options }).then(handleRes),
  del:   (url, options = {}) => fetch(url, { method: "DELETE", headers: authHeaders(), ...options }).then(handleRes),
  upload: (url, formData, options = {}) => fetch(url, { method: "POST", headers: authHeaders(), body: formData, ...options }).then(handleRes),
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

// ── Auth helpers ──────────────────────────────────────────────────
function getToken()   { return localStorage.getItem("otp_token"); }
function getUser()    { try { return JSON.parse(localStorage.getItem("otp_user") || "null"); } catch { return null; } }
function isLoggedIn() { return !!getToken(); }
function isAdmin()    { try { return getUser()?.is_admin || false; } catch { return false; } }

function saveAuth(token, user) {
  localStorage.setItem("otp_token", token);
  localStorage.setItem("otp_user", JSON.stringify(user));
}

const THEME_STORAGE_KEY = "otp_theme";
const THEMES = [
  { id: "dark", label: "Dark", icon: "🌙" },
  { id: "light", label: "Light", icon: "☀️" },
  { id: "midnight", label: "Midnight", icon: "🌌" },
  { id: "ocean", label: "Ocean", icon: "🌊" },
  { id: "sunset", label: "Sunset", icon: "🌅" },
  { id: "forest", label: "Forest", icon: "🌲" },
  { id: "lavender", label: "Lavender", icon: "💜" },
  { id: "aurora", label: "Aurora", icon: "🌀" },
  { id: "ember", label: "Ember", icon: "🔥" },
  { id: "citrus", label: "Citrus", icon: "🍋" },
  { id: "stone", label: "Stone", icon: "🪨" },
  { id: "sage", label: "Sage", icon: "🌿" },
  { id: "dawn", label: "Dawn", icon: "🌄" },
  { id: "neon", label: "Neon", icon: "🌐" },
  { id: "coral", label: "Coral", icon: "🐚" }
];

function getThemePreference() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  const validTheme = THEMES.find(t => t.id === saved);
  if (validTheme) return saved;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return "light";
  return "dark";
}

function applyTheme(theme) {
  const validTheme = THEMES.find(t => t.id === theme);
  const mode = validTheme ? validTheme.id : "dark";
  document.documentElement.setAttribute("data-theme", mode);
  localStorage.setItem(THEME_STORAGE_KEY, mode);
  const btn = document.getElementById("theme-toggle-btn");
  if (btn) {
    const nextTheme = THEMES[(THEMES.findIndex(t => t.id === mode) + 1) % THEMES.length];
    btn.textContent = `${nextTheme.icon} ${nextTheme.label}`;
    btn.title = `Current: ${validTheme?.label || "Dark"}`;
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const currentIndex = THEMES.findIndex(t => t.id === current);
  const nextIndex = (currentIndex + 1) % THEMES.length;
  applyTheme(THEMES[nextIndex].id);
}

async function insertThemeToggle() {
  const navLinks = document.getElementById("nav-links");
  if (!navLinks) return;

  // 1. Check for Forced Admin Theme
  let forcedTheme = null;
  try {
    const sRes = await fetch("/api/auth/settings");
    if (sRes.ok) {
      const sData = await sRes.json();
      if (sData.default_theme) forcedTheme = sData.default_theme;
    }
  } catch (e) { console.warn("Theme fetch failed:", e); }

  if (forcedTheme) {
    // Force the theme and do NOT insert the toggle button (UX finality)
    applyTheme(forcedTheme);
    // Overwrite any local choice to ensure it persists across sessions
    localStorage.setItem(THEME_STORAGE_KEY, forcedTheme);
    return;
  }

  // 2. Normal User Choice Logic (only if no forced theme)
  if (document.getElementById("theme-toggle-btn")) return;
  const btn = document.createElement("button");
  btn.id = "theme-toggle-btn";
  btn.type = "button";
  btn.className = "btn btn-secondary btn-sm theme-toggle";
  btn.onclick = toggleTheme;
  navLinks.appendChild(btn);
  applyTheme(getThemePreference());
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
  const t = document.createElement("div");
  t.className = `toast toast-${type}`;
  const icon = type === "success" ? "✅" : type === "error" ? "❌" : "ℹ️";
  t.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  document.getElementById("toast-container").appendChild(t);
  setTimeout(() => t.remove(), duration);
};

// ── Formatting ────────────────────────────────────────────────────
window.fmtMoney = function(n)     { return "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
window.fmtDate = function(d)        { return new Date(d).toLocaleString(); };
window.fmtDateShort = function(d)   { return new Date(d).toLocaleDateString(); };

window.statusBadge = function(s) {
  const map = { active: "badge-active", completed: "badge-completed", refunded: "badge-refunded", expired: "badge-expired", cancelled: "badge-expired" };
  return `<span class="badge ${map[s] || ''}">${s}</span>`;
};
window.txBadge = function(type) {
  const map = { deposit: "badge-deposit", purchase: "badge-purchase", refund: "badge-active", bonus: "badge-deposit", deduction: "badge-purchase" };
  return `<span class="badge ${map[type] || ''}">${type}</span>`;
};
window.txSign = function(type, amount) {
  const pos = ["deposit", "refund", "bonus"].includes(type);
  return `<span class="${pos ? 'text-success' : 'text-danger'}">${pos ? '+' : ''}${fmtMoney(amount)}</span>`;
};

// ── Skeleton UI Helpers (Moved to preloader.js) ──────────────────


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
    el.classList.remove("closing");
    el.classList.add("open");
  }
};

window.closeModal = function(id) { 
  const el = document.getElementById(id);
  if (el) {
    el.classList.add("closing");
    setTimeout(() => {
      el.classList.remove("open");
      el.classList.remove("closing");
    }, 400);
  }
};

window.uiAlert = function(message) {
  return new Promise(resolve => {
    let m = document.createElement("div");
    m.className = "modal-backdrop open glass-modal-overlay";
    m.style.zIndex = "99999";
    m.innerHTML = `
      <div class="modal glass-modal-box">
        <h3 style="margin-bottom:16px;text-align:center;font-size:20px;color:var(--text)">Notice</h3>
        <p style="color:var(--text-2);text-align:center;margin-bottom:24px;font-size:15px;line-height:1.5">${message}</p>
        <button class="btn btn-primary w-full" id="gl-ok-btn">OK</button>
      </div>`;
    document.body.appendChild(m);
    document.getElementById("gl-ok-btn").onclick = () => {
      m.classList.add("closing");
      setTimeout(() => { m.remove(); resolve(); }, 400);
    };
  });
};

window.uiConfirm = function(message) {
  return new Promise(resolve => {
    let m = document.createElement("div");
    m.className = "modal-backdrop open glass-modal-overlay";
    m.style.zIndex = "99999";
    m.innerHTML = `
      <div class="modal glass-modal-box">
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
      setTimeout(() => { m.remove(); resolve(true); }, 400);
    };
    document.getElementById("gl-no-btn").onclick = () => {
      m.classList.add("closing");
      setTimeout(() => { m.remove(); resolve(false); }, 400);
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
  let fn;
  if (typeof onPageChange === 'string') {
    fn = window[onPageChange] || new Function('return ' + onPageChange)();
  } else {
    fn = onPageChange;
  }
  const fnName = typeof fn === 'function' ? fn.name || onPageChange : onPageChange;
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

async function doRegister(username, email, password) {
  const data = await API.post("/api/auth/register", { username, email, password });
  saveAuth(data.token, data.user);
  return data;
}

// ── Nav burger ────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const burger   = document.getElementById("nav-burger");
  const navLinks = document.getElementById("nav-links");
  if (burger && navLinks)
    burger.addEventListener("click", () => navLinks.classList.toggle("mobile-open"));
  applyTheme(getThemePreference());
  insertThemeToggle();
});

// ── SPA Engine ────────────────────────────────────────────────────
const SPA = {
  active: true,
  
  init() {
    if (!this.active) return;
    document.body.style.overflow = "";
    
    // Manage click-intercept
    document.addEventListener("click", e => {
      const link = e.target.closest("a");
      if (!link) return;
      const href = link.getAttribute("href");
      if (href && (href.startsWith("/dashboard") || href.startsWith("/admin")) && !href.includes("#") && !link.target) {
        e.preventDefault();
        // Save scroll before moving
        history.replaceState({ scrollY: window.scrollY }, "");
        this.navigate(href);
      }
    });

    // Handle Browser Back/Forward
    window.addEventListener("popstate", e => {
      this.navigate(window.location.pathname, false, e.state ? e.state.scrollY : 0);
    });
  },

  async navigate(url, push = true, restoreScroll = 0) {
    try {
      closeMobileMoreMenu();

      // Cleanup background tasks from previous page
      if (window.intervals) {
        window.intervals.forEach(clearInterval);
        window.intervals = [];
      }
      if (window.timeouts) {
        window.timeouts.forEach(clearTimeout);
        window.timeouts = [];
      }

      // Ensure body scroll is unlocked when navigating
      document.body.style.overflow = "";

      const main = document.querySelector(".main-content");
      if (!main) {
        window.location.href = url;
        return;
      }
      main.style.opacity = "0.5";

      const res = await fetch(url);
      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      
      const newMain = doc.querySelector(".main-content");
      if (newMain) {
        // Force full reload if crossing admin/dashboard boundary (to swap whole layout/sidebar)
        const wasAdmin = window.location.pathname.startsWith("/admin");
        const nextAdmin = url.startsWith("/admin");
        if (wasAdmin !== nextAdmin) {
           window.location.href = url;
           return;
        }

        // 1. Sync Styles
        const newStyles = doc.querySelectorAll('style, link[rel="stylesheet"]');
        newStyles.forEach(s => {
          if (s.src && document.querySelector(`link[href="${s.getAttribute('href')}"]`)) return;
          if (!s.src && Array.from(document.querySelectorAll('style')).some(existing => existing.textContent === s.textContent)) return;
          document.head.appendChild(s.cloneNode(true));
        });

        // 2. Swap content
        main.innerHTML = newMain.innerHTML;
        main.style.opacity = "1";
        
        // 3. History
        document.title = doc.title;
        if (push) {
          history.pushState({ scrollY: 0 }, "", url);
        }
        
        // 4. Scripts
        const scripts = doc.querySelectorAll("script");
        scripts.forEach(oldScript => {
          if (oldScript.src && (oldScript.src.endsWith("main.js") || oldScript.src.endsWith("chart.js"))) return;
          const newScript = document.createElement("script");
          if (oldScript.src) {
            newScript.src = oldScript.src;
          } else {
            // Wrap in a block scope to prevent const/let redeclaration errors between pages.
            // Also, temporarily shim document.write to do nothing during SPA script execution
            // (though we are migrating away from it, this is a safety measure).
            newScript.textContent = `(function(){ 
              const _w = document.write; 
              document.write = (html) => { 
                const s = document.currentScript; 
                if(s) s.insertAdjacentHTML('beforebegin', html);
              };
              { ${oldScript.textContent} }
              document.write = _w;
            })()`;
          }
          document.body.appendChild(newScript);
          setTimeout(() => newScript.remove(), 1000);
        });

        this.updateNavStates(url);
        
        // 5. Scroll Restoration
        window.scrollTo(0, restoreScroll);
      } else {
        window.location.href = url;
      }
    } catch (e) {
      console.error("SPA Nav Error:", e);
      window.location.href = url;
    }
  },

  updateNavStates(url) {
    const path = url.split('?')[0];
    
    // 1. Top nav links
    document.querySelectorAll(".nav-links a").forEach(a => {
      const href = a.getAttribute("href");
      if (href) a.classList.toggle("active", path === href);
    });

    // 2. Sidebar items
    document.querySelectorAll(".sidebar-item").forEach(a => {
      const href = a.getAttribute("href");
      if (!href) return;
      // Handle active state including sub-paths (except /dashboard and /admin core)
      const isActive = (path === href) || (href !== "/dashboard" && href !== "/admin" && path.startsWith(href));
      a.classList.toggle("active", isActive);
    });

    // 3. Mobile bottom nav items
    document.querySelectorAll(".mb-nav-item").forEach(a => {
      const href = a.getAttribute("href");
      if (!href) return;
      const isActive = (path === href) || (href !== "/dashboard" && href !== "/admin" && path.startsWith(href));
      a.classList.toggle("active", isActive);
      
      // Also check if it's inside the "More" menu
      const moreMenu = document.getElementById("mb-nav-more-menu");
      if (moreMenu) {
         moreMenu.querySelectorAll(".mb-more-item").forEach(mi => {
            const mhref = mi.getAttribute("href");
            mi.classList.toggle("active", path === mhref || (mhref !== "/dashboard" && mhref !== "/admin" && path.startsWith(mhref)));
         });
         // If any item in more menu is active, highlight the "More" button
         const isMoreActive = Array.from(moreMenu.querySelectorAll(".mb-more-item")).some(mi => mi.classList.contains("active"));
         const moreBtn = document.getElementById("mb-nav-more-btn");
         if (moreBtn) moreBtn.classList.toggle("active", isMoreActive);
      }
    });

    // 4. Update the Mobile Navbar
    this.refreshMobileNav(path);
  },

  refreshMobileNav(path) {
    if (typeof renderMobileBottomNav === "function") {
      renderMobileBottomNav(path);
    }
  }
};

window.SPA = SPA;

// Start SPA
document.addEventListener("DOMContentLoaded", () => SPA.init());

// ── Mobile Bottom Navbar Injection ───────────────────────────────
let currentNavRole = null; // 'admin' or 'user'

function closeMobileMoreMenu() {
  const menu = document.getElementById("mb-nav-more-menu");
  if (menu) menu.classList.add("hidden");
}

window.renderMobileBottomNav = function(path = window.location.pathname) {
  if (!path.startsWith("/dashboard") && !path.startsWith("/admin")) {
    const existing = document.getElementById("mb-bottom-nav-container");
    if (existing) existing.classList.remove("visible");
    closeMobileMoreMenu();
    return;
  }

  const isAdmin = path.startsWith("/admin");
  const role = isAdmin ? 'admin' : 'user';
  
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
      { href: "/admin", icon: "📊", text: "Home" },
      { href: "/admin/users", icon: "👥", text: "Users" },
      { href: "/admin/orders", icon: "📋", text: "Orders" }
    ];
    const userLinks = [
      { href: "/dashboard", icon: "🏠", text: "Home" },
      { href: "/dashboard/orders", icon: "📋", text: "Orders" },
      { href: "/dashboard/buy", icon: "⚡", text: "Buy", center: true },
      { href: "/dashboard/wallet", icon: "💰", text: "Wallet" },
    ];

    const links = isAdmin ? adminLinks : userLinks;
    let html = "";
    links.forEach(l => {
      const isCenter = l.center;
      html += `
        <a href="${l.href}" class="mb-nav-item ${isCenter ? "mb-nav-buy" : ""}" data-href="${l.href}">
          <span class="mb-nav-icon">${l.icon}</span>
          <span>${l.text}</span>
        </a>`;
    });

    html += `
      <button type="button" class="mb-nav-item" id="mb-nav-more-btn" style="cursor:pointer">
        <span class="mb-nav-icon">☰</span>
        <span>More</span>
      </button>
    `;
    inner.innerHTML = html;
    currentNavRole = role;

    // Setup More Menu
    const adminMore = [
      { href: "/admin/analytics", icon: "📈", text: "Analytics" },
      { href: "/admin/transactions", icon: "💳", text: "Txns" },
      { href: "/admin/services", icon: "⚙️", text: "Services" },
      { href: "/admin/servers", icon: "🖥️", text: "Servers" },
      { href: "/admin/payments", icon: "💰", text: "Payments" },
      { href: "/admin/broadcast", icon: "📢", text: "Broadcast" },
      { href: "/admin/settings", icon: "🔧", text: "Settings" }
    ];
    const userMore = [
      { href: "/dashboard/accounts", icon: "🗂️", text: "Accounts" },
      { href: "/dashboard/profile", icon: "👤", text: "Profile" },
      { href: "/support", icon: "💬", text: "Support" },
    ];
    const moreLinks = isAdmin ? adminMore : userMore;
    
    let moreMenu = document.getElementById("mb-nav-more-menu");
    if (moreMenu) moreMenu.remove();
    moreMenu = document.createElement("div");
    moreMenu.id = "mb-nav-more-menu";
    moreMenu.className = "mb-more-menu hidden";
    moreMenu.innerHTML = `<div class="mb-more-menu-content">
      ${moreLinks.map(l => `<a href="${l.href}" class="mb-more-item" data-href="${l.href}"><span class="mb-more-icon">${l.icon}</span><span>${l.text}</span></a>`).join("")}
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
  const moreBtn = document.getElementById("mb-nav-more-btn");
  if (moreBtn) {
    moreBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      moreMenu.classList.toggle("hidden");
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
  if (menu && !menu.classList.contains("hidden")) {
     if (!e.target.closest("#mb-nav-more-btn") && !e.target.closest("#mb-nav-more-menu"))
       menu.classList.add("hidden");
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
  const burger = document.getElementById("nav-burger");
  if (!container) return;

  // Inject responsive layout rules for the navbar global wrapper
  const style = document.createElement("style");
  style.textContent = `
    @media (max-width: 768px) {
      #global-bal-wrap { margin-left: auto; margin-right: 4px; height: 26px; border-radius: 6px; }
      .gl-bal-left { font-size: 12px; padding: 0 8px; font-weight: 700; gap: 4px; }
      .gl-add-btn { font-size: 12px; padding: 0 8px; }
    }
    @media (min-width: 769px) {
      #nav-links { margin-left: auto; margin-right: 16px; }
    }
    #global-bal-wrap {
      display: inline-flex; align-items: stretch;
      background: rgba(59, 130, 246, 0.1);
      border: 1px solid rgba(59, 130, 246, 0.3);
      border-radius: var(--r-md);
      overflow: hidden; height: 32px;
    }
    .gl-bal-left {
      display: flex; align-items: center; padding: 0 12px;
      color: var(--accent); font-weight: 800; text-decoration: none; font-size: 13px;
      gap: 6px;
    }
    .gl-add-btn {
      display: flex; align-items: center; padding: 0 10px;
      background: rgba(59, 130, 246, 0.15); border-left: 1px solid rgba(59, 130, 246, 0.2);
      color: var(--accent); font-weight: 800; font-size: 14px; text-decoration: none; 
      transition: background 0.2s;
    }
    .gl-add-btn:hover { background: rgba(59, 130, 246, 0.3); }
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

  // Insert before nav-burger
  if (burger) {
    container.insertBefore(wrap, burger);
  } else {
    container.appendChild(wrap);
  }

  try {
    const data = await API.get('/api/user/dashboard');
    const b = document.getElementById("nav-global-wallet-bal");
    b.classList.remove("loading-shimmer");
    b.textContent = fmtMoney(data.balance);
  } catch(e) {}
});

// Inject Glassmorphism CSS for modals
(function(){
  const s = document.createElement("style");
  s.textContent = `
    .glass-modal-overlay {
      background: rgba(15, 23, 42, 0.4) !important;
      backdrop-filter: blur(8px) !important;
      -webkit-backdrop-filter: blur(8px) !important;
      animation: fadeInModal 0.2s ease-out;
    }
    .glass-modal-box {
      background: rgba(30, 41, 59, 0.7) !important;
      backdrop-filter: blur(16px) !important;
      -webkit-backdrop-filter: blur(16px) !important;
      border: 1px solid rgba(255,255,255,0.1) !important;
      box-shadow: 0 24px 50px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.05) !important;
      border-radius: 20px !important;
      transform: translateY(0) scale(1) !important;
      animation: bounceIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    @keyframes fadeInModal { from { opacity: 0; } to { opacity: 1; } }
    @keyframes bounceIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  `;
  document.head.appendChild(s);
})();
