const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const config = require("../../config/config");
const { getPage, getRoster } = require("./ladderClient");

test("Ladder API error codes produce actionable Danish messages without leaking upstream errors", async (t) => {
  const original = config.contentApi;
  config.contentApi = { baseUrl: "https://api.example.invalid", apiKey: "private-key" };
  t.after(() => { config.contentApi = original; });
  for (const [code, expected] of [
    ["ladder_credentials_missing", /ikke konfigureret korrekt.*administrator/],
    ["ladder_login_failed", /afviste login.*administrator/],
    ["ladder_session_rejected", /afviste sessionen.*administrator/],
    ["ladder_upstream_timeout", /svarede ikke i tide/],
    ["ladder_upstream_unavailable", /kunne ikke hentes/],
    ["ladder_error", /kunne ikke hentes/],
  ]) {
    await t.test(code, async (t) => {
      t.mock.method(axios, "get", async () => {
        throw Object.assign(new Error("private request details"), {
          response: { status: 502, data: JSON.stringify({ code, error: "private upstream body" }) },
        });
      });
      await assert.rejects(getPage("/team/n/91"), (error) => {
        assert.equal(error.code, code);
        assert.match(error.userMessage, expected);
        assert.doesNotMatch(`${error.message} ${error.userMessage}`, /private/);
        return true;
      });
    });
  }
});

test("Ladder client accepts decoded errors and retains status, timeout and connection fallbacks", async (t) => {
  const original = config.contentApi;
  config.contentApi = { baseUrl: "https://api.example.invalid", apiKey: "test" };
  t.after(() => { config.contentApi = original; });
  for (const [failure, expected] of [
    [{ response: { status: 502, data: { code: "ladder_login_failed" } } }, /afviste login/],
    [{ response: { status: 502, data: '{"error":"Legacy API error"}' } }, /API svarede 502/],
    [{ response: { status: 502, data: "<html>Bad gateway</html>" } }, /API svarede 502/],
    [{ response: { status: 502, data: '{"code":"constructor"}' } }, /API svarede 502/],
    [{ response: { status: 502, data: '{"code":"__proto__"}' } }, /API svarede 502/],
    [{ response: { status: 401, data: "null" } }, /API svarede 401/],
    [{ code: "ECONNABORTED" }, /API svarede ikke i tide/],
    [{ code: "ENOTFOUND" }, /ingen forbindelse til API/],
  ]) {
    await t.test(String(expected), async (t) => {
      t.mock.method(axios, "get", async () => { throw Object.assign(new Error("private"), failure); });
      await assert.rejects(getPage("/team/n/91"), (error) => {
        assert.match(error.userMessage, expected);
        assert.doesNotMatch(error.message, /private/);
        return true;
      });
    });
  }
});

test("authentication failures during profile reads are reported as login failures, not missing rider identities", async () => {
  const html = require("node:fs").readFileSync(`${__dirname}/fixtures/roster-11.html`, "utf8");
  const failure = Object.assign(new Error("Ladder afviste login"), { code: "ladder_login_failed" });
  await assert.rejects(getRoster({ id: "501" }, {
    fetchPage: async (path) => {
      if (path === "/team/n/501") return html;
      throw failure;
    },
  }), (error) => error === failure);
});
