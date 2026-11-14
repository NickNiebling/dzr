const test = require("node:test");
const assert = require("node:assert/strict");
const { parseTeamPage, parseFixtureList, parseFixture } = require("./ladderParser");

test("parseTeamPage reads the team's own fixtures link without needing any matches", () => {
  // These are the identity markers on the live /teamView/Chonky%20Chaser page.
  assert.equal(parseTeamPage('<script>const TEAMID = 82;</script><a class="btn" href="/matchlist/fixtures/Chonky Chaser">Fixtures</a>'), "Chonky Chaser");
  assert.equal(parseTeamPage('<script>const TEAMID = 3;</script><a href="/matchlist/fixtures/Dan&#39;s &amp; co">Fixtures</a>'), "Dan's & co");
  assert.equal(parseTeamPage('<script>const TEAMID = 3;</script><a href="/matchlist/fixtures/Dan\'s%20team">Fixtures</a>'), "Dan's team");
  assert.equal(parseTeamPage("<script>const TEAMID = 3;</script><a href='/matchlist/fixtures/%C3%86%20&#x26;%20co'>Fixtures</a>"), "Æ & co");
  assert.equal(parseTeamPage('<title>404</title>'), null);
  assert.equal(parseTeamPage('<a href="/matchlist/fixtures/Other">Menu link without team identity</a>'), null);
  assert.equal(parseTeamPage('<script>const TEAMID = 3;</script><a href="/matchlist/fixtures/%ZZ">Fixtures</a>'), null);
});

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
