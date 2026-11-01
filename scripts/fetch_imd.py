#!/usr/bin/env python3
"""
scripts/fetch_imd.py - IMD Cyclone Bulletin Scraper & Updater
Target URL: https://mausam.imd.gov.in/imd_latest/contents/cyclone.php
Always checks this exact URL, scrapes the latest cyclone advisory / bulletin PDF,
parses the forecast track coordinates and winds, and updates data/latest_cyclone.json.

User requirement:
If a cyclone name is not available in the advisory (e.g. Deep Depression, Depression, Low Pressure),
keep it as "Latest Advisory" instead of defaulting to a specific name.
"""

import urllib.request
import urllib.error
import ssl
import json
import re
import os
import sys
import io
import subprocess
import glob
from datetime import datetime

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

TARGET_URL = "https://mausam.imd.gov.in/imd_latest/contents/cyclone.php"
BASE_HOST = "https://mausam.imd.gov.in"
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_FILE = os.path.join(PROJECT_DIR, "data", "latest_cyclone.json")
OUTPUT_JS_FILE = os.path.join(PROJECT_DIR, "data", "latest_cyclone_data.js")
INDEX_HTML = os.path.join(PROJECT_DIR, "index.html")
ADVISORY_HTML = os.path.join(PROJECT_DIR, "latest_advisory.html")

def get_ssl_context():
    # Bypass certificate chain validation for Indian Govt (.gov.in) servers
    return ssl._create_unverified_context()

