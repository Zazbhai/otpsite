(() => {
  const form = document.getElementById("webhook-form");
  if (!form) return;
  const input = document.getElementById("webhook-url");
  const save = document.getElementById("webhook-save");
  const test = document.getElementById("webhook-test");
  const status = document.getElementById("webhook-status");
  const endpoint = "/api/user/profile/webhook";
  let savedUrl = "";
  let busy = true;

  function updateControls() {
    input.disabled = save.disabled = busy;
    test.disabled = busy || !savedUrl || input.value.trim() !== savedUrl;
  }

  async function run(work) {
    busy = true;
    updateControls();
    try {
      status.textContent = await work();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      updateControls();
    }
  }

  input.addEventListener("input", updateControls);
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (busy) return;
    run(async () => {
      const settings = await API.put(endpoint, { url: input.value.trim() });
      input.value = savedUrl = settings.url;
      return savedUrl ? "Callback URL saved." : "Webhook delivery disabled.";
    });
  });
  test.addEventListener("click", () => {
    if (test.disabled) return;
    status.textContent = "Sending sample…";
    run(async () => {
      const result = await API.post(endpoint + "/test", {});
      return `Test delivered (HTTP ${result.status}).`;
    });
  });
  document.getElementById("webhook-copy").addEventListener("click", event => {
    window.copyToClipboard(document.getElementById("webhook-example").textContent, event.currentTarget, "Sample payload copied.");
  });
  run(async () => {
    const settings = await API.get(endpoint);
    input.value = savedUrl = settings.url;
    return "";
  });
})();
