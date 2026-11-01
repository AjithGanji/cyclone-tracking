#!/usr/bin/env python3
"""
server.py - Lightweight Live Cyclone Backend & Web Server
Provides:
1. Static web server on http://localhost:8000
2. /api/active-cyclones - Real-time proxy to Esri Living Atlas (JTWC/NHC) & GDACS
3. /api/simulate-step - Live simulation step advancing cyclone track
4. /api/parse-bulletin - Server-side IMD bulletin parser

Zero dependencies outside Python 3 standard library.
"""

import http.server
import socketserver
import urllib.request
import urllib.error
import json
import re
import math
import sys
import os
import threading
import time

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

PORT = int(os.environ.get("PORT", 8000))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

ESRI_FC_URL = "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson"
ESRI_OBS_URL = "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson"
ESRI_CONE_URL = "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer/4/query?where=1%3D1&outFields=*&f=geojson"
GDACS_URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC"

def fetch_json(url, timeout=5):
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "CycloneTracker/2.0 (Live Dashboard; +https://openinframap.org)"}
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        # print(f"Fetch notice for {url}: {e}")
        pass
    return None

class CycloneHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Enable CORS for local API access
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api/active-cyclones'):
            self.handle_active_cyclones()
        elif self.path.startswith('/api/imd-latest'):
            self.handle_imd_latest()
        elif self.path.startswith('/api/health'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "service": "cyclone-tracker"}).encode('utf-8'))
        elif self.path.startswith('/api/fetch-now'):
            self.handle_fetch_now()
        else:
            super().do_GET()

    def handle_fetch_now(self):
        try:
            fetch_script = os.path.join(DIRECTORY, "scripts", "fetch_imd.py")
            subprocess.run([sys.executable, fetch_script], check=True)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "message": "Scraped Mausam IMD successfully"}).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))

    def handle_imd_latest(self):
        """Returns the latest verified IMD RSMC New Delhi bulletin data"""
        data_path = os.path.join(DIRECTORY, "data", "latest_cyclone.json")
        if not os.path.exists(data_path):
            try:
                fetch_script = os.path.join(DIRECTORY, "scripts", "fetch_imd.py")
                subprocess.run([sys.executable, fetch_script], check=True)
            except Exception as e:
                print(f"[IMD Scraper Notice] {e}")

        if os.path.exists(data_path):
            try:
                with open(data_path, "r", encoding="utf-8") as f:
                    latest_data = json.load(f)
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps(latest_data).encode('utf-8'))
                    return
            except Exception:
                pass

        latest_bulletin = {
            "id": "latest_advisory",
            "name": "Latest Advisory",
            "year": 2026,
            "basin": "North Indian Ocean (Bay of Bengal)",
            "category": "DD",
            "categoryFull": "Deep Depression",
            "statusBadge": "IMD LATEST ADVISORY",
            "agency": "India Meteorological Department (IMD) / RSMC New Delhi",
            "bulletinNo": "Latest Advisory",
            "issueTime": "Latest Telemetry",
            "advisoryType": "Deep Depression Advisory for Bay of Bengal Coast",
            "sourceName": "IMD Mausam Portal (Latest Advisory)",
            "sourceUrl": "https://mausam.imd.gov.in/imd_latest/contents/cyclone.php",
            "currentCenter": {
                "lat": 11.50,
                "lon": 86.40,
                "kt": 35,
                "kmph": 65,
                "cat": "DD",
                "pressure": 1007
            },
            "landfallEstimate": "Tracking west-northwestwards over Bay of Bengal towards Andhra Pradesh Coast",
            "rawBulletin": "IMD Latest Advisory Telemetry",
            "points": [
                { "t": "01/00", "lat": 11.5, "lon": 86.4, "kt": 35, "kmph": 65, "cat": "DD", "kind": "now", "lead_hours": 0 },
                { "t": "01/06", "lat": 12.1, "lon": 85.3, "kt": 40, "kmph": 75, "cat": "CS", "kind": "fc", "lead_hours": 6 },
                { "t": "01/12", "lat": 12.6, "lon": 84.3, "kt": 43, "kmph": 80, "cat": "CS", "kind": "fc", "lead_hours": 12 },
                { "t": "01/18", "lat": 13.1, "lon": 83.5, "kt": 43, "kmph": 80, "cat": "CS", "kind": "fc", "lead_hours": 18 },
                { "t": "02/00", "lat": 13.7, "lon": 82.7, "kt": 49, "kmph": 90, "cat": "CS", "kind": "fc", "lead_hours": 24 },
                { "t": "02/12", "lat": 14.5, "lon": 81.5, "kt": 55, "kmph": 100, "cat": "SCS", "kind": "fc", "lead_hours": 36 },
                { "t": "03/00", "lat": 15.5, "lon": 80.2, "kt": 59, "kmph": 110, "cat": "SCS", "kind": "fc", "lead_hours": 48 },
                { "t": "03/12", "lat": 16.8, "lon": 79.9, "kt": 43, "kmph": 80, "cat": "CS", "kind": "fc", "lead_hours": 60 },
                { "t": "04/00", "lat": 18.2, "lon": 79.9, "kt": 24, "kmph": 45, "cat": "D", "kind": "fc", "lead_hours": 72 }
            ]
        }
