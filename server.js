require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const os = require("os");
const rateLimit = require("express-rate-limit");
const { createHash } = require("node:crypto");
const fs = require("fs");
const { getCachedSettings } = require("./utils/settingsCache");

const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
const cookieParser = require("cookie-parser");
const PORT = process.env.PORT || 5000;

/* ─── Middleware ──────────────────────────────────────────────── */
app.use(cookieParser());
// NOTE: Helmet removed — it was blocking onclick= handlers via script-src-attr.
// Add back only in production with explicit scriptSrcAttr: ["'unsafe-inline'"]

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : [];
app.use(cors({
  origin: ALLOWED_ORIGINS.length > 0
    ? (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin))
    : false,
  credentials: true,
}));
app.use(morgan("dev"));
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString("utf8");
  }
}));
app.use(express.urlencoded({ extended: true, verify: (req, res, buf) => { req.rawBody = buf.toString("utf8"); } }));
app.set("trust proxy", 1);

app.use((req, res, next) => {
  if (req.headers.host && req.headers.host.startsWith('www.')) {
    const newHost = req.headers.host.slice(4);
    return res.redirect(301, req.protocol + '://' + newHost + req.originalUrl);
  }
  next();
});

const { protectSource } = require("./middleware/integrity");
app.use(protectSource);

app.use((req, res, next) => {
  if (req.path.endsWith(".css") || req.path.endsWith(".js")) return next();

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// API rate limit: up to 1,000 requests per authenticated user/API key per rolling
// minute. Anonymous requests remain keyed by IP. Keying authenticated traffic by
// user prevents a reverse proxy's shared IP from throttling every customer at once.
function apiRateLimitKey(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ")
    ? auth.slice(7)
    : (req.cookies?.token || req.query?.token || "");
  const { decodeToken } = require("./middleware/auth");
  const payload = token ? decodeToken(token) : null;
  if (payload?.user_id) return "user:" + String(payload.user_id);

  // API gateway calls authenticate with api_key instead of a JWT. Hash it so
  // credentials never become part of rate-limit store keys or diagnostics.
  const apiKey = req.query?.api_key || req.body?.api_key;
  if (apiKey) {
    const digest = createHash("sha256").update(String(apiKey)).digest("hex");
    return "api:" + digest;
  }

  return "ip:" + (req.ip || "unknown");
}

app.use("/api/", rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  keyGenerator: apiRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
}));
// Maintenance Mode Interceptor
app.use(async (req, res, next) => {
  const { isMaintenanceOn } = require("./utils/maintenance");
  const { decodeToken } = require("./middleware/auth");
  
  // Allow these paths even during maintenance:
  const allowedPaths = [
    "/maintenance", 
    "/api/auth/status", 
    "/api/auth/login",
    "/api/auth/settings",
    "/login",
    "/register",
    "/img/", 
    "/css/", 
    "/js/", 
    "/favicon.ico",
    "/uploads/",
    "/api/auth/status",
    "/api/auth/settings"
  ];
  
  const isAllowed = allowedPaths.some(p => req.path.startsWith(p));
  
  // Check if current user is admin via token
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : (req.cookies?.token || req.query?.token || "");
  const payload = decodeToken(token);
  const isUserAdmin = payload && payload.is_admin === true;

  const isAdminPath = req.path.startsWith("/admin") || req.path.startsWith("/api/admin");

  // Bypass maintenance if:
  // 1. Path is explicitly allowed (login, assets, status)
  // 2. Path is an admin path (to allow login/mgmt during outage)
  // 3. User is an authenticated ADMIN
  if (!isAllowed && !isAdminPath && !isUserAdmin) {
    if (await isMaintenanceOn()) {
      if (req.path.startsWith("/api/")) {
        return res.status(503).json({ error: "Under Maintenance", maintenance: true });
      }
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      return res.redirect("/maintenance");
    }
  }
  next();
});

