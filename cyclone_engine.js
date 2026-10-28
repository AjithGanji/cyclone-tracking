/**
 * cyclone_engine.js - Core Meteorological & Geospatial Engine
 * Provides:
 * 1. Official IMD Cone of Uncertainty (SOP error radii) generation
 * 2. IMD National Cyclone Bulletin text parser
 * 3. Esri Living Atlas (JTWC/NHC) & GDACS GeoJSON parsers
 * 4. Geodesic distance & cardinal direction calculators
 * 5. Spatial Point-in-Polygon testing for power grid assets
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CycloneEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const EARTH_RADIUS_KM = 6371.0;

  // IMD Standard Operating Procedure (SOP) Average Forecast Position Errors (km)
  const IMD_SOP_RADII = [
    { hours: 0, radiusKm: 30 },
    { hours: 12, radiusKm: 75 },
    { hours: 24, radiusKm: 150 },
    { hours: 36, radiusKm: 200 },
    { hours: 48, radiusKm: 250 },
    { hours: 60, radiusKm: 300 },
    { hours: 72, radiusKm: 350 },
    { hours: 96, radiusKm: 450 },
    { hours: 120, radiusKm: 550 }
  ];

  // Key coastal weather radar & reference stations along Indian coasts
  const COASTAL_STATIONS = [
    { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185, state: "Andhra Pradesh" },
    { name: "Kakinada", lat: 16.9891, lon: 82.2475, state: "Andhra Pradesh" },
    { name: "Machilipatnam", lat: 16.1875, lon: 81.1389, state: "Andhra Pradesh" },
    { name: "Bapatla", lat: 15.9042, lon: 80.4673, state: "Andhra Pradesh" },
    { name: "Nellore", lat: 14.4426, lon: 79.9865, state: "Andhra Pradesh" },
    { name: "Gopalpur", lat: 19.2618, lon: 84.9080, state: "Odisha" },
    { name: "Puri", lat: 19.8135, lon: 85.8312, state: "Odisha" },
    { name: "Paradip", lat: 20.3165, lon: 86.6114, state: "Odisha" },
    { name: "Dhamra", lat: 20.8033, lon: 86.9667, state: "Odisha" },
    { name: "Digha", lat: 21.6266, lon: 87.5074, state: "West Bengal" },
    { name: "Sagar Island", lat: 21.6500, lon: 88.0833, state: "West Bengal" },
    { name: "Kolkata", lat: 22.5726, lon: 88.3639, state: "West Bengal" },
    { name: "Chennai", lat: 13.0827, lon: 80.2707, state: "Tamil Nadu" },
    { name: "Nagapattinam", lat: 10.7656, lon: 79.8424, state: "Tamil Nadu" },
    { name: "Veraval", lat: 20.9000, lon: 70.3667, state: "Gujarat" },
    { name: "Porbandar", lat: 21.6417, lon: 69.6293, state: "Gujarat" },
    { name: "Dwarka", lat: 22.2442, lon: 68.9685, state: "Gujarat" },
    { name: "Jakhau", lat: 23.2389, lon: 68.7056, state: "Gujarat" }
  ];

  const IMD_CATEGORIES = {
    'SUCS': { code: 'SuCS', name: 'Super Cyclonic Storm', minKt: 120, col: '#741b47' },
    'ESCS': { code: 'ESCS', name: 'Extremely Severe Cyclonic Storm', minKt: 90, maxKt: 119, col: '#990000' },
    'VSCS': { code: 'VSCS', name: 'Very Severe Cyclonic Storm', minKt: 64, maxKt: 89, col: '#cc0000' },
    'SCS': { code: 'SCS', name: 'Severe Cyclonic Storm', minKt: 48, maxKt: 63, col: '#e06666' },
    'CS': { code: 'CS', name: 'Cyclonic Storm', minKt: 34, maxKt: 47, col: '#e69138' },
    'DD': { code: 'DD', name: 'Deep Depression', minKt: 28, maxKt: 33, col: '#0b6e8a' },
    'D': { code: 'D', name: 'Depression', minKt: 17, maxKt: 27, col: '#2f7fc1' },
    'WML': { code: 'WML', name: 'Well Marked Low', minKt: 10, maxKt: 16, col: '#708090' },
    'LPA': { code: 'LPA', name: 'Low Pressure Area', minKt: 0, maxKt: 9, col: '#888888' }
  };

  function toRad(deg) { return deg * Math.PI / 180; }
  function toDeg(rad) { return rad * 180 / Math.PI; }

  function distanceKm(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_KM * c;
  }

  function bearingBetween(lat1, lon1, lat2, lon2) {
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
              Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  /**
   * Calculates shortest directed angular difference from angle a to angle b (-180 to +180 deg)
   * Avoids JavaScript modulo negative remainder bug across 0 deg (North)
   */
  function angleDifference(a, b) {
    let d = (b - a) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }

  function destinationPoint(lat, lon, distanceKm, bearingDeg) {
    const dDivR = distanceKm / EARTH_RADIUS_KM;
    const latR = toRad(lat);
    const lonR = toRad(lon);
    const brgR = toRad(bearingDeg);

    const lat2 = Math.asin(
      Math.sin(latR) * Math.cos(dDivR) +
      Math.cos(latR) * Math.sin(dDivR) * Math.cos(brgR)
    );
    const lon2 = lonR + Math.atan2(
      Math.sin(brgR) * Math.sin(dDivR) * Math.cos(latR),
      Math.cos(dDivR) - Math.sin(latR) * Math.sin(lat2)
    );
    return [toDeg(lon2), toDeg(lat2)];
  }

  function bearingToCardinal(deg) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
    return directions[idx];
  }

  function getIMDErrorRadiusKm(leadHours) {
    if (leadHours <= IMD_SOP_RADII[0].hours) return IMD_SOP_RADII[0].radiusKm;
    for (let i = 0; i < IMD_SOP_RADII.length - 1; i++) {
      const h0 = IMD_SOP_RADII[i].hours;
      const r0 = IMD_SOP_RADII[i].radiusKm;
      const h1 = IMD_SOP_RADII[i + 1].hours;
      const r1 = IMD_SOP_RADII[i + 1].radiusKm;
      if (leadHours >= h0 && leadHours <= h1) {
        return r0 + (r1 - r0) * ((leadHours - h0) / (h1 - h0));
      }
    }
    return IMD_SOP_RADII[IMD_SOP_RADII.length - 1].radiusKm;
  }

  /**
   * Generates a 70% probability Cone of Uncertainty polygon from forecast points
   * Uses IMD SOP forecast error radii, smooth geodesic subdivision, and tangent boundary tracking.
   * Prevents self-intersections, zigzags, and azimuth flips across 0° North.
   * @param {Array} forecastPoints - Array of {lat, lon, lead_hours}
   * @returns {Array} Polygon vertices [[lon, lat], ...]
   */
  function generateIMDCone(forecastPoints) {
    if (!forecastPoints || forecastPoints.length === 0) return [];

    // Filter out invalid or duplicate consecutive points
    const rawPts = [];
    for (let i = 0; i < forecastPoints.length; i++) {
      const p = forecastPoints[i];
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number' || isNaN(p.lat) || isNaN(p.lon)) continue;
      const lead = p.lead_hours !== undefined ? p.lead_hours : i * 6;
      const r = getIMDErrorRadiusKm(lead);
      if (rawPts.length > 0) {
        const prev = rawPts[rawPts.length - 1];
        if (distanceKm(prev.lat, prev.lon, p.lat, p.lon) < 0.05) continue;
      }
      rawPts.push({ lat: p.lat, lon: p.lon, r });
    }

    if (rawPts.length === 0) return [];

    if (rawPts.length === 1) {
      // Single point cone: a smooth circle around it
      const circle = [];
      for (let a = 0; a <= 360; a += 10) {
        circle.push(destinationPoint(rawPts[0].lat, rawPts[0].lon, rawPts[0].r, a));
      }
      return circle;
    }

    // Subdivide track segments so the cone curves smoothly without angular facet kinks (max 35 km)
    const pts = [];
    const MAX_STEP_KM = 35;
    for (let i = 0; i < rawPts.length - 1; i++) {
      const p1 = rawPts[i];
      const p2 = rawPts[i + 1];
      const d = distanceKm(p1.lat, p1.lon, p2.lat, p2.lon);
      const steps = Math.max(1, Math.ceil(d / MAX_STEP_KM));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        pts.push({
          lat: p1.lat + t * (p2.lat - p1.lat),
          lon: p1.lon + t * (p2.lon - p1.lon),
          r: p1.r + t * (p2.r - p1.r)
        });
      }
    }
    pts.push(rawPts[rawPts.length - 1]);

    const leftSide = [];
    const rightSide = [];

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let brg = 0;
      if (i === 0) {
        brg = bearingBetween(p.lat, p.lon, pts[i + 1].lat, pts[i + 1].lon);
      } else if (i === pts.length - 1) {
        brg = bearingBetween(pts[i - 1].lat, pts[i - 1].lon, p.lat, p.lon);
      } else {
        const b1 = bearingBetween(pts[i - 1].lat, pts[i - 1].lon, p.lat, p.lon);
        const b2 = bearingBetween(p.lat, p.lon, pts[i + 1].lat, pts[i + 1].lon);
        const diff = angleDifference(b1, b2);
        brg = (b1 + diff / 2 + 360) % 360;
      }

      leftSide.push(destinationPoint(p.lat, p.lon, p.r, (brg - 90 + 360) % 360));
      rightSide.push(destinationPoint(p.lat, p.lon, p.r, (brg + 90) % 360));
    }

    // Semicircular cap at the final forecast point (smooth forward arc)
    const lastP = pts[pts.length - 1];
    const lastBrg = bearingBetween(pts[pts.length - 2].lat, pts[pts.length - 2].lon, lastP.lat, lastP.lon);
    const endCap = [];
    for (let step = -75; step <= 75; step += 15) {
      const angle = (lastBrg + step + 360) % 360;
      endCap.push(destinationPoint(lastP.lat, lastP.lon, lastP.r, angle));
    }

    // Starting cap around the initial position (smooth rear arc)
    const firstP = pts[0];
    const firstBrg = bearingBetween(firstP.lat, firstP.lon, pts[1].lat, pts[1].lon);
    const startCap = [];
    for (let step = 105; step <= 255; step += 15) {
      const angle = (firstBrg + step + 360) % 360;
      startCap.push(destinationPoint(firstP.lat, firstP.lon, firstP.r, angle));
    }

    // Construct smooth closed envelope: leftSide, endCap, reversed rightSide, startCap
    const polygon = leftSide.concat(endCap, [...rightSide].reverse(), startCap);
    polygon.push(polygon[0]); // close loop
    return polygon;
  }

  /**
   * Ray-casting algorithm to test whether a coordinate (lon, lat) falls inside polygon
   * @param {number} x - Longitude
   * @param {number} y - Latitude
   * @param {Array} poly - Array of [lon, lat] vertices
   */
  function pointInPolygon(x, y, poly) {
    if (!poly || poly.length < 3) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = ((yi > y) !== (yj > y)) &&
                        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Calculate distance and direction to nearest reference stations from center
   * @param {number} centerLat
   * @param {number} centerLon
   * @param {number} limit - Number of closest stations to return
   */
  function calculateStationDistances(centerLat, centerLon, limit = 5) {
    return COASTAL_STATIONS.map(st => {
      const dist = distanceKm(centerLat, centerLon, st.lat, st.lon);
      // Direction FROM station TO cyclone (official IMD bulletin convention)
      const brgFromStation = bearingBetween(st.lat, st.lon, centerLat, centerLon);
      const card = bearingToCardinal(brgFromStation);
      return {
        name: st.name,
        state: st.state,
        distanceKm: Math.round(dist),
        direction: card,
        text: `${Math.round(dist)} km ${card}`
      };
    }).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, limit);
  }

  /**
   * Convert UTC string DD/HH to IST string DD/HHMM
   */
  function utcToIst(utcStr) {
    if (!utcStr) return "";
    const parts = utcStr.split(/[\/\s:]+/).map(Number);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return utcStr;
    const [d, h] = parts;
    let m = h * 60 + 330;
    const dd = d + Math.floor(m / 1440);
    m %= 1440;
    return `${dd}/${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`;
  }

  /**
   * Parse IMD National Cyclone Bulletin or RSMC Advisory
   */
  function parseIMDBulletin(text) {
    if (!text || typeof text !== 'string') return null;

    // 1. Extract Storm Name
    const nameMatch = text.match(/(?:CYCLONIC STORM|CYCLONE|DEPRESSION|STORM)\s*[“"\'\‘]([^"\'\”\’]+)[”"\'\’]/i) ||
                      text.match(/NAME OF THE CYCLONIC STORM[:\s]+([A-Z0-9_-]+)/i) ||
                      text.match(/CYCLONE\s+([A-Z][a-z0-9]+)/i);
    const stormName = nameMatch ? nameMatch[1].trim() : "Indian Ocean Cyclone";

    // 2. Extract Bulletin No
    const bullMatch = text.match(/BULLETIN NO\.\s*(\d+)/i) || text.match(/ADVISORY NO\.\s*(\d+)/i);
    const bulletinNo = bullMatch ? bullMatch[1] : "";

    // 3. Extract Issue Time
    const timeMatch = text.match(/TIME OF ISSUE:\s*([^\n\r]+)/i) ||
                      text.match(/DATE AND TIME OF ISSUE[:\s]+([^\n\r]+)/i);
    const issueTime = timeMatch ? timeMatch[1].trim() : "Latest Advisory";

    // 4. Extract Category
    const catMap = {
      'SUPER CYCLONIC': 'SuCS',
      'EXTREMELY SEVERE': 'ESCS',
      'VERY SEVERE': 'VSCS',
      'SEVERE CYCLONIC': 'SCS',
      'CYCLONIC STORM': 'CS',
      'DEEP DEPRESSION': 'DD',
      'DEPRESSION': 'D',
      'WELL MARKED': 'WML',
      'LOW PRESSURE': 'LPA'
    };

    let overallCat = "CS";
    for (const [k, v] of Object.entries(catMap)) {
      if (new RegExp(k, 'i').test(text)) {
        overallCat = v;
        break;
      }
    }

    // 5. Extract table rows
    // Standard IMD Table format:
    // Date/Time (IST) | Lat / Long | Wind (kmph) | Category
    const points = [];
    const rowRegex = /(\d{1,2}[\.\/]\d{1,2}(?:[\.\/]\d{2,4})?[\s\/]+\d{4})\s*\|?\s*(\d{1,2}\.?\d*)\s*[°N\s]*[\/,]\s*(\d{1,3}\.?\d*)\s*[°E\s]*\|?\s*(\d{2,3}(?:-\d{2,3})?)\s*(?:GUSTING TO\s*\d{2,3})?\s*(?:kmph|kt)?\s*\|?\s*([^\n\r|]+)/gi;

    let m;
    let idx = 0;
    while ((m = rowRegex.exec(text)) !== null) {
      const dtStr = m[1].trim();
      const lat = parseFloat(m[2]);
      const lon = parseFloat(m[3]);
      const windStr = m[4];
      const catRaw = m[5].trim().toUpperCase();

      let kmph = 60;
      if (windStr.includes('-')) {
        kmph = parseFloat(windStr.split('-')[1]);
      } else {
        kmph = parseFloat(windStr);
      }
      const kt = Math.round(kmph / 1.852);

      let cat = "CS";
      for (const [k, v] of Object.entries(catMap)) {
        if (catRaw.includes(k)) {
          cat = v;
          break;
        }
      }

      const dtParts = dtStr.split(/[\.\/\s]+/);
      const tLabel = dtParts.length >= 2 ? `${dtParts[0]}/${dtParts[dtParts.length - 1].slice(0, 2)}` : dtStr;

      points.push({
        t: tLabel,
        rawTime: dtStr,
        lat: lat,
        lon: lon,
        kt: kt,
        kmph: Math.round(kmph),
        cat: cat,
        kind: idx === 0 ? "now" : "fc",
        lead_hours: idx * 6
      });
      idx++;
    }

    // If regular table was not matched, try searching for "LAY CENTRED AT ... NEAR LATITUDE ... LONGITUDE"
    if (points.length === 0) {
      const centerMatch = text.match(/LATITUDE\s*(\d{1,2}\.?\d*)\s*°?\s*N.*?LONGITUDE\s*(\d{1,3}\.?\d*)\s*°?\s*E/i) ||
                          text.match(/(\d{1,2}\.?\d*)\s*°?\s*N[,\s]+(\d{1,3}\.?\d*)\s*°?\s*E/i);
      if (centerMatch) {
        const lat = parseFloat(centerMatch[1]);
        const lon = parseFloat(centerMatch[2]);
        points.push({
          t: "Now",
          rawTime: "Current",
          lat: lat,
          lon: lon,
          kt: 65,
          kmph: 120,
          cat: overallCat,
          kind: "now",
          lead_hours: 0
        });
      }
    }

    if (points.length === 0) return null;

    const currentCenter = points.find(p => p.kind === 'now') || points[0];
    const forecastPoints = points.filter(p => p.kind === 'fc' || p.kind === 'now');
    const cone = generateIMDCone(forecastPoints);

    return {
      id: `custom_${Date.now()}`,
      name: stormName,
      bulletinNo: bulletinNo,
      issueTime: issueTime,
      category: currentCenter.cat,
      categoryFull: IMD_CATEGORIES[currentCenter.cat]?.name || currentCenter.cat,
      statusBadge: "IMD PARSED BULLETIN",
      sourceName: "India Meteorological Department (Parsed)",
      currentCenter: {
        lat: currentCenter.lat,
        lon: currentCenter.lon,
        kt: currentCenter.kt,
        kmph: currentCenter.kmph,
        cat: currentCenter.cat,
        pressure: 980
      },
      points: points,
      cone: cone
    };
  }

  /**
   * Parse Esri Living Atlas (JTWC/NHC) GeoJSON payload
   */
  function parseEsriLiveFeed(forecastGeoJSON, observedGeoJSON, coneGeoJSON) {
    if (!forecastGeoJSON && !observedGeoJSON) return [];

    const stormsMap = new Map();

    function processPoint(feature, isForecast) {
      const p = feature.properties || {};
      const geom = feature.geometry || {};
      if (!geom.coordinates || geom.coordinates.length < 2) return;

      const lon = geom.coordinates[0];
      const lat = geom.coordinates[1];
      const stormName = (p.STORMNAME || p.stormname || p.NAME || "Active Storm").trim().toUpperCase();
      const stormId = p.STORMID || p.stormid || stormName;
      const basin = p.BASIN || (lon >= 50 && lon <= 100 && lat >= 0 && lat <= 35 ? "North Indian Ocean" : "Global");

      if (!stormsMap.has(stormId)) {
        stormsMap.set(stormId, {
          id: stormId,
          name: stormName,
          basin: basin,
          obsPoints: [],
          fcPoints: [],
          cone: [],
          advDate: p.ADVDATE || ""
        });
      }

      const st = stormsMap.get(stormId);
      const kt = parseInt(p.MAXWIND || p.maxwind || p.INTENSITY || 35, 10);
      const kmph = Math.round(kt * 1.852);
      const tau = parseInt(p.TAU || p.tau || 0, 10);

      // Determine category
      let cat = 'CS';
      if (kt >= 120) cat = 'SuCS';
      else if (kt >= 90) cat = 'ESCS';
      else if (kt >= 64) cat = 'VSCS';
      else if (kt >= 48) cat = 'SCS';
      else if (kt >= 34) cat = 'CS';
      else if (kt >= 28) cat = 'DD';
      else cat = 'D';

      const tLbl = p.DATELBL || p.VALIDTIME || (tau === 0 ? "Now" : `+${tau}h`);

      const ptObj = {
        t: tLbl,
        lat: lat,
        lon: lon,
        kt: kt,
        kmph: kmph,
        cat: cat,
        lead_hours: tau,
        kind: isForecast ? (tau === 0 ? "now" : "fc") : "obs"
      };

      if (isForecast) {
        st.fcPoints.push(ptObj);
      } else {
        st.obsPoints.push(ptObj);
      }
    }

    if (observedGeoJSON && observedGeoJSON.features) {
      observedGeoJSON.features.forEach(f => processPoint(f, false));
    }
    if (forecastGeoJSON && forecastGeoJSON.features) {
      forecastGeoJSON.features.forEach(f => processPoint(f, true));
    }

    // Attach cones if present
    if (coneGeoJSON && coneGeoJSON.features) {
      coneGeoJSON.features.forEach(f => {
        const p = f.properties || {};
        const stormName = (p.STORMNAME || p.stormname || "").trim().toUpperCase();
        for (const [id, st] of stormsMap.entries()) {
          if (st.name === stormName || id.includes(stormName)) {
            const geom = f.geometry || {};
            if (geom.type === 'Polygon' && geom.coordinates && geom.coordinates[0]) {
              st.cone = geom.coordinates[0];
            } else if (geom.type === 'MultiPolygon' && geom.coordinates && geom.coordinates[0] && geom.coordinates[0][0]) {
              st.cone = geom.coordinates[0][0];
            }
          }
        }
      });
    }

    const result = [];
    for (const st of stormsMap.values()) {
      // Sort points
      st.obsPoints.sort((a, b) => (a.t > b.t ? 1 : -1));
      st.fcPoints.sort((a, b) => a.lead_hours - b.lead_hours);

      // Current point
      let currentPt = st.fcPoints.find(p => p.kind === 'now');
      if (!currentPt && st.fcPoints.length > 0) currentPt = st.fcPoints[0];
      if (!currentPt && st.obsPoints.length > 0) currentPt = st.obsPoints[st.obsPoints.length - 1];

      if (!currentPt) continue;

      const combinedPoints = st.obsPoints.concat(st.fcPoints);

      // If no cone provided in feed, compute it using IMD SOP!
      let conePoly = st.cone;
      if (!conePoly || conePoly.length === 0) {
        conePoly = generateIMDCone(st.fcPoints);
      }

      result.push({
        id: st.id,
        name: st.name,
        basin: st.basin,
        category: currentPt.cat,
        categoryFull: IMD_CATEGORIES[currentPt.cat]?.name || currentPt.cat,
        statusBadge: "LIVE (JTWC / NHC)",
        sourceName: "ArcGIS Living Atlas (JTWC / NHC)",
        issueTime: st.advDate || "Live Telemetry",
        bulletinNo: "",
        currentCenter: {
          lat: currentPt.lat,
          lon: currentPt.lon,
          kt: currentPt.kt,
          kmph: currentPt.kmph,
          cat: currentPt.cat,
          pressure: 980
        },
        points: combinedPoints,
        cone: conePoly
      });
    }

    return result;
  }

  return {
    EARTH_RADIUS_KM,
    COASTAL_STATIONS,
    IMD_CATEGORIES,
    IMD_SOP_RADII,
    distanceKm,
    bearingBetween,
    destinationPoint,
    bearingToCardinal,
    getIMDErrorRadiusKm,
    generateIMDCone,
    pointInPolygon,
    calculateStationDistances,
    utcToIst,
    parseIMDBulletin,
    parseEsriLiveFeed
  };

}));