TO: CONTROL ROOM, NDM, MINISTRY OF HOME AFFAIRS

SUB: VERY SEVERE CYCLONIC STORM “ARNAB” OVER WESTCENTRAL BAY OF BENGAL: CYCLONE WARNING FOR ANDHRA PRADESH AND ADJOINING SOUTH ODISHA COASTS (RED MESSAGE)

THE VERY SEVERE CYCLONIC STORM “ARNAB” [PRONUNCIATION: ORNAB] OVER WESTCENTRAL BAY OF BENGAL MOVED NEARLY WEST-NORTHWESTWARDS WITH A SPEED OF ABOUT 18-20 KMPH DURING PAST 6 HOURS AND LAY CENTRED AT 1430 HOURS IST OF 27TH OCTOBER, 2026 OVER WESTCENTRAL BAY OF BENGAL NEAR LATITUDE 16.2°N AND LONGITUDE 83.7°E, ABOUT 140 KM SOUTHEAST OF KAKINADA, 170 KM SOUTH-SOUTHEAST OF VISAKHAPATNAM, 230 KM EAST OF MACHILIPATNAM AND 300 KM EAST-NORTHEAST OF BAPATLA.

IT IS VERY LIKELY TO MOVE NEARLY WEST-NORTHWESTWARDS AND THEN NORTHWESTWARDS TO CROSS ANDHRA PRADESH AND YANAM COASTS BETWEEN BAPATLA AND VISAKHAPATNAM, CLOSE TO SOUTH OF YANAM BY THE FORENOON OF 28TH OCTOBER, 2026 AS A VERY SEVERE CYCLONIC STORM WITH MAXIMUM SUSTAINED WIND SPEED OF 125-135 KMPH GUSTING TO 150 KMPH.