// Database Health Check Middleware
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    const { DB_TYPE } = require("./utils/db");
    const { connection } = require("mongoose");
    if (DB_TYPE === "mongodb" && connection.readyState !== 1) {
      return res.status(503).json({ message: "Database connection lost. Please check your internet or retry later." });
    }
  }
  next();
});
/* ─── Dynamic PWA Manifest ───────────────────────────────────── */
app.get('/manifest.json', async (req, res) => {
  try {
    const settings = await getCachedSettings();
    const siteName = settings.site_name || 'Rapid OTP';
    
    // Use uploaded site_logo if available, fallback to default icon
    const appIcon = (settings.site_logo && settings.site_logo !== 'null') ? settings.site_logo : '/icon-512.png';
    
    const manifest = {
      name: siteName,
      short_name: siteName.length > 12 ? siteName.substring(0, 12) : siteName,
      description: `Instant OTP verification numbers at your fingertips.`,
      start_url: '/dashboard/buy', 
      display: 'standalone',
      background_color: '#000000',
      theme_color: settings.primary_color || '#3b82f6',
      orientation: 'portrait-primary',
      scope: '/',
      icons: [
        { src: appIcon, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: appIcon, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ],
      categories: ['utilities', 'productivity'],
      shortcuts: [
        { name: 'Buy Number', short_name: 'Buy', url: '/dashboard/buy', description: 'Instantly buy a new OTP number' },
        { name: 'My Orders', short_name: 'Orders', url: '/dashboard/orders', description: 'View active and past orders' }
      ]
    };
    res.setHeader('Content-Type', 'application/manifest+json');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1hr
    res.json(manifest);
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate manifest' });
  }
});

/* ─── SEO: Sitemap & Robots ───────────────────────────────── */
app.get('/sitemap.xml', async (req, res) => {
  try {
    const settings = await getCachedSettings();
    const siteUrl = (settings.site_url || process.env.SITE_URL || `https://${req.get('host')}`).replace(/\/$/, '');
    const now = new Date().toISOString().split('T')[0];

    const pages = [
      { url: '/',             priority: '1.0', changefreq: 'daily' },
      { url: '/pricing',      priority: '0.8', changefreq: 'weekly' },
      { url: '/how-it-works', priority: '0.7', changefreq: 'monthly' },
      { url: '/support',      priority: '0.6', changefreq: 'monthly' },
      { url: '/terms',        priority: '0.4', changefreq: 'yearly' },
      { url: '/login',        priority: '0.5', changefreq: 'yearly' },
      { url: '/register',     priority: '0.5', changefreq: 'yearly' },
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url>
    <loc>${siteUrl}${p.url}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(xml);
  } catch (e) {
    res.status(500).send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
});

app.get('/robots.txt', async (req, res) => {
  try {
    const settings = await getCachedSettings();
    const siteUrl = (settings.site_url || process.env.SITE_URL || `https://${req.get('host')}`).replace(/\/$/, '');
    const txt = `User-agent: *
Allow: /
Allow: /pricing
Allow: /how-it-works
Allow: /support
Allow: /terms
Allow: /login
Allow: /register

Disallow: /admin
Disallow: /api/
Disallow: /dashboard/

Sitemap: ${siteUrl}/sitemap.xml`;
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(txt);
  } catch (e) {
    res.send('User-agent: *\nAllow: /\n');
  }
});

/* ─── Static Files ───────────────────────────────────────────── */
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, path) => {
    if (path.endsWith("sw.js")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  }
}));

