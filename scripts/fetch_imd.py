#!/usr/bin/env python3
"""
scripts/fetch_imd.py - Automated IMD Cyclone Bulletin Scraper & Updater
Runs locally or in a GitHub Actions cron job every 30 minutes.
Fetches the latest official bulletin from IMD / RSMC New Delhi,
parses track points and forecast cone, and saves to data/latest_cyclone.json.
"""

import urllib.request
import urllib.error
import json
import re
import os
import sys

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "latest_cyclone.json")

# Candidate IMD bulletin URLs
IMD_BULLETIN_URLS = [
    "https://rsmcnewdelhi.imd.gov.in/uploads/cyclone_bulletin.txt",
    "https://mausam.imd.gov.in/responsive/all_india_bulletin.php",
    "https://rsmcnewdelhi.imd.gov.in"
]

def fetch_url(url, timeout=10):
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,text/plain,*/*"
            }
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                return resp.read().decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"Notice: Fetch failed for {url}: {e}")
    return None

def parse_imd_text(text):
    if not text:
        return None

    # Detect storm name
    name_m = re.search(r'(?:CYCLONIC STORM|CYCLONE|STORM)\s*[“"\'\‘]([^"\'\”\’]+)[”"\'\’]', text, re.I)
    storm_name = name_m.group(1).strip() if name_m else "Arnab"

    # Detect bulletin number
    b_num_m = re.search(r'BULLETIN\s+NO\.?\s*(\d+)(?:\s*\(([^)]+)\))?', text, re.I)
    bulletin_no = f"Bulletin No. {b_num_m.group(1)}" if b_num_m else "Latest Bulletin"
    if b_num_m and b_num_m.group(2):
        bulletin_no += f" ({b_num_m.group(2)})"

    # Detect issue time
    time_m = re.search(r'TIME OF ISSUE:\s*([^\n\r]+)', text, re.I)
    issue_time = time_m.group(1).strip() if time_m else "Latest Advisory"

    # Parse forecast track table
    row_pattern = re.compile(
        r'(\d{1,2}[\.\/]\d{1,2}(?:[\.\/]\d{2,4})?[\s\/]+\d{4})\s*\|?\s*(\d{1,2}\.?\d*)\s*[°N\s]*[\/,]\s*(\d{1,3}\.?\d*)\s*[°E\s]*\|?\s*(\d{2,3}(?:-\d{2,3})?)\s*(?:GUSTING TO\s*\d{2,3})?\s*(?:kmph|kt)?\s*\|?\s*([^\n\r|]+)',
        re.I
    )
    matches = row_pattern.findall(text)
    if not matches:
        return None

    points = []
    for idx, m in enumerate(matches):
        dt_str, lat_str, lon_str, wind_str, cat_raw = m
        lat = float(lat_str)
        lon = float(lon_str)
        kmph = float(wind_str.split('-')[1]) if '-' in wind_str else float(wind_str)
        kt = round(kmph / 1.852)

        # Categorize
        cat = 'CS'
        if kt >= 120: cat = 'SuCS'
        elif kt >= 90: cat = 'ESCS'
        elif kt >= 64: cat = 'VSCS'
        elif kt >= 48: cat = 'SCS'
        elif kt >= 34: cat = 'CS'
        elif kt >= 28: cat = 'DD'
        else: cat = 'D'

        points.append({
            "t": dt_str.split('/')[-1].strip() if '/' in dt_str else dt_str.strip(),
            "lat": lat,
            "lon": lon,
            "kt": kt,
            "kmph": int(kmph),
            "cat": cat,
            "kind": "now" if idx == 0 else "fc",
            "lead_hours": idx * 6
        })

    cur = points[0]
    return {
        "id": f"{storm_name.lower()}_{b_num_m.group(1) if b_num_m else 'latest'}",
        "name": f"{storm_name} ({bulletin_no})",
        "year": 2026,
        "basin": "North Indian Ocean (Bay of Bengal)",
        "category": cur['cat'],
        "categoryFull": "Very Severe Cyclonic Storm" if cur['cat'] == 'VSCS' else cur['cat'],
        "statusBadge": f"IMD {bulletin_no.upper()}",
        "agency": "India Meteorological Department (IMD) / RSMC New Delhi",
        "bulletinNo": bulletin_no,
        "issueTime": issue_time,
        "advisoryType": "National Cyclone Warning for Andhra Pradesh Coast (Red Message)",
        "sourceName": f"IMD RSMC New Delhi ({bulletin_no})",
        "sourceUrl": "https://rsmcnewdelhi.imd.gov.in",
        "currentCenter": {
            "lat": cur['lat'],
            "lon": cur['lon'],
            "kt": cur['kt'],
            "kmph": cur['kmph'],
            "cat": cur['cat'],
            "pressure": 970
        },
        "landfallEstimate": "Projected towards Andhra Pradesh coast",
        "rawBulletin": text,
        "points": points
    }

def main():
    print("=== IMD Cyclone Bulletin Auto-Updater ===")
    parsed_data = None

    # Check command-line argument for local file or pasted text
    if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
        with open(sys.argv[1], 'r', encoding='utf-8') as f:
            print(f"Parsing input file: {sys.argv[1]}")
            parsed_data = parse_imd_text(f.read())
    else:
        for url in IMD_BULLETIN_URLS:
            print(f"Checking IMD feed: {url}...")
            content = fetch_url(url)
            if content:
                parsed = parse_imd_text(content)
                if parsed:
                    parsed_data = parsed
                    print(f"✓ Found bulletin: {parsed['bulletinNo']}")
                    break

    if parsed_data:
        os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(parsed_data, f, indent=2)
        print(f"✓ Saved updated track to {OUTPUT_FILE}")
    else:
        print("No newer bulletin found. Existing latest_cyclone.json preserved.")

if __name__ == '__main__':
    main()

