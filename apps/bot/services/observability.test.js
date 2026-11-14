const { test } = require("node:test");
const assert = require("node:assert/strict");

// Start disabled; replace the transport before emitting any test events.
process.env.SENTRY_DSN = "";
const Sentry = require("../instrument");

test("bot captures existing error logs and Express failures without network delivery", async () => {
  const events = [];
  const options = Sentry.getClient().getOptions();
  assert.equal(options.enabled, false);
  await Sentry.close();
  Sentry.init({
    ...options,
    dsn: "https://public@example.invalid/1",
    enabled: true,
    transport: () => ({
      send(envelope) {
        for (const [headers, payload] of envelope[1]) {
          if (headers.type === "event") events.push(payload);
        }
        return Promise.resolve({ statusCode: 200 });
      },
      flush: () => Promise.resolve(true),
    }),
  });
  const express = require("express");
  const app = express();
  app.get("/failure", () => { throw new Error("test Express failure"); });
  Sentry.setupExpressErrorHandler(app);
  app.use((error, req, res, next) => res.status(500).end());
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    console.error("test handled error", new Error("test logged failure"), { Authorization: "Bearer fake-console-token", access_token: "fake-console-token" });
    console.warn("test warning should stay local");
    const response = await fetch(`http://127.0.0.1:${server.address().port}/failure?secret=private-query`, { headers: { Authorization: "Bearer private-token" } });
    assert.equal(response.status, 500);
    await Sentry.flush(2000);
    assert.equal(events.length, 2);
    assert.ok(events.every(event => !event.extra?.arguments));
    assert.ok(!JSON.stringify(events.map(event => event.request)).includes("private-query"));
    assert.ok(!JSON.stringify(events.map(event => event.request)).includes("private-token"));
    assert.ok(events.some(event => event.exception?.values?.some(value => value.value === "test Express failure")));
    assert.ok(events.some(event => event.exception?.values?.some(value => value.value === "test logged failure")));
    assert.ok(events.every(event => event.tags.service === "bot"));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await Sentry.close(2000);
  }
});
