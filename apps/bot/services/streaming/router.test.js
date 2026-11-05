const test = require("node:test");
const assert = require("node:assert/strict");
const { createHttpApp } = require("../server");
const { StreamingError } = require("./model");

async function server(t, service) {
  const app = createHttpApp({ streaming: service });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => listener.once("listening", resolve));
  t.after(() => new Promise((resolve) => listener.close(resolve)));
  return `http://127.0.0.1:${listener.address().port}/streaming`;
}

test("both HTTP endpoints share authentication, JSON limits and per-key throttling", async (t) => {
  for (const route of ["obs", "test"]) {
    const calls = [];
    const url = await server(t, { async callback(token, body, testOnly) {
      calls.push(testOnly); assert.equal(token, "test-key"); return { accepted: true };
    } });
    const post = (headers, body = "{}", endpoint = route) => fetch(`${url}/${endpoint}`, { method: "POST", headers, body });
    assert.equal((await post({ "Content-Type": "application/json" })).status, 401);
    assert.equal((await post({ Authorization: "Bearer test-key" })).status, 415);
    const headers = { Authorization: "Bearer test-key", "Content-Type": "application/json" };
    assert.equal((await post(headers, "{broken")).status, 400);
    assert.equal((await post(headers, JSON.stringify({ extra: "x".repeat(3000) }))).status, 413);
    const valid = await post(headers);
    assert.equal(valid.status, 202);
    assert.equal(valid.headers.get("cache-control"), "no-store");
    assert.deepEqual(calls, [route === "test"]);
    for (let i = 0; i < 12; i++) await post(headers, "{}", i % 2 ? "obs" : "test");
    for (const endpoint of ["obs", "test"]) assert.equal((await post(headers, "{}", endpoint)).status, 429);
  }
});

test("revoked key responses are generic, and Lua download contains no personal credentials", async (t) => {
  const url = await server(t, { async callback(token) {
    if (token === "revoked") throw new StreamingError("invalid_key", "private detail", 401);
    throw new Error("private storage detail");
  } });
  for (const route of ["obs", "test"]) {
    for (const [token, status, error] of [["revoked", 401, "invalid_key"], ["valid", 503, "temporarily_unavailable"]]) {
      const response = await fetch(`${url}/${route}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error });
    }
  }
  const download = await fetch(`${url}/dzr-stream.lua`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /attachment.*dzr-stream.lua/);
  const script = await download.text();
  assert.match(script, /OBS_FRONTEND_EVENT_STREAMING_STARTED/);
  assert.ok(!script.includes("os.execute"));
});

test("Render proxy rate limit separates clients and ignores a spoofed leftmost forwarded address", async (t) => {
  const url = await server(t, { async callback() { return { accepted: true }; } });
  const post = (key, forwarded) => fetch(`${url}/obs`, { method: "POST", headers: {
    Authorization: `Bearer key-${key}`, "Content-Type": "application/json", "X-Forwarded-For": forwarded,
  }, body: "{}" });
  for (let i = 0; i < 300; i++) assert.equal((await post(i, `192.0.2.${i % 250}, 198.51.100.1`)).status, 202);
  assert.equal((await post("spoof", "203.0.113.77, 198.51.100.1")).status, 429);
  assert.equal((await post("other", "198.51.100.2")).status, 202);
});
