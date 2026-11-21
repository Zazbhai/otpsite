(function () {
  // One stream and refresh queue per page, with a fallback for missed events.
  window.subscribeAdminUpdates = function (refresh) {
    let stopped = false;
    let dirty = false;
    let running = false;
    let timer = null;
    let lastRefresh = 0;
    let stream = null;

    function schedule() {
      if (stopped || timer || running || !dirty) return;
      timer = setTimeout(run, Math.max(300, 3000 - (Date.now() - lastRefresh)));
    }
    function requestRefresh() { dirty = true; schedule(); }
    async function run() {
      timer = null;
      if (stopped) return;
      // Do not replace content while the admin is editing or viewing a modal.
      if (document.visibilityState === "hidden" || document.querySelector(".modal-backdrop.open")) {
        timer = setTimeout(run, 1000);
        return;
      }
      dirty = false;
      running = true;
      lastRefresh = Date.now();
      try { await refresh(); }
      catch (err) { console.error("Admin live refresh failed:", err); }
      finally { running = false; schedule(); }
    }
    function connect() {
      if (stopped || stream || typeof EventSource === "undefined") return;
      stream = new EventSource("/api/admin/events");
      stream.addEventListener("connected", requestRefresh);
      stream.addEventListener("change", requestRefresh);
      // EventSource reconnects automatically; connected refreshes missed data.
    }
    connect();
    const fallback = setInterval(requestRefresh, 30000);
    function onVisibility() { if (document.visibilityState === "visible") requestRefresh(); }
    document.addEventListener("visibilitychange", onVisibility);
    function stop() {
      stopped = true;
      clearTimeout(timer);
      clearInterval(fallback);
      stream?.close();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    }
    function onPageHide(e) {
      if (!e.persisted) { stop(); return; }
      stream?.close();
      stream = null;
    }
    function onPageShow(e) { if (e.persisted) { connect(); requestRefresh(); } }
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return stop;
  };
})();