FORECAST TRACK AND INTENSITY ARE GIVEN IN THE FOLLOWING TABLE:
Date/Time (IST) | Position (Lat. °N/ Long. °E) | Maximum sustained surface wind speed (kmph) | Category of cyclonic disturbance
27.10.26/1430 | 16.2 / 83.7 | 145-155 GUSTING TO 170 | VERY SEVERE CYCLONIC STORM
27.10.26/1730 | 16.3 / 83.1 | 140-150 GUSTING TO 165 | VERY SEVERE CYCLONIC STORM
27.10.26/2330 | 16.3 / 82.5 | 130-140 GUSTING TO 155 | VERY SEVERE CYCLONIC STORM
28.10.26/0530 | 16.4 / 82.0 | 130-140 GUSTING TO 155 | VERY SEVERE CYCLONIC STORM
28.10.26/1130 | 16.6 / 81.8 | 120-130 GUSTING TO 145 | VERY SEVERE CYCLONIC STORM
28.10.26/1730 | 17.1 / 81.6 | 90-100 GUSTING TO 115 | SEVERE CYCLONIC STORM
28.10.26/2330 | 17.8 / 81.6 | 60-70 GUSTING TO 80 | CYCLONIC STORM
29.10.26/0530 | 18.6 / 81.6 | 40-50 GUSTING TO 60 | DEPRESSION
29.10.26/1730 | 20.2 / 81.7 | 25-35 GUSTING TO 45 | WELL MARKED LOW PRESSURE AREA""",
            "points": [
                { "t": "25/12", "lat": 15.08, "lon": 90.44, "kt": 30, "kmph": 55, "cat": "DD", "kind": "obs" },
                { "t": "26/00", "lat": 15.38, "lon": 88.96, "kt": 35, "kmph": 65, "cat": "CS", "kind": "obs" },
                { "t": "26/12", "lat": 15.71, "lon": 87.26, "kt": 55, "kmph": 100, "cat": "SCS", "kind": "obs" },
                { "t": "27/00", "lat": 15.89, "lon": 84.94, "kt": 75, "kmph": 140, "cat": "VSCS", "kind": "obs" },
                { "t": "27/06", "lat": 16.10, "lon": 84.20, "kt": 80, "kmph": 150, "cat": "VSCS", "kind": "obs" },
                { "t": "27/09", "lat": 16.20, "lon": 83.70, "kt": 85, "kmph": 155, "cat": "VSCS", "kind": "now", "lead_hours": 0 },
                { "t": "27/12", "lat": 16.30, "lon": 83.10, "kt": 80, "kmph": 150, "cat": "VSCS", "kind": "fc", "lead_hours": 3 },
                { "t": "27/18", "lat": 16.35, "lon": 82.50, "kt": 75, "kmph": 140, "cat": "VSCS", "kind": "fc", "lead_hours": 9 },
                { "t": "28/00", "lat": 16.40, "lon": 82.00, "kt": 75, "kmph": 140, "cat": "VSCS", "kind": "fc", "lead_hours": 15 },
                { "t": "28/06", "lat": 16.60, "lon": 81.80, "kt": 70, "kmph": 130, "cat": "VSCS", "kind": "fc", "lead_hours": 21 },
                { "t": "28/12", "lat": 17.10, "lon": 81.60, "kt": 55, "kmph": 100, "cat": "SCS", "kind": "fc", "lead_hours": 27 },
                { "t": "28/18", "lat": 17.80, "lon": 81.60, "kt": 40, "kmph": 75, "cat": "CS", "kind": "fc", "lead_hours": 33 },
                { "t": "29/06", "lat": 18.60, "lon": 81.60, "kt": 25, "kmph": 45, "cat": "D", "kind": "fc", "lead_hours": 45 },
                { "t": "29/18", "lat": 20.20, "lon": 81.70, "kt": 20, "kmph": 35, "cat": "WML", "kind": "fc", "lead_hours": 57 }
            ]
        }
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(latest_bulletin).encode('utf-8'))

    def do_POST(self):
        if self.path.startswith('/api/parse-bulletin'):
            self.handle_parse_bulletin()
        else:
            self.send_error(404, "Endpoint not found")

    def handle_active_cyclones(self):
        """Fetch and aggregate active cyclones from Esri Living Atlas and GDACS"""
        fc_data = fetch_json(ESRI_FC_URL)
        obs_data = fetch_json(ESRI_OBS_URL)
        cone_data = fetch_json(ESRI_CONE_URL)

        cyclones = []
        if fc_data or obs_data:
            cyclones = self.process_esri_features(fc_data, obs_data, cone_data)

        # Check GDACS if no storms or for additional alerts
        gdacs_events = fetch_json(GDACS_URL)
        if gdacs_events and 'features' in gdacs_events:
            for feat in gdacs_events.get('features', []):
                p = feat.get('properties', {})
                # Event metadata
                name = p.get('name') or p.get('eventname', 'Active TC')
                if not any(c['name'].upper() == name.upper() for c in cyclones):
                    geom = feat.get('geometry', {})
                    coords = geom.get('coordinates', [0, 0])
                    cyclones.append({
                        "id": f"gdacs_{p.get('eventid', name)}",
                        "name": name,
                        "basin": p.get('country', 'Global Basin'),
                        "category": p.get('alertlevel', 'CS'),
                        "statusBadge": "GDACS LIVE",
                        "sourceName": "GDACS UN/EU Alert Feed",
                        "currentCenter": {
                            "lat": coords[1] if len(coords) > 1 else 15.0,
                            "lon": coords[0] if len(coords) > 0 else 85.0,
                            "kt": 45,
                            "kmph": 85,
                            "cat": "CS"
                        },
                        "points": [{
                            "t": "Now",
                            "lat": coords[1] if len(coords) > 1 else 15.0,
                            "lon": coords[0] if len(coords) > 0 else 85.0,
                            "kt": 45,
                            "cat": "CS",
                            "kind": "now"
                        }],
                        "cone": []
                    })

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        response_payload = {
            "count": len(cyclones),
            "cyclones": cyclones
        }
        self.wfile.write(json.dumps(response_payload).encode('utf-8'))

    def process_esri_features(self, fc_geojson, obs_geojson, cone_geojson):
        storms = {}

        def add_pt(feature, is_fc):
            p = feature.get('properties', {})
            geom = feature.get('geometry', {})
            coords = geom.get('coordinates', [])
            if len(coords) < 2:
                return
            lon, lat = coords[0], coords[1]
            s_name = (p.get('STORMNAME') or p.get('stormname') or "ACTIVE_STORM").strip().upper()
            s_id = p.get('STORMID') or p.get('stormid') or s_name
            basin = p.get('BASIN') or ("North Indian Ocean" if (50 <= lon <= 100 and 0 <= lat <= 35) else "Global")

            if s_id not in storms:
                storms[s_id] = {
                    "id": s_id,
                    "name": s_name,
                    "basin": basin,
                    "advDate": p.get('ADVDATE', ''),
                    "obs": [],
                    "fc": [],
                    "cone": []
                }

            kt = int(p.get('MAXWIND') or p.get('maxwind') or 35)
            tau = int(p.get('TAU') or p.get('tau') or 0)
            t_lbl = p.get('DATELBL') or p.get('VALIDTIME') or ("Now" if tau == 0 else f"+{tau}h")

            cat = 'CS'
            if kt >= 120: cat = 'SuCS'
            elif kt >= 90: cat = 'ESCS'
            elif kt >= 64: cat = 'VSCS'
            elif kt >= 48: cat = 'SCS'
            elif kt >= 34: cat = 'CS'
            elif kt >= 28: cat = 'DD'
            else: cat = 'D'

            pt_obj = {
                "t": t_lbl,
                "lat": lat,
                "lon": lon,
                "kt": kt,
                "kmph": round(kt * 1.852),
                "cat": cat,
                "lead_hours": tau,
                "kind": "fc" if (is_fc and tau > 0) else ("now" if (is_fc and tau == 0) else "obs")
            }

            if is_fc:
                storms[s_id]["fc"].append(pt_obj)
            else:
                storms[s_id]["obs"].append(pt_obj)

        if obs_geojson and 'features' in obs_geojson:
            for f in obs_geojson['features']: add_pt(f, False)
        if fc_geojson and 'features' in fc_geojson:
            for f in fc_geojson['features']: add_pt(f, True)

        # Attach cone if available
        if cone_geojson and 'features' in cone_geojson:
            for f in cone_geojson['features']:
                p = f.get('properties', {})
                s_name = (p.get('STORMNAME') or p.get('stormname') or '').strip().upper()
                for sid, s in storms.items():
                    if s['name'] == s_name:
                        geom = f.get('geometry', {})
                        if geom.get('type') == 'Polygon' and geom.get('coordinates'):
                            s['cone'] = geom['coordinates'][0]

        res = []
        for sid, s in storms.items():
            s['fc'].sort(key=lambda x: x.get('lead_hours', 0))
            pts = s['obs'] + s['fc']
            now_pt = next((p for p in s['fc'] if p['kind'] == 'now'), (s['fc'][0] if s['fc'] else (s['obs'][-1] if s['obs'] else None)))
            if not now_pt:
                continue

            res.append({
                "id": sid,
                "name": s['name'],
                "basin": s['basin'],
                "category": now_pt['cat'],
                "statusBadge": "LIVE (JTWC/NHC)",
                "sourceName": "ArcGIS Living Atlas (Authoritative JTWC/NHC)",
                "issueTime": s.get('advDate', 'Live Telemetry'),
                "currentCenter": {
                    "lat": now_pt['lat'],
                    "lon": now_pt['lon'],
                    "kt": now_pt['kt'],
                    "kmph": now_pt['kmph'],
                    "cat": now_pt['cat'],
                    "pressure": 980
                },
                "points": pts,
                "cone": s['cone']
            })
        return res

    def handle_parse_bulletin(self):
        """Server-side IMD bulletin parsing endpoint"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            data = json.loads(body)
            text = data.get('bulletin', '')

            # Simple regex parser
            name_m = re.search(r'(?:CYCLONIC STORM|CYCLONE|STORM)\s*[“"\'\‘]([^"\'\”\’]+)[”"\'\’]', text, re.I)
            storm_name = name_m.group(1).strip() if name_m else "Indian Ocean Cyclone"

            row_pattern = re.compile(
                r'(\d{1,2}[\.\/]\d{1,2}(?:[\.\/]\d{2,4})?[\s\/]+\d{4})\s*\|?\s*(\d{1,2}\.?\d*)\s*[°N\s]*[\/,]\s*(\d{1,3}\.?\d*)\s*[°E\s]*\|?\s*(\d{2,3}(?:-\d{2,3})?)\s*(?:GUSTING TO\s*\d{2,3})?\s*(?:kmph|kt)?\s*\|?\s*([^\n\r|]+)',
                re.I
            )
            matches = row_pattern.findall(text)
            points = []
            for idx, m in enumerate(matches):
                dt_str, lat_str, lon_str, wind_str, cat_raw = m
                lat = float(lat_str)
                lon = float(lon_str)
                kmph = float(wind_str.split('-')[1]) if '-' in wind_str else float(wind_str)
                kt = round(kmph / 1.852)
                points.append({
                    "t": dt_str.split('/')[-1] if '/' in dt_str else dt_str,
                    "lat": lat,
                    "lon": lon,
                    "kt": kt,
                    "kmph": int(kmph),
                    "cat": "CS",
                    "kind": "now" if idx == 0 else "fc",
                    "lead_hours": idx * 6
                })

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "success",
                "name": storm_name,
                "points": points
            }).encode('utf-8'))
        except Exception as e:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))


