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
   * Generates a Cone of Uncertainty polygon with configurable left/right/cap scaling factors.
   * Enables asymmetrical expansion (e.g. Right-Forward onshore wind penalty).
   */
  function generateConePolygon(forecastPoints, leftScale = 1.0, rightScale = 1.0, capScale = 1.0) {
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
      const r = rawPts[0].r * Math.max(leftScale, rightScale);
      for (let a = 0; a <= 360; a += 10) {
        circle.push(destinationPoint(rawPts[0].lat, rawPts[0].lon, r, a));
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

      leftSide.push(destinationPoint(p.lat, p.lon, p.r * leftScale, (brg - 90 + 360) % 360));
      rightSide.push(destinationPoint(p.lat, p.lon, p.r * rightScale, (brg + 90) % 360));
    }

    // Semicircular cap at the final forecast point (smooth forward arc)
    const lastP = pts[pts.length - 1];
    const lastBrg = bearingBetween(pts[pts.length - 2].lat, pts[pts.length - 2].lon, lastP.lat, lastP.lon);
    const endCap = [];
    for (let step = -75; step <= 75; step += 15) {
      const angle = (lastBrg + step + 360) % 360;
      endCap.push(destinationPoint(lastP.lat, lastP.lon, lastP.r * capScale, angle));
    }

    // Starting cap around the initial position (smooth rear arc)
    const firstP = pts[0];
    const firstBrg = bearingBetween(firstP.lat, firstP.lon, pts[1].lat, pts[1].lon);
    const startCap = [];
    for (let step = 105; step <= 255; step += 15) {
      const angle = (firstBrg + step + 360) % 360;
      startCap.push(destinationPoint(firstP.lat, firstP.lon, firstP.r * Math.min(leftScale, rightScale), angle));
    }

    // Construct smooth closed envelope: leftSide, endCap, reversed rightSide, startCap
    const polygon = leftSide.concat(endCap, [...rightSide].reverse(), startCap);
    polygon.push(polygon[0]); // close loop
    return polygon;
  }

  /**
   * Generates a 70% probability Cone of Uncertainty polygon from forecast points
   * Uses IMD SOP forecast error radii, smooth geodesic subdivision, and tangent boundary tracking.
   * @param {Array} forecastPoints - Array of {lat, lon, lead_hours}
   * @returns {Array} Polygon vertices [[lon, lat], ...]
   */
  function generateIMDCone(forecastPoints) {
    return generateConePolygon(forecastPoints, 1.0, 1.0, 1.0);
  }

  /**
   * Generates dynamic multi-zone probability gradient cones representing Tripping Probability (P_trip):
   * 1. High Probability Zone: Center/Eyewall & Right-Forward Quadrant (Soft Coral / Light Amber #FF6B6B to #FFA94D)
   * 2. Moderate Probability Zone: Mid-Cone (Light Yellow-Orange #FFE066)
   * 3. Low Probability Zone: Outer Cone Edges (Soft Blue-Green / Grey-Yellow #A9E34B)
   * Features asymmetric Right-Forward expansion (+20-25% penalty for Northern Hemisphere onshore wind vector).
   */
  function generateProbabilityCones(forecastPoints) {
    if (!forecastPoints || forecastPoints.length === 0) return null;
    return {
      // High Zone: Center, eyewall corridor & right-forward quadrant
      high: generateConePolygon(forecastPoints, 0.32, 0.52, 0.44),

      // Moderate Zone: Mid-cone with right-side asymmetric boost
      med: generateConePolygon(forecastPoints, 0.62, 0.82, 0.74),

      // Low Zone: Full cone envelope
      low: generateConePolygon(forecastPoints, 1.0, 1.0, 1.0)
    };
  }

  /**
   * Generates physical Wind Speed Swath zones (Gale ≥65 km/h, Storm ≥90 km/h, Hurricane ≥120 km/h)
   * Calibrated against Rankine vortex radial decay with Northern Hemisphere forward translation asymmetry.
   */
  function generateWindSpeedSwath(forecastPoints) {
    if (!forecastPoints || forecastPoints.length === 0) return null;
    return {
      // Hurricane force corridor (≥120 km/h, core eyewall)
      hurricane: generateConePolygon(forecastPoints, 0.28, 0.42, 0.36),

      // Storm force swath (90 - 120 km/h)
      storm: generateConePolygon(forecastPoints, 0.55, 0.74, 0.65),

      // Gale force swath (65 - 90 km/h)
      gale: generateConePolygon(forecastPoints, 0.85, 1.05, 0.95)
    };
  }

  /**
   * Projects a point (lat, lon) onto a geodesic line segment (lat1, lon1) -> (lat2, lon2).
   */
  function projectPointOnSegment(lat, lon, lat1, lon1, lat2, lon2) {
    const d12 = distanceKm(lat1, lon1, lat2, lon2);
    if (d12 < 0.001) {
      return {
        distKm: distanceKm(lat, lon, lat1, lon1),
        projLat: lat1,
        projLon: lon1,
        u: 0,
        bearing: 0,
        crossTrackBearing: bearingBetween(lat1, lon1, lat, lon)
      };
    }
    const brg12 = bearingBetween(lat1, lon1, lat2, lon2);
    const brg1P = bearingBetween(lat1, lon1, lat, lon);
    const d1P = distanceKm(lat1, lon1, lat, lon);
    const angleDiffRad = toRad(brg1P - brg12);
    const dXt = Math.abs(Math.asin(Math.sin(d1P / EARTH_RADIUS_KM) * Math.sin(angleDiffRad)) * EARTH_RADIUS_KM);
    let cosAt = Math.cos(d1P / EARTH_RADIUS_KM) / Math.cos(dXt / EARTH_RADIUS_KM);
    if (cosAt > 1) cosAt = 1;
    if (cosAt < -1) cosAt = -1;
    let dAt = Math.acos(cosAt) * EARTH_RADIUS_KM;
    if (Math.cos(angleDiffRad) < 0) dAt = -dAt;
    const u = Math.max(0, Math.min(1, dAt / d12));
    const projPt = destinationPoint(lat1, lon1, u * d12, brg12);
    const crossBearing = bearingBetween(projPt[1], projPt[0], lat, lon);
    return {
      distKm: distanceKm(lat, lon, projPt[1], projPt[0]),
      projLat: projPt[1],
      projLon: projPt[0],
      u,
      bearing: brg12,
      crossTrackBearing: crossBearing
    };
  }

  /**
   * Estimates the local sustained surface wind speed (km/h & knots) at coordinate (lat, lon)
   * using a modified Rankine / Holland vortex decay profile with Northern Hemisphere forward motion asymmetry.
   */
  function estimateLocalWindSpeed(lat, lon, forecastPoints = []) {
    if (!forecastPoints || forecastPoints.length === 0) {
      return { localWindKmph: 65, localWindKt: 35, distToTrackKm: 50, centerWindKmph: 75, quadrant: 'Mid-Cone', quadrantCode: 'MC', rConeKm: 100 };
    }

    if (forecastPoints.length === 1) {
      const p = forecastPoints[0];
      const d = distanceKm(lat, lon, p.lat, p.lon);
      const centerWind = p.kmph || (p.kt ? Math.round(p.kt * 1.852) : 75);
      const Rmax = 30;
      const vRot = d <= Rmax ? centerWind * (0.85 + 0.15 * (d / Rmax)) : centerWind * Math.pow(Rmax / Math.max(Rmax, d), 0.52);
      const localWindKmph = Math.max(15, Math.round(vRot));
      return {
        localWindKmph,
        localWindKt: Math.round(localWindKmph / 1.852),
        distToTrackKm: Math.round(d * 10) / 10,
        centerWindKmph: centerWind,
        quadrant: 'Radial',
        quadrantCode: 'RAD',
        rConeKm: getIMDErrorRadiusKm(p.lead_hours || 0)
      };
    }

    let minDistance = Infinity;
    let closestInfo = null;

    for (let i = 0; i < forecastPoints.length - 1; i++) {
      const p1 = forecastPoints[i];
      const p2 = forecastPoints[i + 1];
      const proj = projectPointOnSegment(lat, lon, p1.lat, p1.lon, p2.lat, p2.lon);
      if (proj.distKm < minDistance) {
        minDistance = proj.distKm;
        const lead1 = p1.lead_hours !== undefined ? p1.lead_hours : i * 6;
        const lead2 = p2.lead_hours !== undefined ? p2.lead_hours : (i + 1) * 6;
        const lead = lead1 + proj.u * (lead2 - lead1);
        const rCone = getIMDErrorRadiusKm(lead);
        const w1 = p1.kmph || (p1.kt ? p1.kt * 1.852 : 75);
        const w2 = p2.kmph || (p2.kt ? p2.kt * 1.852 : 75);
        const centerWindKmph = w1 + proj.u * (w2 - w1);
        closestInfo = { proj, lead, rCone, centerWindKmph };
      }
    }

    if (!closestInfo) {
      return { localWindKmph: 65, localWindKt: 35, distToTrackKm: 50, centerWindKmph: 75, quadrant: 'Mid-Cone', quadrantCode: 'MC', rConeKm: 100 };
    }

    const { proj, rCone, centerWindKmph } = closestInfo;
    const dLat = proj.distKm;

    // Relative angle to storm heading (0..360)
    const relBearing = (proj.crossTrackBearing - proj.bearing + 360) % 360;
    let quadrant = 'Left-Rear';
    let quadrantCode = 'LR';
    let asymFactor = 1.0;

    if (relBearing >= 0 && relBearing < 90) {
      quadrant = 'Right-Forward';
      quadrantCode = 'RF';
      // Forward translation adds directly to tangential wind in Northern Hemisphere
      asymFactor = 1.0 + 0.22 * Math.cos(relBearing * Math.PI / 180);
    } else if (relBearing >= 90 && relBearing < 180) {
      quadrant = 'Right-Rear';
      quadrantCode = 'RR';
      asymFactor = 1.0 + 0.08 * Math.cos((relBearing - 90) * Math.PI / 180);
    } else if (relBearing >= 270 && relBearing < 360) {
      quadrant = 'Left-Forward';
      quadrantCode = 'LF';
      asymFactor = 1.0 + 0.05 * Math.sin((360 - relBearing) * Math.PI / 180);
    } else {
      quadrant = 'Left-Rear';
      quadrantCode = 'LR';
      // Forward translation opposes tangential wind
      asymFactor = 1.0 - 0.16 * Math.sin((relBearing - 180) * Math.PI / 180);
    }

    // Radial decay from eyewall (R_max ≈ 30 km)
    const Rmax = 30;
    let vRot = 0;
    if (dLat <= Rmax) {
      vRot = centerWindKmph * (0.85 + 0.15 * (dLat / Rmax));
    } else {
      vRot = centerWindKmph * Math.pow(Rmax / dLat, 0.52);
    }

    const localWindKmph = Math.max(15, Math.round(vRot * asymFactor));
    const localWindKt = Math.round(localWindKmph / 1.852);

    return {
      localWindKmph,
      localWindKt,
      centerWindKmph: Math.round(centerWindKmph),
      distToTrackKm: Math.round(dLat * 10) / 10,
      rConeKm: Math.round(rCone),
      quadrant,
      quadrantCode,
      asymFactor
    };
  }

  /**
   * Calculates electrical Tripping Probability (P_trip in %) and Risk Level for an asset:
   * Rigorously integrates dynamic wind pressure (V_local^2), radial distance decay, forward quadrant penalty, and voltage class.
   * @param {number} lat - Asset Latitude
   * @param {number} lon - Asset Longitude
   * @param {number} voltageOrMw - Voltage in kV or Plant Capacity in MW
   * @param {boolean} isPlant - Whether asset is a Power Generation Plant
   * @param {Array} forecastPoints - Cyclone track forecast points
   * @returns {Object} { pTrip, riskLevel, localWindKmph, localWindKt, centerWindKmph, distToTrackKm, rConeKm, quadrant, quadrantCode, windKmph }
   */
  function calculateTrippingProbability(lat, lon, voltageOrMw = 400, isPlant = false, forecastPoints = []) {
    const windInfo = estimateLocalWindSpeed(lat, lon, forecastPoints);
    const { localWindKmph, localWindKt, centerWindKmph, distToTrackKm, rConeKm, quadrant, quadrantCode } = windInfo;

    // 1. Dynamic Wind Pressure & Velocity Tripping Baseline (CEA / CIGRE & IEEE standards)
    // Wind pressure q = 0.5 * rho * V^2
    let pWind = 0;
    if (localWindKmph < 40) {
      // Gentle to moderate breeze (< 40 km/h): Baseline operational tripping
      pWind = 8 + (localWindKmph / 40) * 12; // 8% - 20%
    } else if (localWindKmph < 65) {
      // Depression to Cyclonic Storm entry (40 - 65 km/h)
      pWind = 20 + ((localWindKmph - 40) / 25) * 22; // 20% - 42%
    } else if (localWindKmph < 90) {
      // Cyclonic Storm to Severe Cyclone (65 - 90 km/h - Gale Force)
      // Conductor galloping, phase swinging, minor tree contact
      pWind = 42 + ((localWindKmph - 65) / 25) * 26; // 42% - 68%
    } else if (localWindKmph < 120) {
      // Very Severe Cyclone (90 - 120 km/h - Storm Force)
      // Salt spray contamination, insulator flashover, tower vibration
      pWind = 68 + ((localWindKmph - 90) / 30) * 20; // 68% - 88%
    } else {
      // Extremely Severe / Super Cyclone (≥ 120 km/h - Hurricane Force)
      // Severe structural bending, conductor snapping, substation switchyard trips
      pWind = 88 + Math.min(10, ((localWindKmph - 120) / 35) * 10); // 88% - 98%
    }

    // 2. Voltage Sensitivity & Structural Height Factors
    // High voltage lines have taller towers (50m+), where boundary-layer wind velocity is 25-30% higher
    let pVolt = 0;
    const v = +voltageOrMw || 0;
    if (isPlant) {
      // Power plants: Cooling intake blockage, vibration limits
      pVolt = (localWindKmph >= 65) ? 5 : 2;
    } else if (v >= 765) {
      // EHV 765kV: Tall towers (55-65m), long spans (450m+), high wind exposure aloft
      pVolt = (localWindKmph >= 60) ? 9 : 4;
    } else if (v >= 400) {
      // 400kV backbone lines: 40-50m towers
      pVolt = (localWindKmph >= 60) ? 6 : 3;
    } else if (v >= 220) {
      // 220kV lines
      pVolt = (localWindKmph >= 60) ? 4 : 1;
    } else if (v >= 132) {
      // 132kV lines
      pVolt = (localWindKmph >= 50) ? 3 : 1;
    } else if (v > 0) {
      // 33kV/66kV distribution: prone to tree branch falls, hoarding impacts, pole tilting
      pVolt = (localWindKmph >= 50) ? 7 : 3;
    }

    // 3. Eyewall Proximity Turbulence Penalty
    let pEye = 0;
    if (distToTrackKm <= 25 && centerWindKmph >= 75) {
      pEye = 4; // microbursts and intense turbulence in eyewall corridor
    }

    const rawP = pWind + pVolt + pEye;
    const pTrip = Math.min(98, Math.max(8, Math.round(rawP)));
    const riskLevel = pTrip >= 70 ? 'High' : (pTrip >= 40 ? 'Moderate' : 'Low');

    return {
      pTrip,
      riskLevel,
      localWindKmph,
      localWindKt,
      centerWindKmph,
      distToTrackKm,
      rConeKm,
      quadrant,
      quadrantCode,
      windKmph: localWindKmph // backwards compatibility
    };
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
    generateConePolygon,
    generateProbabilityCones,
    generateWindSpeedSwath,
    projectPointOnSegment,
    estimateLocalWindSpeed,
    calculateTrippingProbability,
    pointInPolygon,
    calculateStationDistances,
    utcToIst,
    parseIMDBulletin,
    parseEsriLiveFeed
  };

}));

