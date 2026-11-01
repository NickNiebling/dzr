const express = require("express");
const path = require("node:path");
const { StreamingError, hash } = require("./model");

function createStreamingRouter(service, { now = Date.now } = {}) {
  const router = express.Router();
  const attempts = new Map();
  function limited(key, limit) {
    if (attempts.size > 2048) for (const [id, value] of attempts) if (value.until < now()) attempts.delete(id);
    if (attempts.size > 4096) return true;
    const bucket = attempts.get(key);
    if (!bucket || bucket.until < now()) { attempts.set(key, { count: 1, until: now() + 60_000 }); return false; }
    return ++bucket.count > limit;
  }
  router.get("/dzr-stream.lua", (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    res.download(path.join(__dirname, "../../assets/dzr-stream.lua"), "dzr-stream.lua");
  });
  // Both routes share authentication, payload limits and the same rate-limit buckets.
  router.post(["/obs", "/test"], (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (limited(`ip:${req.ip}`, 300)) return res.status(429).json({ error: "rate_limited" });
    const token = /^Bearer (\S{1,120})$/i.exec(req.headers.authorization || "")?.[1];
    if (!token) return res.status(401).json({ error: "invalid_key" });
    if (limited(`key:${hash(token)}`, 12)) return res.status(429).json({ error: "rate_limited" });
    if (!req.is("application/json")) return res.status(415).json({ error: "json_required" });
    res.locals.streamingToken = token;
    next();
  }, express.json({ limit: "2kb", strict: true }), async (req, res) => {
    try { res.status(202).json(await service.callback(res.locals.streamingToken, req.body, req.path === "/test")); }
    catch (error) { res.status(error instanceof StreamingError ? error.status : 503).json({ error: error instanceof StreamingError ? error.code : "temporarily_unavailable" }); }
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.type === "entity.too.large" ? 413 : 400).json({ error: "invalid_json" });
  });
  return router;
}

module.exports = { createStreamingRouter };
