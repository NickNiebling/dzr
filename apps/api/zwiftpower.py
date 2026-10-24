import html
from collections import defaultdict
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

_zp_segments = None


class ZwiftPower:
    """
    A class to log into ZwiftPower, maintain an authenticated session,
    and fetch data from various ZwiftPower endpoints.
    """

    def __init__(self, username: str, password: str):
        """
        Initialize the ZwiftPower client. Credentials are saved and
        used during the login() flow.
        """
        self.username = username
        self.password = password
        self.session = requests.Session()
        # Spoof a common browser user agent
        self.session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 "
                "Safari/537.36"
            )
        })

    def login(self):
        """
        Performs the Zwift SSO login flow to authenticate on ZwiftPower.
        Updates self.session with the necessary cookies.
        """
        # 1) Hit ZwiftPower external login URL
        zwiftpower_login_url = (
            "https://zwiftpower.com/ucp.php?mode=login"
            "&login=external&oauth_service=oauthzpsso"
        )
        resp1 = self.session.get(zwiftpower_login_url, allow_redirects=False)
        if "Location" not in resp1.headers:
            raise RuntimeError("ZwiftPower login redirect not found.")

        # 2) Zwift SSO login page
        zwift_login_url = resp1.headers["Location"]
        resp2 = self.session.get(zwift_login_url, allow_redirects=False)

        # 3) Parse Zwift SSO form
        soup = BeautifulSoup(resp2.text, 'html.parser')
        form = soup.find('form', id='form')
        if not form or not form.get('action'):
            raise RuntimeError("Zwift login form not found or invalid.")

        action_url = form['action']  # the POST target
        payload = {
            tag['name']: tag.get('value', '')
            for tag in form.find_all('input') if tag.get('name')
        }
        payload['username'] = self.username
        payload['password'] = self.password

        if 'rememberMe' in payload:
            payload['rememberMe'] = 'on'

        # 4) POST credentials to Zwift
        resp3 = self.session.post(action_url, data=payload, allow_redirects=False)
        if "Location" not in resp3.headers:
            raise RuntimeError("Zwift login credentials likely incorrect or 2FA needed.")

        # 5) Final redirect to ZwiftPower (sets final ZwiftPower cookie)
        final_url = resp3.headers["Location"]
        resp4 = self.session.get(final_url, allow_redirects=True)

        # If we want, we can confirm by checking ZwiftPower HTML or cookies
        # for proof we're logged in. For brevity, just check status:
        if resp4.status_code != 200:
            raise RuntimeError(
                f"ZwiftPower final login redirect failed (status={resp4.status_code})"
            )

    def get_team_riders(self, club_id: int) -> dict:
        """
        Fetch JSON data about the riders in a given team/club ID.
        Returns the parsed JSON as a dictionary.
        """
        url = f"https://zwiftpower.com/api3.php?do=team_riders&id={club_id}"
        resp = self.session.get(url)
        resp.raise_for_status()  # Raise an exception for non-200
        return resp.json()

    def get_team_results(self, club_id: int, allowed_zwids: set[str] | None = None) -> dict:
        """
        Fetch JSON data about the team's results for a given team/club ID.
        Returns the parsed JSON as a dictionary.

        If allowed_zwids is provided, filter the returned `data` rows at the source
        so downstream analysis only considers those Zwift IDs.
        None allows everyone; an empty set allows no one.
        """
        url = f"https://zwiftpower.com/api3.php?do=team_results&id={club_id}"
        resp = self.session.get(url)
        resp.raise_for_status()
        payload = resp.json()

        if allowed_zwids is not None:
            allowed = {str(z).strip() for z in allowed_zwids if str(z).strip()}
            try:
                rows = payload.get("data", [])
                if isinstance(rows, list):
                    payload["data"] = [
                        r for r in rows
                        if isinstance(r, dict) and str(r.get("zwid", "")).strip() in allowed
                    ]
            except Exception:
                # Be defensive: if payload shape changes, don't break callers.
                pass

        return payload

    def _format_timestamp(self, timestamp):
        """
        Convert Unix timestamp to YYYY-MM-DD HH:MM format in CEST/CET timezone
        
        Args:
            timestamp: Unix timestamp (seconds since Jan 1, 1970)
            
        Returns:
            String with formatted date and time
        """
        from datetime import datetime
        import pytz
        
        # Convert timestamp to datetime in UTC
        utc_dt = datetime.fromtimestamp(timestamp, tz=pytz.UTC)
        
        # Convert to Europe/Copenhagen timezone (CEST/CET)
        copenhagen_tz = pytz.timezone('Europe/Copenhagen')
        local_dt = utc_dt.astimezone(copenhagen_tz)
        
        # Format the date and time
        return local_dt.strftime('%Y-%m-%d %H:%M')

    def _format_time(self, seconds_float):
        """
        Convert seconds.milliseconds to hh:mm:ss.ms format
        
        Args:
            seconds_float: Time in seconds with milliseconds (e.g., 3661.234)
            
        Returns:
            String in format "hh:mm:ss.ms"
        """
        if seconds_float is None:
            return "N/A"
            
        # Split into seconds and milliseconds
        seconds = int(seconds_float)
        milliseconds = int((seconds_float - seconds) * 1000)
        
        # Calculate hours, minutes, and remaining seconds
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        remaining_seconds = seconds % 60
        
        # Format with leading zeros and milliseconds
        return f"{hours:02d}:{minutes:02d}:{remaining_seconds:02d}.{milliseconds:03d}"

    def filter_events_by_title(self, club_id: int, search_string: str) -> dict:
        """
        Filter team results to only include events whose titles match the given pattern.
        Includes detailed rider data and formatted timestamps.
        
        Args:
            club_id (int): The team/club ID to fetch results for
            search_string (str): The pattern to match in event titles (case-insensitive)
            
        Returns:
            dict: A dictionary containing filtered events with their details and rider data:
                {
                    zid: {
                        "event_info": {
                            "title": str,
                            "date": str (formatted YYYY-MM-DD HH:MM in CEST/CET)
                        },
                        "riders": [
                            {
                                "name": str,
                                "category": str,
                                "time": str (formatted hh:mm:ss.ms),
                                "position_in_cat": int,
                                "20m wkg": str,
                                "5m wkg": str,
                                "1m wkg": str
                            },
                            ...
                        ]
                    },
                    ...
                }
        """
        # Get all team results
        team_results = self.get_team_results(club_id)
        events = team_results["events"]
        rows = team_results["data"]
        filtered_results = {}
        
        # First find matching events by title
        for zid, event_info in events.items():
            title = event_info.get("title", "")
            if search_string.lower() in title.lower():
                # Initialize event data with simplified event info
                filtered_results[zid] = {
                    "event_info": {
                        "title": event_info.get("title", ""),
                        "date": self._format_timestamp(event_info.get("date", 0))
                    },
                    "riders": []
                }
        
        # Now collect rider data for each matching event
        for row in rows:
            zid = row.get("zid")
            if zid in filtered_results:
                # Clean up rider name
                rider_name = html.unescape(row.get("name", ""))
                
                # Create rider data dictionary
                rider_data = {
                    "name": rider_name,
                    "category": row.get("category"),
                    "time": self._format_time(row.get("time", [None])[0]),
                    "position_in_cat": row.get("position_in_cat"),
                    "20m wkg": row.get("wkg1200", [None])[0],  # 20-min power
                    "5m wkg": row.get("wkg300", [None])[0],    # 5-min power
                    "1m wkg": row.get("wkg60", [None])[0]      # 1-min power
                }
                
                filtered_results[zid]["riders"].append(rider_data)
        
        return filtered_results

    def get_rider_data_json(self, rider_id: int) -> dict:
        """
        Fetch the rider's JSON from the "cache3/profile" endpoint,
        e.g., /cache3/profile/<rider_id>_all.json
        """
        url = f"https://zwiftpower.com/cache3/profile/{rider_id}_all.json"
        resp = self.session.get(url)
        if resp.status_code == 200:
            return resp.json()
        else:
            # Could raise an exception or return an empty dict
            return {}

    def get_rider_zrs(self, rider_id: int) -> str:
        """
        Fetch the Zwift Racing Score by scraping the HTML on
        /profile.php?z=<rider_id>. Returns the score as a string,
        or None if not found.
        """
        url = f"https://zwiftpower.com/profile.php?z={rider_id}"
        resp = self.session.get(url)
        if resp.status_code != 200:
            return None

        soup = BeautifulSoup(resp.text, "html.parser")

        # Locate the <th> with "Zwift Racing Score", then get next <td> <b>
        racing_score_th = soup.find("th", string=lambda x: x and "Zwift Racing Score" in x)
        if racing_score_th:
            score_td = racing_score_th.find_next("td")
            if score_td and score_td.find("b"):
                return score_td.find("b").get_text(strip=True)
        return None
    
    def analyze_team_results(self, team_results: dict) -> dict:
        """
        Given a dict from get_team_results (containing 'events' and 'data'),
        produce three analyses:
          1) top 10 events (by zid) with participants,
          2) top 10 events (by event title) aggregated,
          3) a list of riders with the most top-3 positions_in_cat.
          4) a list of winners (position_in_cat == 1)
          5) a list of top riders by wkg1200 (20-minute power)
          6) a list of top riders by wkg300 (5-minute power)
          7) a list of top riders by wkg60 (1-minute power)

        Returns a dict with three keys:
          {
            "top_10_by_zid": [...],
            "top_10_by_title": [...],
            "top_3_riders": [...]
          }
        }
        """
        # ===========================
        # 1) Top 10 events BY ZID
        # ===========================
        events = team_results["events"]
        rows = team_results["data"]

        # Group riders by zid
        by_event = defaultdict(list)
        for row in rows:
            # Use html.unescape() for rider names
            rider_name = html.unescape(row["name"])

            new_row = dict(row)  # copy to avoid mutating original
            new_row["name"] = rider_name
            new_row["position_in_cat"] = row.get("position_in_cat")

            zid = new_row["zid"]
            by_event[zid].append(new_row)

        # Count how many riders each zid has
        event_counts = [(zid, len(riders)) for zid, riders in by_event.items()]
        # Sort descending by participant count
        event_counts.sort(key=lambda x: x[1], reverse=True)
        # Take top 10
        top_zids = event_counts[:10]

        top_10_by_zid = []
        for zid, rider_count in top_zids:
            event_info = events.get(zid, {})
            event_title = event_info.get("title", f"(No title for {zid})")
            riders_for_this_zid = by_event[zid]

            # Build participant list
            participants = []
            for r in riders_for_this_zid:
                participants.append({
                    "name": r["name"],
                    "zwid": r["zwid"],
                    #"position_in_event": r["position_in_cat"]
                })

            top_10_by_zid.append({
                "zid": zid,
                "title": event_title,
                "rider_count": rider_count,
                "participants": participants
            })

        # ===========================
        # 2) Top 10 events BY TITLE
        # ===========================
        title_counts = defaultdict(int)

        for row in rows:
            zid = row["zid"]
            evt_obj = events.get(zid, {})
            raw_title = evt_obj.get("title", "(No title)")
            event_title = html.unescape(raw_title)
            title_counts[event_title] += 1

        # Sort descending
        sorted_by_count = sorted(title_counts.items(), key=lambda x: x[1], reverse=True)
        # Take top 10
        sorted_by_count = sorted_by_count[:10]

        top_10_by_title = []
        for title, count in sorted_by_count:
            top_10_by_title.append({
                "event_name": title,
                "participant_count": count
            })

        # ===========================
        # 3) Riders with the MOST top 3 FINISHES in their category
        # ===========================
        top_3_counter = defaultdict(int)
        for row in rows:
            pos_in_cat = row.get("position_in_cat")
            type = row.get("f_t")
            if pos_in_cat is not None and pos_in_cat <= 3 and type == 'TYPE_RACE ':
                # Convert name
                rider_name = html.unescape(row["name"])
                zwid = row["zwid"]
                # Could key by just zwid or by (rider_name, zwid)
                key = (rider_name, zwid)
                top_3_counter[key] += 1

        # Sort by number of top-3 finishes, descending
        sorted_top_3 = sorted(top_3_counter.items(), key=lambda x: x[1], reverse=True)[:3]

        top_3_riders = []
        for (name, zwid), count in sorted_top_3:
            top_3_riders.append({
                "name": name,
                "zwid": zwid,
                "top_3_count": count
            })
        
        # ===========================
        # 4) Winners (position_in_cat == 1)
        # ===========================
        winners = []
        for row in rows:
            pos_in_cat = row.get("position_in_cat")
            type = row.get("f_t")
            if pos_in_cat is not None and pos_in_cat <= 1 and type == 'TYPE_RACE ':
                # Convert name
                rider_name = html.unescape(row["name"])
                zwid = row["zwid"]
                zid = row["zid"]
                evt_obj = events.get(zid, {})
                raw_title = evt_obj.get("title", "(No title)")
                event_title = html.unescape(raw_title)
                winners.append({
                    "name": rider_name,
                    "zwid": zwid,
                    "event_title": event_title
                })
                
        # ==============================================================
        # 5) Top riders by wkg1200 (20-minute power)
        # 6) Top riders by wkg300  (5-minute  power)
        # ==============================================================
        # We’ll track each rider’s best 20-min and 5-min stats:
        # best_20min[(rider_name, zwid)] = {"value": float, "event_title": str}
        # best_5min [(rider_name, zwid)] = {"value": float, "event_title": str}
        best_20min = defaultdict(lambda: {"value": 0.0, "event_title": None})
        best_5min  = defaultdict(lambda: {"value": 0.0, "event_title": None})
        best_1min  = defaultdict(lambda: {"value": 0.0, "event_title": None})

        for row in rows:
            rider_name = html.unescape(row["name"])
            zwid = row["zwid"]
            rider_id = (rider_name, zwid)

            zid = row["zid"]
            event_info = events.get(zid, {})
            # If you want to unescape the event's title just in case
            raw_title = event_info.get("title", f"(No title for {zid})")
            event_title = html.unescape(raw_title)
            
            wgk60_raw = row.get("wkg60")
            pos_in_cat = row.get("position_in_cat")
            if isinstance(wgk60_raw, list) and len(wgk60_raw) > 0:
                wkg60_str = wgk60_raw[0]
                # If it's numeric, parse to float
                if isinstance(wkg60_str, str) and wkg60_str.replace('.', '', 1).isdigit():
                    val_60 = float(wkg60_str)
                    # If higher than our current best, update
                    if val_60 > best_1min[rider_id]["value"]:
                        best_1min[rider_id]["value"] = val_60
                        best_1min[rider_id]["event_title"] = event_title
                        best_1min[rider_id]["position_in_cat"] = pos_in_cat

            # row["wkg1200"] looks like ['3.2', 0] if using your data structure
            wkg1200_raw = row.get("wkg1200")
            pos_in_cat = row.get("position_in_cat")
            if isinstance(wkg1200_raw, list) and len(wkg1200_raw) > 0:
                wkg1200_str = wkg1200_raw[0]  # e.g. "3.2"
                # If it's numeric, parse to float
                if isinstance(wkg1200_str, str) and wkg1200_str.replace('.', '', 1).isdigit():
                    val_1200 = float(wkg1200_str)
                    # If higher than our current best, update
                    if val_1200 > best_20min[rider_id]["value"]:
                        best_20min[rider_id]["value"] = val_1200
                        best_20min[rider_id]["event_title"] = event_title
                        best_20min[rider_id]["position_in_cat"] = pos_in_cat

            # Same logic for wkg300 (5-min)
            wkg300_raw = row.get("wkg300")
            pos_in_cat = row.get("position_in_cat")
            if isinstance(wkg300_raw, list) and len(wkg300_raw) > 0:
                wkg300_str = wkg300_raw[0]
                if isinstance(wkg300_str, str) and wkg300_str.replace('.', '', 1).isdigit():
                    val_300 = float(wkg300_str)
                    if val_300 > best_5min[rider_id]["value"]:
                        best_5min[rider_id]["value"] = val_300
                        best_5min[rider_id]["event_title"] = event_title
                        best_5min[rider_id]["position_in_cat"] = pos_in_cat

        # Now we can sort them descending by the "value"
        sorted_20min = sorted(
            best_20min.items(),
            key=lambda x: x[1]["value"],
            reverse=True
        )[:3]

        sorted_5min = sorted(
            best_5min.items(),
            key=lambda x: x[1]["value"],
            reverse=True
        )[:3]
        
        sorted_1min = sorted(
            best_1min.items(),
            key=lambda x: x[1]["value"],
            reverse=True
        )[:3]

        # Build final lists
        top_wkg1200 = []
        for (name, zwid), info in sorted_20min:
            top_wkg1200.append({
                "name": name,
                "zwid": zwid,
                "wkg1200": info["value"],
                "event_title": info["event_title"],
                "position_in_cat": info["position_in_cat"]
            })

        top_wkg300 = []
        for (name, zwid), info in sorted_5min:
            top_wkg300.append({
                "name": name,
                "zwid": zwid,
                "wkg300": info["value"],
                "event_title": info["event_title"],
                "position_in_cat": info["position_in_cat"]
            })
        
        top_wkg60 = []
        for (name, zwid), info in sorted_1min:
            top_wkg60.append({
                "name": name,
                "zwid": zwid,
                "wkg60": info["value"],
                "event_title": info["event_title"],
                "position_in_cat": info["position_in_cat"]
            })
        
        # ===========================
        # 7) The three riders with the most completed events
        # ===========================
        event_counter = defaultdict(int)
        for row in rows:
            # Convert name
            rider_name = html.unescape(row["name"])
            zwid = row["zwid"]
            # Could key by just zwid or by (rider_name, zwid)
            key = (rider_name, zwid)
            event_counter[key] += 1

        # Sort by number of top-3 finishes, descending
        sorted_most_events = sorted(event_counter.items(), key=lambda x: x[1], reverse=True)[:3]

        most_event_riders = []
        for (name, zwid), count in sorted_most_events:
            most_event_riders.append({
                "name": name,
                "zwid": zwid,
                "events_count": count
            })

        # ===========================
        # Return all three analyses in a dict
        # ===========================
        return {
            "top_10_by_zid": top_10_by_zid, # top 10 events with most participants by race id
            "top_10_by_title": top_10_by_title, # top 10 events with most participants by event title (can be across multiple races)
            "most_events_riders": most_event_riders, # top 3 riders with most completed events
            "most_top_3_riders": top_3_riders, # top 3 riders with most top-3 finishes in their category
            "winners": winners, # list of winners in races
            "top_watts_per_kg_20min": top_wkg1200, # top riders by 20-minute power
            "top_watts_per_kg_5min": top_wkg300, # top riders by 5-minute power
            "top_watts_per_kg_1min": top_wkg60 # top riders by 1-minute power
        }

    def list_segments(self) -> list:
        """ZwiftPower segment names, one list for every world. Names match the Primes dropdown."""
        global _zp_segments
        if _zp_segments:
            return _zp_segments
        response = self.session.get("https://zwiftpower.com/segments.php", allow_redirects=True)
        if response.status_code >= 400:
            raise RuntimeError("ZwiftPower segments are unavailable")
        soup = BeautifulSoup(response.text, "html.parser")
        rows = []
        seen = set()
        for pane in soup.select("div.tab-pane[id^=tab_]"):
            pane_id = pane.get("id") or ""
            link = soup.find("a", href=f"#{pane_id}")
            world = link.get_text(strip=True) if link else ""
            select = pane.find("select")
            if not select:
                continue
            for option in select.find_all("option"):
                name = option.get_text(strip=True)
                value = str(option.get("value") or "").strip()
                if not name or value in {"", "0"} or name.lower().startswith("change segment"):
                    continue
                if value in seen:
                    continue
                seen.add(value)
                rows.append({"id": value, "name": name, "world": world})
        if not rows:
            raise RuntimeError("ZwiftPower did not list any segments")
        _zp_segments = rows
        return rows

    def search_segments(self, query: str) -> list:
        folded = " ".join(str(query or "").casefold().split())
        if len(folded) < 2:
            return []
        hits = []
        for row in self.list_segments():
            name = row["name"].casefold()
            if folded == name or folded in name:
                hits.append(row)
        hits.sort(key=lambda row: (row["name"].casefold() != folded, not row["name"].casefold().startswith(folded), row["name"]))
        return hits[:20]

    def sprint_preview(self, event_id: int, sprints: list, points: str) -> dict:
        """Match catalog sprints to the Primes dropdown. Reads only."""
        loaded = self._load_prime_form(int(event_id))
        if loaded.get("pending"):
            return {"pending": True, "sprints": [], "points": points}
        return _public_sprints(_match_primes(loaded["options"], sprints, points))

    def apply_sprints(self, event_id: int, sprints: list, points: str) -> dict:
        """Fill the Primes tab from the catalog and press Update."""
        loaded = self._load_prime_form(int(event_id))
        if loaded.get("pending"):
            return {"pending": True, "sprints": [], "points": points, "updated": []}
        preview = _match_primes(loaded["options"], sprints, points)
        if any(not row["matched"] for row in preview["sprints"]):
            return _public_sprints(preview)
        if not preview["sprints"]:
            public = _public_sprints(preview)
            public["updated"] = []
            return public
        fields = dict(loaded["fields"])
        for index in range(8):
            if index < len(preview["sprints"]):
                row = preview["sprints"][index]
                fields[f"segment_type_{index}"] = "0"
                fields[f"segment_id_{index}"] = row["segmentId"]
                fields[f"segment_category_type_{index}"] = "0"
                fields[f"segment_laps_{index}"] = row["laps"]
                fields[f"segment_points_{index}"] = preview["points"]
                fields[f"segment_points_all_{index}"] = ""
                fields[f"segment_culling_{index}"] = "0"
            else:
                fields[f"segment_type_{index}"] = "0"
                fields[f"segment_id_{index}"] = "0"
                fields[f"segment_category_type_{index}"] = "0"
                fields[f"segment_laps_{index}"] = ""
                fields[f"segment_points_{index}"] = ""
                fields[f"segment_points_all_{index}"] = ""
                fields[f"segment_culling_{index}"] = "0"
        fields["post"] = "Update"
        response = self.session.post(loaded["action"], data=fields, allow_redirects=True)
        if response.status_code >= 400:
            raise RuntimeError(f"ZwiftPower rejected the sprint update ({response.status_code})")
        confirmed = self._load_prime_form(int(event_id))
        expected = [row["segment"] for row in preview["sprints"]]
        if confirmed.get("selected") != expected:
            raise RuntimeError("ZwiftPower did not keep the sprint setup")
        public = _public_sprints(preview)
        public["updated"] = public["sprints"]
        return public

    def _load_prime_form(self, event_id: int) -> dict:
        response = self.session.get(
            f"https://zwiftpower.com/zz.php?do=edit_race&zwift_event_id={event_id}",
            allow_redirects=True,
        )
        if response.status_code >= 400:
            raise RuntimeError("ZwiftPower race editor is unavailable")
        soup = BeautifulSoup(response.text, "html.parser")
        form = None
        for candidate in soup.find_all("form"):
            if "edit_race" in str(candidate.get("action") or ""):
                form = candidate
                break
        if not form or not form.find("select", attrs={"name": "segment_id_0"}):
            return {"pending": True}
        fields = {}
        for tag in form.find_all("input"):
            name = tag.get("name")
            if not name:
                continue
            input_type = str(tag.get("type") or "text").lower()
            if input_type in {"submit", "button", "image"}:
                continue
            if input_type in {"checkbox", "radio"} and not tag.has_attr("checked"):
                continue
            fields[name] = tag.get("value") or ""
        for tag in form.find_all("textarea"):
            if tag.get("name"):
                fields[tag["name"]] = tag.string if tag.string is not None else ""
        options = {}
        selected = []
        for tag in form.find_all("select"):
            name = tag.get("name")
            if not name:
                continue
            chosen = tag.find("option", selected=True)
            fields[name] = str(chosen.get("value") or "") if chosen else "0"
            if name == "segment_id_0":
                for option in tag.find_all("option"):
                    label = option.get_text(strip=True)
                    value = str(option.get("value") or "").strip()
                    if label and value and value != "0":
                        options[label.casefold()] = {"name": label, "id": value}
        for index in range(8):
            value = str(fields.get(f"segment_id_{index}") or "0")
            if value in {"", "0"}:
                break
            label = next((row["name"] for row in options.values() if row["id"] == value), "")
            if label:
                selected.append(label)
        return {
            "pending": False,
            "fields": fields,
            "options": options,
            "selected": selected,
            "action": urljoin("https://zwiftpower.com/", form["action"]),
        }

    def wkg_category_preview(self, event_id: int) -> dict:
        """WKG finishers, and the Unfiltered pen they should be moved to. Reads only."""
        loaded = self._load_result_edit(int(event_id))
        return _public_category_preview(loaded)

    def apply_wkg_categories(self, event_id: int) -> dict:
        """Submit WKG lines with the category replaced by the Unfiltered pen. DQ is left as it is."""
        loaded = self._load_result_edit(int(event_id))
        preview = _public_category_preview(loaded)
        if preview["pending"] or not loaded["changes"]:
            return preview
        payload = dict(loaded["fields"])
        payload["edit_results"] = "\n".join(change["line"] for change in loaded["changes"])
        payload["post"] = "Update Results"
        response = self.session.post(loaded["action"], data=payload, allow_redirects=True)
        if response.status_code >= 400:
            raise RuntimeError(f"ZwiftPower rejected the category update ({response.status_code})")
        confirmed = self.wkg_category_preview(int(event_id))
        still = {change["zwid"] for change in confirmed["changes"]}
        failed = [change["name"] for change in preview["changes"] if change["zwid"] in still]
        if failed:
            names = ", ".join(failed)
            raise RuntimeError(f"ZwiftPower still has WKG results for {names}")
        confirmed["updated"] = preview["changes"]
        return confirmed

    def _load_result_edit(self, event_id: int) -> dict:
        results = self.session.get(f"https://zwiftpower.com/cache3/results/{event_id}_zwift.json")
        edit = self.session.get(
            f"https://zwiftpower.com/zz.php?do=edit_results&zwift_event_id={event_id}",
            allow_redirects=True,
        )
        if results.status_code >= 400 or edit.status_code >= 400:
            raise RuntimeError("ZwiftPower results are unavailable")
        soup = BeautifulSoup(edit.text, "html.parser")
        form = soup.find("form", id="postform")
        if not form or not form.get("action"):
            raise RuntimeError("ZwiftPower did not show the results editor")
        try:
            payload = results.json()
        except Exception:
            payload = {}
        rows = payload.get("data") if isinstance(payload, dict) else None
        textarea = form.find("textarea", attrs={"name": "all_riders"})
        riders = textarea.string if textarea is not None and textarea.string is not None else ""
        if not isinstance(rows, list) or not riders.strip():
            return {"pending": True, "changes": [], "skipped": [], "fields": {}, "action": ""}
        pens = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            zwid = str(row.get("zwid") or "").strip()
            if zwid:
                pens[zwid] = row.get("label")
        fields = {
            tag["name"]: tag.get("value", "")
            for tag in form.find_all("input")
            if tag.get("name")
        }
        for area in form.find_all("textarea"):
            if area.get("name"):
                fields[area["name"]] = area.string if area.string is not None else ""
        changes = []
        skipped = []
        for raw_line in riders.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            parts = [part.strip() for part in line.split(",")]
            if not parts or parts[0] != "WKG":
                continue
            name = parts[4] if len(parts) > 4 else ""
            zwid = parts[5] if len(parts) > 5 else ""
            category = pen_category(pens.get(zwid))
            if not zwid or category is None:
                skipped.append({"name": name or zwid or "Unknown rider", "zwid": zwid, "reason": "No pen on the unfiltered results"})
                continue
            changes.append({
                "name": name or zwid,
                "zwid": zwid,
                "from": "WKG",
                "to": category,
                "line": retarget_wkg_line(line, category),
            })
        return {
            "pending": False,
            "changes": changes,
            "skipped": skipped,
            "fields": fields,
            "action": urljoin("https://zwiftpower.com/", form["action"]),
        }


