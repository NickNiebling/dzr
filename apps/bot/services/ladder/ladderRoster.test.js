const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseRosterPage, parseProfileIdentity } = require("./ladderRoster");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const home = fixture("roster-11.html");
const away = fixture("roster-10.html");
const expected = JSON.parse(fixture("roster-counts.json"));

test("verified anonymised examples preserve their complete current membership", () => {
  for (const [file, count] of Object.entries(expected)) {
    const roster = parseRosterPage(fixture(file));
    assert.equal(roster.riders.length, count);
    assert.equal(roster.expectedCount, count);
    assert.deepEqual(roster.nextPaths, []);
    assert.equal(roster.riders[0].zwiftId, null, "internal Ladder ids do not establish Zwift identity");
  }
  const roster = parseRosterPage(home);
  assert.equal(roster.id, 501);
  assert.equal(roster.name, "Example Home");
  assert.deepEqual(roster.riders[0], {
    name: "Rider 01", profileId: 50100, zwiftId: null,
    wkg: { 5: 10.01, 60: 6.01, 300: 4.51, 1200: 4.01 },
  });
  assert.equal(parseRosterPage(away).id, 502);
});

test("captains, historical participants and commented mobile cards are excluded", () => {
  const html = home.replace('<table class="table-sm', '<!-- <table class="newPowerTable"><tbody><tr><td>Former rider</td></tr></tbody></table> --><table class="table-sm');
  const roster = parseRosterPage(html);
  assert.equal(roster.riders.length, 11);
  assert.equal(roster.riders.some((rider) => rider.profileId === 999999 || rider.profileId === 999998), false);
});

test("missing identity and power retain the member", () => {
  const html = home.replace("data-goto=/profile/50100", "")
    .replace(/(<td\s+class="d-none text-center p-0 m-0"\s+data-format="wkg"\s+data-time="90"\s+data-power-time="5"[^>]*>)\s*10.01/, "$1 0");
  const roster = parseRosterPage(html);
  assert.equal(roster.riders.length, 11);
  assert.equal(roster.riders[0].profileId, null);
  assert.equal(roster.riders[0].wkg[5], null);
});

test("90-day power is read independently of attribute order and other periods", () => {
  const html = home.replace('data-format="wkg"\ndata-time="90"\ndata-power-time="5"', 'data-power-time="5" data-time="90" data-format="wkg"')
    .replace("10.01\n</td>", '10.01\n</td><td data-format="wkg" data-time="30" data-power-time="5">99</td>');
  assert.equal(parseRosterPage(html).riders[0].wkg[5], 10.01);
});

test("duplicate rows are retained until explicit identity deduplication", () => {
  const row = home.match(/<tr data-rider-id="50100"[\s\S]*?<\/tr>/)[0];
  const roster = parseRosterPage(home.replace("</tbody>", `${row}</tbody>`));
  assert.equal(roster.riders.length, 12);
  assert.equal(roster.riders.filter((rider) => rider.profileId === 50100).length, 2);
});

test("missing rows and unexpected members fail completeness verification", () => {
  const truncated = home.replace(/<tr data-rider-id="50100"[\s\S]*?<\/tr>/, "");
  assert.throws(() => parseRosterPage(truncated), /stemmer ikke overens/);
  assert.throws(() => parseRosterPage(home.replace('data-goto=/profile/50100', 'data-goto=/profile/123').replace('data-rider-id="50100"', 'data-rider-id="123"')), /stemmer ikke overens/);
});

test("same-name members without profile links each require a distinct row", () => {
  const sameName = home.replaceAll("Rider 02", "Rider 01")
    .replace("data-goto=/profile/50100", "")
    .replace("data-goto=/profile/50101", "");
  const complete = parseRosterPage(sameName);
  assert.equal(complete.riders.length, 11);
  assert.equal(complete.riders.filter((rider) => rider.name === "Rider 01" && !rider.profileId).length, 2);
  const truncated = sameName.replace(/<tr data-rider-id="50101"[\s\S]*?<\/tr>/, "");
  assert.throws(() => parseRosterPage(truncated), /stemmer ikke overens/);
  const unknownRow = sameName.match(/<tr data-rider-id="50100"[\s\S]*?<\/tr>/)[0];
  assert.throws(() => parseRosterPage(sameName.replace("</tbody>", `${unknownRow}</tbody>`)), /stemmer ikke overens/);
});

