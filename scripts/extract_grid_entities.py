import os
import sys
import math
import json
import re
import requests
from concurrent.futures import ThreadPoolExecutor
import mapbox_vector_tile
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# Coordinates to Lat/Lon conversion for vector tile pixel coordinates
def to_latlon(z, x, y, ext, px, py):
    fx = x + px / ext
    fy = y + (ext - py) / ext
    n = 2.0 ** z
    lon = (fx / n) * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1.0 - 2.0 * fy / n)))
    lat = math.degrees(lat_rad)
    return round(lat, 5), round(lon, 5)

# Calculate geodetic distance between two coordinates in km (Haversine)
def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2)**2
    return round(r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)), 2)

# Suggest a standardized 8-12 character uppercase PSSE Bus Name
def make_psse_bus_name(name, voltage):
    if not name:
        return 'BUS'
    clean = re.sub(r'[^A-Za-z0-9]', '', name).upper()
    v_num = re.findall(r'\d+', str(voltage))
    v_suffix = ''
    if v_num:
        v = int(v_num[0])
        if v >= 700: v_suffix = '7'
        elif v >= 380: v_suffix = '4'
        elif v >= 200: v_suffix = '2'
        elif v >= 100: v_suffix = '1'
        elif v >= 60: v_suffix = '6'
        elif v >= 30: v_suffix = '3'
    base = clean[:7] if v_suffix else clean[:8]
    return f"{base}{v_suffix}"

# Determine Voltage Class
def get_voltage_class(v):
    try:
        val = float(re.findall(r'[\d\.]+', str(v))[0])
        if val >= 700: return '765 kV'
        elif val >= 380: return '400 kV'
        elif val >= 200: return '220/230 kV'
        elif val >= 100: return '132/110 kV'
        elif val >= 60: return '66 kV'
        elif val >= 30: return '33 kV'
        elif val >= 500: return 'HVDC'
        return f"{int(val)} kV"
    except Exception:
        return 'Unknown'

# Inferred Indian Region based on Lat / Lon
def get_grid_region(lat, lon):
    if lat < 16.0 or (lat < 20.0 and lon > 77.0 and lon < 85.0):
        return 'Southern Region (SR)', 3
    elif lon < 77.0 and lat < 26.0:
        return 'Western Region (WR)', 2
    elif lat >= 26.0 and lon < 82.0:
        return 'Northern Region (NR)', 1
    elif lon >= 88.0 and lat >= 22.0:
        return 'North-Eastern Region (NER)', 5
    else:
        return 'Eastern Region (ER)', 4

def parse_base_plants():
    plants = []
    base_file = os.path.join(os.path.dirname(__file__), '..', 'base_data.js')
    if not os.path.exists(base_file):
        return plants
    try:
        with open(base_file, 'r', encoding='utf-8') as f:
            text = f.read()
        idx1 = text.find('{')
        idx2 = text.find('};')
        if idx1 != -1 and idx2 != -1:
            raw = json.loads(text[idx1:idx2+1])
            for p in raw.get('plants', []):
                # [name, lon, lat, mw, fuel, operator]
                name = str(p[0]).strip()
                lon = float(p[1])
                lat = float(p[2])
                mw = float(p[3]) if p[3] else 0.0
                fuel = str(p[4]).strip() if len(p) > 4 else 'Thermal'
                op = str(p[5]).strip() if len(p) > 5 else ''
                plants.append({
                    'name': name,
                    'lat': round(lat, 5),
                    'lon': round(lon, 5),
                    'mw': mw,
                    'fuel': fuel,
                    'method': 'Conventional' if fuel in ['Coal', 'Gas', 'Lignite'] else fuel,
                    'operator': op,
                    'osm_id': '',
                    'source': 'WRI India Database'
                })
    except Exception as e:
        print(f"Notice: base_data.js parse error: {e}")
    return plants

