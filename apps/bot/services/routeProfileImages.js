/**
 * Build the PNGs for a route profile request: the race profile, plus climb close-ups when asked.
 * Returns files and a caption; the caller posts them, so this has no Discord dependency.
 */
const { routeDetails, searchRoutes } = require("./zwiftRoutes");
const { loadZwiftCatalog } = require("./zwiftCatalog");
const { getRouteProfile } = require("./routeProfileApi");
const { zoomWindows, totalGainM } = require("./routeProfileGeometry");
const { getZwiftEvent } = require("./zwiftEvents");
const { placePowerups } = require("./powerupPlaces");

// Discord allows 10 attachments: the profile, up to 8 climbs, and the finish.
const MAX_CLOSEUPS = 8;

function fileSlug(value) {
  return String(value || "route").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "route";
}

/**
 * A catalog hit supplies the canonical spelling. A miss still goes to the site, which resolves
 * the name from the live game dictionary. Several catalog matches stay a choice.
 */
function resolveRoute(route, world) {
  const typed = String(route || "").trim();
  const typedWorld = String(world || "").trim();
  if (!typed) return { success: false, message: "Give a route name." };
  if (typedWorld) {
    const found = searchRoutes({ query: typed, world: typedWorld, limit: 5 });
    if (found.success && found.routes?.length) {
      return { success: true, name: found.routes[0].name, world: found.routes[0].world };
    }
    return { success: true, name: typed, world: typedWorld };
  }
  const details = routeDetails(typed);
  if (details.success) return { success: true, name: details.route.name, world: details.route.world };
  if (Array.isArray(details.candidates) && details.candidates.length) {
    return { success: false, message: details.message, candidates: details.candidates };
  }
  return { success: true, name: typed, world: "" };
}

/** Custom KOMs as the site expects them, dropping any that cannot be drawn. */
function customRanges(list) {
  return (Array.isArray(list) ? list : [])
    .map((kom) => ({
      name: String(kom?.name || "").trim().slice(0, 60) || "Custom KOM",
      fromKm: Number(kom?.from_km ?? kom?.fromKm),
      toKm: Number(kom?.to_km ?? kom?.toKm),
    }))
    .filter((kom) => Number.isFinite(kom.fromKm) && Number.isFinite(kom.toKm) && kom.toKm > kom.fromKm && kom.fromKm >= 0)
    .slice(0, MAX_CLOSEUPS);
}

/**
 * Close-up windows in the order asked: named climbs, then custom KOMs (marked exact, so their stats
 * cover exactly the given stretch), then the finish. With only `closeups`, every climb on the route.
 */
function closeupWindows(profile, nameCount) {
  const asked = (profile.climbs || []).map((zoom, index) => ({ ...zoom, exact: index >= nameCount }));
  const windows = asked.filter((zoom) => zoom.matched && zoom.toKm > zoom.fromKm);
  if (!asked.length) windows.push(...zoomWindows(profile, { max: MAX_CLOSEUPS }));
  const finish = profile.finish;
  if (finish?.matched && finish.toKm > finish.fromKm) windows.push({ ...finish, title: `Finish: ${finish.title}` });
  return {
    windows: windows.slice(0, MAX_CLOSEUPS + 1),
    missing: [...asked, ...(finish ? [finish] : [])].filter((zoom) => !zoom.matched).map((zoom) => zoom.title),
  };
}

function facts(profile, world, laps) {
  const parts = [];
  if (world) parts.push(world);
  parts.push(`${Number(profile.raceKm).toFixed(1)} km`, `${Math.round(totalGainM(profile.altitudeM))} m`);
  if (laps > 1) parts.push(`${laps} laps`);
  if (profile.leadInKm > 0) parts.push(`incl. ${Number(profile.leadInKm).toFixed(1)} km lead-in`);
  return parts.join(" · ");
}

/**
 * The event's course fills in what the caller left out, and its powerup tags come along, so a race
 * profile shows the powerups that were really set. Returns { args, powerups } or { error }.
 */