test("known profile matches are consumed before same-name missing identities", () => {
  const sameName = home.replaceAll("Rider 02", "Rider 01")
    .replace("data-goto=/profile/50100", "");
  const roster = parseRosterPage(sameName);
  assert.equal(roster.riders.length, 11);
  assert.equal(roster.riders[0].profileId, null);
  assert.equal(roster.riders[1].profileId, 50101);
  assert.throws(() => parseRosterPage(sameName.replace(/<tr data-rider-id="50100"[\s\S]*?<\/tr>/, "")), /stemmer ikke overens/);
});

test("current membership cannot include another team's former member", () => {
  const html = home.replace('"LadderTeam":501', '"LadderTeam":777');
  assert.throws(() => parseRosterPage(html), /nuværende medlemmer/);
});

test("unknown pagination or lazy loading fails with a concrete completeness error", () => {
  for (const marker of [
    '<a rel="next" href="/team/n/501?page=2">Next</a>',
    '<nav class="pagination"><a>2</a></nav>',
    '<button data-action="loadMore">More members</button>',
    '<script>const serverSide = true;</script>',
  ]) {
    assert.throws(() => parseRosterPage(home.replace("</tbody></table>", `</tbody></table>${marker}`)), /pagineret eller indlæses i flere dele/);
  }
});

test("unknown, empty or malformed roster formats fail instead of returning partial membership", () => {
  assert.throws(() => parseRosterPage("<html><title>Login</title></html>"), /ukendt rosterformat/);
  assert.throws(() => parseRosterPage(home.replace('id="pane-roster"', 'id="pane-unknown"')), /roster-sektion mangler/);
  assert.throws(() => parseRosterPage(home.replace("Ladder.roster = ", "Ladder.other = ")), /indlejrede medlemsliste mangler/);
  assert.throws(() => parseRosterPage(home.replace(/Ladder\.roster = \[[\s\S]*?\];/, "Ladder.roster = [broken];")), /ugyldig eller afkortet/);
  assert.throws(() => parseRosterPage(home.replace(/Ladder\.roster = \[[\s\S]*?\];/, "Ladder.roster = [];")), /ingen medlemmer/);
  assert.throws(() => parseRosterPage(home.replace('data-rider-id="50100"', 'data-rider-id="123"')), /modstridende profil-id/);
});

test("quoted brackets in names do not truncate the embedded JSON", () => {
  const html = home.replace('>Rider 01</div>', '>Rider &amp; &quot;[01]&quot;</div>')
    .replace('"ZPName":"Rider 01"', '"ZPName":"Rider & \\"[01]\\""');
  assert.equal(parseRosterPage(html).riders[0].name, 'Rider & "[01]"');
});

test("profile identity comes from the verified explicit external link", () => {
  assert.equal(parseProfileIdentity(fixture("profile-identity.html")), 50100);
  assert.equal(parseProfileIdentity('<a href="https://www.zwiftpower.com/profile.php?foo=1&amp;z=42">ZP</a>'), 42);
  assert.equal(parseProfileIdentity("<a href='https://my.zwift.com/profile/42'>Zwift</a>"), 42);
  assert.equal(parseProfileIdentity('<a href="https://www.zwift.com/athlete/42">Zwift</a>'), 42);
});

test("missing numeric identity does not guess from internal links or UUIDs", () => {
  for (const html of [
    '<a href="/profile/42">Ladder</a>',
    '<a href="https://www.zwift.com/athlete/00000000-0000-4000-8000-000000000001">Zwift</a>',
    '<a href="https://zwiftpower.com.evil.example/profile.php?z=42">Fake</a>',
    '<!-- <a href="https://zwiftpower.com/profile.php?z=42">Old</a> -->',
    '<script>const rider = {id:42};</script>',
  ]) assert.equal(parseProfileIdentity(html), null);
});

test("conflicting explicit numeric links fail rather than choosing one", () => {
  assert.throws(() => parseProfileIdentity('<a href="https://zwiftpower.com/profile.php?z=42">ZP</a><a href="https://my.zwift.com/profile/43">Zwift</a>'), /modstridende eksplicitte Zwift-id/);
  assert.equal(parseProfileIdentity('<a href="https://zwiftpower.com/profile.php?z=42">ZP</a><a href="https://my.zwift.com/profile/42">Zwift</a>'), 42);
});
