// Keep PM2 output limited to webhook/callback messages at every log level.
// Install before loading the application and its dependencies.
function installTerminalLogging(target = console) {
  for (const method of ["log", "info", "debug", "warn", "error"]) {
    const original = target[method].bind(target);
    target[method] = (...args) => {
      if (typeof args[0] === "string" && /^\[[^\]]*(?:webhook|callback)[^\]]*\]/i.test(args[0])) original(...args);
    };
  }
  // The database logger still records other warnings/errors in app.log.
}

module.exports = { installTerminalLogging };