async function withEvent(args, readEvent) {
  if (!args.event) return { args, powerups: null };
  const read = await readEvent(args.event);
  if (!read.success) return { error: read.message };
  const event = read.event;
  const merged = { ...args };
  if (!String(merged.route || "").trim() && !merged.routeId) {
    if (event.route) {
      merged.route = event.route;
      merged.world = event.world;
    } else if (event.route_id) {
      merged.routeId = event.route_id;
    } else {
      return { error: `Zwift event ${event.id} has no route.` };
    }
    if (!(Number(merged.distance_km) > 0) && !(Number(merged.laps) > 0)) {
      if (event.distance_km) merged.distance_km = event.distance_km;
      else merged.laps = event.laps;
    }
  }
  return {
    args: merged,
    powerups: {
      powerupIds: event.powerup_ids || [],
      archPowerups: event.arch_powerups || {},
      names: event.powerups || [],
      bannerNames: event.banner_powerups || [],
      start: event.start_powerup || null,
    },
  };
}

/**
 * args: { route?, event?, world?, laps?, distance_km?, climbs?: string[], custom_koms?: [{ name, from_km, to_km }],
 *         finish?, closeups?: boolean }
 * Returns { success, files: [{ name, buffer }], caption } or { success:false, message }.
 */
async function buildRouteProfileImages(args = {}, deps = {}) {
  const render = deps.render || require("./routeProfileChart");
  const fetchProfile = deps.getRouteProfile || getRouteProfile;
  await loadZwiftCatalog();

  const fromEvent = await withEvent(args, deps.getZwiftEvent || getZwiftEvent);
  if (fromEvent.error) return { success: false, message: fromEvent.error };
  args = fromEvent.args;
  if (!String(args.route || "").trim() && !args.routeId) return { success: false, message: "Give a route name or a Zwift event." };

  let name = String(args.route || "").trim();
  let world = String(args.world || "").trim();
  if (name) {
    const resolved = resolveRoute(name, world);
    if (!resolved.success) return { success: false, message: resolved.message, candidates: resolved.candidates };
    name = resolved.name;
    world = resolved.world;
  }

  const distanceKm = Number(args.distance_km) > 0 ? Number(args.distance_km) : 0;
  const laps = distanceKm ? 1 : Math.max(1, Math.min(20, Number.parseInt(args.laps, 10) || 1));
  const climbs = Array.isArray(args.climbs) ? args.climbs.filter(Boolean).slice(0, MAX_CLOSEUPS) : [];
  const ranges = customRanges(args.custom_koms);
  const finish = String(args.finish || "").trim();
  const request = { world, route: name, laps, distanceKm, climbs, ranges, finish };
  if (args.routeId) request.routeId = args.routeId;
  const loaded = await fetchProfile(request);
  if (!loaded.success) return { success: false, message: loaded.message };
  const profile = loaded.profile;
  const title = profile.routeName || name || "Route";
  const worldLabel = world || profile.world || "";

  const details = facts(profile, worldLabel, laps);
  let text = `**${title}** · ${details}`;
  const event = fromEvent.powerups;
  const powerups = event ? placePowerups(profile, event) : [];
  if (event) {
    const parts = [];
    if (event.names.length) parts.push(event.names.join(", "));
    if (event.bannerNames.length) parts.push(`fixed on banners: ${event.bannerNames.join(", ")}`);
    if (event.start) parts.push(`start: ${event.start}`);
    text += parts.length || powerups.length ? `\nPowerups: ${parts.join(" · ")}` : "\nPowerups: none set for this event";
  }
  const main = await render.renderRouteProfile(profile, { name: title, subtitle: details, powerups });
  if (!main) return { success: false, message: "Could not draw the profile image." };
  const files = [{ name: `${fileSlug(title)}-profile.png`, buffer: main }];

  const missing = [];
  if (climbs.length || ranges.length || finish || args.closeups === true) {
    const planned = closeupWindows(profile, climbs.length);
    for (const zoom of planned.windows) {
      const png = render.renderClimbZoom(profile, zoom);
      if (png) files.push({ name: `${fileSlug(zoom.title)}-closeup.png`, buffer: png });
    }
    missing.push(...planned.missing);
    if (args.closeups === true && !climbs.length && !ranges.length && !profile.segments?.some((s) => s.type === "climb")) {
      missing.push("(no climbs on this route)");
    }
  }

  return { success: true, files, caption: text, missing };
}

module.exports = { buildRouteProfileImages, resolveRoute, customRanges, closeupWindows };
