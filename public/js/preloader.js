/* ── Ultra-Smooth, Zero-Lag Modern Glass Preloader ── */
(function() {
  // 0. Immediate Theme Apply
  try {
    const savedTheme = localStorage.getItem('otp_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    if (savedTheme === 'light') document.documentElement.className = 'light';
  } catch(e) {}

  // 1. Inject Lightweight, High-Performance GPU-Only CSS
  const style = document.createElement("style");
  style.id = "preloader-css";
  style.innerHTML = `
    #initial-preloader {
      position: fixed;
      top: 0; left: 0; width: 100%; height: 100%;
      background: var(--surface, #f8f9ff);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2147483647;
      transition: opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.35s;
      will-change: opacity;
    }
    html[data-theme="dark"] #initial-preloader,
    :root[data-theme="dark"] #initial-preloader {
      background: #050b14;
    }
    #initial-preloader.fade-out {
      opacity: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }

    .loader-orb-wrapper {
      position: relative;
      width: 90px;
      height: 90px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Outer Spinning Gradient Ring */
    .loader-ring-outer {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 3px solid transparent;
      border-top-color: var(--primary, #1050d4);
      border-right-color: var(--secondary-container, #00c1fd);
      animation: spin-smooth 1s linear infinite;
      will-change: transform;
    }

    /* Inner Reverse Spinning Accent Ring */
    .loader-ring-inner {
      position: absolute;
      inset: 12px;
      border-radius: 50%;
      border: 3px solid transparent;
      border-bottom-color: var(--success, #10b981);
      border-left-color: var(--primary, #1050d4);
      opacity: 0.8;
      animation: spin-reverse 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      will-change: transform;
    }

    /* Center Breathing Core Mark */
    .loader-core-icon {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(16, 80, 212, 0.15), rgba(0, 193, 253, 0.15));
      border: 1px solid rgba(16, 80, 212, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 4px 16px rgba(16, 80, 212, 0.15);
      animation: pulse-core 2s ease-in-out infinite;
      will-change: transform;
    }

    @keyframes spin-smooth {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    @keyframes spin-reverse {
      0% { transform: rotate(360deg); }
      100% { transform: rotate(0deg); }
    }

    @keyframes pulse-core {
      0%, 100% { transform: scale(0.94); opacity: 0.9; }
      50% { transform: scale(1.06); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  // 2. Create Loader DOM
  const preloader = document.createElement("div");
  preloader.id = "initial-preloader";
  preloader.innerHTML = `
    <div class="loader-orb-wrapper">
      <div class="loader-ring-outer"></div>
      <div class="loader-ring-inner"></div>
      <div class="loader-core-icon">⚡</div>
    </div>
  `;

  // 3. Insertion
  function inject() {
    if (document.body) {
      document.body.appendChild(preloader);
    } else {
      setTimeout(inject, 5);
    }
  }
  inject();

  // 4. Dismissal logic
  let dismissed = false;

  window.showPageLoader = function() {
    dismissed = false;
    preloader.classList.remove("fade-out");
    if (!preloader.parentNode && document.body) {
      document.body.appendChild(preloader);
    }
  };

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    preloader.classList.add("fade-out");
    setTimeout(() => {
      if (preloader.parentNode && dismissed) preloader.remove();
    }, 350);
  }

  window.hidePageLoader = function() {
    dismiss();
  };

  // 5. Initial Trigger: Only hide once EVERYTHING on the page (images, fonts, stylesheets, scripts) has fully loaded
  const handleFullLoad = () => {
    // Add a short buffer after window.load so final layout calculations and API renders finish cleanly
    setTimeout(dismiss, 350);
  };

  if (document.readyState === 'complete') {
    handleFullLoad();
  } else {
    window.addEventListener('load', handleFullLoad);
  }

  // High failsafe (15s) in case of extreme network latency or blocked external scripts
  setTimeout(dismiss, 15000);
})();