def fetch_mausam_page():
    print(f"Checking primary source: {TARGET_URL}...")
    req = urllib.request.Request(
        TARGET_URL,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,*/*"
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=15, context=get_ssl_context()) as resp:
            if resp.status == 200:
                return resp.read().decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"Error loading {TARGET_URL}: {e}")
    return None

def extract_pdf_url_from_html(html):
    if not html:
        return None

    # Matches href unquoted or quoted pointing to cyclone_pdf
    pdf_matches = re.findall(r'href=[\x27\x22]?([^\s>\x27\x22]*cyclone_pdf[^\s>\x27\x22]*\.pdf)', html, re.I)
    if not pdf_matches:
        # Fallback to any PDF link on the page
        pdf_matches = re.findall(r'href=[\x27\x22]?([^\s>\x27\x22]*\.pdf)', html, re.I)

    if not pdf_matches:
        return None

    # Filter out empty or "No_Cyclone" templates
    valid_candidates = [p for p in pdf_matches if 'no_cyclone' not in p.lower()]
    if not valid_candidates:
        valid_candidates = pdf_matches

    # Prioritize official National Bulletin or Tropical Cyclone Advisory over general outlooks
    chosen_rel = next((p for p in valid_candidates if any(k in p.lower() for k in ['national_bulletin', 'advisory', 'bulletin'])), None)
    if not chosen_rel:
        chosen_rel = next((p for p in valid_candidates if 'outlook' in p.lower()), valid_candidates[0])
    
    # Resolve relative path ../../backend/assets/...
    clean_path = re.sub(r'^\.\./\.\./', '', chosen_rel)
    if clean_path.startswith("http"):
        return clean_path
    return f"{BASE_HOST}/{clean_path.lstrip('/')}"

def download_and_extract_pdf_text(pdf_url):
    print(f"Scraping advisory PDF: {pdf_url}...")
    req = urllib.request.Request(pdf_url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=20, context=get_ssl_context()) as resp:
            pdf_bytes = resp.read()

        import pdfplumber
        full_text = ""
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                txt = page.extract_text()
                if txt:
                    full_text += txt + "\n"
        return full_text
    except Exception as e:
        print(f"Error extracting PDF: {e}")
        return None

def parse_advisory_text(full_text):
    if not full_text:
        return None

    # 1. Subject line extraction
    sub_m = re.search(r'(?:Sub|Subject)\s*:\s*[-–—\s]*([^\n\r]+)', full_text[:2500], re.I)
    sub_text = sub_m.group(1).strip() if sub_m else ""

    # 2. Check for explicit named storm in subject or early header (first 1200 chars)
    # Strictly avoid matching historical comparisons in remarks (e.g. 'compared to Arnab')
    name_m = re.search(r'(?:CYCLONIC\s+STORM|CYCLONE)\s*[\x22\x27\u201c\u2018]([A-Za-z0-9_-]+)[\x22\x27\u201d\u2019]', sub_text, re.I)
    if not name_m:
        name_m = re.search(r'(?:CYCLONIC\s+STORM|CYCLONE)\s+[\x22\x27\u201c\u2018]([A-Za-z0-9_-]+)[\x22\x27\u201d\u2019]', full_text[:1200], re.I)
    if not name_m:
        name_m = re.search(r'NAME\s+OF\s+THE\s+CYCLONIC\s+STORM[:\s]+[\x22\x27\u201c\u2018]?([A-Za-z0-9_-]+)[\x22\x27\u201d\u2019]?', full_text[:1200], re.I)

    # 3. Advisory / Bulletin Number
    adv_m = re.search(r'TROPICAL\s+CYCLONE\s+ADVISORY\s+NO\.?\s*(\d+)', full_text[:1500], re.I)
    bull_m = re.search(r'NATIONAL\s+BULLETIN\s+NO\.?\s*(\d+)', full_text[:1500], re.I)

    if adv_m:
        bulletin_no = f"Advisory No. {adv_m.group(1)}"
        status_badge = f"IMD ADVISORY #{adv_m.group(1)}"
    elif bull_m:
        bulletin_no = f"Bulletin No. {bull_m.group(1)}"
        status_badge = f"IMD BULLETIN #{bull_m.group(1)}"
    else:
        bulletin_no = "Latest Advisory"
        status_badge = "IMD LATEST ADVISORY"

    # User rule: If cyclone name is not available in advisory, keep it as "Latest Advisory" instead of name
    if name_m:
        raw_name = name_m.group(1).strip()
        storm_name = raw_name.title()
        display_name = f"{storm_name} ({bulletin_no})" if bulletin_no != "Latest Advisory" else storm_name
        storm_id = f"{storm_name.lower()}_{bulletin_no.replace(' ', '_').lower()}"
    else:
        storm_name = "Latest Advisory"
        display_name = "Latest Advisory"
        storm_id = f"latest_advisory_{bulletin_no.replace(' ', '_').lower()}"

    # 4. Issue Time
    time_m = re.search(r'TIME OF ISSUE\s*:\s*([^\n\r]+)', full_text[:2000], re.I)
    if not time_m:
        time_m = re.search(r'ISSUED\s+AT\s+([^\n\r]+?)(?:Sub:|$)', full_text[:2000], re.I)
    issue_time = time_m.group(1).strip() if time_m else "Latest Telemetry"

    # 5. Forecast Track Points Table
    is_ist_table = bool(re.search(r'Date\/Time[\s\S]{0,100}?\(\s*IST\s*\)', full_text, re.I))
    row_pattern = re.compile(
        r'(\d{1,2}[\.\/]\d{1,2}(?:[\.\/]\d{2,4})?[\s\/]+\d{4})\s+(\d{1,2}\.?\d*)\s*[\/,\s]+\s*(\d{1,3}\.?\d*)\s+(\d{2,3}(?:-\d{2,3})?)\s*(?:gusting to\s*\d{2,3})?\s+([^\n\r|]+)',
        re.I
    )
    matches = row_pattern.findall(full_text)
    if not matches:
        return None

    fc_pts = []
    for idx, (dt_str, lat_s, lon_s, wind_s, cat_s) in enumerate(matches):
        lat = float(lat_s)
        lon = float(lon_s)
        kmph = float(wind_s.split('-')[1]) if '-' in wind_s else float(wind_s)
        kt = round(kmph / 1.852)

        c_upper = cat_s.upper()
        if "SUPER" in c_upper: cat = "SuCS"
        elif "EXTREMELY" in c_upper: cat = "ESCS"
        elif "VERY SEVERE" in c_upper: cat = "VSCS"
        elif "SEVERE" in c_upper: cat = "SCS"
        elif "DEEP" in c_upper: cat = "DD"
        elif "CYCLONIC" in c_upper: cat = "CS"
        elif "DEPRESSION" in c_upper: cat = "D"
        else: cat = "WML"

        # Format time representation for dashboard
        # Parses date and hour, converting IST to UTC format if needed so app.js utcToIst renders smoothly
        try:
            m_dt = dt_str.split('/')
            date_part = m_dt[0]
            time_part = m_dt[1] if len(m_dt) > 1 else '0000'
            day = date_part.split('.')[0] if '.' in date_part else date_part
            time_digits = ''.join(c for c in time_part if c.isdigit())[:4].zfill(4)
            hh = int(time_digits[:2])
            mm = int(time_digits[2:])
            if is_ist_table:
                # Convert IST (UTC+5:30) to UTC DD/HH
                total_m = hh * 60 + mm - 330
                d_int = int(day)
                if total_m < 0:
                    total_m += 1440
                    d_int -= 1
                utc_hh = total_m // 60
                t_label = f"{d_int:02d}/{utc_hh:02d}"
            else:
                t_label = f"{int(day):02d}/{hh:02d}"
        except Exception:
            t_label = dt_str.split('/')[-1].strip() if '/' in dt_str else dt_str.strip()

        fc_pts.append({
            "t": t_label,
            "rawTime": dt_str,
            "lat": lat,
            "lon": lon,
            "kt": kt,
            "kmph": int(kmph),
            "cat": cat,
            "kind": "now" if idx == 0 else "fc",
            "lead_hours": idx * 6
        })

    cur = fc_pts[0]
    # For a new system/bulletin, do NOT prepend historical points from past cyclones (like Arnab).
    # All points are directly from the current advisory track.
    all_points = fc_pts

    category_full = (
        "Super Cyclonic Storm" if cur['cat'] == 'SuCS' else
        "Extremely Severe Cyclonic Storm" if cur['cat'] == 'ESCS' else
        "Very Severe Cyclonic Storm" if cur['cat'] == 'VSCS' else
        "Severe Cyclonic Storm" if cur['cat'] == 'SCS' else
        "Cyclonic Storm" if cur['cat'] == 'CS' else
        "Deep Depression" if cur['cat'] == 'DD' else
        "Depression" if cur['cat'] == 'D' else
        "Well Marked Low Pressure" if cur['cat'] == 'WML' else cur['cat']
    )

    # 6. Central Pressure
    press_m = re.search(r'(?:central pressure|pressure is|pressure of)\s*(?:about|around)?\s*(\d{3,4})\s*hPa', full_text, re.I)
    pressure_val = int(press_m.group(1)) if press_m else (1007 if cur['cat'] in ['D', 'DD'] else 992)

    # 7. Landfall Estimate
    landfall_m = re.search(r'(?:very likely to\s+)?cross\s+([^\r\n]+?\b2026\b|[^\r\n.]+)', full_text, re.I)
    if landfall_m:
        landfall_est = f"To cross {landfall_m.group(1).strip()}"
    else:
        landfall_est = "Tracking over Bay of Bengal; Doppler radars monitoring"

    # 8. Advisory Type
    advisory_type = sub_text if sub_text else f"{category_full} Advisory for Bay of Bengal Coast"

    return {
        "id": storm_id,
        "name": display_name,
        "year": 2026,
        "basin": "North Indian Ocean (Bay of Bengal)",
        "category": cur['cat'],
        "categoryFull": category_full,
        "statusBadge": status_badge,
        "agency": "India Meteorological Department (IMD) / RSMC New Delhi",
        "bulletinNo": bulletin_no,
        "issueTime": issue_time,
        "advisoryType": advisory_type,
        "sourceName": f"IMD Mausam Portal ({bulletin_no})",
        "sourceUrl": TARGET_URL,
        "currentCenter": {
            "lat": cur['lat'],
            "lon": cur['lon'],
            "kt": cur['kt'],
            "kmph": cur['kmph'],
            "cat": cur['cat'],
            "pressure": pressure_val
        },
        "landfallEstimate": landfall_est,
        "rawBulletin": full_text[:4000],
        "points": all_points
    }

def get_git_exe():
    import shutil
    g = shutil.which("git")
    if g:
        return g
    candidates = glob.glob(os.path.expandvars(r"%LOCALAPPDATA%\GitHubDesktop\app-*\resources\app\git\cmd\git.exe"))
    if candidates:
        git_dir = os.path.dirname(candidates[-1])
        if git_dir not in os.environ.get("PATH", ""):
            os.environ["PATH"] = git_dir + os.pathsep + os.environ.get("PATH", "")
        return candidates[-1]
    for p in [r"C:\Program Files\Git\cmd\git.exe", r"C:\Program Files\Git\bin\git.exe"]:
        if os.path.exists(p):
            git_dir = os.path.dirname(p)
            if git_dir not in os.environ.get("PATH", ""):
                os.environ["PATH"] = git_dir + os.pathsep + os.environ.get("PATH", "")
            return p
    return None

def git_sync_push(parsed):
    git_cmd = get_git_exe()
    if not git_cmd:
        print("[Git Sync] Git executable not located. Skipping push to GitHub.")
        return False
    try:
        status_proc = subprocess.run(
            [git_cmd, "status", "--porcelain", "data/", "latest_advisory.html", "arnab_cyclone_openinframap.html"],
            cwd=PROJECT_DIR, capture_output=True, text=True
        )
        if not status_proc.stdout.strip():
            print("[Git Sync] Repository is already up-to-date with latest advisory.")
            return True

        print(f"[Git Sync] Detected updated advisory files. Committing and pushing to GitHub Pages...")
        subprocess.run(
            [git_cmd, "add", "data/latest_cyclone.json", "data/latest_cyclone_data.js", "latest_advisory.html", "arnab_cyclone_openinframap.html"],
            cwd=PROJECT_DIR, check=True
        )
        storm_title = parsed.get('name', 'Latest Advisory')
        bull_label = parsed.get('bulletinNo', '')
        commit_msg = f"Auto-update IMD Advisory: {storm_title} ({bull_label}) [skip ci]"
        subprocess.run([git_cmd, "commit", "-m", commit_msg], cwd=PROJECT_DIR, check=True)

        print("[Git Sync] Pushing to GitHub (origin/main)...")
        push_res = subprocess.run([git_cmd, "push", "origin", "main"], cwd=PROJECT_DIR, capture_output=True, text=True)
        if push_res.returncode == 0:
            print("[Git Sync] ✓ Successfully pushed to GitHub Pages!")
            print("           Live track: https://ajithganji.github.io/cyclone-tracking/")
            return True
        else:
            print(f"[Git Sync] Notice during git push: {push_res.stderr.strip()}")
            return False
    except Exception as e:
        print(f"[Git Sync] Notice: {e}")
        return False

def main():
    print("=== IMD Cyclone Scraper (Target: mausam.imd.gov.in/imd_latest/contents/cyclone.php) ===")
    
    html = fetch_mausam_page()
    if not html:
        print("Failed to fetch Mausam cyclone page.")
        return

    pdf_url = extract_pdf_url_from_html(html)
    if not pdf_url:
        print("No cyclone PDF link found on page.")
        return

    full_text = download_and_extract_pdf_text(pdf_url)
    if not full_text:
        print("Failed to extract text from advisory PDF.")
        return

    parsed = parse_advisory_text(full_text)
    if not parsed:
        print("Could not parse cyclone advisory table.")
        return

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(parsed, f, indent=2)

    # Generate static JavaScript payload for zero-backend GitHub Pages and local offline viewing
    with open(OUTPUT_JS_FILE, 'w', encoding='utf-8') as f:
        f.write("// Auto-generated by scripts/fetch_imd.py for zero-backend static deployment\n")
        f.write(f"window.LATEST_IMD_ADVISORY = {json.dumps(parsed, indent=2)};\n")

    # Generate/update latest_advisory.html and arnab_cyclone_openinframap.html
    if os.path.exists(INDEX_HTML):
        try:
            import shutil
            shutil.copy2(INDEX_HTML, ADVISORY_HTML)
            legacy_html = os.path.join(PROJECT_DIR, "arnab_cyclone_openinframap.html")
            shutil.copy2(INDEX_HTML, legacy_html)
        except Exception:
            pass

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S IST")
    print("=" * 64)
    print(f"🌀 [{now_str}] IMD ADVISORY PROCESSED SUCCESSFULLY")
    print("=" * 64)
    print(f"  Storm Name:     {parsed['name']}")
    print(f"  Bulletin No:    {parsed.get('bulletinNo', 'Latest Advisory')}")
    print(f"  Category:       {parsed['categoryFull']} ({parsed['category']})")
    print(f"  Issue Time:     {parsed.get('issueTime', 'Latest')}")
    print(f"  Current Center: {parsed['currentCenter']['lat']}°N, {parsed['currentCenter']['lon']}°E | {parsed['currentCenter']['kmph']} km/h ({parsed['currentCenter']['kt']} kt)")
    print(f"  Forecast Track: {len(parsed['points'])} points mapped")
    print(f"  Landfall Est:   {parsed.get('landfallEstimate', 'N/A')[:80]}")
    print("-" * 64)

    # Automatically commit and push updates to GitHub
    git_sync_push(parsed)
    print("=" * 64)

if __name__ == '__main__':
    main()
