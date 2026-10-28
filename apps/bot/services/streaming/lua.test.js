const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { spawn, spawnSync } = require("node:child_process");

const lua = process.env.LUAJIT_BIN || "luajit";
const available = spawnSync(lua, ["-v"]).status === 0;

test("OBS Lua uses real libcurl multi over TLS; start/heartbeat/stop ordering, retries and test callbacks", { skip: !available, timeout: 20000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dzr-lua-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cert = path.join(dir, "cert.pem"), keyFile = path.join(dir, "key.pem");
  const certificate = spawnSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", keyFile, "-out", cert]);
  assert.equal(certificate.status, 0, certificate.stderr?.toString());
  const requests = [];
  const server = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(cert) }, (req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const parsed = JSON.parse(body);
      requests.push({ body: parsed, authorization: req.headers.authorization, url: req.url });
      res.writeHead(requests.length === 1 ? 503 : parsed.platform === null ? 400 : 202, { "Content-Type": "application/json" });
      res.end('{"accepted":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const endpoint = `https://127.0.0.1:${server.address().port}/streaming/obs`;
  const token = `dzrs_111111111111111111.${"a".repeat(43)}`;
  const script = path.resolve(__dirname, "../../assets/dzr-stream.lua");
  const harness = path.join(dir, "harness.lua");
  // OBS UI/events are mocked; the networking, FFI declarations, TLS validation, status handling
  // and asynchronous retry loop are the shipped Lua code. The test trusts only its local cert.
  fs.writeFileSync(harness, `
local ffi = require("ffi")
ffi.cdef[[int usleep(unsigned int);]]
local load = ffi.load
ffi.load = function(name)
  local lib = load(name)
  return setmetatable({curl_easy_init = function()
    local handle = lib.curl_easy_init()
    lib.curl_easy_setopt(handle, 10065, ${JSON.stringify(cert)})
    return handle
  end}, {__index = lib})
end
local tick, event, test_button
local service_name, service_available = "YouTube - RTMPS", true
local clock = os.time()
os.time = function() return clock end
obslua = {
  LOG_INFO=1, LOG_WARNING=2, LOG_ERROR=3, OBS_TEXT_DEFAULT=0, OBS_TEXT_PASSWORD=1,
  OBS_COMBO_TYPE_LIST=0, OBS_COMBO_FORMAT_STRING=0,
  OBS_FRONTEND_EVENT_STREAMING_STARTED=1, OBS_FRONTEND_EVENT_STREAMING_STOPPED=2,
  script_log=function(_, message) print(message) end,
  obs_data_create=function() return {} end,
  obs_data_get_string=function(data, field) assert(field ~= "key" or data.endpoint, "stream key was read"); return data[field] or "" end,
  obs_data_set_string=function(data, field, value) data[field]=value end,
  obs_data_set_int=function(data, field, value) data[field]=value end,
  obs_data_release=function() end,
  obs_data_get_json=function(data)
    local fields={}
    for k,v in pairs(data) do fields[#fields+1]=string.format('%q:', k)..(type(v)=="number" and string.format("%.0f",v) or string.format('%q',v)) end
    return "{"..table.concat(fields,",").."}"
  end,
  obs_frontend_get_streaming_service=function() return service_available and true or nil end,
  obs_service_get_settings=function() return {service=service_name} end,
  obs_frontend_add_event_callback=function(fn) event=fn end,
  obs_frontend_remove_event_callback=function() end,
  obs_frontend_streaming_active=function() return false end,
  timer_add=function(fn) tick=fn end, timer_remove=function() end,
  obs_properties_create=function() return {} end, obs_properties_add_text=function() end,
  obs_properties_add_list=function() return {} end, obs_property_list_add_string=function() end,
  obs_properties_add_button=function(_,_,_,fn) test_button=fn end,
}
dofile(${JSON.stringify(script)})
script_load({endpoint=${JSON.stringify(endpoint)}, key=${JSON.stringify(token)}, platform="auto"})
script_properties()
local function pump(count) for i=1,count do tick(); ffi.C.usleep(10000) end end
test_button(); pump(50)
clock=clock+3; pump(50) -- retry the deliberately failed first request
event(1); pump(50)
event(1); pump(20) -- duplicate OBS event is ignored
clock=clock+31; pump(50)
event(2); pump(50)
service_name="Twitch"
test_button(); pump(50)
event(1); pump(50)
event(2); pump(50)
service_name="Custom RTMP"
event(1); pump(50) -- unknown detection must reach DZR, so it can report to IT
script_update({endpoint=${JSON.stringify(endpoint)}, key=${JSON.stringify(token)}, platform="twitch"})
pump(50) -- selecting a known platform repairs the active session
event(2); pump(50)
service_available=false
script_update({endpoint=${JSON.stringify(endpoint)}, key=${JSON.stringify(token)}, platform="auto"})
test_button(); pump(50) -- missing OBS service also becomes unknown
script_update({endpoint=${JSON.stringify(endpoint)}, key=${JSON.stringify(token)}, platform="facebook"})
test_button(); pump(50) -- invalid persisted/manual settings cannot become a provider
script_unload()
`);
  const child = spawn(lua, [harness], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(() => child.kill());
  const exit = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  assert.equal(exit, 0, output);
  assert.deepEqual(requests.map((r) => r.body.event), ["test", "test", "started", "heartbeat", "stopped",
    "test", "started", "stopped", "started", "started", "stopped", "test", "test"], output);
  assert.deepEqual(requests.map((r) => r.body.platform), ["youtube", "youtube", "youtube", "youtube", "youtube",
    "twitch", "twitch", "twitch", null, "twitch", "twitch", null, null]);
  assert.deepEqual(requests.slice(2, 5).map((r) => r.body.sequence), [1, 2, 3]);
  assert.equal(requests[2].body.sessionId, requests[4].body.sessionId);
  assert.equal(requests[8].body.sessionId, requests[9].body.sessionId);
  assert.equal(requests[8].body.startedAt, requests[9].body.startedAt);
  assert.ok(requests.every((r) => r.authorization === `Bearer ${token}` && r.url === "/streaming/obs"));
  assert.ok(!output.includes(token));
});
