/* ── Robust Preloader Logic ── */
(function() {
  // 1. Inject CSS immediately. Use !important to override everything.
  const style = document.createElement("style");
  style.id = "preloader-css";
  style.innerHTML = `
    #initial-preloader {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: #000; display: flex; align-items: center; justify-content: center;
      z-index: 2147483647; transition: opacity 0.5s ease;
      overflow: hidden; pointer-events: all;
    }
    #initial-preloader.fade-out { opacity: 0 !important; pointer-events: none !important; }
    
    .cyber-orbital-scene { position: relative; width: 100px; height: 100px; display: flex; align-items: center; justify-content: center; }
    .orbital-ring { position: absolute; border-radius: 50%; border: 2px solid transparent; animation: plOrbit linear infinite; }
    .ring-1 { width: 90px; height: 90px; border-top-color: #3b82f6; border-bottom-color: #3b82f6; animation-duration: 2s; }
    .ring-2 { width: 65px; height: 65px; border-left-color: #6366f1; border-right-color: #6366f1; animation-duration: 1.5s; animation-direction: reverse; }
    .ring-3 { width: 45px; height: 45px; border-top-color: #fff; border-left-color: #fff; animation-duration: 1s; }
    .orbital-core { width: 10px; height: 10px; background: #fff; border-radius: 50%; box-shadow: 0 0 15px #fff, 0 0 30px #3b82f6; }
    .orbital-text { 
      position: absolute; bottom: -35px; left: 50%; transform: translateX(-50%); 
      color: #3b82f6; font-family: sans-serif; font-size: 9px; font-weight: 800; 
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

  // Trigger: Window fully loaded
  window.addEventListener('load', () => setTimeout(dismiss, 100));
  
  // Trigger: DOM ready (usually faster)
  document.addEventListener('DOMContentLoaded', () => setTimeout(dismiss, 1000));
  
  // Trigger: Immediate failsafe (3 seconds)
  setTimeout(dismiss, 3000);

  // Trigger: If tab becomes visible (handles some mobile backgrounding issues)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') dismiss();
  });

  // 5. Minimal Navigation Interceptor (Safer for mobile)
  document.addEventListener('click', function(e) {
    let a = e.target;
    while (a && a.tagName !== 'A') a = a.parentNode;
    
    if (a && a.href && a.target !== '_blank' && 
        a.href.indexOf(window.location.origin) === 0 && 
        a.href.indexOf('#') === -1 && !e.metaKey && !e.ctrlKey) {
      
      if (a.getAttribute('onclick') || a.href.indexOf('javascript:') !== -1) return;

      // Only intercept if the user has been on the page for at least 500ms
      // (Prevents mis-clicks during initial load)
      
      const exitLoader = preloader.cloneNode(true);
      exitLoader.style.opacity = '1';
      document.body.appendChild(exitLoader);
      
      // Delay navigation slightly to let the loader show
      e.preventDefault();
      setTimeout(() => { window.location.href = a.href; }, 100);
      
      // Failsafe for exit loader
      setTimeout(() => { if (exitLoader.parentNode) exitLoader.remove(); }, 2500);
    }
  }, true);
})();