def pen_category(label) -> str | None:
    """Unfiltered result label. 1 is A, 2 is B, 3 is C, 4 is D, and 5 and above is E."""
    try:
        number = int(label)
    except (TypeError, ValueError):
        return None
    if number <= 1:
        return "A"
    if number == 2:
        return "B"
    if number == 3:
        return "C"
    if number == 4:
        return "D"
    if number >= 5:
        return "E"
    return None


def retarget_wkg_line(line: str, category: str) -> str:
    prefix, separator, rest = line.partition(",")
    if prefix.strip() != "WKG" or not separator:
        raise ValueError("Line is not a WKG result")
    return f"{category}{separator}{rest}"


def _match_primes(options: dict, sprints: list, points: str) -> dict:
    if len(sprints) > 8:
        raise ValueError("ZwiftPower accepts at most 8 sprints")
    rows = []
    for item in sprints:
        name = str(item.get("name") or "").strip()
        laps = str(item.get("laps") or "1").strip() or "1"
        hit = options.get(name.casefold())
        rows.append({
            "name": name,
            "laps": laps,
            "segment": hit["name"] if hit else "",
            "segmentId": hit["id"] if hit else "",
            "matched": bool(hit),
        })
    return {"pending": False, "points": points, "sprints": rows}


def _public_sprints(preview: dict) -> dict:
    return {
        "pending": bool(preview.get("pending")),
        "points": preview.get("points") or "",
        "sprints": [
            {
                "name": row.get("name") or "",
                "laps": row.get("laps") or "",
                "segment": row.get("segment") or "",
                "matched": bool(row.get("matched")),
            }
            for row in preview.get("sprints") or []
        ],
    }


def _public_category_preview(loaded: dict) -> dict:
    changes = [
        {"name": change["name"], "zwid": change["zwid"], "from": change["from"], "to": change["to"]}
        for change in loaded.get("changes") or []
    ]
    return {
        "pending": bool(loaded.get("pending")),
        "changes": changes,
        "skipped": list(loaded.get("skipped") or []),
    }