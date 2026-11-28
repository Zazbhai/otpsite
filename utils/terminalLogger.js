// Keep PM2 output focused on webhook deliveries and operational failures.
// Install before loading the application and its dependencies.
function installTerminalLogging(target = console) {
  for (const method of ["log", "info", "debug"]) {
    const original = target[method].bind(target);
    target[method] = (...args) => {
      if (typeof args[0] === "string" && /^\[[^\]]*(?:webhook|callback)[^\]]*\]/i.test(args[0])) original(...args);
    };
  }
  // Warnings/errors remain visible, including database and provider failures.
}

module.exports = { installTerminalLogging };
