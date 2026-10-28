-- DZR Streaming v1. Install through OBS > Tools > Scripts, then paste your personal DZR key.
-- Uses OBS's LuaJIT FFI and libcurl multi: no shell, Python, stream keys or Google login.
local obs = obslua
local ffi = require("ffi")
local jit = require("jit")
local endpoint = "https://bot-tdnm.onrender.com/streaming/obs"
local key, platform_setting, video_link = "", "auto", ""
local session, pending, current, multi, curl, write_callback
local queue, retained = {}, {}
local last_heartbeat, stopped = 0, false
local last_session_start = 0

ffi.cdef[[
typedef void dzr_CURL;
typedef void dzr_CURLM;
struct dzr_curl_slist { char *data; struct dzr_curl_slist *next; };
struct dzr_CURLMsg { int msg; dzr_CURL *easy_handle; union { void *whatever; int result; } data; };
int curl_global_init(long flags);
dzr_CURL *curl_easy_init(void);
int curl_easy_setopt(dzr_CURL *handle, int option, ...);
int curl_easy_getinfo(dzr_CURL *handle, int info, ...);
void curl_easy_cleanup(dzr_CURL *handle);
struct dzr_curl_slist *curl_slist_append(struct dzr_curl_slist *list, const char *value);
void curl_slist_free_all(struct dzr_curl_slist *list);
dzr_CURLM *curl_multi_init(void);
int curl_multi_add_handle(dzr_CURLM *multi, dzr_CURL *easy);
int curl_multi_remove_handle(dzr_CURLM *multi, dzr_CURL *easy);
int curl_multi_perform(dzr_CURLM *multi, int *running);
struct dzr_CURLMsg *curl_multi_info_read(dzr_CURLM *multi, int *remaining);
int curl_multi_cleanup(dzr_CURLM *multi);
]]

local function log(level, text) obs.script_log(level, "DZR: " .. text) end
local function millis() return os.time() * 1000 end
local function trim(value) return (value or ""):match("^%s*(.-)%s*$") end

local function load_curl()
    local names
    if ffi.os == "Windows" then names = { "libcurl", "libcurl.dll", "libcurl-x64", "libcurl-4" }
    elseif ffi.os == "OSX" then names = { "/usr/lib/libcurl.dylib", "curl" }
    else names = { "libcurl.so.4", "curl" } end
    for _, name in ipairs(names) do
        local ok, lib = pcall(ffi.load, name)
        if ok then curl = lib; break end
    end
    if not curl then log(obs.LOG_ERROR, "libcurl blev ikke fundet. Brug en officiel OBS Studio-installation (Windows/macOS) eller installér libcurl på Linux."); return false end
    if curl.curl_global_init(3) ~= 0 then return false end
    multi = curl.curl_multi_init()
    if multi == nil then return false end
    write_callback = ffi.cast("size_t (*)(char *, size_t, size_t, void *)", function(_, size, count, _)
        -- The callback contract uses only HTTP status. Do not retain/log arbitrary response bodies.
        return size * count
    end)
    return true
end

local function platform()
    if platform_setting == "youtube" or platform_setting == "twitch" then return platform_setting end
    if platform_setting ~= "auto" then return nil end
    local service = obs.obs_frontend_get_streaming_service()
    if service == nil then return nil end
    local settings = obs.obs_service_get_settings(service)
    if settings == nil then return nil end
    local name = string.lower(obs.obs_data_get_string(settings, "service") or "")
    obs.obs_data_release(settings)
    -- Deliberately never read the service's "key", account credentials or authentication files.
    if name:find("youtube", 1, true) then return "youtube" end
    if name:find("twitch", 1, true) then return "twitch" end
    return nil
end

local function valid_settings()
    if not endpoint:match("^https://[%w%.%-]+:?%d*/streaming/obs$") then
        log(obs.LOG_ERROR, "Indsæt HTTPS callback-adressen fra /streaming_add i DZR endpoint."); return false
    end
    local owner, secret = key:match("^dzrs_(%d+)%.([%w_-]+)$")
    if not owner or #owner < 17 or #owner > 20 or #secret ~= 43 then
        log(obs.LOG_ERROR, "Indsæt din personlige nøgle fra /streaming_add i DZR key."); return false
    end
    return true
end