/* ─── API Routes ─────────────────────────────────────────────── */
app.use(require("./utils/adminRealtime").trackAdminChanges);
app.use("/api/auth", require("./routes/auth"));
app.use("/api/user", require("./routes/user"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/admin/readymade", require("./routes/accounts-admin"));
app.use("/api/accounts", require("./routes/accounts"));
app.use("/api/payment/omnipay", require("./routes/omnipayWebhook"));
app.use("/api/payment/heleket", require("./routes/heleketWebhook"));
app.use("/api/payment/eaglepay", require("./routes/eaglepayWebhook"));
// Provider callbacks authenticate with a per-server secret; no user session is needed.
app.use("/api/provider/webhook", require("./routes/providerWebhook"));

// API Gateway (SMS handler API standard)
app.use("/stubs/handler_api.php", require("./routes/apiGateway"));

// External Info API Data
app.use("/info", require("./routes/info"));

/* ─── HTML Page Routes ───────────────────────────────────────── */
const views = path.join(__dirname, "views");

const pageCache = new Map();

async function renderPage(res, filename) {
  try {
    const settings = await getCachedSettings();
    let html;

    // Simple in-memory cache for HTML templates
    if (pageCache.has(filename) && process.env.NODE_ENV === "production") {
      html = pageCache.get(filename);
    } else {
      html = fs.readFileSync(path.join(views, filename), "utf8");
      
      // Check if content is Base64 encoded (common in built/obfuscated versions)
      // Base64 encoded HTML usually starts with 'PCFET0NU' (<!DOCT)
      if (html.trim().length > 0 && !html.trim().startsWith("<") && /^[A-Za-z0-9+/=]+$/.test(html.trim())) {
        try {
          html = Buffer.from(html.trim(), "base64").toString("utf8");
        } catch (e) {
          // If decoding fails, keep original
        }
      }
      
      if (process.env.NODE_ENV === "production") pageCache.set(filename, html);
    }

    // Core Branding... (replacements continue below)
    const siteName = settings.site_name || "Zaz";
    const siteLogo = settings.site_logo || "/img/logo.png";
    const siteFavicon = (settings.site_favicon && settings.site_favicon !== "null") ? settings.site_favicon : "/favicon.ico";

    // SEO & Meta
    const seoOg = (settings.seo_og_image && settings.seo_og_image !== 'null') ? settings.seo_og_image : siteLogo;
    const seoTitle = settings.seo_title || `Instant Virtual Numbers for SMS Verification`;
    const seoDesc = settings.seo_description || `Get instant virtual phone numbers for ${siteName}. Receive OTP online for WhatsApp, Telegram, and 500+ services. Reliable, fast, and secure virtual numbers globally.`;
    const seoKeys = settings.seo_keywords || `otp, sms verification, virtual numbers, ${siteName}, receive sms online, burner number, private phone numbers, bypass otp`;

    // Theme & Branding Injection (Prevent FOUC)
    const primaryColor = settings.primary_color || "#3b82f6";
    const defaultTheme = settings.default_theme || "dark";
    const brandingVersion = settings.branding_version || "1";
    
    const themeInitScript = `
    <!-- Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
    <link href="https://fonts.googleapis.com" rel="preconnect"/>
    <link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect"/>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
    
    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
    <script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            "colors": {
              "on-primary": "#ffffff", "on-primary-container": "#fefcff", "on-primary-fixed-variant": "#003dab", "inverse-on-surface": "#eaf1ff",
              "primary-fixed-dim": "#b5c4ff", "primary": "#1050d4", "secondary-fixed-dim": "#75d1ff", "on-background": "#0b1c30",
              "tertiary-fixed": "#6ffbbe", "on-surface-variant": "#434654", "tertiary": "#006947", "surface-variant": "#d3e4fe",
              "primary-container": "#396bee", "on-secondary-fixed-variant": "#004d67", "on-primary-fixed": "#00174c", "on-error": "#ffffff",
              "on-tertiary-fixed": "#002113", "surface-container-lowest": "#ffffff", "outline": "#737686", "primary-fixed": "#dbe1ff",
              "on-tertiary-fixed-variant": "#005236", "surface-container-low": "#eff4ff", "surface-container-highest": "#d3e4fe",
              "inverse-primary": "#b5c4ff", "error-container": "#ffdad6", "on-error-container": "#93000a", "on-secondary": "#ffffff",
              "surface": "#f8f9ff", "on-surface": "#0b1c30", "on-tertiary-container": "#f5fff6", "outline-variant": "#c3c5d7",
              "on-secondary-container": "#004b65", "error": "#ba1a1a", "tertiary-fixed-dim": "#4edea3", "secondary": "#006688",
              "surface-bright": "#f8f9ff", "background": "#f8f9ff", "surface-tint": "#1653d6", "on-tertiary": "#ffffff",
              "surface-dim": "#cbdbf5", "inverse-surface": "#213145", "tertiary-container": "#00855b", "surface-container": "#e5eeff",
              "secondary-container": "#00c1fd", "surface-container-high": "#dce9ff", "secondary-fixed": "#c2e8ff", "on-secondary-fixed": "#001e2b"
            },
            "borderRadius": { "DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px" },
            "spacing": { "margin-desktop": "2.5rem", "stack-md": "1rem", "stack-sm": "0.5rem", "gutter": "1.5rem", "stack-lg": "2rem", "margin-mobile": "1rem", "container-max": "1280px" },
            "fontFamily": {
              "body-md": ["Plus Jakarta Sans"], "headline-md": ["Plus Jakarta Sans"], "headline-lg": ["Plus Jakarta Sans"],
              "body-lg": ["Plus Jakarta Sans"], "headline-sm": ["Plus Jakarta Sans"], "label-md": ["Inter"],
              "body-sm": ["Plus Jakarta Sans"], "otp-display": ["Plus Jakarta Sans"]
            },
            "fontSize": {
              "body-md": ["16px", {"lineHeight": "24px", "fontWeight": "400"}],
              "headline-md": ["24px", {"lineHeight": "32px", "letterSpacing": "-0.01em", "fontWeight": "600"}],
              "headline-lg": ["32px", {"lineHeight": "40px", "letterSpacing": "-0.02em", "fontWeight": "700"}],
              "body-lg": ["18px", {"lineHeight": "28px", "fontWeight": "400"}],
              "headline-sm": ["20px", {"lineHeight": "28px", "fontWeight": "600"}],
              "label-md": ["12px", {"lineHeight": "16px", "letterSpacing": "0.05em", "fontWeight": "600"}],
              "body-sm": ["14px", {"lineHeight": "20px", "fontWeight": "400"}],
              "otp-display": ["48px", {"lineHeight": "56px", "letterSpacing": "0.1em", "fontWeight": "700"}]
            }
          },
        },
      }
    </script>
    <style>
        .glass-panel {
            background: rgba(255, 255, 255, 0.7);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.5);
        }
    </style>
    <script id="theme-init">
      (function() {
        try {
          document.documentElement.className = "light"; // Force Stitch light theme globally
          document.documentElement.setAttribute('data-theme', 'light');
        } catch (e) {}
      })();
    </script>
    `;

    // Perform replacements
    const replacements = {
      "{{SITE_NAME}}": siteName,
      "{{SITE_LOGO}}": siteLogo,
      "{{SITE_FAVICON}}": siteFavicon,
      "{{SITE_URL}}": settings.site_url || process.env.SITE_URL || process.env.WEBSITE_URL || "https://your-site.com",
      "{{SEO_TITLE}}": seoTitle,
      "{{SEO_DESC}}": seoDesc,
      "{{SEO_KEYWORDS}}": seoKeys,
      "{{SEO_OG_IMAGE}}": seoOg,
      "{{THEME_INIT}}": themeInitScript,
      "{{BRANDING_VERSION}}": brandingVersion
    };

    for (const [key, value] of Object.entries(replacements)) {
      html = html.replace(new RegExp(key, "g"), value);
    }

    // ── Per-Page SEO Meta Injection ────────────────────────────
    const siteUrlBase = (settings.site_url || process.env.SITE_URL || `https://your-site.com`).replace(/\/$/, '');
    const pageMetaMap = {
      // ── Public (indexable) pages ──
      'index.html':        { title: `${siteName} | Temporary Mobile Number Provider for OTP Verification`, desc: seoDesc, path: '/',             robots: 'index, follow', keywords: seoKeys },
      'pricing.html':      { title: `Pricing — ${siteName}`, desc: `View transparent pricing for virtual numbers on ${siteName}. Services available for WhatsApp, Telegram and 500+ apps from ₹4.`, path: '/pricing',      robots: 'index, follow', keywords: `pricing, virtual number price, otp cost, ${siteName}` },
      'how-it-works.html': { title: `How It Works — ${siteName}`, desc: `Learn how to get a temporary phone number for OTP verification in 3 simple steps on ${siteName}.`, path: '/how-it-works', robots: 'index, follow', keywords: `how to get virtual number, otp verification guide, ${siteName}` },
      'support.html':      { title: `Support & Contact — ${siteName}`, desc: `Get help with your ${siteName} account, deposits, or virtual numbers. Fast support via Telegram, email, and WhatsApp.`, path: '/support',      robots: 'index, follow', keywords: `support, contact, help, ${siteName}` },
      'terms.html':        { title: `Terms of Service — ${siteName}`, desc: `Read the Terms of Service and usage policy for ${siteName}.`, path: '/terms',        robots: 'index, follow', keywords: `terms, privacy, policy, ${siteName}` },
      // ── Auth & User pages (noindex) ──
      'dashboard.html':    { title: `Dashboard — ${siteName}`, desc: `Your ${siteName} dashboard.`, path: '/dashboard',      robots: 'noindex, nofollow' },
      'buy.html':          { title: `Buy Number — ${siteName}`, desc: `Buy virtual numbers for OTP verification on ${siteName}.`, path: '/dashboard/buy',    robots: 'noindex, nofollow' },
      'orders.html':       { title: `My Orders — ${siteName}`, desc: `View and manage your active OTP orders on ${siteName}.`, path: '/dashboard/orders', robots: 'noindex, nofollow' },
      'wallet.html':       { title: `Wallet — ${siteName}`, desc: `Manage your ${siteName} wallet balance and transactions.`, path: '/dashboard/wallet', robots: 'noindex, nofollow' },
      'profile.html':      { title: `Profile — ${siteName}`, desc: `Manage your ${siteName} account profile.`, path: '/dashboard/profile', robots: 'noindex, nofollow' },
      'referrals.html':    { title: `Referrals — ${siteName}`, desc: `Earn rewards by referring friends to ${siteName}.`, path: '/dashboard/referrals', robots: 'noindex, nofollow' },
      'accounts.html':     { title: `Readymade Accounts — ${siteName}`, desc: `Browse readymade accounts on ${siteName}.`, path: '/dashboard/accounts', robots: 'noindex, nofollow' },
    };

    const pageMeta = pageMetaMap[filename];
    if (pageMeta) {
      const canonical = `${siteUrlBase}${pageMeta.path}`;
      const isIndexable = pageMeta.robots.startsWith('index');
      const seoBlock = `
    <title>${pageMeta.title}</title>
    <meta name="description" content="${pageMeta.desc}">
    ${pageMeta.keywords ? `<meta name="keywords" content="${pageMeta.keywords}">` : ''}
    <meta name="robots" content="${pageMeta.robots}">
    <meta name="author" content="${siteName}">
    ${isIndexable ? `<link rel="canonical" href="${canonical}">` : ''}
    <meta property="og:title" content="${pageMeta.title}">
    <meta property="og:description" content="${pageMeta.desc}">
    <meta property="og:image" content="${seoOg}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${siteName}">
    <meta property="og:locale" content="en_IN">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${pageMeta.title}">
    <meta name="twitter:description" content="${pageMeta.desc}">
    <meta name="twitter:image" content="${seoOg}">`;
      // Replace <title> in the HTML and inject all meta before </head>
      html = html.replace(/<title>.*?<\/title>/gi, '');
      html = html.replace(/<\/head>/i, seoBlock + '\n</head>');
    }
    // ───────────────────────────────────────────────────────────

    // PWA Meta Injection + Favicon Hardening
    const appleTouchIcon = (settings.site_logo && settings.site_logo !== 'null') ? settings.site_logo : '/icon-512.png';
    const pwaMeta = `
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="${primaryColor}">
    <meta name="msapplication-TileColor" content="${primaryColor}">
    <meta name="msapplication-TileImage" content="${appleTouchIcon}">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="${siteName}">
    <link rel="apple-touch-icon" sizes="180x180" href="${appleTouchIcon}">
    <link rel="icon" type="image/x-icon" href="${siteFavicon}">
    <link rel="shortcut icon" href="${siteFavicon}">
    <script>
      window.globalDeferredPrompt = null;
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        window.globalDeferredPrompt = e;
      });
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          // Add version param to bypass aggressive CDN/browser cache
          navigator.serviceWorker.register('/sw.js?v=4').catch(() => {});
        });
      }
    </script>`;
    html = html.replace(/<\/head>/i, pwaMeta + '\n</head>');

    // Per-page SEO structured data injection for Google Sitelinks
    const pageSchemaMap = {
      'index.html':   { name: `${siteName} | Temporary Mobile Number Provider for OTP Verification`, url: siteUrlBase, desc: seoDesc, breadcrumb: [{pos:1, name:'Home', item: siteUrlBase}] },
      'pricing.html': { name: `Pricing — ${siteName}`, url: `${siteUrlBase}/pricing`, desc: `Affordable virtual number pricing. Buy OTP numbers starting from ₹4 on ${siteName}.`, breadcrumb: [{pos:1,name:'Home',item:siteUrlBase},{pos:2,name:'Pricing',item:`${siteUrlBase}/pricing`}] },
      'how-it-works.html': { name: `How It Works — ${siteName}`, url: `${siteUrlBase}/how-it-works`, desc: `Learn how to get virtual numbers for OTP verification on ${siteName} in 3 easy steps.`, breadcrumb: [{pos:1,name:'Home',item:siteUrlBase},{pos:2,name:'How It Works',item:`${siteUrlBase}/how-it-works`}] },
      'support.html': { name: `Support — ${siteName}`, url: `${siteUrlBase}/support`, desc: `Get help and support for ${siteName}. Contact us for any issues with your virtual numbers.`, breadcrumb: [{pos:1,name:'Home',item:siteUrlBase},{pos:2,name:'Support',item:`${siteUrlBase}/support`}] },
      'terms.html':   { name: `Terms of Service — ${siteName}`, url: `${siteUrlBase}/terms`, desc: `Read the Terms of Service for ${siteName}.`, breadcrumb: [{pos:1,name:'Home',item:siteUrlBase},{pos:2,name:'Terms',item:`${siteUrlBase}/terms`}] },
    };

    const pageSchema = pageSchemaMap[filename];
    if (pageSchema) {
      const ldJson = JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "WebPage",
            "@id": `${pageSchema.url}/#webpage`,
            "url": pageSchema.url,
            "name": pageSchema.name,
            "description": pageSchema.desc,
            "isPartOf": { "@id": `${siteUrlBase}/#website` },
            "breadcrumb": {
              "@type": "BreadcrumbList",
              "itemListElement": pageSchema.breadcrumb.map(b => ({
                "@type": "ListItem",
                "position": b.pos,
                "name": b.name,
                "item": b.item
              }))
            }
          }
        ]
      });
      html = html.replace(/<\/head>/i, `<script type="application/ld+json">${ldJson}</script>\n</head>`);
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("Render error:", err);
    res.sendFile(path.join(views, filename));
  }
}

