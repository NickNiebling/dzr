const test = require("node:test");
const assert = require("node:assert/strict");

const { readWebPage, htmlToText, zwiftEventLinks, isPrivateAddress, checkUrl } = require("./webPage");

const publicLookup = async () => [{ address: "93.184.216.34" }];

test("refuses private, local and non-https targets", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  assert.equal(isPrivateAddress("93.184.216.34"), false);
  assert.equal((await checkUrl("http://example.com", { lookup: publicLookup })).ok, false);
  assert.equal((await checkUrl("https://localhost/x", { lookup: publicLookup })).ok, false);
  assert.equal((await checkUrl("https://169.254.169.254/latest")).ok, false);
  assert.equal((await checkUrl("https://internal.example", { lookup: async () => [{ address: "10.0.0.5" }] })).ok, false);
  assert.equal((await checkUrl("https://example.com/cal", { lookup: publicLookup })).ok, true);
});

test("turns HTML into text and absolute links, without scripts", () => {
  const page = htmlToText(
    `<html><head><title>Kalender &amp; løb</title><script>var x = "hidden";</script></head>
     <body><h1>E-Serien</h1><table><tr><td>22/10</td><td><a href="/events/view/123">DZR løbet</a></td></tr></table></body></html>`,
    "https://www.zwift.com/da/"
  );
  assert.equal(page.title, "Kalender & løb");
  assert.match(page.text, /22\/10 \| DZR løbet/);
  assert.doesNotMatch(page.text, /hidden/);
  assert.deepEqual(page.links, [{ href: "https://www.zwift.com/events/view/123", label: "DZR løbet" }]);
});

test("collects Zwift event links once each, from links and text", () => {
  const found = zwiftEventLinks(
    [{ href: "https://www.zwift.com/eu-de/events/tag/dcu/view/2539801", label: "Løb 1" }, { href: "https://zwift.com/events/view/2539801", label: "dup" }], // zwift-link-check: allow-input
    "Tilmeld: https://www.zwift.com/events/view/2539786"
  );
  assert.deepEqual(found, [{ event_id: "2539801", label: "Løb 1" }, { event_id: "2539786", label: null }]);
});

test("follows a redirect only after checking where it goes", async () => {
  const calls = [];
  const http = {
    get: async (url) => {
      calls.push(url);
      if (url === "https://example.com/a") return { status: 302, headers: { location: "https://10.0.0.1/secret" } };
      return { status: 200, headers: { "content-type": "text/html" }, data: "<p>never</p>" };
    },
  };
  const result = await readWebPage("https://example.com/a", { http, lookup: publicLookup });
  assert.equal(result.success, false);
  assert.deepEqual(calls, ["https://example.com/a"]);
});

test("flags a page that is almost empty without JavaScript", async () => {
  const http = { get: async () => ({ status: 200, headers: { "content-type": "text/html" }, data: "<div id=root></div>" }) };
  const result = await readWebPage("https://example.com/cal", { http, lookup: publicLookup });
  assert.match(result.note, /JavaScript/);
});