def extract_all():
    print("=== Starting Grid Extraction for PSS/E Mapping ===")
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    # 1. Define tiles for India
    tiles_z6 = [(6, x, y) for x in range(44, 50) for y in range(24, 31)]
    tiles_z7 = [(7, x, y) for x in range(88, 99) for y in range(48, 62)]
    all_tiles = tiles_z6 + tiles_z7
    print(f"Total tiles to scan: {len(all_tiles)} (z6: {len(tiles_z6)}, z7: {len(tiles_z7)})")

    def fetch_tile(item):
        z, x, y = item
        url = f'https://openinframap.org/map/power/{z}/{x}/{y}.pbf'
        try:
            r = requests.get(url, headers=headers, timeout=8)
            if r.status_code == 200:
                return z, x, y, mapbox_vector_tile.decode(r.content)
        except Exception:
            pass
        return z, x, y, None

    print("Fetching and decoding vector tiles in parallel...")
    with ThreadPoolExecutor(max_workers=16) as exe:
        tile_results = list(exe.map(fetch_tile, all_tiles))
    print("Tiles fetched successfully.")

    substations_map = {}
    lines_map = {}
    plants_map = {}

    for z, x, y, data in tile_results:
        if not data:
            continue
        
        # --- SUBSTATIONS ---
        for layer_name in ['power_substation_point', 'power_substation']:
            if layer_name not in data:
                continue
            ext = data[layer_name].get('extent', 4096)
            for f in data[layer_name]['features']:
                p = f.get('properties', {})
                name = p.get('name')
                if not name or not name.strip():
                    continue
                name_clean = name.strip()
                geom = f.get('geometry', {})
                gtype = geom.get('type')
                coords = geom.get('coordinates', [])
                
                lat, lon = None, None
                if gtype == 'Point' and len(coords) >= 2:
                    lat, lon = to_latlon(z, x, y, ext, coords[0], coords[1])
                elif gtype == 'Polygon' and coords and len(coords[0]) > 0:
                    pts = coords[0]
                    avg_x = sum(pt[0] for pt in pts) / len(pts)
                    avg_y = sum(pt[1] for pt in pts) / len(pts)
                    lat, lon = to_latlon(z, x, y, ext, avg_x, avg_y)
                elif gtype == 'MultiPolygon' and coords and coords[0] and len(coords[0][0]) > 0:
                    pts = coords[0][0]
                    avg_x = sum(pt[0] for pt in pts) / len(pts)
                    avg_y = sum(pt[1] for pt in pts) / len(pts)
                    lat, lon = to_latlon(z, x, y, ext, avg_x, avg_y)
                
                if lat is None or lon is None:
                    continue
                
                # Check bounding box for India (Lat 6..38, Lon 67..98)
                if not (6.0 <= lat <= 38.0 and 67.0 <= lon <= 98.0):
                    continue

                v_raw = str(p.get('voltage', '')).strip()
                v2_raw = str(p.get('voltage_2', '')).strip()
                # Parse numeric voltage
                v_num = 0.0
                m = re.findall(r'[\d\.]+', v_raw)
                if m: v_num = round(float(m[0]), 1)
                
                v2_num = 0.0
                m2 = re.findall(r'[\d\.]+', v2_raw)
                if m2: v2_num = round(float(m2[0]), 1)

                # Deduplication key based on normalized name and approx location
                norm_name = re.sub(r'\s+', ' ', name_clean.lower().replace('sub station', 'substation').replace('s/s', 'substation').replace('ss', 'substation'))
                loc_key = f"{round(lat, 2)}_{round(lon, 2)}"
                key = (norm_name, loc_key)

                if key not in substations_map:
                    substations_map[key] = {
                        'name': name_clean,
                        'voltage': v_num if v_num > 0 else (v2_num if v2_num > 0 else ''),
                        'secondary_v': v2_num if (v2_num > 0 and v2_num != v_num) else '',
                        'substation_type': p.get('substation', 'transmission').capitalize(),
                        'operator': p.get('operator', ''),
                        'osm_id': p.get('osm_id', ''),
                        'lat': lat,
                        'lon': lon
                    }
                else:
                    # Enrich existing if empty
                    if not substations_map[key]['operator'] and p.get('operator'):
                        substations_map[key]['operator'] = p.get('operator')
                    if not substations_map[key]['voltage'] and v_num > 0:
                        substations_map[key]['voltage'] = v_num

        # --- TRANSMISSION LINES ---
        if 'power_line' in data:
            ext = data['power_line'].get('extent', 4096)
            for f in data['power_line']['features']:
                p = f.get('properties', {})
                name = p.get('name')
                if not name or not name.strip():
                    continue
                name_clean = name.strip()
                geom = f.get('geometry', {})
                gtype = geom.get('type')
                coords = geom.get('coordinates', [])
                
                pts_ll = []
                if gtype == 'LineString':
                    pts_ll = [to_latlon(z, x, y, ext, pt[0], pt[1]) for pt in coords if len(pt) >= 2]
                elif gtype == 'MultiLineString':
                    for seg in coords:
                        pts_ll.extend([to_latlon(z, x, y, ext, pt[0], pt[1]) for pt in seg if len(pt) >= 2])
                
                if not pts_ll or len(pts_ll) < 2:
                    continue

                # Filter within India bounds
                if not any(6.0 <= pt[0] <= 38.0 and 67.0 <= pt[1] <= 98.0 for pt in pts_ll):
                    continue

                v_raw = str(p.get('voltage', '')).strip()
                v_num = 0.0
                m = re.findall(r'[\d\.]+', v_raw)
                if m: v_num = round(float(m[0]), 1)

                norm_name = re.sub(r'\s+', ' ', name_clean.lower())
                seg_len = sum(haversine_km(pts_ll[i][0], pts_ll[i][1], pts_ll[i+1][0], pts_ll[i+1][1]) for i in range(len(pts_ll)-1))
                
                if norm_name not in lines_map:
                    lines_map[norm_name] = {
                        'name': name_clean,
                        'voltage': v_num if v_num > 0 else '',
                        'circuits': p.get('circuits', '1'),
                        'frequency': p.get('frequency', '50'),
                        'line_type': 'Underground Cable' if p.get('line') == 'cable' or p.get('tunnel') else 'Overhead Transmission Line',
                        'operator': p.get('operator', ''),
                        'osm_id': p.get('osm_id', ''),
                        'start_pt': pts_ll[0],
                        'end_pt': pts_ll[-1],
                        'all_pts': pts_ll,
                        'total_len_km': seg_len,
                        'segments_count': 1
                    }
                else:
                    lines_map[norm_name]['total_len_km'] += seg_len
                    lines_map[norm_name]['segments_count'] += 1
                    lines_map[norm_name]['all_pts'].extend(pts_ll)
                    if not lines_map[norm_name]['operator'] and p.get('operator'):
                        lines_map[norm_name]['operator'] = p.get('operator')
                    if not lines_map[norm_name]['voltage'] and v_num > 0:
                        lines_map[norm_name]['voltage'] = v_num

        # --- POWER PLANTS ---
        for layer_name in ['power_plant_point', 'power_plant']:
            if layer_name not in data:
                continue
            ext = data[layer_name].get('extent', 4096)
            for f in data[layer_name]['features']:
                p = f.get('properties', {})
                name = p.get('name')
                if not name or not name.strip():
                    continue
                name_clean = name.strip()
                geom = f.get('geometry', {})
                gtype = geom.get('type')
                coords = geom.get('coordinates', [])
                
                lat, lon = None, None
                if gtype == 'Point' and len(coords) >= 2:
                    lat, lon = to_latlon(z, x, y, ext, coords[0], coords[1])
                elif gtype == 'Polygon' and coords and len(coords[0]) > 0:
                    pts = coords[0]
                    avg_x = sum(pt[0] for pt in pts) / len(pts)
                    avg_y = sum(pt[1] for pt in pts) / len(pts)
                    lat, lon = to_latlon(z, x, y, ext, avg_x, avg_y)
                
                if lat is None or lon is None:
                    continue
                if not (6.0 <= lat <= 38.0 and 67.0 <= lon <= 98.0):
                    continue

                output_raw = str(p.get('output', '')).strip()
                mw = 0.0
                m = re.findall(r'[\d\.]+', output_raw)
                if m: mw = round(float(m[0]), 1)

                source = p.get('source', 'Power Plant').capitalize()
                method = p.get('method', '').capitalize()
                
                norm_name = re.sub(r'\s+', ' ', name_clean.lower())
                loc_key = f"{round(lat, 2)}_{round(lon, 2)}"
                key = (norm_name, loc_key)

                if key not in plants_map:
                    plants_map[key] = {
                        'name': name_clean,
                        'mw': mw,
                        'fuel': source,
                        'method': method,
                        'operator': p.get('operator', ''),
                        'osm_id': p.get('osm_id', ''),
                        'lat': lat,
                        'lon': lon,
                        'source': 'OpenInfraMap'
                    }

    print(f"Extracted from OpenInfraMap tiles: {len(substations_map)} substations, {len(lines_map)} lines, {len(plants_map)} plants.")

    # Merge Base Data Plants (WRI Major Plants Database)
    base_plants = parse_base_plants()
    print(f"Merging {len(base_plants)} major power plants from base_data.js...")
    for bp in base_plants:
        norm_name = re.sub(r'\s+', ' ', bp['name'].lower())
        loc_key = f"{round(bp['lat'], 2)}_{round(bp['lon'], 2)}"
        key = (norm_name, loc_key)
        # Check if already present
        matched = False
        for (pn, pk) in plants_map.keys():
            if pn in norm_name or norm_name in pn:
                matched = True
                if bp['mw'] > 0 and (plants_map[(pn, pk)]['mw'] == 0 or plants_map[(pn, pk)]['mw'] < bp['mw']):
                    plants_map[(pn, pk)]['mw'] = bp['mw']
                if not plants_map[(pn, pk)]['operator'] and bp['operator']:
                    plants_map[(pn, pk)]['operator'] = bp['operator']
                if bp['fuel'] and plants_map[(pn, pk)]['fuel'] in ['Power plant', 'Unknown', '']:
                    plants_map[(pn, pk)]['fuel'] = bp['fuel']
                break
        if not matched:
            plants_map[key] = bp

    print(f"Total merged power plants: {len(plants_map)}")

    # 4. Prepare Excel Workbook
    wb = openpyxl.Workbook()
    # Remove default sheet
    wb.remove(wb.active)

    # Styling Palettes
    DARK_NAVY = "1E3A8A"
    SECTION_HEADER = "0F172A"
    PSSE_ACCENT = "FEF3C7"  # Soft gold for PSSE user mapping columns
    PSSE_TEXT = "92400E"
    ZEBRA_FILL = "F8FAFC"
    BORDER_COLOR = "CBD5E1"

    thin_border = Border(
        left=Side(style='thin', color=BORDER_COLOR),
        right=Side(style='thin', color=BORDER_COLOR),
        top=Side(style='thin', color=BORDER_COLOR),
        bottom=Side(style='thin', color=BORDER_COLOR)
    )

    header_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
    data_font = Font(name="Segoe UI", size=10, color="0F172A")
    psse_header_font = Font(name="Segoe UI", size=11, bold=True, color="1E293B")
    
    header_fill = PatternFill(start_color=DARK_NAVY, end_color=DARK_NAVY, fill_type="solid")
    psse_header_fill = PatternFill(start_color="FDE68A", end_color="FDE68A", fill_type="solid")
    psse_cell_fill = PatternFill(start_color="FFFBEB", end_color="FFFBEB", fill_type="solid")
    zebra_fill = PatternFill(start_color=ZEBRA_FILL, end_color=ZEBRA_FILL, fill_type="solid")
    white_fill = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")

    align_center = Alignment(horizontal="center", vertical="center")
    align_left = Alignment(horizontal="left", vertical="center")
    align_right = Alignment(horizontal="right", vertical="center")

    # ==========================================================
    # SHEET 1: SUBSTATIONS
    # ==========================================================
    ws_sub = wb.create_sheet(title="Substations")
    sub_headers = [
        "Entity_ID", "Substation_Name", "Voltage_Rating", "Voltage_kV", "Secondary_kV",
        "Voltage_Class", "Substation_Type", "Operator_Utility", "Latitude", "Longitude",
        "Grid_Region", "PSSE_Bus_Number", "PSSE_Bus_Name", "Base_kV", "Bus_Type",
        "Area_Number", "Zone_Number", "OSM_ID", "Notes"
    ]
    ws_sub.append(sub_headers)

    # Sort substations descending by voltage rating
    sorted_subs = sorted(substations_map.values(), key=lambda s: (float(s['voltage']) if s['voltage'] else 0.0, s['name']), reverse=True)
    
    for i, s in enumerate(sorted_subs, 1):
        v = s['voltage']
        v_class = get_voltage_class(v) if v else 'Distribution/Local'
        region_name, area_code = get_grid_region(s['lat'], s['lon'])
        psse_name = make_psse_bus_name(s['name'], v)
        
        row = [
            f"SUB_{i:04d}",
            s['name'],
            f"{v} kV" if v else "Unspecified",
            v if v else "",
            s['secondary_v'] if s['secondary_v'] else "",
            v_class,
            s['substation_type'],
            s['operator'] if s['operator'] else "",
            s['lat'],
            s['lon'],
            region_name,
            "",  # PSSE_Bus_Number (User maps here)
            psse_name,
            v if v else "",
            1,   # Default PSSE Bus Type: 1 (Load / PQ Bus)
            area_code,
            "",  # Zone Number
            s['osm_id'],
            "Direct OpenInfraMap Asset"
        ]
        ws_sub.append(row)

    # ==========================================================
    # SHEET 2: TRANSMISSION LINES
    # ==========================================================
    ws_lines = wb.create_sheet(title="Transmission_Lines")
    line_headers = [
        "Entity_ID", "Line_Name", "Voltage_Rating", "Voltage_kV", "Voltage_Class",
        "Circuits", "Frequency_Hz", "Line_Type", "Operator_Utility", "Est_Length_km",
        "From_Substation_Guess", "To_Substation_Guess", "Midpoint_Lat", "Midpoint_Lon",
        "Start_Lat", "Start_Lon", "End_Lat", "End_Lon", "PSSE_From_Bus", "PSSE_To_Bus",
        "Circuit_ID", "R_pu", "X_pu", "B_pu", "Rate_MVA", "OSM_ID"
    ]
    ws_lines.append(line_headers)

    sorted_lines = sorted(lines_map.values(), key=lambda l: (float(l['voltage']) if l['voltage'] else 0.0, l['name']), reverse=True)
    for i, l in enumerate(sorted_lines, 1):
        v = l['voltage']
        v_class = get_voltage_class(v) if v else 'Unknown'
        
        # Calculate midpoint
        pts = l['all_pts']
        mid_lat = round(sum(p[0] for p in pts) / len(pts), 5)
        mid_lon = round(sum(p[1] for p in pts) / len(pts), 5)
        
        # Split line name guess (e.g. "400 kV Vijayawada - Nellore")
        name_clean = l['name']
        parts = re.split(r'[-–—]| to | TO | To ', re.sub(r'^\d+\s*k[vV]\s*', '', name_clean))
        from_guess = parts[0].strip() if len(parts) > 0 else ""
        to_guess = parts[1].strip() if len(parts) > 1 else ""

        # Default thermal rating MVA estimate based on voltage
        rate_mva = 0
        if v:
            vf = float(v)
            if vf >= 765: rate_mva = 3000
            elif vf >= 400: rate_mva = 1200
            elif vf >= 220: rate_mva = 400
            elif vf >= 132: rate_mva = 150
            elif vf >= 66: rate_mva = 60

        row = [
            f"LINE_{i:04d}",
            l['name'],
            f"{v} kV" if v else "Unspecified",
            v if v else "",
            v_class,
            l['circuits'],
            l['frequency'],
            l['line_type'],
            l['operator'] if l['operator'] else "",
            round(l['total_len_km'], 2),
            from_guess,
            to_guess,
            mid_lat,
            mid_lon,
            l['start_pt'][0],
            l['start_pt'][1],
            l['end_pt'][0],
            l['end_pt'][1],
            "",  # PSSE_From_Bus
            "",  # PSSE_To_Bus
            "1" if str(l['circuits']) in ['1', 'SC', 'Single'] else "1",
            "",  # R_pu (User parameter)
            "",  # X_pu (User parameter)
            "",  # B_pu (User parameter)
            rate_mva if rate_mva > 0 else "",
            l['osm_id']
        ]
        ws_lines.append(row)

    # ==========================================================
    # SHEET 3: POWER PLANTS
    # ==========================================================
    ws_plants = wb.create_sheet(title="Power_Plants")
    plant_headers = [
        "Entity_ID", "Plant_Name", "Capacity_MW", "Fuel_Source", "Generation_Method",
        "Operator_Utility", "Latitude", "Longitude", "Grid_Region", "PSSE_Bus_Number",
        "PSSE_Bus_Name", "Machine_ID", "Base_kV", "Bus_Type", "Pmax_MW", "Pmin_MW",
        "Qmax_MVAR", "Qmin_MVAR", "Mbase_MVA", "Data_Source", "OSM_ID"
    ]
    ws_plants.append(plant_headers)

    sorted_plants = sorted(plants_map.values(), key=lambda p: (float(p['mw']) if p['mw'] else 0.0, p['name']), reverse=True)
    for i, p in enumerate(sorted_plants, 1):
        mw = float(p['mw']) if p['mw'] else 0.0
        region_name, area_code = get_grid_region(p['lat'], p['lon'])
        psse_gen_name = make_psse_bus_name(p['name'], 400 if mw >= 500 else (220 if mw >= 200 else 132))

        # Estimate reactive capability: Qmax ~ 0.4 * Pmax, Qmin ~ -0.2 * Pmax
        qmax = round(0.4 * mw, 1) if mw > 0 else ""
        qmin = round(-0.2 * mw, 1) if mw > 0 else ""
        mbase = round(mw / 0.85, 1) if mw > 0 else ""

        row = [
            f"GEN_{i:04d}",
            p['name'],
            mw if mw > 0 else "",
            p['fuel'],
            p['method'] if p['method'] else p['fuel'],
            p['operator'] if p['operator'] else "",
            p['lat'],
            p['lon'],
            region_name,
            "",  # PSSE_Bus_Number (User maps here)
            psse_gen_name,
            "1", # Machine_ID
            "",  # Interconnection Base kV
            2,   # PSSE Bus Type: 2 (Generator / PV Bus)
            mw if mw > 0 else "",
            round(0.4 * mw, 1) if mw > 100 else 0, # Pmin
            qmax,
            qmin,
            mbase,
            p['source'],
            p['osm_id']
        ]
        ws_plants.append(row)

    # ==========================================================
    # SHEET 4: SUMMARY & PSSE GUIDE
    # ==========================================================
    ws_guide = wb.create_sheet(title="Summary_and_Guide")
    
    # Write guide and summary content
    guide_lines = [
        ["POWER SYSTEM GRID ENTITIES & PSSE BUS MAPPING WORKBOOK", ""],
        ["Generated for India Power Grid & Cyclone Impact Modeling", ""],
        ["", ""],
        ["EXECUTIVE SUMMARY & STATISTICS", ""],
        ["Total Identified Substations:", len(sorted_subs)],
        ["Total Identified Transmission Lines:", len(sorted_lines)],
        ["Total Identified Power Plants:", len(sorted_plants)],
        ["Total Generation Capacity Cataloged (MW):", sum(p['mw'] for p in sorted_plants if p['mw'])],
        ["", ""],
        ["SUBSTATION BREAKDOWN BY VOLTAGE LEVEL", "COUNT"],
    ]

    # Voltage breakdown counts
    v_counts = {}
    for s in sorted_subs:
        vc = get_voltage_class(s['voltage']) if s['voltage'] else 'Unspecified/Local'
        v_counts[vc] = v_counts.get(vc, 0) + 1
    for k, v in sorted(v_counts.items(), key=lambda x: -x[1]):
        guide_lines.append([k, v])

    guide_lines.extend([
        ["", ""],
        ["POWER PLANT BREAKDOWN BY FUEL TYPE", "COUNT"],
    ])
    fuel_counts = {}
    for p in sorted_plants:
        f = p['fuel'] if p['fuel'] else 'Unknown'
        fuel_counts[f] = fuel_counts.get(f, 0) + 1
    for k, v in sorted(fuel_counts.items(), key=lambda x: -x[1]):
        guide_lines.append([k, v])

    guide_lines.extend([
        ["", ""],
        ["HOW TO MAP THIS DATA INTO SIEMENS PTI PSS/E", ""],
        ["1. Bus Data Record (.raw file Format)", "PSS/E requires: I, 'NAME', BASKV, IDE, AREA, ZONE, OWNER, VM, VA"],
        ["   - Column 'PSSE_Bus_Number' (I):", "Enter your system bus integer (1 to 999999)."],
        ["   - Column 'PSSE_Bus_Name' ('NAME'):", "Pre-generated 8-character uppercase identifier with voltage suffix."],
        ["   - Column 'Base_kV' (BASKV):", "Nominal substation bus voltage in kV (765, 400, 220, 132, etc.)."],
        ["   - Column 'Bus_Type' (IDE):", "1 = PQ (Load), 2 = PV (Generator), 3 = Swing / Slack Bus, 4 = Disconnected."],
        ["   - Column 'Area_Number' (AREA):", "Standard Regional Code (1=Northern, 2=Western, 3=Southern, 4=Eastern, 5=North-Eastern)."],
        ["", ""],
        ["2. Branch / Transmission Line Data Record (.raw file Format)", "PSS/E requires: I, J, CKT, R, X, B, RATEA, RATEB, RATEC, GI, BI, GJ, BJ, ST, MET, LEN, O1, F1..."],
        ["   - 'PSSE_From_Bus' (I) & 'PSSE_To_Bus' (J):", "Enter corresponding terminal bus numbers mapped from the Substations sheet."],
        ["   - 'Circuit_ID' (CKT):", "Default is '1' for single circuit, '2' for second circuit of double circuit towers."],
        ["   - 'R_pu', 'X_pu', 'B_pu':", "Per-unit impedance values on system MVA base (typically 100 MVA)."],
        ["   - 'Rate_MVA' (RATEA):", "Continuous thermal rating in MVA (pre-estimated based on voltage class)."],
        ["", ""],
        ["3. Generator Data Record (.raw file Format)", "PSS/E requires: I, ID, PG, QG, QT, QB, VS, IREG, MBASE, ZR, ZX, RT, XT, GTAP, STAT, RMPCT, PT, PB..."],
        ["   - 'PSSE_Bus_Number' (I):", "Enter the generator POI / switchyard bus number."],
        ["   - 'Machine_ID' (ID):", "Default set to '1'."],
        ["   - 'Pmax_MW' (PT) & 'Pmin_MW' (PB):", "Active power limits (MW)."],
        ["   - 'Qmax_MVAR' (QT) & 'Qmin_MVAR' (QB):", "Pre-calculated based on typical 0.85 PF generator capability curve."],
        ["   - 'Mbase_MVA' (MBASE):", "Nominal MVA base = MW / 0.85."]
    ])

    for row in guide_lines:
        ws_guide.append(row)

    # ==========================================================
    # STYLING & FORMATTING FOR ALL SHEETS
    # ==========================================================
    for ws in [ws_sub, ws_lines, ws_plants]:
        ws.views.sheetView[0].showGridLines = True
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions

        # Format Header Row
        for cell in ws[1]:
            col_name = str(cell.value)
            cell.alignment = align_center
            if "PSSE" in col_name or col_name in ["Base_kV", "Bus_Type", "Area_Number", "Zone_Number", "R_pu", "X_pu", "B_pu", "Rate_MVA", "Machine_ID", "Pmax_MW", "Pmin_MW", "Qmax_MVAR", "Qmin_MVAR", "Mbase_MVA", "Circuit_ID"]:
                cell.fill = psse_header_fill
                cell.font = psse_header_font
            else:
                cell.fill = header_fill
                cell.font = header_font
            cell.border = thin_border
        
        # Format Data Rows
        max_row = ws.max_row
        max_col = ws.max_column
        for r_idx in range(2, max_row + 1):
            is_even = (r_idx % 2 == 0)
            row_fill = zebra_fill if is_even else white_fill
            for c_idx in range(1, max_col + 1):
                cell = ws.cell(row=r_idx, column=c_idx)
                col_name = str(ws.cell(row=1, column=c_idx).value)
                cell.font = data_font
                cell.border = thin_border
                
                # Check if this is a PSSE mapping column
                if "PSSE" in col_name or col_name in ["R_pu", "X_pu", "B_pu"]:
                    cell.fill = psse_cell_fill
                else:
                    cell.fill = row_fill

                # Alignments
                if col_name in ["Entity_ID", "Voltage_Rating", "Voltage_kV", "Secondary_kV", "Voltage_Class", "PSSE_Bus_Number", "PSSE_Bus_Name", "Base_kV", "Bus_Type", "Area_Number", "Zone_Number", "Machine_ID", "Circuits", "Frequency_Hz", "Circuit_ID"]:
                    cell.alignment = align_center
                elif col_name in ["Latitude", "Longitude", "Capacity_MW", "Est_Length_km", "Midpoint_Lat", "Midpoint_Lon", "Start_Lat", "Start_Lon", "End_Lat", "End_Lon", "Pmax_MW", "Pmin_MW", "Qmax_MVAR", "Qmin_MVAR", "Mbase_MVA", "Rate_MVA"]:
                    cell.alignment = align_right
                else:
                    cell.alignment = align_left

        # Auto-adjust column widths
        for col in ws.columns:
            max_len = 0
            col_letter = get_column_letter(col[0].column)
            for cell in col:
                val = str(cell.value or '')
                if len(val) > max_len:
                    max_len = len(val)
            ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

    # Style Guide Sheet
    ws_guide.views.sheetView[0].showGridLines = True
    ws_guide.column_dimensions['A'].width = 48
    ws_guide.column_dimensions['B'].width = 80
    
    ws_guide['A1'].font = Font(name="Segoe UI", size=14, bold=True, color="1E3A8A")
    ws_guide['A2'].font = Font(name="Segoe UI", size=11, italic=True, color="475569")
    ws_guide['A4'].font = Font(name="Segoe UI", size=12, bold=True, color="0F172A")
    ws_guide['A10'].font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
    ws_guide['B10'].font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
    ws_guide['A10'].fill = header_fill
    ws_guide['B10'].fill = header_fill
    
    for r in range(1, ws_guide.max_row + 1):
        c1 = ws_guide.cell(row=r, column=1)
        c2 = ws_guide.cell(row=r, column=2)
        if "HOW TO MAP" in str(c1.value) or "BREAKDOWN" in str(c1.value):
            c1.font = Font(name="Segoe UI", size=12, bold=True, color="0F172A")
        elif "Format)" in str(c1.value):
            c1.font = Font(name="Segoe UI", size=11, bold=True, color="1E3A8A")
            c2.font = Font(name="Segoe UI", size=10, italic=True, color="334155")
        elif not c1.font.bold:
            c1.font = Font(name="Segoe UI", size=10, color="1E293B")
            c2.font = Font(name="Segoe UI", size=10, color="1E293B")

    # Save Excel Workbook
    output_path = os.path.join(os.path.dirname(__file__), '..', 'Power_System_Grid_Entities_PSSE_Mapping.xlsx')
    output_path = os.path.abspath(output_path)
    wb.save(output_path)
    print(f"\n=======================================================")
    print(f"Excel file successfully generated at:")
    print(f"{output_path}")
    print(f"Substations: {len(sorted_subs)}")
    print(f"Transmission Lines: {len(sorted_lines)}")
    print(f"Power Plants: {len(sorted_plants)}")
    print(f"=======================================================")

if __name__ == '__main__':
    extract_all()