// Public
app.get("/index.html", (req, res) => {
  if (req.query.login === "1") {
    res.clearCookie("token");
    return renderPage(res, "index.html");
  }
  const token = req.cookies.token;
  if (token) return res.redirect("/dashboard/buy");
  renderPage(res, "index.html");
});
app.get("/", (req, res) => {
  const token = req.cookies.token;
  const queryString = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";

  if (req.query.login === "1") {
    res.clearCookie("token");
    return res.redirect("/index.html" + queryString);
  }
  
  if (token) return res.redirect("/dashboard/buy" + queryString);
  res.redirect("/index.html" + queryString);
});
app.get("/pricing", (_, res) => renderPage(res, "pricing.html"));
app.get("/api-docs", (_, res) => renderPage(res, "api-docs.html"));
app.get("/how-it-works", (_, res) => renderPage(res, "how-it-works.html"));
app.get("/terms", (_, res) => renderPage(res, "terms.html"));
app.get("/support", (_, res) => renderPage(res, "support.html"));
app.get("/maintenance", (_, res) => renderPage(res, "maintenance.html"));

// External Stats Dashboard
app.get("/info/otpverse123", (_, res) => renderPage(res, "info.html"));
app.get("/info/otpverse123/", (_, res) => renderPage(res, "info.html"));

