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
    showProbGradient: false,
    showWindGradient: false,
    showAssetRiskMarkers: true,
    probConeGroup: null,
    windConeGroup: null,
    assetRiskLayerGroup: null,
    probLayers: {
      low: null,
      med: null,
      high: null
    },
    windLayers: {
      gale: null,
      storm: null,
      hurricane: null
    },
    affectedTableSort: {
      column: 'prob', // default sort by Tripping Probability descending
      descending: true
    },
    currentScannedAssets: [],
    coneLayer: null,
    trackObsLayer: null,
    trackFcLayer: null,
    trackMarkerGroup: null,
    nameLayer: null,
    wriLayer: null,
    map: null,
    gridLayer: null,
    minVoltage: 400,
    minPlantMw: 100,
    lastScannedImpact: null
  };

  const chk = id => document.getElementById(id);

  // --- INITIALIZATION ---
  window.addEventListener('DOMContentLoaded', initApp);

  async function initApp() {
    state.minVoltage = chk('kv') ? (+chk('kv').value || 400) : 400;
    state.minPlantMw = chk('plant-mw') ? (+chk('plant-mw').value || 100) : 100;
    initMap();
    initPresets();
    initUIControls();
    initModals();

    // Check live feeds immediately and load the latest active storm directly
    await fetchLiveCyclones();

    // Only load fallback preset if live fetch returned nothing
    if (!state.currentStorm) {
      if (typeof window.LATEST_IMD_ADVISORY !== 'undefined' && window.LATEST_IMD_ADVISORY) {
        loadStorm(window.LATEST_IMD_ADVISORY, false);
      } else {
        loadStorm(CYCLONE_PRESETS.dana_2024, false);
      }
    }

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

    // 1. Global Basemap Tile Providers (100% Free, Zero API Keys, No Watermarks)
    const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      pane: 'basemap',
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
    });

    const esriGrayBase = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      pane: 'basemap',
      maxZoom: 16,
      attribution: 'Tiles © <a href="https://www.esri.com" target="_blank">Esri</a>'
    });
    const esriGrayRef = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
      pane: 'basemap',
      maxZoom: 16
    });
    const esriGrayLayer = L.layerGroup([esriGrayBase, esriGrayRef]);

    const esriSatBase = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      pane: 'basemap',
      maxZoom: 18,
      attribution: 'Tiles © <a href="https://www.esri.com" target="_blank">Esri</a>'
    });
    const esriSatRef = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      pane: 'basemap',
      maxZoom: 18
    });
    const esriSatLayer = L.layerGroup([esriSatBase, esriSatRef]);

    const esriTopo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
      pane: 'basemap',
      maxZoom: 18,
      attribution: 'Tiles © <a href="https://www.esri.com" target="_blank">Esri</a>'
    });

    // Offline Vector Base Layer (used for fallback or offline inspection)
    const offlineBaseGroup = L.layerGroup();
    if (typeof BASE !== 'undefined') {
      if (BASE.land) {
        L.geoJSON({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: BASE.land.map(r => [r]) } }, {
          pane: 'basemap', interactive: false, style: { stroke: true, color: '#8d7860', weight: 1.2, fillColor: '#f4f1e8', fillOpacity: 1 }
        }).addTo(offlineBaseGroup);
      }
      if (BASE.states) {
        L.geoJSON({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: BASE.states } }, {
          pane: 'basemap', interactive: false, style: { color: '#a98d6b', weight: 0.8, dashArray: '4 3' }
        }).addTo(offlineBaseGroup);
      }
      if (BASE.countries) {
        L.geoJSON({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: BASE.countries } }, {
          pane: 'basemap', interactive: false, style: { color: '#7a5c3c', weight: 1.4 }
        }).addTo(offlineBaseGroup);
      }
      if (BASE.cities) {
        BASE.cities.forEach(([n, x, y]) => {
          L.marker([y, x], {
            interactive: false, keyboard: false,
            icon: L.divIcon({ className: 'city', html: `<i></i>${n}`, iconSize: null, iconAnchor: [3, 7] })
          }).addTo(offlineBaseGroup);
        });
      }
    }

    // Set OpenStreetMap Standard as the active global basemap by default
    osmLayer.addTo(state.map);

    // Basemap Layer Selection Control (top-right of map)
    const baseMaps = {
      "🗺️ OpenStreetMap": osmLayer,
      "🌐 Light Gray Canvas": esriGrayLayer,
      "🛰️ Satellite Hybrid": esriSatLayer,
      "⛰️ Topographic": esriTopo,
      "📴 Offline Simple Vector": offlineBaseGroup
    };
    L.control.layers(baseMaps, null, { position: 'topright', collapsed: true }).addTo(state.map);

    state.map.attributionControl.addAttribution('Grid © <a href="https://openinframap.org" target="_blank">OpenInfraMap</a>');

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

    // Multi-Zone Probability Gradient Cone Group (P_trip)
    state.probConeGroup = L.layerGroup();
    state.probLayers = {
      // 1. Low Probability Outer Zone (Soft Blue-Green / Neutral #A9E34B)
      low: L.polygon([], {
        pane: 'cone',
        color: '#82c91e',
        weight: 1.0,
        fillColor: '#a9e34b',
        fillOpacity: 0.12,
        interactive: false
      }),
      // 2. Moderate Probability Mid-Cone Zone (Light Yellow-Orange #FFE066)
      med: L.polygon([], {
        pane: 'cone',
        color: '#f59f00',
        weight: 1.0,
        fillColor: '#ffe066',
        fillOpacity: 0.10,
        interactive: false
      }),
      // 3. High Probability Zone: Center/Eyewall & Right-Forward Quadrant (Soft Coral / Light Amber #FF6B6B to #FFA94D)
      high: L.polygon([], {
        pane: 'cone',
        color: '#fa5252',
        weight: 1.2,
        fillColor: '#ff6b6b',
        fillOpacity: 0.10,
        interactive: false
      })
    };
    state.probLayers.low.addTo(state.probConeGroup);
    state.probLayers.med.addTo(state.probConeGroup);
    state.probLayers.high.addTo(state.probConeGroup);

    // Multi-Zone Wind Speed Swath Layer Group (Gale, Storm, Hurricane)
    state.windConeGroup = L.layerGroup();
    state.windLayers = {
      gale: L.polygon([], {
        pane: 'cone',
        color: '#f59f00',
        weight: 1.0,
        fillColor: '#ffe066',
        fillOpacity: 0.10,
        interactive: false
      }),
      storm: L.polygon([], {
        pane: 'cone',
        color: '#e67700',
        weight: 1.0,
        fillColor: '#ffa94d',
        fillOpacity: 0.10,
        interactive: false
      }),
      hurricane: L.polygon([], {
        pane: 'cone',
        color: '#d6336c',
        weight: 1.2,
        fillColor: '#ff6b6b',
        fillOpacity: 0.10,
        interactive: false
      })
    };
    state.windLayers.gale.addTo(state.windConeGroup);
    state.windLayers.storm.addTo(state.windConeGroup);
    state.windLayers.hurricane.addTo(state.windConeGroup);

    // High-visibility Risk-Colored Asset Markers Layer Group
    state.assetRiskLayerGroup = L.layerGroup().addTo(state.map);

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
  function getVoltageColor(pOrV) {
    if (typeof pOrV === 'object' && pOrV !== null) {
      if ((pOrV.frequency !== undefined && +pOrV.frequency === 0 && pOrV.frequency !== '') || (pOrV.voltage && String(pOrV.voltage).toLowerCase().includes('dc'))) {
        return '#C2185B'; // HVDC: Dark Pink
      }
    }
    const v = typeof pOrV === 'object' && pOrV !== null ? (+pOrV.voltage || 0) : (+pOrV || 0);
    if (v >= 700) return '#EAB308'; // 765 kV: Yellow
    if (v >= 310) return '#E53935'; // 400 kV: Red
    if (v >= 200) return '#16A34A'; // 220 kV and 230 kV: Green
    if (v >= 100) return '#F472B6'; // 132 kV and 110 kV: Light Pink
    if (v >= 50) return '#0D47A1';  // 66 kV: Dark Blue
    if (v >= 20) return '#8B4513';  // 33 kV: Brown
    return v >= 10 ? '#6E97B8' : '#7A7A85';
  }

  function initVectorGrid() {
    function vcol(p) {
      return getVoltageColor(p);
    }

    const HIDE = [];
    const gridStyles = {
      power_line: (p, z) => {
        if (!state.layers.lines || p.line === 'bay' || p.line === 'busbar') return HIDE;
        const v = +p.voltage || 0;
        const minV = state.minVoltage !== undefined ? state.minVoltage : (chk('kv') ? +chk('kv').value : 0);
        if (minV > 0 && v < minV) return HIDE;
        if (z < 7 && v < 100) return HIDE;
        return { color: vcol(p), weight: z < 7 ? 1 : z < 9 ? 1.5 : z < 11 ? 2.2 : 3, opacity: 0.9 };
      },
      power_substation: (p, z) => {
        if (!state.layers.subs) return HIDE;
        const v = +p.voltage || 0;
        const minV = state.minVoltage !== undefined ? state.minVoltage : (chk('kv') ? +chk('kv').value : 0);
        if (minV > 0 && v < minV) return HIDE;
        if (z < 6.5 && v < 400) return HIDE;
        if (z < 8 && v < 220) return HIDE;
        return { color: vcol(p), weight: 1.2, fill: true, fillColor: vcol(p), fillOpacity: 0.5 };
      },
      power_substation_point: (p, z) => {
        if (!state.layers.subs) return HIDE;
        const v = +p.voltage || 0;
        const minV = state.minVoltage !== undefined ? state.minVoltage : (chk('kv') ? +chk('kv').value : 0);
        if (minV > 0 && v < minV) return HIDE;
        if (z < 6.5 && v < 400) return HIDE;
        if (z < 8 && v < 220) return HIDE;
        return { radius: z < 8 ? 3.5 : 5, color: '#fff', weight: 1.2, fill: true, fillColor: vcol(p), fillOpacity: 1 };
      },
      power_plant: (p, z) => {
        if (!state.layers.plants) return HIDE;
        const mw = +p.output || 0;
        const minMw = state.minPlantMw !== undefined ? state.minPlantMw : (chk('plant-mw') ? +chk('plant-mw').value : 0);
        if (minMw === 500 && mw < 500) return HIDE;
        if (minMw === 200 && mw <= 200) return HIDE;
        if (minMw === 100 && mw < 100) return HIDE;
        return { color: '#7c4544', weight: 1, fill: true, fillColor: '#7c4544', fillOpacity: 0.25 };
      },
      power_plant_point: (p, z) => {
        if (!state.layers.plants) return HIDE;
        const mw = +p.output || 0;
        const minMw = state.minPlantMw !== undefined ? state.minPlantMw : (chk('plant-mw') ? +chk('plant-mw').value : 0);
        if (minMw === 500 && mw < 500) return HIDE;
        if (minMw === 200 && mw <= 200) return HIDE;
        if (minMw === 100 && mw < 100) return HIDE;
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
    if (state.wriLayer) {
      state.wriLayer.clearLayers();
    }
    const fuelCol = { Coal: '#4a3b35', Gas: '#d98b2b', Hydro: '#2f7fc1', Solar: '#e6c229', Wind: '#5bb5a2', Nuclear: '#b0359b', Oil: '#6b7280' };
    const minMw = state.minPlantMw !== undefined ? state.minPlantMw : (chk('plant-mw') ? +chk('plant-mw').value : 100);
    const filterFn = (mw) => {
      if (minMw === 500) return mw >= 500;
      if (minMw === 200) return mw > 200;
      if (minMw === 100) return mw >= 100;
      return true;
    };

    const markers = BASE.plants
      .filter(p => filterFn(p[3] || 0))
      .map(p => {
        const radius = p[3] >= 2000 ? 7 : p[3] >= 1000 ? 5.5 : p[3] >= 500 ? 4.5 : 3.2;
        return L.circleMarker([p[2], p[1]], {
          pane: 'gridpts',
          radius: radius,
          color: '#fff',
          weight: 1,
          fillColor: fuelCol[p[4]] || '#888',
          fillOpacity: 0.9
        }).bindPopup(describeAsset({ name: p[0], output: p[3], source: p[4], operator: p[5], db: 'WRI Global Power Plant Database' }, 'Power plant'));
      });

    if (!state.wriLayer) {
      state.wriLayer = L.layerGroup(markers).addTo(state.map);
    } else {
      markers.forEach(m => state.wriLayer.addLayer(m));
    }
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
    const userMinV = state.minVoltage !== undefined ? state.minVoltage : (chk('kv') ? +chk('kv').value : 0);
    const zoomMinV = z < 6.5 ? 400 : z < 8 ? 220 : z < 10 ? 132 : z < 12 ? 33 : 0;
    const minV = Math.max(userMinV, zoomMinV);
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
      const col = getVoltageColor(p);
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
      if (st.name === 'Latest Advisory') {
        opt.textContent = `Latest Advisory (${st.category || 'TC'} · ${st.year || '2026'})`;
      } else {
        opt.textContent = `${st.name} (${st.category || 'TC'} · ${st.year || '2026'})`;
      }
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

    if (state.currentStorm && sel) {
      sel.value = state.currentStorm.id;
    }
  }

  // --- LOAD & SWITCH CYCLONE ---
  function loadStorm(stormData, shouldFitBounds = true) {
    if (!stormData) return;

    // Ensure cone exists; generate dynamically from forecast points
    if (!stormData.isLiveFeedPolygon || !stormData.cone || stormData.cone.length === 0) {
      const fcPts = stormData.points.filter(p => p.kind === 'fc' || p.kind === 'now');
      stormData.cone = CycloneEngine.generateIMDCone(fcPts);
    }

    state.currentStorm = stormData;
    if (chk('storm-select')) chk('storm-select').value = stormData.id;
    renderStormUI(stormData);
    renderStormMap(stormData, shouldFitBounds);
    triggerAutoScan();
  }

  // --- RENDER SIDEBAR UI ---
  function renderStormUI(st) {
    if (st.name === 'Latest Advisory' || !st.name) {
      chk('storm-title').textContent = `${st.categoryFull || st.category || 'Cyclonic Disturbance'} (Latest Advisory)`;
    } else {
      chk('storm-title').textContent = `${st.categoryFull || st.category} ‘${st.name}’`;
    }
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
  function applyProbGradientStyle() {
    const isProbOn = !!state.showProbGradient;
    const isWindOn = !!state.showWindGradient;

    // Toggle Legend Cards
    const probLegend = chk('prob-legend-card');
    if (probLegend) probLegend.style.display = isProbOn ? 'block' : 'none';

    const windLegend = chk('wind-legend-card');
    if (windLegend) windLegend.style.display = isWindOn ? 'block' : 'none';

    // Base Cone Outline vs Solid Fill
    if (isProbOn || isWindOn) {
      if (state.coneLayer) {
        state.coneLayer.setStyle({
          fillOpacity: 0,
          weight: 1.4,
          color: '#495057',
          dashArray: '3 4'
        });
      }
    } else {
      if (state.coneLayer) {
        state.coneLayer.setStyle({
          color: '#2e9e45',
          weight: 1.8,
          fillColor: '#2e9e45',
          fillOpacity: 0.22,
          dashArray: null
        });
      }
    }

    // Probability Cone Layers
    if (isProbOn && state.layers.cone) {
      if (state.probConeGroup && !state.map.hasLayer(state.probConeGroup)) {
        state.probConeGroup.addTo(state.map);
      }
    } else {
      if (state.probConeGroup && state.map.hasLayer(state.probConeGroup)) {
        state.map.removeLayer(state.probConeGroup);
      }
    }

    // Wind Speed Swath Layers
    if (isWindOn && state.layers.cone) {
      if (state.windConeGroup && !state.map.hasLayer(state.windConeGroup)) {
        state.windConeGroup.addTo(state.map);
      }
    } else {
      if (state.windConeGroup && state.map.hasLayer(state.windConeGroup)) {
        state.map.removeLayer(state.windConeGroup);
      }
    }
  }

  function renderRiskAssetMarkers() {
    if (!state.assetRiskLayerGroup) return;
    state.assetRiskLayerGroup.clearLayers();
    if (!state.showAssetRiskMarkers) return;

    const assets = state.currentScannedAssets || [];
    assets.forEach(a => {
      const r = a.risk;
      if (!r) return;
      const isHigh = r.pTrip >= 70;
      const isMed = r.pTrip >= 40 && r.pTrip < 70;

      const markerCol = isHigh ? '#e03131' : (isMed ? '#d97706' : '#2b8a3e');
      const fillCol = isHigh ? '#ff6b6b' : (isMed ? '#ffe066' : '#a9e34b');
      const radius = isHigh ? 7.5 : (isMed ? 6 : 5);

      const m = L.circleMarker([a.c[1], a.c[0]], {
        pane: 'markerPane',
        radius: radius,
        color: markerCol,
        weight: 2,
        fillColor: fillCol,
        fillOpacity: 0.88
      });

      const catBadge = `<span class="cat-chip" style="background:${markerCol}; color:#fff; font-size:9.5px; padding:1px 5px;">${r.riskLevel.toUpperCase()} RISK (${r.pTrip}%)</span>`;
      m.bindPopup(`
        <div class="asset-risk-popup">
          <b class="title" style="color:${markerCol}">${a.n}</b>
          <div><b>Category:</b> ${a.cat} · <b>Rating:</b> ${a.v}</div>
          <div><b>Tripping Probability:</b> ${catBadge}</div>
          <div><b>Est. Local Wind:</b> <b>${r.localWindKmph || r.windKmph} km/h</b> <span style="color:var(--muted)">(${r.localWindKt || Math.round((r.windKmph || 60)/1.852)} kt)</span></div>
          <div><b>Distance to Track:</b> ${r.distToTrackKm} km</div>
          <div><b>Quadrant:</b> ${r.quadrant} (${r.quadrantCode})</div>
        </div>
      `);

      m.addTo(state.assetRiskLayerGroup);
    });
  }

  function renderStormMap(st, shouldFitBounds = true) {
    // 1. Cone of Uncertainty
    const coneLL = (st.cone || []).map(c => [c[1], c[0]]);
    state.coneLayer.setLatLngs(coneLL);

    // Multi-zone probability gradient cones (High, Moderate, Low with RF expansion)
    const fcPoints = (st.points || []).filter(p => p.kind !== 'obs');
    const ptsForCone = fcPoints.length > 0 ? fcPoints : (st.points || []);
    const probCones = CycloneEngine.generateProbabilityCones(ptsForCone);
    if (probCones && state.probLayers) {
      if (state.probLayers.low && probCones.low) {
        state.probLayers.low.setLatLngs(probCones.low.map(c => [c[1], c[0]]));
      }
      if (state.probLayers.med && probCones.med) {
        state.probLayers.med.setLatLngs(probCones.med.map(c => [c[1], c[0]]));
      }
      if (state.probLayers.high && probCones.high) {
        state.probLayers.high.setLatLngs(probCones.high.map(c => [c[1], c[0]]));
      }
    }

    // Multi-zone wind speed swath (Gale, Storm, Hurricane)
    if (CycloneEngine.generateWindSpeedSwath && state.windLayers) {
      const windSwaths = CycloneEngine.generateWindSpeedSwath(ptsForCone);
      if (windSwaths) {
        if (state.windLayers.gale && windSwaths.gale) {
          state.windLayers.gale.setLatLngs(windSwaths.gale.map(c => [c[1], c[0]]));
        }
        if (state.windLayers.storm && windSwaths.storm) {
          state.windLayers.storm.setLatLngs(windSwaths.storm.map(c => [c[1], c[0]]));
        }
        if (state.windLayers.hurricane && windSwaths.hurricane) {
          state.windLayers.hurricane.setLatLngs(windSwaths.hurricane.map(c => [c[1], c[0]]));
        }
      }
    }

    applyProbGradientStyle();

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

    const minV = state.minVoltage !== undefined ? state.minVoltage : (chk('kv') ? +chk('kv').value : 400);
    const minMw = state.minPlantMw !== undefined ? state.minPlantMw : (chk('plant-mw') ? +chk('plant-mw').value : 100);

    const out = {
      Substations: new Map(),
      Plants: new Map(),
      'Power Plants (≥100 MW)': new Map(),
      'Named Lines': new Map()
    };
    out['Power Plants (≥100 MW)'] = out.Plants;

    const allConePlants = new Map();
    const fcPoints = (state.currentStorm.points || []).filter(p => p.kind !== 'obs');
    const forecastPoints = fcPoints.length > 0 ? fcPoints : (state.currentStorm.points || []);

    const plantMatchesFilter = (mw) => {
      if (minMw === 500) return mw >= 500;
      if (minMw === 200) return mw > 200;
      if (minMw === 100) return mw >= 100;
      return true;
    };

    // 1. Scan offline WRI Plants
    if (typeof BASE !== 'undefined' && BASE.plants) {
      BASE.plants.forEach(p => {
        if (CycloneEngine.pointInPolygon(p[1], p[2], cone)) {
          const mw = p[3] || 0;
          const risk = CycloneEngine.calculateTrippingProbability(p[2], p[1], mw, true, forecastPoints);
          const tier = mw >= 500 ? 'Power Plant (≥500 MW Mega)' : (mw > 200 ? 'Power Plant (>200 MW Major)' : 'Power Plant (≥100 MW)');
          allConePlants.set(p[0], {
            n: p[0],
            v: `${mw} MW ${p[4] || ''}`,
            c: [p[1], p[2]],
            s: mw,
            fuel: p[4] || 'Thermal',
            cat: tier,
            risk
          });
        }
      });
    }

    // 2. Scan loaded OpenInfraMap Vector Tiles
    for (const { coords, layers } of state.tileCache.values()) {
      for (const ln of ['power_substation', 'power_substation_point', 'power_line', 'power_plant', 'power_plant_point']) {
        const lyr = layers[ln];
        if (!lyr || !lyr.features) continue;
        for (const f of lyr.features) {
          const p = f.properties, v = +p.voltage || 0, ext = f.extent || 4096, rings = f.geometry;
          if (!rings || !rings.length) continue;

          if (ln.startsWith('power_line')) {
            if ((minV > 0 && v < minV) || !p.name || out['Named Lines'].has(p.name)) continue;
            const hit = rings.flat().find(pt => {
              const [x, y] = toLL(coords, ext, pt);
              return CycloneEngine.pointInPolygon(x, y, cone);
            });
            if (hit) {
              const c = toLL(coords, ext, hit);
              const risk = CycloneEngine.calculateTrippingProbability(c[1], c[0], v, false, forecastPoints);
              out['Named Lines'].set(p.name, {
                n: p.name,
                v: `${v} kV`,
                c,
                s: v,
                cat: 'Transmission Line',
                risk
              });
            }
          } else if (ln.startsWith('power_substation')) {
            if (minV > 0 && v < minV) continue;
            const r = rings[0];
            let sx = 0, sy = 0;
            r.forEach(pt => { sx += pt.x; sy += pt.y; });
            const c = toLL(coords, ext, { x: sx / r.length, y: sy / r.length });
            if (!CycloneEngine.pointInPolygon(c[0], c[1], cone)) continue;
            const k = (p.name || c.map(z => z.toFixed(2)).join()) + '|' + v;
            if (!out.Substations.has(k)) {
              const risk = CycloneEngine.calculateTrippingProbability(c[1], c[0], v, false, forecastPoints);
              out.Substations.set(k, {
                n: p.name || 'Unnamed substation',
                v: `${v} kV`,
                c,
                s: v,
                cat: 'Substation',
                risk
              });
            }
          } else {
            const o = +p.output || 0;
            if (o < 50 || !p.name) continue;
            const r = rings[0];
            const c = toLL(coords, ext, r[0]);
            if (!CycloneEngine.pointInPolygon(c[0], c[1], cone)) continue;
            if (!allConePlants.has(p.name)) {
              const risk = CycloneEngine.calculateTrippingProbability(c[1], c[0], o, true, forecastPoints);
              const tier = o >= 500 ? 'Power Plant (≥500 MW Mega)' : (o > 200 ? 'Power Plant (>200 MW Major)' : 'Power Plant (≥100 MW)');
              allConePlants.set(p.name, {
                n: p.name,
                v: `${Math.round(o)} MW ${p.source || ''}`,
                c,
                s: o,
                fuel: p.source || 'Power Plant',
                cat: tier,
                risk
              });
            }
          }
        }
      }
    }

    // Breakdown metrics across all plants inside cone
    const allPlantsList = [...allConePlants.values()];
    const countGe500 = allPlantsList.filter(p => p.s >= 500).length;
    const countGt200 = allPlantsList.filter(p => p.s > 200).length;
    const countGe100 = allPlantsList.filter(p => p.s >= 100).length;
    const totalConeMw = allPlantsList.reduce((sum, p) => sum + (p.s || 0), 0);

    // Apply plant capacity filter to active view
    let totalMwCapacity = 0;
    allPlantsList.forEach(item => {
      if (plantMatchesFilter(item.s)) {
        out.Plants.set(item.n, item);
        totalMwCapacity += item.s;
      }
    });

    state.lastScannedImpact = {
      out,
      minV,
      minMw,
      totalMwCapacity,
      plantCounts: {
        ge500: countGe500,
        gt200: countGt200,
        ge100: countGe100,
        total: allPlantsList.length,
        totalConeMw
      }
    };

    // Flatten assets list for table rendering & column sorting
    const allAssets = [];
    out.Substations.forEach(item => allAssets.push(item));
    out.Plants.forEach(item => allAssets.push(item));
    out['Named Lines'].forEach(item => allAssets.push(item));
    state.currentScannedAssets = allAssets;

    renderAffectedAssetsUI();
    renderRiskAssetMarkers();
  }

  function renderAffectedAssetsUI() {
    const box = chk('assets');
    if (!box) return;
    box.innerHTML = '';

    const impact = state.lastScannedImpact;
    if (!impact) return;
    const { out, minV, totalMwCapacity, plantCounts } = impact;
    const assets = state.currentScannedAssets || [];
    const highRiskCount = assets.filter(a => a.risk && a.risk.pTrip >= 70).length;

    const cnt500 = plantCounts ? plantCounts.ge500 : 0;
    const cnt200 = plantCounts ? plantCounts.gt200 : 0;
    const cnt100 = plantCounts ? plantCounts.ge100 : 0;

    // 1. Impact Summary Chips (6 chips in 3x2 grid)
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'impact-summary';
    const subLabel = minV > 0 ? `Substations (≥${minV} kV)` : 'Substations (All)';
    summaryDiv.innerHTML = `
      <div class="impact-chip">
        <div class="impact-chip-val">${out.Substations.size}</div>
        <div class="impact-chip-lbl">${subLabel}</div>
      </div>
      <div class="impact-chip">
        <div class="impact-chip-val">${cnt500}</div>
        <div class="impact-chip-lbl">Plants (≥500 MW)</div>
      </div>
      <div class="impact-chip">
        <div class="impact-chip-val">${cnt200}</div>
        <div class="impact-chip-lbl">Plants (&gt;200 MW)</div>
      </div>
      <div class="impact-chip">
        <div class="impact-chip-val">${cnt100}</div>
        <div class="impact-chip-lbl">Plants (≥100 MW)</div>
      </div>
      <div class="impact-chip">
        <div class="impact-chip-val">${Math.round(totalMwCapacity).toLocaleString()} MW</div>
        <div class="impact-chip-lbl">Exposed Cap.</div>
      </div>
      <div class="impact-chip impact-chip-high">
        <div class="impact-chip-val">${highRiskCount}</div>
        <div class="impact-chip-lbl">High Risk (P<sub>trip</sub>≥70%)</div>
      </div>
    `;
    box.appendChild(summaryDiv);

    if (assets.length === 0) {
      const emptyNote = document.createElement('p');
      emptyNote.className = 'note';
      emptyNote.style.marginTop = '10px';
      emptyNote.textContent = 'No power grid assets currently detected inside the active cone at this voltage threshold.';
      box.appendChild(emptyNote);
      return;
    }

    // 2. Interactive Sortable Likely Affected Elements Table
    const tableHeaderTitle = document.createElement('h2');
    tableHeaderTitle.style.marginTop = '14px';
    tableHeaderTitle.textContent = `Likely Affected Elements (${assets.length})`;
    box.appendChild(tableHeaderTitle);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'assets-table-wrap';

    const table = document.createElement('table');
    table.className = 'assets-table';

    const sortCol = state.affectedTableSort ? state.affectedTableSort.column : 'prob';
    const isDesc = state.affectedTableSort ? state.affectedTableSort.descending : true;
    const arrow = (col) => sortCol === col ? (isDesc ? ' ▼' : ' ▲') : '';

    table.innerHTML = `
      <thead>
        <tr>
          <th data-sort="name" class="${sortCol === 'name' ? 'sorted' : ''}">Asset Name<span class="sort-arrow">${arrow('name')}</span></th>
          <th data-sort="category" class="${sortCol === 'category' ? 'sorted' : ''}">Type<span class="sort-arrow">${arrow('category')}</span></th>
          <th data-sort="rating" class="${sortCol === 'rating' ? 'sorted' : ''}">Rating<span class="sort-arrow">${arrow('rating')}</span></th>
          <th data-sort="wind" class="${sortCol === 'wind' ? 'sorted' : ''}">Est. Wind<span class="sort-arrow">${arrow('wind')}</span></th>
          <th data-sort="dist" class="${sortCol === 'dist' ? 'sorted' : ''}">Track Dist<span class="sort-arrow">${arrow('dist')}</span></th>
          <th data-sort="quad" class="${sortCol === 'quad' ? 'sorted' : ''}">Quadrant<span class="sort-arrow">${arrow('quad')}</span></th>
          <th data-sort="prob" class="${sortCol === 'prob' ? 'sorted' : ''}">Tripping Risk (P<sub>trip</sub>)<span class="sort-arrow">${arrow('prob')}</span></th>
        </tr>
      </thead>
      <tbody id="assets-table-body"></tbody>
    `;
    tableWrap.appendChild(table);
    box.appendChild(tableWrap);

    // Bind click-to-sort on headers
    table.querySelectorAll('th[data-sort]').forEach(th => {
      th.onclick = () => {
        const col = th.getAttribute('data-sort');
        if (state.affectedTableSort.column === col) {
          state.affectedTableSort.descending = !state.affectedTableSort.descending;
        } else {
          state.affectedTableSort.column = col;
          // default descending for numerical risk/rating/dist/wind
          state.affectedTableSort.descending = (col === 'prob' || col === 'rating' || col === 'wind');
        }
        renderAffectedAssetsUI();
      };
    });

    renderAffectedTableRows(table.querySelector('#assets-table-body'));
  }

  function renderAffectedTableRows(tbody) {
    if (!tbody) return;
    tbody.innerHTML = '';

    const sortCol = state.affectedTableSort ? state.affectedTableSort.column : 'prob';
    const isDesc = state.affectedTableSort ? state.affectedTableSort.descending : true;

    const sorted = [...(state.currentScannedAssets || [])].sort((a, b) => {
      let vA, vB;
      if (sortCol === 'name') {
        vA = a.n.toLowerCase();
        vB = b.n.toLowerCase();
        return isDesc ? vB.localeCompare(vA) : vA.localeCompare(vB);
      } else if (sortCol === 'category') {
        vA = a.cat || '';
        vB = b.cat || '';
        return isDesc ? vB.localeCompare(vA) : vA.localeCompare(vB);
      } else if (sortCol === 'rating') {
        vA = a.s || 0;
        vB = b.s || 0;
        return isDesc ? vB - vA : vA - vB;
      } else if (sortCol === 'wind') {
        vA = (a.risk && (a.risk.localWindKmph !== undefined ? a.risk.localWindKmph : a.risk.windKmph)) || 0;
        vB = (b.risk && (b.risk.localWindKmph !== undefined ? b.risk.localWindKmph : b.risk.windKmph)) || 0;
        return isDesc ? vB - vA : vA - vB;
      } else if (sortCol === 'dist') {
        vA = (a.risk && a.risk.distToTrackKm !== undefined) ? a.risk.distToTrackKm : 999;
        vB = (b.risk && b.risk.distToTrackKm !== undefined) ? b.risk.distToTrackKm : 999;
        return isDesc ? vB - vA : vA - vB;
      } else if (sortCol === 'quad') {
        vA = (a.risk && a.risk.quadrantCode) || '';
        vB = (b.risk && b.risk.quadrantCode) || '';
        return isDesc ? vB.localeCompare(vA) : vA.localeCompare(vB);
      } else {
        // Default: Tripping Probability (prob)
        vA = (a.risk && a.risk.pTrip !== undefined) ? a.risk.pTrip : 0;
        vB = (b.risk && b.risk.pTrip !== undefined) ? b.risk.pTrip : 0;
        return isDesc ? vB - vA : vA - vB;
      }
    });

    sorted.forEach(item => {
      const tr = document.createElement('tr');
      const r = item.risk || { pTrip: 50, riskLevel: 'Moderate', distToTrackKm: 50, quadrant: 'Mid-Cone', quadrantCode: 'MC', localWindKmph: 75, localWindKt: 40 };
      const riskClass = r.pTrip >= 70 ? 'risk-high' : (r.pTrip >= 40 ? 'risk-med' : 'risk-low');
      const isRF = r.quadrantCode === 'RF';
      const windKmph = r.localWindKmph || r.windKmph || 60;
      const windKt = r.localWindKt || Math.round(windKmph / 1.852);

      tr.innerHTML = `
        <td><a class="asset-name-link" title="${item.n}">${item.n}</a></td>
        <td><span style="color:var(--muted)">${item.cat}</span></td>
        <td><b>${item.v}</b></td>
        <td><span class="wind-cell">${windKmph} km/h <span class="wind-kt">(${windKt} kt)</span></span></td>
        <td>${r.distToTrackKm} km</td>
        <td><span class="quad-badge ${isRF ? 'quad-rf' : ''}" title="${r.quadrant} Quadrant">${r.quadrantCode}</span></td>
        <td>
          <span class="risk-badge ${riskClass}">
            ${r.pTrip}% · ${r.riskLevel}
          </span>
        </td>
      `;

      tr.onclick = () => {
        state.map.flyTo([item.c[1], item.c[0]], 11, { duration: 0.8 });
      };

      tbody.appendChild(tr);
    });
  }

  // --- EXCEL / CSV REPORT GENERATOR FOR GRID ASSETS INSIDE CONE ---
  function exportGridAssetsToExcel() {
    if (!state.currentStorm) {
      showToast('No active cyclone loaded to scan.', 'err', 3500);
      return;
    }

    if (!state.lastScannedImpact) {
      performGridScan();
    }

    const impact = state.lastScannedImpact;
    const out = impact ? impact.out : null;
    const st = state.currentStorm;
    const cur = st.currentCenter || (st.points ? (st.points.find(p => p.kind === 'now') || st.points[0]) : { lat: 0, lon: 0, kt: 0, kmph: 0 });
    const minV = impact ? impact.minV : (state.minVoltage !== undefined ? state.minVoltage : (+chk('kv').value || 400));
    const minMw = impact ? impact.minMw : (state.minPlantMw !== undefined ? state.minPlantMw : (chk('plant-mw') ? +chk('plant-mw').value : 100));
    const totalMw = impact ? impact.totalMwCapacity : 0;
    const plantCounts = impact ? impact.plantCounts : null;
    const highRiskCount = (state.currentScannedAssets || []).filter(a => a.risk && a.risk.pTrip >= 70).length;

    const rows = [];

    // Official Metadata Header Block
    rows.push(['IMD CYCLONE TRACK & POWER TRANSMISSION INFRASTRUCTURE IMPACT ASSESSMENT']);
    rows.push(['Generated At', new Date().toLocaleString()]);
    rows.push(['Cyclone System', st.name || 'Latest Advisory']);
    rows.push(['Official Classification', st.categoryFull || st.category || 'Cyclonic Disturbance']);
    rows.push(['Bulletin / Advisory No.', st.bulletinNo || 'Official Bulletin']);
    rows.push(['Issue Time', st.issueTime || 'Latest Telemetry']);
    rows.push(['Current Center Coordinates', `${cur.lat ? cur.lat.toFixed(2) : 0}°N, ${cur.lon ? cur.lon.toFixed(2) : 0}°E`]);
    rows.push(['Maximum Sustained Surface Winds', `${cur.kt || 0} kt (${cur.kmph || Math.round((cur.kt || 0) * 1.852)} km/h)`]);
    rows.push(['Estimated Central Pressure', cur.pressure ? `${cur.pressure} hPa` : 'Estimated']);
    rows.push(['Predicted Landfall / Movement', st.landfallEstimate || 'Tracking over coastal sector']);
    rows.push(['Voltage Filter Threshold', minV > 0 ? `≥ ${minV} kV` : 'All Voltages']);
    rows.push(['Plant Capacity Filter', minMw > 0 ? (minMw === 200 ? '> 200 MW' : `≥ ${minMw} MW`) : 'All Power Plants']);
    rows.push(['Substations Inside Cone', out ? out.Substations.size : 0]);
    rows.push(['Mega Power Plants (≥500 MW) Inside Cone', plantCounts ? plantCounts.ge500 : 0]);
    rows.push(['Major Power Plants (>200 MW) Inside Cone', plantCounts ? plantCounts.gt200 : 0]);
    rows.push(['Power Plants (≥100 MW) Inside Cone', plantCounts ? plantCounts.ge100 : 0]);
    rows.push(['Total Power Plants Listed', out && out.Plants ? out.Plants.size : (out && out['Power Plants (≥100 MW)'] ? out['Power Plants (≥100 MW)'].size : 0)]);
    rows.push(['Exposed Generation Capacity (Filtered)', `${Math.round(totalMw).toLocaleString()} MW`]);
    rows.push(['Transmission Lines Inside Cone', out ? out['Named Lines'].size : 0]);
    rows.push(['High Tripping Risk Assets (P_trip ≥ 70%)', highRiskCount]);
    rows.push([]); // blank separator row

    // Table Column Headers
    rows.push([
      'Asset Category',
      'Asset Name',
      'Rating / Capacity',
      'Numeric Rating',
      'Unit',
      'Category / Fuel Type',
      'Latitude (°N)',
      'Longitude (°E)',
      'Distance to Cyclone Center (km)',
      'Direction from Cyclone Center',
      'Estimated Local Wind Speed (km/h)',
      'Estimated Local Wind Speed (kt)',
      'Distance to Track Centerline (km)',
      'Quadrant Relative to Storm',
      'Tripping Probability (%)',
      'Risk Level',
      'Impact Status',
      'Associated Cyclone',
      'IMD Bulletin Reference'
    ]);

    let totalCount = 0;

    function getDir(fromLat, fromLon, toLat, toLon) {
      if (!fromLat || !toLat) return '';
      const brg = CycloneEngine.bearingBetween(fromLat, fromLon, toLat, toLon);
      return CycloneEngine.bearingToCardinal(brg);
    }

    const fcPoints = (st.points || []).filter(p => p.kind !== 'obs');
    const forecastPoints = fcPoints.length > 0 ? fcPoints : (st.points || []);

    // 1. Power Plants
    const plantMap = (out && (out.Plants || out['Power Plants (≥100 MW)'])) || new Map();
    [...plantMap.values()].sort((a, b) => b.s - a.s).forEach(item => {
      const distKm = cur.lat ? Math.round(CycloneEngine.distanceKm(cur.lat, cur.lon, item.c[1], item.c[0])) : '';
      const dir = cur.lat ? getDir(cur.lat, cur.lon, item.c[1], item.c[0]) : '';
      const risk = item.risk || CycloneEngine.calculateTrippingProbability(item.c[1], item.c[0], item.s, true, forecastPoints);
      const windKmph = risk.localWindKmph || risk.windKmph || 60;
      const windKt = risk.localWindKt || Math.round(windKmph / 1.852);
      const plantCat = item.s >= 500 ? 'Power Plant (≥500 MW Mega)' : (item.s > 200 ? 'Power Plant (>200 MW Major)' : 'Power Plant (≥100 MW)');
      rows.push([
        plantCat,
        item.n,
        `${item.s} MW`,
        item.s,
        'MW',
        item.fuel || 'Thermal',
        item.c[1].toFixed(4),
        item.c[0].toFixed(4),
        distKm,
        dir,
        windKmph,
        windKt,
        risk.distToTrackKm,
        risk.quadrant,
        `${risk.pTrip}%`,
        risk.riskLevel,
        'Exposed inside 70% Forecast Cone',
        st.name,
        st.bulletinNo || ''
      ]);
      totalCount++;
    });

    // 2. Substations
    if (out && out.Substations) {
      [...out.Substations.values()].sort((a, b) => b.s - a.s).forEach(item => {
        const distKm = cur.lat ? Math.round(CycloneEngine.distanceKm(cur.lat, cur.lon, item.c[1], item.c[0])) : '';
        const dir = cur.lat ? getDir(cur.lat, cur.lon, item.c[1], item.c[0]) : '';
        const risk = item.risk || CycloneEngine.calculateTrippingProbability(item.c[1], item.c[0], item.s, false, forecastPoints);
        const windKmph = risk.localWindKmph || risk.windKmph || 60;
        const windKt = risk.localWindKt || Math.round(windKmph / 1.852);
        rows.push([
          'Substation',
          item.n,
          `${item.s} kV`,
          item.s,
          'kV',
          'Substation',
          item.c[1].toFixed(4),
          item.c[0].toFixed(4),
          distKm,
          dir,
          windKmph,
          windKt,
          risk.distToTrackKm,
          risk.quadrant,
          `${risk.pTrip}%`,
          risk.riskLevel,
          'Exposed inside 70% Forecast Cone',
          st.name,
          st.bulletinNo || ''
        ]);
        totalCount++;
      });
    }

    // 3. Named Lines
    if (out && out['Named Lines']) {
      [...out['Named Lines'].values()].sort((a, b) => b.s - a.s).forEach(item => {
        const distKm = cur.lat ? Math.round(CycloneEngine.distanceKm(cur.lat, cur.lon, item.c[1], item.c[0])) : '';
        const dir = cur.lat ? getDir(cur.lat, cur.lon, item.c[1], item.c[0]) : '';
        const risk = item.risk || CycloneEngine.calculateTrippingProbability(item.c[1], item.c[0], item.s, false, forecastPoints);
        const windKmph = risk.localWindKmph || risk.windKmph || 60;
        const windKt = risk.localWindKt || Math.round(windKmph / 1.852);
        rows.push([
          'Transmission Line',
          item.n,
          `${item.s} kV`,
          item.s,
          'kV',
          'Transmission Corridor',
          item.c[1].toFixed(4),
          item.c[0].toFixed(4),
          distKm,
          dir,
          windKmph,
          windKt,
          risk.distToTrackKm,
          risk.quadrant,
          `${risk.pTrip}%`,
          risk.riskLevel,
          'Crosses inside 70% Forecast Cone',
          st.name,
          st.bulletinNo || ''
        ]);
        totalCount++;
      });
    }

    // Format CSV with UTF-8 BOM (\uFEFF) so Excel on Windows/Mac opens immediately with zero encoding corruption
    const escapeCsv = val => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };
    const csvContent = '\uFEFF' + rows.map(r => r.map(escapeCsv).join(',')).join('\r\n');

    const cleanStormName = (st.name || 'Latest_Advisory').replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `Grid_Assets_Impact_${cleanStormName}_${minV}kV_${minMw}MW_${dateStr}.csv`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    showToast(`✓ Excel downloaded: ${totalCount} grid assets exported!`, 'ok', 4000);
  }

  // --- LIVE DATA FETCHING ENGINE ---
  async function fetchLiveCyclones() {
    if (state.isFetching) return;
    state.isFetching = true;
    updateRefreshMeta('Checking live telemetry...');
    chk('refresh-btn').classList.add('spinning');

    let newLiveStorms = [];

    // 1. Instant Synchronous Preloaded Advisory (Works 100% on GitHub Pages, offline, and in office networks without tunnels or servers)
    if (typeof window.LATEST_IMD_ADVISORY !== 'undefined' && window.LATEST_IMD_ADVISORY && window.LATEST_IMD_ADVISORY.name) {
      newLiveStorms.push({ ...window.LATEST_IMD_ADVISORY, type: 'live' });
      if (!state.currentStorm) {
        loadStorm(newLiveStorms[0], true);
        updateStormDropdown();
      }
    }

    // 2. Fetch local server API if server is running (< 10ms response)
    try {
      const imdResp = await fetch('/api/imd-latest', { cache: 'no-cache' });
      if (imdResp.ok) {
        const imdData = await imdResp.json();
        if (imdData && imdData.name) {
          const idx = newLiveStorms.findIndex(s => s.id === imdData.id);
          if (idx >= 0) newLiveStorms[idx] = { ...imdData, type: 'live' };
          else newLiveStorms.unshift({ ...imdData, type: 'live' });
          if (!state.currentStorm) {
            loadStorm(newLiveStorms[0], true);
            updateStormDropdown();
          }
        }
      }
    } catch (_) {}

    // 3. Fallback / auto-poll static JSON with cache-busting timestamp (works smoothly on GitHub Pages)
    try {
      const staticResp = await fetch(`data/latest_cyclone.json?_t=${Date.now()}`, { cache: 'no-cache' });
      if (staticResp.ok) {
        const staticData = await staticResp.json();
        if (staticData && staticData.name) {
          const idx = newLiveStorms.findIndex(s => s.id === staticData.id);
          if (idx >= 0) newLiveStorms[idx] = { ...staticData, type: 'live' };
          else newLiveStorms.unshift({ ...staticData, type: 'live' });
          if (!state.currentStorm) {
            loadStorm(newLiveStorms[0], true);
            updateStormDropdown();
          }
        }
      }
    } catch (_) {}

    // Secondary path: Check global active cyclones (JTWC / NHC / GDACS)
    try {
      const resp = await fetch('/api/active-cyclones', { cache: 'no-cache' });
      if (resp.ok) {
        const data = await resp.json();
        if (data && Array.isArray(data.cyclones)) {
          const globalStorms = data.cyclones.map(c => ({ ...c, type: 'live' }));
          newLiveStorms = newLiveStorms.concat(globalStorms);
        }
      }
    } catch (_) {
      // Backend server not running or proxy offline; continue to next fallback
    }

    // Attempt 3: Direct Client-Side Fetch to Esri Living Atlas (JTWC / NHC Live Feed)
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

      // Automatically activate the newest live advisory as default
      const nioStorm = newLiveStorms.find(s => s.basin && s.basin.includes('Indian Ocean')) || newLiveStorms[0];
      if (nioStorm) {
        loadStorm(nioStorm, true);
        showToast(`Live update: Activated ${nioStorm.name}!`, 'ok', 4000);
      }

      updateStormDropdown();
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
    chk('t-cone').onchange = e => {
      state.layers.cone = e.target.checked;
      if (!e.target.checked) {
        if (state.coneLayer && state.map.hasLayer(state.coneLayer)) state.coneLayer.remove();
        if (state.probConeGroup && state.map.hasLayer(state.probConeGroup)) state.probConeGroup.remove();
        if (state.windConeGroup && state.map.hasLayer(state.windConeGroup)) state.windConeGroup.remove();
      } else {
        if (state.coneLayer && !state.map.hasLayer(state.coneLayer)) state.coneLayer.addTo(state.map);
        applyProbGradientStyle();
      }
    };

    // 1. Tripping Probability Gradient Cone Toggle (synced between Layers panel & Scanner)
    const setProbGradient = (val) => {
      state.showProbGradient = val;
      if (chk('t-prob-gradient')) chk('t-prob-gradient').checked = val;
      if (chk('t-prob-gradient-sec')) chk('t-prob-gradient-sec').checked = val;
      applyProbGradientStyle();
    };
    if (chk('t-prob-gradient')) chk('t-prob-gradient').onchange = e => setProbGradient(e.target.checked);
    if (chk('t-prob-gradient-sec')) chk('t-prob-gradient-sec').onchange = e => setProbGradient(e.target.checked);

    // 2. Risk-Colored Asset Markers Toggle (synced)
    const setAssetRiskMarkers = (val) => {
      state.showAssetRiskMarkers = val;
      if (chk('t-asset-risk')) chk('t-asset-risk').checked = val;
      if (chk('t-asset-risk-sec')) chk('t-asset-risk-sec').checked = val;
      renderRiskAssetMarkers();
    };
    if (chk('t-asset-risk')) chk('t-asset-risk').onchange = e => setAssetRiskMarkers(e.target.checked);
    if (chk('t-asset-risk-sec')) chk('t-asset-risk-sec').onchange = e => setAssetRiskMarkers(e.target.checked);

    // 3. Wind Speed Swath Toggle (synced)
    const setWindGradient = (val) => {
      state.showWindGradient = val;
      if (chk('t-wind-gradient')) chk('t-wind-gradient').checked = val;
      if (chk('t-wind-gradient-sec')) chk('t-wind-gradient-sec').checked = val;
      applyProbGradientStyle();
    };
    if (chk('t-wind-gradient')) chk('t-wind-gradient').onchange = e => setWindGradient(e.target.checked);
    if (chk('t-wind-gradient-sec')) chk('t-wind-gradient-sec').onchange = e => setWindGradient(e.target.checked);

    chk('t-labels').onchange = e => { chk('map').classList.toggle('hide-lbl', !e.target.checked); };

    // Scanner actions & Grid Filters (Voltage Level & Plant MW)
    const handleFilterChange = () => {
      state.minVoltage = chk('kv') ? (+chk('kv').value || 0) : 0;
      state.minPlantMw = chk('plant-mw') ? (+chk('plant-mw').value || 0) : 0;
      regrid();
      drawLabels();
      initWRIPlants();
      performGridScan();
    };
    chk('scan').onclick = handleFilterChange;
    chk('kv').onchange = handleFilterChange;
    if (chk('plant-mw')) {
      chk('plant-mw').onchange = handleFilterChange;
    }

    if (chk('btn-export-excel')) {
      chk('btn-export-excel').onclick = exportGridAssetsToExcel;
    }

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

    // 2. Raw Bulletin Viewer Modal
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