local function video_id()
    if video_link == "" then return nil end
    local value = video_link:match("[?&]v=([%w_-]+)") or video_link:match("youtu%.be/([%w_-]+)") or video_link
    if #value == 11 and value:match("^[%w_-]+$") then return value end
    return nil
end

local function new_session()
    if platform() == nil then
        log(obs.LOG_ERROR, "Ukendt streamingplatform. DZR får besked; vælg YouTube eller Twitch i Platform.")
    end
    last_session_start = math.max(millis(), last_session_start + 1)
    return { id = string.format("%d_%08x%08x", os.time(), math.random(0, 0x7fffffff), math.random(0, 0x7fffffff)),
        started_at = last_session_start, sequence = 0, platform = platform() }
end

local function enqueue(event, target)
    if not multi or not valid_settings() then return end
    if #queue >= 6 then log(obs.LOG_WARNING, "DZR-køen er fuld; kontrollér netværksforbindelsen."); return end
    target.sequence = target.sequence + 1
    queue[#queue + 1] = { event = event, session_id = target.id, started_at = target.started_at,
        sequence = target.sequence, platform = target.platform, attempts = 0, retry_at = 0, video_id = video_id() }
end

local function start_stream()
    if session or not valid_settings() then return end
    session = new_session()
    last_heartbeat = os.time()
    enqueue("started", session)
end

local function on_event(event)
    if event == obs.OBS_FRONTEND_EVENT_STREAMING_STARTED then start_stream()
    elseif event == obs.OBS_FRONTEND_EVENT_STREAMING_STOPPED and session then
        enqueue("stopped", session)
        session = nil
    end
end

local function body_for(job)
    local data = obs.obs_data_create()
    obs.obs_data_set_string(data, "event", job.event)
    if job.platform then obs.obs_data_set_string(data, "platform", job.platform) end
    obs.obs_data_set_string(data, "sessionId", job.session_id)
    obs.obs_data_set_int(data, "sequence", job.sequence)
    obs.obs_data_set_int(data, "startedAt", job.started_at)
    obs.obs_data_set_int(data, "sentAt", math.max(millis(), job.started_at))
    if job.video_id and job.platform == "youtube" then obs.obs_data_set_string(data, "videoId", job.video_id) end
    local body = obs.obs_data_get_json(data)
    -- OBS string setters cannot represent nil; serialize the absent platform as JSON null.
    if job.platform == nil then body = body:gsub("}%s*$", ',"platform":null}') end
    obs.obs_data_release(data)
    return body
end

local function close_request()
    if current then
        curl.curl_multi_remove_handle(multi, current)
        curl.curl_easy_cleanup(current)
        if retained.headers ~= nil then curl.curl_slist_free_all(retained.headers) end
    end
    current, retained = nil, {}
end