// User portal
app.get("/dashboard", (_, res) => renderPage(res, "dashboard.html"));
app.get("/dashboard/buy", (_, res) => renderPage(res, "buy.html"));
app.get("/dashboard/orders", (_, res) => renderPage(res, "orders.html"));
app.get("/dashboard/orders/:id", (_, res) => renderPage(res, "order-detail.html"));
app.get("/dashboard/wallet", (_, res) => renderPage(res, "wallet.html"));
app.get("/dashboard/profile", (_, res) => renderPage(res, "profile.html"));
app.get("/dashboard/referrals", (_, res) => renderPage(res, "referrals.html"));
app.get("/dashboard/accounts", (_, res) => renderPage(res, "accounts.html"));

// Admin panel
const { adminRequired } = require("./middleware/auth");
app.get("/admin", adminRequired, (_, res) => renderPage(res, "admin/index.html"));
app.get("/admin/users", adminRequired, (_, res) => renderPage(res, "admin/users.html"));
app.get("/admin/users/:id", adminRequired, (_, res) => renderPage(res, "admin/user-detail.html"));
app.get("/admin/orders", adminRequired, (_, res) => renderPage(res, "admin/orders.html"));
app.get("/admin/orders/:id", adminRequired, (_, res) => renderPage(res, "admin/order-detail.html"));
app.get("/admin/services", adminRequired, (_, res) => renderPage(res, "admin/services.html"));
app.get("/admin/countries", adminRequired, (_, res) => renderPage(res, "admin/countries.html"));
app.get("/admin/servers", adminRequired, (_, res) => renderPage(res, "admin/servers.html"));
app.get("/admin/payments", adminRequired, (_, res) => renderPage(res, "admin/payments.html"));
app.get("/admin/payout", adminRequired, (_, res) => renderPage(res, "admin/payout.html"));
app.get("/admin/transactions", adminRequired, (_, res) => renderPage(res, "admin/transactions.html"));
app.get("/admin/broadcast", adminRequired, (_, res) => renderPage(res, "admin/broadcast.html"));
app.get("/admin/settings", adminRequired, (_, res) => renderPage(res, "admin/settings.html"));
app.get("/admin/analytics", adminRequired, (_, res) => renderPage(res, "admin/analytics.html"));
app.get("/admin/readymade", adminRequired, (_, res) => renderPage(res, "admin/readymade.html"));
app.get("/admin/promo-codes", adminRequired, (_, res) => renderPage(res, "admin/promo-codes.html"));
app.get("/admin/referrals", adminRequired, (_, res) => renderPage(res, "admin/referrals.html"));

