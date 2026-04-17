/* ── Robust Preloader Logic ── */
(function() {
  // 0. Immediate Theme Apply to prevent flicker
  try {
    const savedTheme = localStorage.getItem('theme_pref') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
  } catch(e) {}

  // 1. Inject CSS immediately. Use !important to override everything.
  const style = document.createElement("style");
  style.id = "preloader-css";
  style.innerHTML = `
    #initial-preloader {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: var(--bg-1, #000); display: flex; align-items: center; justify-content: center;
      z-index: 2147483647; transition: opacity 0.5s ease;
      overflow: hidden; pointer-events: all;
    }
    #initial-preloader.fade-out { opacity: 0 !important; pointer-events: none !important; }
    
    .cyber-orbital-scene { position: relative; width: 100px; height: 100px; display: flex; align-items: center; justify-content: center; }
    .orbital-ring { position: absolute; border-radius: 50%; border: 2px solid transparent; animation: plOrbit linear infinite; }
    .ring-1 { width: 90px; height: 90px; border-top-color: var(--accent, #3b82f6); border-bottom-color: var(--accent, #3b82f6); animation-duration: 2s; }
    .ring-2 { width: 65px; height: 65px; border-left-color: var(--accent-2, #6366f1); border-right-color: var(--accent-2, #6366f1); animation-duration: 1.5s; animation-direction: reverse; }
    .ring-3 { width: 45px; height: 45px; border-top-color: var(--text, #fff); border-left-color: var(--text, #fff); animation-duration: 1s; }
    .orbital-core { width: 10px; height: 10px; background: var(--text, #fff); border-radius: 50%; box-shadow: 0 0 15px var(--accent, #3b82f6), 0 0 30px var(--accent, #3b82f6); }
    .orbital-text { 
      position: absolute; bottom: -35px; left: 50%; transform: translateX(-50%); 
      color: var(--accent, #3b82f6); font-family: sans-serif; font-size: 9px; font-weight: 800; 
      letter-spacing: 3px; text-transform: uppercase; white-space: nowrap; 
    }

    @keyframes plOrbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);

  // 2. Create Loader Element
  const preloader = document.createElement("div");
  preloader.id = "initial-preloader";
  preloader.innerHTML = `
    <div class="cyber-orbital-scene">
      <div class="orbital-ring ring-1"></div><div class="orbital-ring ring-2"></div><div class="orbital-ring ring-3"></div>
      <div class="orbital-core"></div><div class="orbital-text">LOADING</div>
    </div>
  `;

  // 3. Robust Insertion
  function inject() {
    if (document.body) {
      document.body.appendChild(preloader);
    } else if (document.documentElement) {
      document.documentElement.appendChild(preloader);
    } else {
      setTimeout(inject, 5);
    }
  }
  inject();

  // 4. Multiple Dismissal Failsafes
  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    preloader.classList.add("fade-out");
    setTimeout(() => { if (preloader.parentNode) preloader.remove(); }, 600);
  }

  // Trigger: Window ready
  if (document.readyState === 'complete') {
    dismiss();
  } else {
    window.addEventListener('load', dismiss);
    document.addEventListener('DOMContentLoaded', dismiss);
  }
  
  // High-speed failsafe (1.5s)
  setTimeout(dismiss, 1500);

  // Trigger: If tab becomes visible 
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') dismiss();
  });
})();
