/**
 * app.js - Main Application Controller for Live Dynamic Cyclone Tracking
 */

(function () {
  'use strict';

  // --- STATE ---
  const state = {
    currentStorm: null,
    availableStorms: [],
    liveMode: true,
    autoPollIntervalMs: 300000, // 5 minutes
    pollTimer: null,
    lastChecked: null,
    isFetching: false,
    tileCache: new Map(),
    liveGridAvailable: false,
    layers: {
      lines: true,
      subs: true,
      plants: true,
      sname: true,
      wri: true,
      cone: true,
      labels: true
    },
    coneLayer: null,
    trackObsLayer: null,
    trackFcLayer: null,
    trackMarkerGroup: null,
    nameLayer: null,
    wriLayer: null,
    map: null,
    gridLayer: null
  };

  const chk = id => document.getElementById(id);

  // --- INITIALIZATION ---
  window.addEventListener('DOMContentLoaded', initApp);

  function initApp() {
    initMap();
    initPresets();
    initUIControls();
    initModals();

    // Load initial benchmark storm (Arnab)
    loadStorm(CYCLONE_PRESETS.arnab_2026, false);
    showToast('Cyclone track & power grid initialized. Checking live feeds...', 'ok', 3000);

    // Initial check for real-time live cyclones from external APIs
    fetchLiveCyclones();

    // Start background polling
    startLivePolling();
  }

  // --- MAP INITIALIZATION ---
  function initMap() {
    state.map = L.map('map', {
      zoomControl: true,
      preferCanvas: true,
      minZoom: 3,
      maxZoom: 16
    }).setView([17.5, 83.5], 6);

    ['basemap', 'grid', 'gridpts', 'cone', 'track'].forEach((n, i) => {
      const p = state.map.createPane(n);
      p.style.zIndex = [150, 350, 360, 380, 450][i];
    });
    state.map.getPane('cone').style.pointerEvents = 'none';

    // 1. Offline Base Layers from BASE
    if (typeof BASE !== 'undefined') {
      if (BASE.land) {
        L.geoJSON({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: BASE.land.map(r => [r]) } }, {
          pane: 'basemap', interactive: false, style: { stroke: false, fillColor: '#f4f1e8', fillOpacity: 1 }
        }).addTo(state.map);
      }
      if (BASE.states) {
        L.geoJSON({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: BASE.states } }, {
          pane: 'basemap', interactive: false, style: { color: '#a98d6b', weight: 0.8, dashArray: '4 3' }
        }).addTo(state.map);
      }
      if (BASE.countries) {
        L.geoJSON({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: BASE.countries } }, {
          pane: 'basemap', interactive: false, style: { color: '#7a5c3c', weight: 1.4 }
        }).addTo(state.map);
      }
      if (BASE.cities) {
        BASE.cities.forEach(([n, x, y]) => {
          L.marker([y, x], {
            interactive: false, keyboard: false,
            icon: L.divIcon({ className: 'city', html: `<i></i>${n}`, iconSize: null, iconAnchor: [3, 7] })
          }).addTo(state.map);
        });
      }
    }

    // Online tile basemap (shows smoothly when online, falls back to offline land above)
    try {
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        pane: 'basemap',
        subdomains: 'abcd',
        maxZoom: 18,
        attribution: '© <a href="https://carto.com/">CARTO</a>'
      }).addTo(state.map);
    } catch (_) {}

    state.map.attributionControl.addAttribution('Boundaries © Natural Earth | Grid © <a href="https://openinframap.org" target="_blank">OpenInfraMap</a>');

    // 2. OpenInfraMap Vector Grid Setup
    initVectorGrid();

    // 3. WRI Power Plants (>=100 MW)
    initWRIPlants();

    // 4. Dynamic Overlay Layers
    state.coneLayer = L.polygon([], {
      pane: 'cone',
      color: '#2e9e45',
      weight: 1.5,
      fillColor: '#2e9e45',
      fillOpacity: 0.22,
      interactive: false
    }).addTo(state.map);

    state.trackObsLayer = L.polyline([], {
      pane: 'track',
      color: '#14234b',
      weight: 3.5,
      interactive: false
    }).addTo(state.map);

    state.trackFcLayer = L.polyline([], {
      pane: 'track',
      color: '#d7191c',
      weight: 3.5,
      dashArray: '5 5',
      interactive: false
    }).addTo(state.map);

    state.trackMarkerGroup = L.layerGroup().addTo(state.map);
    state.nameLayer = L.layerGroup().addTo(state.map);

    state.map.on('zoomend moveend', scheduleLabels);
  }

  // --- OPENINFRAMAP VECTOR TILES ---
  function initVectorGrid() {
    function vcol(p) {
      if (p.frequency !== undefined && +p.frequency === 0 && p.frequency !== '') return '#4E01B5';
      const v = +p.voltage || 0;
      return v >= 550 ? '#00C1CF' : v >= 310 ? '#B54EB2' : v >= 220 ? '#C73030' : v >= 132 ? '#B55D00' : v >= 52 ? '#B59F10' : v >= 25 ? '#55B555' : v >= 10 ? '#6E97B8' : '#7A7A85';
    }

    const HIDE = [];
    const gridStyles = {
      power_line: (p, z) => {
        if (!state.layers.lines || p.line === 'bay' || p.line === 'busbar') return HIDE;
        const v = +p.voltage || 0;
        if (z < 7 && v < 100) return HIDE;
        return { color: vcol(p), weight: z < 7 ? 1 : z < 9 ? 1.5 : z < 11 ? 2.2 : 3, opacity: 0.9 };
      },
      power_substation: (p, z) => {
        if (!state.layers.subs) return HIDE;
        const v = +p.voltage || 0;
        if (z < 6.5 && v < 400) return HIDE;
        if (z < 8 && v < 220) return HIDE;
        return { color: vcol(p), weight: 1.2, fill: true, fillColor: vcol(p), fillOpacity: 0.5 };
      },
      power_substation_point: (p, z) => {
        if (!state.layers.subs) return HIDE;
        const v = +p.voltage || 0;
        if (z < 6.5 && v < 400) return HIDE;
        if (z < 8 && v < 220) return HIDE;
        return { radius: z < 8 ? 3.5 : 5, color: '#fff', weight: 1.2, fill: true, fillColor: vcol(p), fillOpacity: 1 };
      },
      power_plant: (p, z) => {
        if (!state.layers.plants) return HIDE;
        return { color: '#7c4544', weight: 1, fill: true, fillColor: '#7c4544', fillOpacity: 0.25 };
      },
      power_plant_point: (p, z) => {
        if (!state.layers.plants) return HIDE;
        return { radius: z < 8 ? 3 : 5, color: '#fff', weight: 1, fill: true, fillColor: '#7c4544', fillOpacity: 1 };
      }
    };
    ['power_tower', 'power_pole', 'power_generator', 'power_generator_area', 'power_compensator', 'power_switch', 'power_transformer', 'power_portal', 'power_portal_way', 'power_cable_joint', 'power_heatmap_solar', 'power_line_ref', 'power_substation_ref', 'power_plant_ref'].forEach(n => gridStyles[n] = HIDE);

    function setLiveGrid() {
      if (state.liveGridAvailable) return;
      state.liveGridAvailable = true;
      showToast('✓ Live OpenInfraMap power grid connected.', 'ok', 3500);
    }
    function setOfflineGrid() {
      if (state.liveGridAvailable) return;
      showToast('Transmission grid tiles loading in background. Track & plants active.', '', 4000);
    }

    if (L.VectorGrid && L.VectorGrid.Protobuf) {
      const P = L.VectorGrid.Protobuf.prototype, orig = P._getVectorTilePromise;
      P._getVectorTilePromise = function (coords) {
        return orig.call(this, coords).then(json => {
          if (json.layers && Object.keys(json.layers).length) setLiveGrid();
          state.tileCache.set(`${coords.z}/${coords.x}/${coords.y}`, { coords, layers: json.layers });
          scheduleLabels();
          return json;
        }).catch(() => {
          setOfflineGrid();
          return { layers: {} };
        });
      };

      try {
        state.gridLayer = L.vectorGrid.protobuf('https://openinframap.org/map/power/{z}/{x}/{y}.pbf', {
          pane: 'grid',
          rendererFactory: L.canvas.tile,
          interactive: true,
          maxNativeZoom: 17,
          vectorTileLayerStyles: gridStyles
        }).addTo(state.map);

        state.gridLayer.on('click', e => {
          const p = e.layer.properties || {};
          L.popup({ maxWidth: 280 }).setLatLng(e.latlng).setContent(describeAsset(p)).openOn(state.map);
        });
      } catch (err) {
        console.warn('VectorGrid initialization notice:', err);
      }
    }
    setTimeout(() => { if (!state.liveGridAvailable) setOfflineGrid(); }, 8000);
  }

  function describeAsset(p, kind) {
    const k = kind || (p.output && !p.voltage ? 'Power plant' : (p.line || p.circuits !== undefined) ? 'Power line' : 'Substation');
    const r = [`<b>${p.name || k}</b>`];
    if (p.name) r.push(k);
    if (p.voltage) r.push(`Voltage: ${p.voltage} kV${p.voltage_2 ? ' / ' + p.voltage_2 : ''}${p.voltage_3 ? ' / ' + p.voltage_3 : ''}`);
    if (p.operator) r.push(`Operator: ${p.operator}`);
    if (p.output) r.push(`Output: ${Math.round(p.output)} MW`);
    if (p.source) r.push(`Fuel: ${p.source}`);
    if (p.circuits) r.push(`Circuits: ${p.circuits}`);
    if (p.ref) r.push(`Ref: ${p.ref}`);
    if (p.db) r.push(`<span style="color:#666">${p.db}</span>`);
    return r.join('<br>');
  }

  function initWRIPlants() {
    if (typeof BASE === 'undefined' || !BASE.plants) return;
    const fuelCol = { Coal: '#4a3b35', Gas: '#d98b2b', Hydro: '#2f7fc1', Solar: '#e6c229', Wind: '#5bb5a2', Nuclear: '#b0359b', Oil: '#6b7280' };
    state.wriLayer = L.layerGroup(BASE.plants.map(p => {
      const radius = p[3] >= 2000 ? 7 : p[3] >= 1000 ? 5.5 : p[3] >= 500 ? 4.5 : 3.2;
      return L.circleMarker([p[2], p[1]], {
        pane: 'gridpts',
        radius: radius,
        color: '#fff',
        weight: 1,
        fillColor: fuelCol[p[4]] || '#888',
        fillOpacity: 0.9
      }).bindPopup(describeAsset({ name: p[0], output: p[3], source: p[4], operator: p[5], db: 'WRI Global Power Plant Database' }, 'Power plant'));
    })).addTo(state.map);
  }

  // --- SUBSTATION LABELS ON TILE CACHE ---
  let labelTimer = null;
  function scheduleLabels() {
    clearTimeout(labelTimer);
    labelTimer = setTimeout(drawLabels, 250);
  }
  function drawLabels() {
    state.nameLayer.clearLayers();
    if (!state.layers.sname || !state.layers.subs) return;
    const z = state.map.getZoom(), b = state.map.getBounds().pad(0.1);
    const minV = z < 6.5 ? 400 : z < 8 ? 220 : z < 10 ? 132 : z < 12 ? 33 : 0;
    const seen = new Map();

    for (const { coords, layers } of state.tileCache.values()) {
      if (Math.abs(coords.z - Math.round(z)) > 1) continue;
      for (const ln of ['power_substation', 'power_substation_point']) {
        const lyr = layers[ln];
        if (!lyr || !lyr.features) continue;
        for (const f of lyr.features) {
          const p = f.properties;
          if (!p.name) continue;
          const v = +p.voltage || 0;
          if (v < minV) continue;
          const r = f.geometry && f.geometry[0];
          if (!r || !r.length) continue;
          let sx = 0, sy = 0;
          r.forEach(q => { sx += q.x; sy += q.y; });
          const c = toLL(coords, f.extent || 4096, { x: sx / r.length, y: sy / r.length });
          if (!b.contains([c[1], c[0]])) continue;
          const k = p.name + '|' + v;
          if (seen.has(k)) continue;
          seen.set(k, { p, v, c });
        }
      }
    }
    [...seen.values()].sort((a, b) => b.v - a.v).slice(0, 300).forEach(({ p, v, c }) => {
      const col = p.voltage >= 550 ? '#00C1CF' : p.voltage >= 310 ? '#B54EB2' : p.voltage >= 220 ? '#C73030' : '#B55D00';
      L.marker([c[1], c[0]], {
        interactive: false, keyboard: false, pane: 'markerPane',
        icon: L.divIcon({ className: 'sname', html: `<span style="color:${col}">${p.name}</span>${v ? `<b>${v} kV</b>` : ''}`, iconSize: null, iconAnchor: [-6, 5] })
      }).addTo(state.nameLayer);
    });
  }

  function toLL(c, ext, pt) {
    const n = 2 ** c.z;
    const lon = (c.x + pt.x / ext) / n * 360 - 180;
    const yy = Math.PI * (1 - 2 * (c.y + pt.y / ext) / n);
    return [lon, Math.atan(Math.sinh(yy)) * 180 / Math.PI];
  }

  // --- PRESET CYCLONES SETUP ---
  function initPresets() {
    state.availableStorms = [
      { ...CYCLONE_PRESETS.arnab_2026, type: 'preset' },
      { ...CYCLONE_PRESETS.arnab_2026_oct27, type: 'preset' },
      { ...CYCLONE_PRESETS.dana_2024, type: 'preset' },
      { ...CYCLONE_PRESETS.remal_2024, type: 'preset' },
      { ...CYCLONE_PRESETS.michaung_2023, type: 'preset' },
      { ...CYCLONE_PRESETS.biparjoy_2023, type: 'preset' }
    ];
    updateStormDropdown();
  }

  function updateStormDropdown() {
    const sel = chk('storm-select');
    sel.innerHTML = '';

    const liveGroup = document.createElement('optgroup');
    liveGroup.label = '🔴 Live Active Cyclones (Global / NIO)';

    const presetGroup = document.createElement('optgroup');
    presetGroup.label = '⚡ Landmark & Benchmark Cyclones';

    const customGroup = document.createElement('optgroup');
    customGroup.label = '📋 Imported & Custom Tracks';

    let liveCount = 0;
    let customCount = 0;

    state.availableStorms.forEach(st => {
      const opt = document.createElement('option');
      opt.value = st.id;
      opt.textContent = `${st.name} (${st.category || 'TC'} · ${st.year || '2026'})`;
      if (state.currentStorm && state.currentStorm.id === st.id) {
        opt.selected = true;
      }

      if (st.type === 'live') {
        liveGroup.appendChild(opt);
        liveCount++;
      } else if (st.type === 'custom') {
        customGroup.appendChild(opt);
        customCount++;
      } else {
        presetGroup.appendChild(opt);
      }
    });

    if (liveCount > 0) sel.appendChild(liveGroup);
    sel.appendChild(presetGroup);
    if (customCount > 0) sel.appendChild(customGroup);
  }

  // --- LOAD & SWITCH CYCLONE ---
  function loadStorm(stormData, shouldFitBounds = true) {
    if (!stormData) return;

    // Ensure cone exists; if missing, generate dynamically from forecast points
    if (!stormData.cone || stormData.cone.length === 0) {
      const fcPts = stormData.points.filter(p => p.kind === 'fc' || p.kind === 'now');
      stormData.cone = CycloneEngine.generateIMDCone(fcPts);
    }

    state.currentStorm = stormData;
    renderStormUI(stormData);
    renderStormMap(stormData, shouldFitBounds);
    triggerAutoScan();
  }

  // --- RENDER SIDEBAR UI ---
  function renderStormUI(st) {
    chk('storm-title').textContent = `${st.categoryFull || st.category} ‘${st.name}’`;
    chk('storm-eyebrow').textContent = `${st.statusBadge || 'IMD Track'} · ${st.issueTime || 'Latest Advisory'}`;
    chk('storm-source').textContent = st.sourceName ? `Source: ${st.sourceName}. Coordinates and cone dynamically rendered.` : 'Data plotted dynamically on OpenInfraMap power layers.';

    // Source Card updates
    if (chk('source-agency')) chk('source-agency').textContent = st.agency || 'India Meteorological Department (IMD)';
    if (chk('source-bulletin')) chk('source-bulletin').textContent = st.bulletinNo || 'Official Advisory';
    if (chk('source-time')) chk('source-time').textContent = st.issueTime || 'Latest Advisory';
    if (chk('source-type')) chk('source-type').textContent = st.advisoryType || (st.statusBadge || 'National Cyclone Warning');
    if (chk('source-badge')) chk('source-badge').textContent = st.statusBadge || 'OFFICIAL SOURCE';
    if (chk('source-link')) {
      chk('source-link').href = st.sourceUrl || 'https://rsmcnewdelhi.imd.gov.in';
      chk('source-link').textContent = (st.sourceUrl && st.sourceUrl.includes('imd')) ? 'Verify on IMD ↗' : 'View Source ↗';
    }

    const cur = st.currentCenter || (st.points.find(p => p.kind === 'now') || st.points[0]);
    chk('now-wind-badge').textContent = `${cur.kt} kt · ${cur.kmph || Math.round(cur.kt * 1.852)} km/h`;
    chk('now-cat-chip').textContent = cur.cat;
    chk('now-cat-chip').style.background = CycloneEngine.IMD_CATEGORIES[cur.cat]?.col || '#d7191c';

    chk('now-time-utc').textContent = cur.t || st.issueTime;
    chk('now-time-ist').textContent = CycloneEngine.utcToIst(cur.t) || 'Derived IST';
    chk('now-coords').textContent = `${cur.lat.toFixed(2)}°N, ${cur.lon.toFixed(2)}°E`;
    chk('now-pressure').textContent = cur.pressure ? `${cur.pressure} hPa` : 'Estimated';

    // Distances to nearest coastal radar/ports
    const distBox = chk('station-distances');
    distBox.innerHTML = '';
    const nearestStations = CycloneEngine.calculateStationDistances(cur.lat, cur.lon, 4);
    nearestStations.forEach(s => {
      const div = document.createElement('div');
      div.className = 'dist-item';
      div.innerHTML = `<span class="dist-name">${s.name} (${s.state})</span><span class="dist-val">${s.text}</span>`;
      distBox.appendChild(div);
    });

    // Populate Track Table
    const tb = chk('trk');
    tb.innerHTML = '';
    st.points.forEach(p => {
      const tr = document.createElement('tr');
      tr.className = p.kind === 'now' ? 'now' : (p.kind === 'fc' ? 'fc' : '');
      const catColor = CycloneEngine.IMD_CATEGORIES[p.cat]?.col || '#d7191c';
      const kmph = p.kmph || Math.round(p.kt * 1.852);
      tr.innerHTML = `
        <td>${p.t}</td>
        <td>${CycloneEngine.utcToIst(p.t)}</td>
        <td>${p.lat.toFixed(2)}</td>
        <td>${p.lon.toFixed(2)}</td>
        <td>${p.kt} <span style="color:var(--muted)">(${kmph})</span></td>
        <td><span class="cat-chip" style="background:${catColor}">${p.cat}</span></td>
      `;
      tr.addEventListener('click', () => {
        state.map.flyTo([p.lat, p.lon], 8, { duration: 0.8 });
      });
      tb.appendChild(tr);
    });
  }

  // --- RENDER MAP LAYERS ---
  function renderStormMap(st, shouldFitBounds = true) {
    // 1. Cone of Uncertainty
    const coneLL = (st.cone || []).map(c => [c[1], c[0]]);
    state.coneLayer.setLatLngs(coneLL);

    // 2. Track polylines
    const obsCoords = st.points.filter(p => p.kind !== 'fc').map(p => [p.lat, p.lon]);
    const fcCoords = st.points.filter(p => p.kind !== 'obs').map(p => [p.lat, p.lon]);
    state.trackObsLayer.setLatLngs(obsCoords);
    state.trackFcLayer.setLatLngs(fcCoords);

    // 3. Track Marker Icons
    state.trackMarkerGroup.clearLayers();

    function getCycloneSvg(p) {
      const catInfo = CycloneEngine.IMD_CATEGORIES[p.cat] || {};
      const col = p.kind === 'now' ? '#cc0000' : (p.kind === 'fc' ? '#d7191c' : '#14234b');
      if (p.kt < 34) {
        return `<svg viewBox="-8 -8 16 16"><circle r="5" fill="${col}" stroke="#fff" stroke-width="1.2"/></svg>`;
      }
      const arms = `<path d="M0,-4 C3,-9 7,-8 7,-8 M0,4 C-3,9 -7,8 -7,8" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`;
      return `<svg viewBox="-9 -9 18 18">${arms}<circle r="4.2" fill="${p.kt >= 48 ? col : '#fff'}" stroke="${col}" stroke-width="2"/></svg>`;
    }

    st.points.forEach(p => {
      const isNow = p.kind === 'now';
      const isFc = p.kind === 'fc';
      const kmph = p.kmph || Math.round(p.kt * 1.852);
      const title = `${p.t} UTC · ${p.lat}°N ${p.lon}°E · ${p.kt} kt (${kmph} km/h) ${p.cat}`;

      const marker = L.marker([p.lat, p.lon], {
        zIndexOffset: isNow ? 1500 : (isFc ? 1000 : 800),
        title: title,
        icon: L.divIcon({
          className: 'trk',
          html: `${getCycloneSvg(p)}<div class="lbl ${isFc ? 'fc' : ''}">${p.t}, ${p.kt}KT, ${p.cat}</div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        })
      });

      marker.bindPopup(`
        <div style="font-size:12.5px;">
          <b style="font-size:14px; color:${CycloneEngine.IMD_CATEGORIES[p.cat]?.col || '#333'}">${st.name} (${p.cat})</b><br>
          <b>Stage:</b> ${isNow ? 'Current Position (Now)' : isFc ? 'Forecast Position' : 'Observed Past'}<br>
          <b>Time:</b> ${p.t} UTC (${CycloneEngine.utcToIst(p.t)} IST)<br>
          <b>Coordinates:</b> ${p.lat.toFixed(2)}°N, ${p.lon.toFixed(2)}°E<br>
          <b>Winds:</b> ${p.kt} knots (${kmph} km/h)<br>
          ${p.lead_hours !== undefined ? `<b>Lead Time:</b> +${p.lead_hours} hrs<br>` : ''}
        </div>
      `);
      marker.addTo(state.trackMarkerGroup);
    });

    // 4. Fit bounds if requested
    if (shouldFitBounds && coneLL.length > 0) {
      state.map.fitBounds(L.polygon(coneLL).getBounds().pad(0.12), { animate: true, duration: 0.8 });
    }
  }

  // --- GRID ASSET IMPACT SCANNER ---
  function triggerAutoScan() {
    if (!state.currentStorm || !state.currentStorm.cone || state.currentStorm.cone.length === 0) return;
    performGridScan();
  }

  function performGridScan() {
    const cone = state.currentStorm.cone;
    if (!cone || cone.length < 3) return;

    const minV = +chk('kv').value || 132;
    const out = {
      Substations: new Map(),
      'Power Plants (≥100 MW)': new Map(),
      'Named Lines': new Map()
    };

    let totalMwCapacity = 0;

    // Scan offline WRI Plants
    if (typeof BASE !== 'undefined' && BASE.plants) {
      BASE.plants.forEach(p => {
        if (CycloneEngine.pointInPolygon(p[1], p[2], cone)) {
          out['Power Plants (≥100 MW)'].set(p[0], {
            n: p[0],
            v: `${p[3]} MW ${p[4]}`,
            c: [p[1], p[2]],
            s: p[3],
            fuel: p[4]
          });
          totalMwCapacity += p[3];
        }
      });
    }

    // Scan loaded OpenInfraMap Vector Tiles
    for (const { coords, layers } of state.tileCache.values()) {
      for (const ln of ['power_substation', 'power_substation_point', 'power_line', 'power_plant', 'power_plant_point']) {
        const lyr = layers[ln];
        if (!lyr || !lyr.features) continue;
        for (const f of lyr.features) {
          const p = f.properties, v = +p.voltage || 0, ext = f.extent || 4096, rings = f.geometry;
          if (!rings || !rings.length) continue;

          if (ln.startsWith('power_line')) {
            if (v < minV || !p.name || out['Named Lines'].has(p.name)) continue;
            const hit = rings.flat().find(pt => {
              const [x, y] = toLL(coords, ext, pt);
              return CycloneEngine.pointInPolygon(x, y, cone);
            });
            if (hit) {
              out['Named Lines'].set(p.name, { n: p.name, v: `${v} kV`, c: toLL(coords, ext, hit), s: v });
            }
          } else if (ln.startsWith('power_substation')) {
            if (v < minV) continue;
            const r = rings[0];
            let sx = 0, sy = 0;
            r.forEach(pt => { sx += pt.x; sy += pt.y; });
            const c = toLL(coords, ext, { x: sx / r.length, y: sy / r.length });
            if (!CycloneEngine.pointInPolygon(c[0], c[1], cone)) continue;
            const k = (p.name || c.map(z => z.toFixed(2)).join()) + '|' + v;
            if (!out.Substations.has(k)) {
              out.Substations.set(k, { n: p.name || 'Unnamed substation', v: `${v} kV`, c, s: v });
            }
          } else {
            const o = +p.output || 0;
            if (o < 100 || !p.name) continue;
            const r = rings[0];
            const c = toLL(coords, ext, r[0]);
            if (!CycloneEngine.pointInPolygon(c[0], c[1], cone)) continue;
            if (!out['Power Plants (≥100 MW)'].has(p.name)) {
              out['Power Plants (≥100 MW)'].set(p.name, { n: p.name, v: `${Math.round(o)} MW ${p.source || ''}`, c, s: o, fuel: p.source });
              totalMwCapacity += o;
            }
          }
        }
      }
    }

    // Render Impact Summary Chips & List
    const box = chk('assets');
    box.innerHTML = '';

    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'impact-summary';
    summaryDiv.innerHTML = `
      <div class="impact-chip">
        <div class="impact-chip-val">${out.Substations.size}</div>
        <div class="impact-chip-lbl">Substations (≥${minV}kV)</div>
      </div>
      <div class="impact-chip">
        <div class="impact-chip-val">${out['Power Plants (≥100 MW)'].size}</div>
        <div class="impact-chip-lbl">Plants (≥100MW)</div>
      </div>
      <div class="impact-chip">
        <div class="impact-chip-val">${Math.round(totalMwCapacity).toLocaleString()} MW</div>
        <div class="impact-chip-lbl">Exposed Capacity</div>
      </div>
    `;
    box.appendChild(summaryDiv);

    for (const [groupName, mapItems] of Object.entries(out)) {
      if (!mapItems.size) continue;
      const h = document.createElement('h2');
      h.textContent = `${groupName} (${mapItems.size})`;
      h.style.marginTop = '12px';
      box.appendChild(h);

      const ul = document.createElement('ul');
      [...mapItems.values()].sort((a, b) => b.s - a.s).forEach(a => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${a.n}</span><span>${a.v}</span>`;
        li.onclick = () => state.map.flyTo([a.c[1], a.c[0]], 11, { duration: 0.8 });
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
  }

  // --- LIVE DATA FETCHING ENGINE ---
  async function fetchLiveCyclones() {
    if (state.isFetching) return;
    state.isFetching = true;
    updateRefreshMeta('Checking live telemetry...');
    chk('refresh-btn').classList.add('spinning');

    let newLiveStorms = [];

    // Attempt 1: Check Local Proxy (only if running locally via server.py on localhost)
    const isLocalhost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
    if (isLocalhost) {
      try {
        const resp = await fetch('/api/active-cyclones', { cache: 'no-cache' });
        if (resp.ok) {
          const data = await resp.json();
          if (data && Array.isArray(data.cyclones)) {
            newLiveStorms = data.cyclones.map(c => ({ ...c, type: 'live' }));
          }
        }
      } catch (_) {
        // Local server not running or proxy offline; continue to direct client fetch
      }

      try {
        const imdResp = await fetch('/api/imd-latest', { cache: 'no-cache' });
        if (imdResp.ok) {
          const imdData = await imdResp.json();
          if (imdData && imdData.name) {
            newLiveStorms.unshift({ ...imdData, type: 'live' });
          }
        }
      } catch (_) {}
    }

    // Attempt 2: Direct Client-Side Fetch to Esri Living Atlas (JTWC / NHC Live Feed)
    if (newLiveStorms.length === 0) {
      try {
        const fcUrl = 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson';
        const obsUrl = 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson';
        const coneUrl = 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer/4/query?where=1%3D1&outFields=*&f=geojson';

        const [fcRes, obsRes, coneRes] = await Promise.allSettled([
          fetch(fcUrl),
          fetch(obsUrl),
          fetch(coneUrl)
        ]);

        const fcJson = fcRes.status === 'fulfilled' && fcRes.value.ok ? await fcRes.value.json() : null;
        const obsJson = obsRes.status === 'fulfilled' && obsRes.value.ok ? await obsRes.value.json() : null;
        const coneJson = coneRes.status === 'fulfilled' && coneRes.value.ok ? await coneRes.value.json() : null;

        const parsed = CycloneEngine.parseEsriLiveFeed(fcJson, obsJson, coneJson);
        if (parsed.length > 0) {
          newLiveStorms = parsed.map(c => ({ ...c, type: 'live' }));
        }
      } catch (err) {
        console.warn('Direct live feed fetch notice:', err);
      }
    }

    // Process & Integrate Live Storms
    if (newLiveStorms.length > 0) {
      state.availableStorms = state.availableStorms.filter(s => s.type !== 'live').concat(newLiveStorms);
      updateStormDropdown();

      // If current storm was live or none selected, switch to highest priority active storm
      const nioStorm = newLiveStorms.find(s => s.basin && s.basin.includes('Indian Ocean')) || newLiveStorms[0];
      if (nioStorm && (!state.currentStorm || state.currentStorm.type === 'live')) {
        loadStorm(nioStorm, true);
        showToast(`Live update: Activated active storm ${nioStorm.name}!`, 'ok', 4000);
      }
      chk('live-indicator-text').textContent = `${newLiveStorms.length} Active`;
    } else {
      chk('live-indicator-text').textContent = 'Live Monitored';
      showToast('Live feeds active (0 active cyclones in NIO). Benchmark scenario loaded.', '', 3500);
    }

    state.lastChecked = new Date();
    state.isFetching = false;
    chk('refresh-btn').classList.remove('spinning');
    updateRefreshMeta();
  }

  function startLivePolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    if (!state.liveMode) return;

    state.pollTimer = setInterval(() => {
      if (state.liveMode) fetchLiveCyclones();
    }, state.autoPollIntervalMs);
  }

  function updateRefreshMeta(customMsg) {
    const el = chk('refresh-meta-time');
    if (customMsg) {
      el.textContent = customMsg;
      return;
    }
    if (!state.lastChecked) {
      el.textContent = 'Auto-check enabled';
      return;
    }
    const secs = Math.round((new Date() - state.lastChecked) / 1000);
    if (secs < 60) {
      el.textContent = `Updated ${secs}s ago`;
    } else {
      el.textContent = `Updated ${Math.round(secs / 60)}m ago`;
    }
  }
  setInterval(() => { if (!state.isFetching) updateRefreshMeta(); }, 15000);

  let toastTimer = null;
  function showToast(msg, type = '', durationMs = 4000) {
    const st = chk('status');
    if (!st) return;
    clearTimeout(toastTimer);
    st.hidden = false;
    st.className = type === 'ok' ? 'ok' : '';
    st.innerHTML = `<span>${msg}</span><button type="button" class="status-close" title="Dismiss">✕</button>`;
    const closeBtn = st.querySelector('.status-close');
    if (closeBtn) {
      closeBtn.onclick = () => { st.hidden = true; };
    }
    if (durationMs > 0) {
      toastTimer = setTimeout(() => { st.hidden = true; }, durationMs);
    }
  }

  // --- UI CONTROLS & LISTENERS ---
  function initUIControls() {
    // Storm Dropdown change
    chk('storm-select').addEventListener('change', e => {
      const selected = state.availableStorms.find(s => s.id === e.target.value);
      if (selected) loadStorm(selected, true);
    });

    // Refresh Now
    chk('refresh-btn').addEventListener('click', () => {
      fetchLiveCyclones();
    });

    // Auto Refresh toggle
    chk('auto-poll-select').addEventListener('change', e => {
      const val = parseInt(e.target.value, 10);
      if (val === 0) {
        state.liveMode = false;
        clearInterval(state.pollTimer);
        chk('live-badge').style.opacity = '0.5';
      } else {
        state.liveMode = true;
        state.autoPollIntervalMs = val * 60 * 1000;
        chk('live-badge').style.opacity = '1';
        startLivePolling();
      }
    });

    // Layer toggles
    const regrid = () => { if (state.gridLayer) state.gridLayer.redraw(); };
    chk('t-lines').onchange = e => { state.layers.lines = e.target.checked; regrid(); };
    chk('t-subs').onchange = e => { state.layers.subs = e.target.checked; regrid(); drawLabels(); };
    chk('t-plants').onchange = e => { state.layers.plants = e.target.checked; regrid(); };
    chk('t-sname').onchange = e => { state.layers.sname = e.target.checked; drawLabels(); };
    chk('t-wri').onchange = e => { if (state.wriLayer) e.target.checked ? state.wriLayer.addTo(state.map) : state.wriLayer.remove(); };
    chk('t-cone').onchange = e => { e.target.checked ? state.coneLayer.addTo(state.map) : state.coneLayer.remove(); };
    chk('t-labels').onchange = e => { chk('map').classList.toggle('hide-lbl', !e.target.checked); };

    // Scanner actions
    chk('scan').onclick = performGridScan;
    chk('kv').onchange = performGridScan;
    chk('fitcone').onclick = () => {
      if (state.currentStorm && state.currentStorm.cone && state.currentStorm.cone.length > 0) {
        state.map.fitBounds(L.polygon(state.currentStorm.cone.map(c => [c[1], c[0]])).getBounds(), { animate: true, duration: 0.8 });
      }
    };
  }

  // --- MODALS (IMD BULLETIN PARSER & TRACK EDITOR) ---
  function initModals() {
    // 1. IMD Bulletin Importer Modal
    const importModal = chk('modal-import');
    chk('btn-open-import').onclick = () => importModal.classList.add('open');
    chk('btn-close-import').onclick = () => importModal.classList.remove('open');
    chk('btn-cancel-import').onclick = () => importModal.classList.remove('open');

    chk('btn-apply-import').onclick = () => {
      const text = chk('bulletin-textarea').value.trim();
      if (!text) {
        alert('Please paste an IMD bulletin text or select one of the sample templates.');
        return;
      }
      const parsed = CycloneEngine.parseIMDBulletin(text);
      if (!parsed || !parsed.points || parsed.points.length === 0) {
        alert('Could not detect coordinates or track table. Please check bulletin format.');
        return;
      }

      parsed.type = 'custom';
      state.availableStorms.unshift(parsed);
      updateStormDropdown();
      loadStorm(parsed, true);
      importModal.classList.remove('open');
      showToast(`Successfully plotted ${parsed.name} from IMD bulletin!`, 'ok');
    };

    // Preset sample buttons inside modal
    document.querySelectorAll('.btn-sample-bulletin').forEach(btn => {
      btn.onclick = () => {
        const stormKey = btn.getAttribute('data-storm');
        const st = CYCLONE_PRESETS[stormKey];
        if (st) {
          // Generate sample bulletin text
          chk('bulletin-textarea').value = generateSampleBulletinText(st);
        }
      };
    });

    // 2. Track Editor Modal
    const editModal = chk('modal-edit');
    chk('btn-open-edit').onclick = () => {
      populateTrackEditor();
      editModal.classList.add('open');
    };
    chk('btn-close-edit').onclick = () => editModal.classList.remove('open');
    chk('btn-cancel-edit').onclick = () => editModal.classList.remove('open');

    chk('btn-add-point').onclick = () => {
      const tbody = chk('editor-tbody');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" class="ed-t" value="Next" style="width:50px"></td>
        <td><input type="number" step="0.01" class="ed-lat" value="17.5" style="width:65px"></td>
        <td><input type="number" step="0.01" class="ed-lon" value="82.0" style="width:65px"></td>
        <td><input type="number" class="ed-kt" value="55" style="width:50px"></td>
        <td>
          <select class="ed-cat">
            <option value="SuCS">SuCS</option><option value="ESCS">ESCS</option>
            <option value="VSCS">VSCS</option><option value="SCS" selected>SCS</option>
            <option value="CS">CS</option><option value="DD">DD</option><option value="D">D</option>
          </select>
        </td>
        <td><select class="ed-kind"><option value="obs">obs</option><option value="now">now</option><option value="fc" selected>fc</option></select></td>
        <td><button type="button" class="btn btn-sm" onclick="this.closest('tr').remove()">✕</button></td>
      `;
      tbody.appendChild(tr);
    };

    chk('btn-apply-edit').onclick = () => {
      const rows = document.querySelectorAll('#editor-tbody tr');
      const newPoints = [];
      rows.forEach((r, idx) => {
        const t = r.querySelector('.ed-t').value;
        const lat = parseFloat(r.querySelector('.ed-lat').value);
        const lon = parseFloat(r.querySelector('.ed-lon').value);
        const kt = parseInt(r.querySelector('.ed-kt').value, 10);
        const cat = r.querySelector('.ed-cat').value;
        const kind = r.querySelector('.ed-kind').value;
        if (!isNaN(lat) && !isNaN(lon) && !isNaN(kt)) {
          newPoints.push({
            t, lat, lon, kt, kmph: Math.round(kt * 1.852), cat, kind, lead_hours: idx * 6
          });
        }
      });

      if (newPoints.length < 2) {
        alert('Please provide at least 2 valid coordinates.');
        return;
      }

      // Recompute cone and update
      const fcPts = newPoints.filter(p => p.kind === 'fc' || p.kind === 'now');
      const updatedStorm = {
        ...state.currentStorm,
        id: `edited_${Date.now()}`,
        name: `${state.currentStorm.name} (Simulated)`,
        statusBadge: 'SIMULATED / EDITED',
        points: newPoints,
        cone: CycloneEngine.generateIMDCone(fcPts),
        type: 'custom'
      };

      state.availableStorms.unshift(updatedStorm);
      updateStormDropdown();
      loadStorm(updatedStorm, true);
      editModal.classList.remove('open');
      showToast('Custom track coordinates applied & cone dynamically recomputed!', 'ok');
    };

    // 3. Raw Bulletin Viewer Modal
    const rawModal = chk('modal-raw');
    if (chk('btn-view-raw-bulletin')) {
      chk('btn-view-raw-bulletin').onclick = () => {
        if (!state.currentStorm) return;
        const text = state.currentStorm.rawBulletin || generateSampleBulletinText(state.currentStorm);
        chk('raw-bulletin-text').textContent = text;
        chk('raw-modal-meta').textContent = `Agency: ${state.currentStorm.agency || 'IMD RSMC New Delhi'} · ${state.currentStorm.bulletinNo || ''}`;
        if (chk('raw-modal-link') && state.currentStorm.sourceUrl) {
          chk('raw-modal-link').href = state.currentStorm.sourceUrl;
        }
        rawModal.classList.add('open');
      };
    }
    if (chk('btn-close-raw')) chk('btn-close-raw').onclick = () => rawModal.classList.remove('open');
    if (chk('btn-cancel-raw')) chk('btn-cancel-raw').onclick = () => rawModal.classList.remove('open');
  }

  function populateTrackEditor() {
    const tbody = chk('editor-tbody');
    tbody.innerHTML = '';
    if (!state.currentStorm || !state.currentStorm.points) return;

    state.currentStorm.points.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" class="ed-t" value="${p.t}" style="width:50px"></td>
        <td><input type="number" step="0.01" class="ed-lat" value="${p.lat.toFixed(2)}" style="width:65px"></td>
        <td><input type="number" step="0.01" class="ed-lon" value="${p.lon.toFixed(2)}" style="width:65px"></td>
        <td><input type="number" class="ed-kt" value="${p.kt}" style="width:50px"></td>
        <td>
          <select class="ed-cat">
            ${['SuCS','ESCS','VSCS','SCS','CS','DD','D','WML'].map(c => `<option value="${c}" ${p.cat === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </td>
        <td>
          <select class="ed-kind">
            <option value="obs" ${p.kind === 'obs' ? 'selected' : ''}>obs</option>
            <option value="now" ${p.kind === 'now' ? 'selected' : ''}>now</option>
            <option value="fc" ${p.kind === 'fc' ? 'selected' : ''}>fc</option>
          </select>
        </td>
        <td><button type="button" class="btn btn-sm" onclick="this.closest('tr').remove()">✕</button></td>
      `;
      tbody.appendChild(tr);
    });
  }

  function generateSampleBulletinText(st) {
    return `INDIA METEOROLOGICAL DEPARTMENT
BULLETIN NO. ${st.bulletinNo || '15'}
TIME OF ISSUE: 1430 HOURS IST DATED ${st.issueTime || '24.10.2024'}
FROM: INDIA METEOROLOGICAL DEPARTMENT, NEW DELHI
SUB: ${st.categoryFull.toUpperCase()} “${st.name.toUpperCase()}” OVER NORTH INDIAN OCEAN

THE ${st.categoryFull.toUpperCase()} “${st.name.toUpperCase()}” LAY CENTRED AT ${st.issueTime} NEAR LATITUDE ${st.currentCenter.lat}°N AND LONGITUDE ${st.currentCenter.lon}°E.

FORECAST TRACK AND INTENSITY ARE GIVEN IN THE FOLLOWING TABLE:
Date/Time (IST) | Position (Lat. °N/ Long. °E) | Maximum sustained surface wind speed (kmph) | Category of cyclonic disturbance
${st.points.map(p => `${p.t}00 | ${p.lat.toFixed(1)} / ${p.lon.toFixed(1)} | ${p.kmph || Math.round(p.kt * 1.852)} kmph GUSTING TO ${(p.kmph || Math.round(p.kt * 1.852)) + 15} | ${CycloneEngine.IMD_CATEGORIES[p.cat]?.name || p.cat}`).join('\n')}
`;
  }

})();