// global 404
app.use((_, res) => {
  res.status(404);
  renderPage(res, "404.html");
});

// Global Error Handler Safety Net
app.use((err, req, res, next) => {
  console.error("GLOBAL_ERROR:", err.stack || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal Server Error", message: err.message });
});

/* ─── Database ────────────────────────────────────────────────── */
const { connectDB, log } = require("./utils/db");

async function startServer() {
  try {
    log(`🚀 Starting Rapid OTP...`);
    
    // 1. Initialize Database First
    await connectDB();
    log("✅ Database initialized successfully.");
    
    // 2. Start Listening
    server.listen(PORT, "0.0.0.0", async () => {
      // 2a. Initialize Real-time Emitter (Socket.io)
      const realtimeEmitter = require("./utils/realtimeEmitter");
      realtimeEmitter.init(io);

      // Start background services ONLY after DB is ready
      const { startWatcher } = require("./utils/orderWatcher");
      startWatcher();
      log("🕒 Order Watcher started.");

      const { startCurrencyUpdater } = require("./utils/currencyUpdater");
      startCurrencyUpdater();
      log("💰 Currency Updater started.");

      // 3. Cleanup Orphaned Services (Automatic)
      try {
        const Service = require("./models/Service");
        const Server = require("./models/Server");
        const { DB_TYPE } = require("./utils/db");
        const { clearCache } = require("./utils/apiCache");

        if (DB_TYPE === "mysql") {
          const { Op } = require("sequelize");
          const count1 = await Service.destroy({ where: { server_id: null } });
          const servers = await Server.findAll({ attributes: ['id'] });
          const serverIds = servers.map(s => s.id);
          const count2 = await Service.destroy({ where: { server_id: { [Op.notIn]: serverIds } } });
          if (count1 + count2 > 0) log(`🧹 Cleaned up ${count1 + count2} orphaned services (MySQL).`);
        } else {
          const res1 = await Service.deleteMany({ $or: [{ server_id: null }, { server_id: { $exists: false } }] });
          const servers = await Server.find({}, { _id: 1 });
          const serverIds = servers.map(s => s._id);
          const res2 = await Service.deleteMany({ server_id: { $nin: serverIds } });
          const total = res1.deletedCount + res2.deletedCount;
          if (total > 0) log(`🧹 Cleaned up ${total} orphaned services (MongoDB).`);
        }
        clearCache("services");
      } catch (e) {
        log("⚠️ Orphaned services cleanup failed: " + e.message);
      }

      const nets = os.networkInterfaces();
      let localIp = "localhost";
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (net.family === "IPv4" && !net.internal) {
            localIp = net.address;
            break;
          }
        }
      }
      log(`🚀 Rapid OTP fully ready at http://${localIp}:${PORT}`);
    });

    // Handle port-already-in-use gracefully
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        const cmd = process.platform === "win32"
          ? `Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess -Force`
          : `fuser -k ${PORT}/tcp`;
        console.error(`   ${cmd}`);
        process.exit(1);
      } else {
        throw err;
      }
    });

  } catch (err) {
    log("❌ Critical Startup Error: " + err.message);
    process.exit(1);
  }
}

startServer();