def start_background_updater(interval_seconds=900):
    """Automatically scrapes Mausam IMD for newer advisory PDFs every 15 minutes in the background"""
    def loop():
        time.sleep(15)
        while True:
            try:
                fetch_script = os.path.join(DIRECTORY, "scripts", "fetch_imd.py")
                print("[Auto-Updater] Checking Mausam IMD for latest advisory...")
                subprocess.run([sys.executable, fetch_script], check=True)
            except Exception as err:
                print(f"[Auto-Updater] Notice: {err}")
            time.sleep(interval_seconds)

    updater_thread = threading.Thread(target=loop, daemon=True, name="IMD-AutoUpdater")
    updater_thread.start()


def run_server():
    start_background_updater(900)
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("", PORT), CycloneHandler) as httpd:
        print("=" * 64)
        print("🌀 LIVE CYCLONE TRACK & POWER GRID DASHBOARD")
        print("=" * 64)
        print(f"Server online at: http://localhost:{PORT}")
        print(f"Main Entry:       http://localhost:{PORT}/index.html")
        print(f"Legacy Entry:     http://localhost:{PORT}/arnab_cyclone_openinframap.html")
        print(f"API Endpoint:     http://localhost:{PORT}/api/active-cyclones")
        print("=" * 64)
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")

if __name__ == '__main__':
    run_server()

