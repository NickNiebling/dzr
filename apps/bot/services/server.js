const Sentry = require("@sentry/node");
const express = require("express");
const axios = require("axios");
const config = require("../config/config");
const { createStreamingRouter } = require("./streaming/router");

function createHttpApp({ streaming } = {}) {
  const app = express();
  // Render terminates HTTPS and forwards through one trusted proxy hop.
  app.set("trust proxy", 1);
  app.get("/", (req, res) => res.send("Bot is running!"));
  if (streaming) app.use("/streaming", createStreamingRouter(streaming));
  Sentry.setupExpressErrorHandler(app);
  return app;
}

function setupKeepAliveServer(options = {}) {
  const app = createHttpApp(options);
  app.listen(config.server.port, "0.0.0.0", () =>
    console.log(`Bot HTTP server running on port ${config.server.port}`)
  );

  // Keep-Alive Ping
  setInterval(async () => {
    try {
      await axios.get(config.server.keepAliveUrl);
      console.log("✅ Keep-alive ping sent to prevent sleeping.");
    } catch (error) {
      console.error("❌ Keep-alive ping failed:", error);
    }
  }, config.server.keepAliveInterval);
}

module.exports = {
  createHttpApp,
  setupKeepAliveServer,
};