local function send(job)
    current = curl.curl_easy_init()
    if current == nil then return false end
    -- These strings/callbacks must outlive curl_multi_perform: libcurl borrows POSTFIELDS.
    retained.body, retained.url = body_for(job), endpoint
    retained.headers = curl.curl_slist_append(nil, "Content-Type: application/json")
    retained.headers = curl.curl_slist_append(retained.headers, "Authorization: Bearer " .. key)
    retained.headers = curl.curl_slist_append(retained.headers, "Expect:")
    local function set(option, value) return curl.curl_easy_setopt(current, option, value) == 0 end
    local function number(option, value) return set(option, ffi.cast("long", value)) end
    local ok = set(10002, retained.url) and set(10015, retained.body) and number(60, #retained.body)
        and set(10023, retained.headers) and set(20011, write_callback)
        and number(155, 8000) and number(156, 4000) and number(99, 1)
        and number(52, 0) and number(64, 1) and number(81, 2)
    if not ok or curl.curl_multi_add_handle(multi, current) ~= 0 then close_request(); return false end
    return true
end

local function pump()
    if stopped or not multi then return end
    if session and os.time() - last_heartbeat >= 30 then
        last_heartbeat = os.time()
        if #queue < 2 then enqueue("heartbeat", session) end
    end
    if not current and #queue > 0 and queue[1].retry_at <= os.time() then
        pending = table.remove(queue, 1)
        pending.attempts = pending.attempts + 1
        if not send(pending) then log(obs.LOG_ERROR, "HTTP-klienten kunne ikke startes."); pending = nil; return end
    end
    if not current then return end
    local running, remaining = ffi.new("int[1]"), ffi.new("int[1]")
    curl.curl_multi_perform(multi, running)
    local message = curl.curl_multi_info_read(multi, remaining)
    if message == nil or message.msg ~= 1 then return end
    local status = ffi.new("long[1]")
    curl.curl_easy_getinfo(current, 0x200002, status)
    local code, success = tonumber(status[0]), message.data.result == 0
    close_request()
    if success and code == 202 then
        if pending.event == "test" or pending.event == "started" then
            log(obs.LOG_INFO, "Signal modtaget af DZR. Kun en bekræftet offentlig livestream annonceres.")
        end
    elseif code == 401 or code == 403 then
        log(obs.LOG_ERROR, "Nøgle eller platform afvist. Kør /streaming_add, og kontrollér opsætningen.")
        queue = {}
    elseif code == 400 then
        if pending.platform == nil then
            log(obs.LOG_ERROR, "Ukendt platform afvist af DZR. Vælg YouTube eller Twitch i Platform.")
        else
            log(obs.LOG_ERROR, "Signal afvist. Kontrollér computerens ur og det valgfrie YouTube-link.")
        end
    elseif pending.attempts < 5 then
        pending.retry_at = os.time() + math.min(30, 2 ^ pending.attempts)
        table.insert(queue, 1, pending)
    else
        log(obs.LOG_WARNING, "DZR kunne ikke nås. Næste livstegn prøver igen automatisk.")
    end
    pending = nil
end

-- libcurl invokes a Lua write callback. That C-to-Lua re-entry must not run from a JIT trace.
jit.off(pump, true)

function script_description()
    return "<b>DZR Streaming</b><br>Brug /streaming_add i Discord for adresse og personlig nøgle. "
        .. "Stream keys læses aldrig. Test sender ingen offentlig besked. "
        .. "Ved YouTube kan et konkret videolink gøre live-verifikationen hurtigere."
end

function script_defaults(settings)
    obs.obs_data_set_default_string(settings, "endpoint", endpoint)
    obs.obs_data_set_default_string(settings, "platform", "auto")
end

function script_properties()
    local props = obs.obs_properties_create()
    obs.obs_properties_add_text(props, "endpoint", "DZR endpoint", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_text(props, "key", "DZR key", obs.OBS_TEXT_PASSWORD)
    local choices = obs.obs_properties_add_list(props, "platform", "Platform", obs.OBS_COMBO_TYPE_LIST, obs.OBS_COMBO_FORMAT_STRING)
    for _, choice in ipairs({ { "Automatisk", "auto" }, { "YouTube", "youtube" }, { "Twitch", "twitch" } }) do
        obs.obs_property_list_add_string(choices, choice[1], choice[2])
    end
    obs.obs_properties_add_text(props, "video_link", "YouTube-videolink (valgfrit, opdatér for hver stream)", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_button(props, "test", "Test forbindelse", function()
        if valid_settings() then enqueue("test", new_session()) end
        return false
    end)
    return props
end

function script_update(settings)
    local new_key = trim(obs.obs_data_get_string(settings, "key"))
    local new_endpoint = trim(obs.obs_data_get_string(settings, "endpoint")):gsub("/+$", "")
    if key ~= new_key or endpoint ~= new_endpoint then queue = {} end
    key, endpoint = new_key, new_endpoint
    platform_setting = obs.obs_data_get_string(settings, "platform")
    if platform_setting == "" then platform_setting = "auto" end
    video_link = trim(obs.obs_data_get_string(settings, "video_link"))
    -- A manual selection can repair auto-detection while OBS is already streaming.
    if session and session.platform == nil and platform() ~= nil then
        session.platform = platform()
        enqueue("started", session)
    end
end

function script_load(settings)
    math.randomseed(os.time() + math.floor(os.clock() * 1000000))
    script_update(settings)
    if not load_curl() then return end
    stopped = false
    obs.obs_frontend_add_event_callback(on_event)
    obs.timer_add(pump, 100)
    if obs.obs_frontend_streaming_active() then start_stream() end
end

function script_unload()
    stopped = true
    obs.timer_remove(pump)
    obs.obs_frontend_remove_event_callback(on_event)
    if current then close_request() end
    if multi then curl.curl_multi_cleanup(multi); multi = nil end
    if write_callback then write_callback:free(); write_callback = nil end
    -- No global cleanup: OBS and other scripts may still be using the same libcurl.
    -- If OBS exits abruptly, the server expires the session after missing heartbeats.
end
