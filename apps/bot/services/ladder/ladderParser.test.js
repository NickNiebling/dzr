const test = require("node:test");
const assert = require("node:assert/strict");
const { parseFixtureList, parseFixture, parseRosterPage, parseProfileIdentity } = require("./ladderParser");
const fs = require("node:fs");
const path = require("node:path");

test("parseFixtureList reads id, teams and route from a fixture row", () => {
  const html = `<table><tr class="x" data-id="17200"><td>
    <span class="teamOpener a" data-team-id="1">Mad Dogs (DBR)</span>
    <span class="teamOpener b" data-team-id="2">Chonky Chaser</span>
    <span class="route-detail"> Croissant </span></td></tr></table>`;
  assert.deepEqual(parseFixtureList(html), [{ id: "17200", home: "Mad Dogs (DBR)", away: "Chonky Chaser", route: "Croissant" }]);
});

test("parseFixture reads start, laps, fixed distance and signups with Zwift ids", () => {
  const html = `<script>let forTime = '2026-10-05T17:30:00Z'; let routeId = 99; let laps = 2; let distance = 15000;</script>
    <section class="homeTeamSignins"><h2 class="px-2">Home</h2><table><tr>
      <td data-goto=/profile/42 class="c"><div class="sticky-truncate">Rider [DZR]</div></td>
      <td data-format="wkg" data-time="90" data-power-time="300">4.5</td>
      <td data-format="wkg" data-time="90" data-power-time="1200">0</td>
    </tr></table></section>
    <section class="awayTeamSignins"><h2 class="px-2">Away</h2></section>`;
  const fixture = parseFixture(html);
  assert.equal(fixture.start, "2026-10-05T17:30:00Z");
  assert.equal(fixture.laps, 2);
  assert.equal(fixture.distance, 15000);
  assert.equal(fixture.home.name, "Home");
  assert.equal(fixture.home.riders.length, 1);
  const rider = fixture.home.riders[0];
  assert.equal(rider.zwiftId, 42);
  assert.equal(rider.wkg[300], 4.5);
  assert.equal(rider.wkg[1200], null);
  assert.deepEqual(fixture.away.riders, []);
  assert.deepEqual(fixture.powerupIds, []);
  assert.deepEqual(fixture.powerups, []);
});

test("parseFixture reads the powerup bag and arch overrides from the event tags", () => {
  const html = `<script>
    const tags = ["powerup_percent=\\"0,40,1,30,5,30\\"","arch_powerup=\\"0,3,4,5\\""];
    const fixturePU1 = 'feather';
    const fixturePU2 = 'aero';
  </script>`;
  const fixture = parseFixture(html);
  assert.deepEqual(fixture.powerupIds, [0, 1, 5]);
  assert.deepEqual(fixture.powerups, ["Feather", "Draft", "Aero"]);
  assert.deepEqual(fixture.archPowerups, { 0: 3, 4: 5 });
});

test("parseFixture keeps the named powerups when the bag is missing", () => {
  const html = `<script>const fixturePU1 = 'feather'; const fixturePU2 = 'aero';</script>`;
  const fixture = parseFixture(html);
  assert.deepEqual(fixture.powerupIds, []);
  assert.deepEqual(fixture.powerups, ["feather", "aero"]);
});

test("parseFixture reads the Zwift event id from the hidden field or the sign-in link button", () => {
  const field = `<input type="hidden" name="zwiftEventId" id="fixture_zid" value="5729795" />`;
  assert.equal(parseFixture(field).zwiftEventId, "5729795");
  assert.equal(parseFixture("<a>Sign-in link (event 5748317)</a>").zwiftEventId, "5748317");
  assert.equal(parseFixture(`<input name="zwiftEventId" value="">`).zwiftEventId, null);
});

// Authenticated examples had 11/10 current members and 21 matching external profile links.
const rosterExample = (count) => fs.readFileSync(path.join(__dirname, "fixtures", `roster-${count}.html`), "utf8");

test("current roster examples retain all 11/10 members and 90-day power", () => {
  for (const count of [11, 10]) {
    const roster = parseRosterPage(rosterExample(count));
    assert.equal(roster.riders.length, count);
    assert.equal(roster.riders[0].wkg[300], 4.51);
    assert.equal(roster.riders[0].zwiftId, null);
  }
  const html = rosterExample(11);
  const row = html.match(/<tr data-rider-id="50100"[\s\S]*?<\/tr>/)[0];
  assert.equal(parseRosterPage(html.replace("</tbody>", `${row}</tbody>`)).riders.length, 12);
});

test("roster completeness rejects truncation, pagination and same-name missing members", () => {
  const html = rosterExample(11);
  const withoutFirst = (source) => source.replace(/<tr data-rider-id="50100"[\s\S]*?<\/tr>/, "");
  assert.throws(() => parseRosterPage(withoutFirst(html)), /stemmer ikke overens/);
  assert.throws(() => parseRosterPage(html.replace("</table>", '</table><a rel="next" href="?page=2">Next</a>')), /pagineret/);
  assert.throws(() => parseRosterPage(html.replace('"LadderTeam":501', '"LadderTeam":999')), /nuværende medlemmer/);
  assert.throws(() => parseRosterPage("<title>Unknown</title>"), /ukendt rosterformat/);
  const sameName = html.replaceAll("Rider 02", "Rider 01")
    .replace("data-goto=/profile/50100", "").replace("data-goto=/profile/50101", "");
  assert.equal(parseRosterPage(sameName).riders.filter((rider) => !rider.profileId).length, 2);
  assert.throws(() => parseRosterPage(withoutFirst(sameName)), /stemmer ikke overens/);
});

test("explicit profile links establish identity; missing identity or power retains the member", () => {
  assert.equal(parseProfileIdentity('<a href="https://zwiftpower.com/profile.php?z=42">ZP</a>'), 42);
  assert.equal(parseProfileIdentity('<a href="https://www.zwift.com/athlete/42">Zwift</a>'), 42);
  for (const href of ["/profile/42", "https://zwiftpower.com.evil.example/profile.php?z=42", "https://www.zwift.com/athlete/00000000-0000-4000-8000-000000000001"])
    assert.equal(parseProfileIdentity(`<a href="${href}">Profile</a>`), null);
  assert.throws(() => parseProfileIdentity('<a href="https://zwiftpower.com/profile.php?z=42">ZP</a><a href="https://www.zwift.com/athlete/43">Zwift</a>'), /modstridende/);
  const roster = parseRosterPage(rosterExample(11).replace("data-goto=/profile/50100", "").replace(">4.51</td>", ">0</td>"));
  assert.equal(roster.riders.length, 11);
  assert.equal(roster.riders[0].profileId, null);
  assert.equal(roster.riders[0].wkg[300], null);
});
