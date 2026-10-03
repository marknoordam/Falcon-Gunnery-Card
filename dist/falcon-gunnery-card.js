/**
 * Falcon Gunnery Card (nav-console-card) v0.9.1
 * https://github.com/marknoordam/Falcon-Gunnery-Card
 *
 * A Star Wars style "nav console" dashboard card for Home Assistant, made to match the
 * Falcon Gunnery theme (https://github.com/marknoordam/Falcon-Gunnery-Theme). Three panels:
 *   left   - readouts, thermostat and humidity ring gauges, a power level meter
 *   center - flight radar for the FlightRadar24 integration's "current in area" sensor,
 *            drawn as the gunnery radar: crosshair, X lines, ellipse, range rings, faint
 *            grid, stars, and the local map reduced to faint lines on black
 *   right  - weather and a tappable status list; the Aircraft row (or the tab on the
 *            panel edge) swaps it for the flight contacts board
 *
 * Loading this file also loads the theme fonts (Michroma, News Cycle, Share Tech Mono,
 * Aurebesh Rodian) from the same folder, so the theme needs no separate font resource.
 *
 * The radar's behaviour (dead-reckoned motion, sweep-timed blip decay, lingering lost
 * contacts, helicopter and emergency squawk handling, trails, sonar pings) is modelled on
 * flightradar-radar-card by Fredrik Ehrenholm (MIT License, Copyright (c) 2026),
 * https://github.com/Ehrenholm/flightradar-radar-card. The `field` helper, emergency squawk
 * list and helicopter type patterns are adapted from that project.
 */

const VERSION = '0.9.1';

const EMERGENCY_SQUAWKS = ['7700', '7600', '7500'];
const HELI_CODE_RE = /^(EC\d|H1\d\d|B06|B407|B412|B429|B505|R22|R44|R66|S61|S64|S76|S92|UH1|A109|A119|A129|A139|A149|A169|A189|AS3\d|AS5\d|MI\d|KA\d)/;
const HELI_MODEL_RE = /helicopter|eurocopter|sikorsky|robinson r|bell \d|agusta|kamov|airbus h\d|leonardo aw/i;
const TOGGLE_DOMAINS = ['light', 'switch', 'fan', 'input_boolean'];

// Special aircraft to flag on the radar. Each rule matches on any of its lists; a config
// entry can use a preset by name, extend one ({ preset: rcaf, color: ... }), or define its own.
const HIGHLIGHT_PRESETS = {
  warplane: {
    name: 'Canadian Warplane Heritage', label: 'CWH', color: '#ffd166', icon: 'star', aurebesh: 'warplane heritage',
    // ICAO designator CWH (telephony WARPLANE HERITAGE), plus the museum's registrations
    callsign_prefix: ['CWH'],
    airline: ['warplane heritage'],
    registration: ['C-GVRA', 'C-GCWM', 'C-GCWH', 'CF-UUU', 'C-FUUU', 'CF-DLC', 'C-FDLC'],
  },
  rcaf: {
    name: 'Royal Canadian Air Force', label: 'RCAF', color: '#6fb6ff', icon: 'roundel', aurebesh: 'royal canadian air force',
    // ICAO designator CFC (telephony CANFORCE)
    callsign_prefix: ['CFC', 'CANFORCE'],
    airline: ['royal canadian air force', 'canadian armed forces', 'canadian forces', 'rcaf'],
    // RCAF serials are numbers only (e.g. 130612) on Canadian transponder addresses (C00000-C3FFFF)
    canadian_military_serial: true,
  },
};
const M_PER_MI = 1609.344;
const M_PER_KM = 1000;
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';

const DEFAULTS = {
  aurebesh: true,
  aurebesh_size: 1.3,
  motion: false,
  scale: 1.25,
  height: 'fill',
  height_offset: 72,
  left: {},
  right: { view: 'status' },
  radar: {
    distance_unit: 'mi',
    radius: 20,
    map: true,
    map_opacity: 0.35,
    stars: true,
    sweep: true,
    sweep_period: 4,
    trail_length: 7,
    trail_style: 'line',
    smooth_motion: true,
    linger_time: 45,
    low_altitude: 10000,
    alert_distance: 0,
    sound_alerts: 'none',
    stale_after: 120,
    speed_unit: 'kts',
    altitude_unit: 'ft',
    show_details: true,
    show_photo: true,
    today_count: null,
    today_radius_km: 10,
    highlights: ['warplane', 'rcaf'],
  },
};

// Fonts live next to this file (HACS: /hacsfiles/Falcon-Gunnery-Card/). @font-face rules don't
// apply reliably from inside a shadow root, so they go in the document head, once.
const FONT_BASE = new URL('.', import.meta.url).href;
const FONTS = [
  ['Michroma', 'Michroma-Regular.ttf', 400, 'truetype'],
  ['News Cycle', 'NewsCycle-Regular.ttf', 400, 'truetype'],
  ['News Cycle', 'NewsCycle-Bold.ttf', 700, 'truetype'],
  ['Share Tech Mono', 'ShareTechMono-Regular.ttf', 400, 'truetype'],
  ['Aurebesh Rodian', 'AurebeshRodian.otf', 400, 'opentype'],
];

function ensureFonts() {
  if (document.getElementById('falcon-gunnery-fonts')) return;
  const style = document.createElement('style');
  style.id = 'falcon-gunnery-fonts';
  style.textContent = FONTS.map(([family, file, weight, format]) =>
    `@font-face{font-family:"${family}";src:url("${FONT_BASE}${file}") format("${format}");font-weight:${weight};font-display:swap}`).join('\n');
  document.head.appendChild(style);
}

// FR24 reports missing values as 'N/A' and privacy-blocked identities as 'BLOCKED'.
function field(v) {
  if (v == null || v === '') return '';
  const s = String(v);
  return /^(n\/a|blocked)$/i.test(s) ? '' : s;
}

function isHelicopter(f) {
  return HELI_CODE_RE.test(String(f.aircraft_code || '').toUpperCase())
    || HELI_MODEL_RE.test(String(f.aircraft_model || ''));
}

const toRad = (d) => d * Math.PI / 180;
const toDeg = (r) => r * 180 / Math.PI;

function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

function bearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
    - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Move a point `dist` metres along `brg` degrees.
function project(lat, lon, brg, dist) {
  const d = dist / 6371000;
  const b = toRad(brg);
  const la1 = toRad(lat);
  const lo1 = toRad(lon);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [toDeg(la2), toDeg(lo2)];
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

// Angle above the horizon to an aircraft, allowing for the Earth's curve (with the usual
// 4/3 radius for atmospheric refraction).
function elevationAngle(groundM, altFt, homeElevM) {
  const drop = (groundM * groundM) / (2 * 6371000 * (4 / 3));
  return toDeg(Math.atan2(altFt * 0.3048 - homeElevM - drop, Math.max(1, groundM)));
}

// Web Mercator world pixel coordinates at zoom 0 (256px world).
function mercator(lat, lon) {
  const s = Math.sin(toRad(Math.max(-85, Math.min(85, lat))));
  return [(lon + 180) / 360 * 256, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256];
}

function parseColor(c) {
  const m = String(c).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    const n = parseInt(h, 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  const r = String(c).match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  return r ? [+r[1], +r[2], +r[3]] : [64, 230, 210];
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? merge(base[k], v) : v;
  }
  return out;
}

const STYLE = `
:host { display: block; }
ha-card { background: none; border: none; box-shadow: none; overflow: visible; --aurebesh-tag: none; }
.nv {
  --acc: var(--primary-color, #40e6d2);
  --txt: var(--primary-text-color, #d4fdff);
  --txt2: var(--secondary-text-color, #78b9c2);
  --bg: var(--primary-background-color, #01080b);
  --red: var(--error-color, #ff6f6f);
  --amb: var(--warning-color, #ffb02e);
  --grn: var(--success-color, #3dff8a);
  --off: color-mix(in srgb, var(--acc) 18%, var(--bg));
  --body: var(--ha-font-family-body, "News Cycle", sans-serif);
  --mono: "Share Tech Mono", ui-monospace, monospace;
  --ab: var(--aurebesh-font-family, "Aurebesh Rodian");
  position: relative; box-sizing: border-box; height: var(--nv-height, 640px);
  display: grid; grid-template-columns: var(--nv-lw, 190px) minmax(0, 1fr) var(--nv-rw, 250px);
  gap: calc(24px * var(--nv-s, 1)); padding: 10px; font-family: var(--body); color: var(--txt);
}
.nv.narrow { grid-template-columns: 1fr 1fr; height: auto; }
.nv.narrow .center { grid-column: 1 / -1; order: -1; height: min(100vw, 560px); }
.nv.narrow .tab { display: none; }
.pn {
  position: relative; min-width: 0; min-height: 0; box-sizing: border-box;
  border: 2.5px solid var(--acc); background: var(--bg);
  box-shadow: 0 0 10px color-mix(in srgb, var(--acc) 45%, transparent), inset 0 0 10px color-mix(in srgb, var(--acc) 15%, transparent);
  padding: 10px; display: flex; flex-direction: column; gap: 10px;
}
.side { overflow: visible; }
.lslots { display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--acc) transparent; padding-right: 2px; }
.rbody { display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; overflow: hidden; }
.lslots, .rbody, .hdb, .ovl, .tab { zoom: var(--nv-s, 1); }
.rcards { display: flex; flex-direction: column; gap: 8px; flex: none; max-height: 60%; overflow-y: auto; scrollbar-width: none; }
.rcards:empty, .contacts .rcards { display: none; }
.lights { display: flex; flex-direction: column; }
.ap { border: 1.5px solid var(--acc); padding: 6px 7px; cursor: pointer; }
.ap .h { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.pill { font-family: var(--mono); font-size: 10px; padding: 1px 6px; border: 1px solid currentColor; color: var(--txt2); white-space: nowrap; }
.pill.on { color: var(--acc); text-shadow: 0 0 5px var(--acc); box-shadow: 0 0 5px color-mix(in srgb, var(--acc) 50%, transparent); }
.pill.done { color: var(--grn); text-shadow: 0 0 5px var(--grn); }
.pill.warn { color: var(--red); text-shadow: 0 0 5px var(--red); }
.ap.warn { border-color: var(--red); box-shadow: 0 0 6px color-mix(in srgb, var(--red) 50%, transparent); }
.kv { display: flex; justify-content: space-between; gap: 6px; font-family: var(--mono); font-size: 11px; color: var(--txt2); margin-top: 4px; }
.kv b { color: var(--txt); font-weight: 400; white-space: nowrap; }
.kv.warn b { color: var(--red); }
.center { padding: 0; overflow: hidden; background: #000; }
.tab {
  position: absolute; z-index: 3; top: 46%; width: 30px; height: 46px; box-sizing: border-box; padding: 0;
  border: 2px solid var(--acc); border-radius: 7px; background: color-mix(in srgb, var(--acc) 22%, var(--bg));
  color: var(--acc); display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.tab:hover { background: color-mix(in srgb, var(--acc) 40%, var(--bg)); }
.tab svg { width: 17px; height: 17px; }
.left .tab { right: -29px; }
.right .tab { left: -29px; }
.lb { font-size: 11px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--txt2); }
.ab { font-family: var(--ab); font-size: calc(10px * var(--nv-ab, 1)); letter-spacing: .12em; color: var(--acc); opacity: .75; text-transform: none; font-weight: 400; vertical-align: middle; }
.noab .ab { display: none; }
.rd { border: 2px solid var(--acc); border-radius: 4px; padding: 4px 8px; font-family: var(--mono); font-size: 22px; color: var(--acc); text-shadow: 0 0 6px var(--acc); line-height: 1.1; white-space: nowrap; overflow: hidden; }
.ring { text-align: center; cursor: pointer; }
.ring svg { display: block; margin: 0 auto 2px; }
.mt { border: 1.5px solid var(--acc); padding: 6px; }
.mr { display: grid; grid-template-columns: 38px 1fr; align-items: center; gap: 4px; height: 14px; font-family: var(--mono); font-size: 10px; color: var(--txt2); cursor: pointer; }
.mr span { overflow: hidden; white-space: nowrap; text-transform: uppercase; }
.mr b { display: block; height: 6px; background: var(--acc); box-shadow: 0 0 5px var(--acc); transition: width .6s; }
.mr.hi b { background: var(--red); box-shadow: 0 0 5px var(--red); }
.hdb { background: var(--acc); color: var(--bg); font-weight: 700; font-size: 12px; letter-spacing: .2em; padding: 4px 8px; display: flex; justify-content: space-between; align-items: center; text-transform: uppercase; }
.hdb .ab { color: var(--bg); opacity: .8; }
.wx { text-align: center; cursor: pointer; }
.list { display: flex; flex-direction: column; overflow-y: auto; scrollbar-width: thin; min-height: 0; }
.st { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 13px; padding: 5px 4px; border-bottom: 1px solid color-mix(in srgb, var(--acc) 25%, transparent); cursor: pointer; }
.st:hover { background: color-mix(in srgb, var(--acc) 10%, transparent); }
.st .n { display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.st ha-state-icon { --mdc-icon-size: 17px; color: var(--txt2); flex: none; }
.st .ic { width: 17px; height: 17px; flex: none; color: var(--txt2); }
.st .v { font-family: var(--mono); font-size: 11px; color: var(--txt2); white-space: nowrap; }
.st.on ha-state-icon, .st.on .ic, .st.on .v { color: var(--acc); text-shadow: 0 0 5px var(--acc); }
.st.warn ha-state-icon, .st.warn .ic, .st.warn .v { color: var(--red); text-shadow: 0 0 5px var(--red); }
.st.mid ha-state-icon, .st.mid .v { color: var(--amb); }
.ct { padding: 6px 4px; border-bottom: 1px solid color-mix(in srgb, var(--acc) 25%, transparent); cursor: pointer; font-family: var(--mono); font-size: 12px; }
.ct:hover { background: color-mix(in srgb, var(--acc) 10%, transparent); }
.ct.sel { background: color-mix(in srgb, var(--amb) 14%, transparent); box-shadow: inset 2px 0 0 var(--amb); }
.ct .a { display: flex; justify-content: space-between; gap: 6px; }
.ct .cs { color: var(--acc); letter-spacing: .04em; }
.ct.low .cs { color: var(--amb); }
.ct.em .cs, .ct.em .a { color: var(--red); }
.ct .tag { font-size: 10px; padding: 0 4px; border: 1px solid currentColor; margin-left: 4px; letter-spacing: .06em; }
.ct .b { color: var(--txt2); font-family: var(--body); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.photo { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border: 1.5px solid var(--acc); display: block; }
.empty { color: var(--txt2); font-size: 12px; padding: 10px 4px; text-align: center; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.ovl { position: absolute; z-index: 2; pointer-events: none; }
.cnt { top: 10px; right: 12px; border: 2px solid var(--acc); border-radius: 3px; padding: 1px 9px; font-family: var(--mono); font-size: 15px; letter-spacing: .2em; color: var(--acc); text-shadow: 0 0 5px var(--acc); }
.ttl { top: 10px; left: 12px; font-size: 12px; font-weight: 700; letter-spacing: .2em; color: var(--txt2); }
.ttl .ab { display: block; margin-top: 3px; }
.stale { top: 40px; right: 12px; margin-top: var(--stale-off, 0px); font-family: var(--mono); font-size: 11px; color: var(--red); display: none; }
.stale.show { display: block; }
.snd { pointer-events: auto; top: 48px; left: 12px; width: 28px; height: 28px; border: 1.5px solid var(--acc); background: transparent; color: var(--txt2); cursor: pointer; padding: 4px; display: none; }
.snd.show { display: block; }
.snd.armed { color: var(--acc); box-shadow: 0 0 6px var(--acc); }
.snd svg { width: 100%; height: 100%; fill: currentColor; }
.ro { left: 0; right: 0; bottom: 0; min-height: 108px; box-sizing: border-box; padding: 10px 12px; border-top: 2px solid var(--acc); background: rgba(0, 0, 0, .75); }
.ro .k { font-family: var(--mono); font-size: 10px; color: var(--amb); }
.ro .l1 { font-family: var(--mono); font-size: 16px; color: var(--txt); margin-top: 3px; letter-spacing: .04em; overflow-wrap: anywhere; }
.ro .l2 { font-family: var(--mono); font-size: 12px; color: var(--txt2); margin-top: 3px; line-height: 1.35; overflow-wrap: anywhere; }
.ro .l2 b { color: var(--txt); font-weight: 400; }
.ro .k { display: flex; justify-content: space-between; gap: 8px; }
.ro .k .ab { font-size: calc(9px * var(--nv-ab, 1)); }
.today { top: 40px; right: 12px; text-align: right; font-family: var(--mono); color: var(--amb); display: none; }
.today.show { display: block; }
.today b { display: inline-block; border: 2px solid var(--amb); border-radius: 3px; padding: 1px 9px; font-size: 15px; font-weight: 400; letter-spacing: .2em; text-shadow: 0 0 5px var(--amb); }
.today span { display: block; font-size: 10px; margin-top: 3px; letter-spacing: .08em; }
.ro.em .k, .ro.em .l1 { color: var(--red); }
`;

const ICON = {
  speakerOn: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16 8a5 5 0 0 1 0 8" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
  speakerOff: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="2"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/></svg>',
  plane: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M16 10h4a2 2 0 0 1 0 4h-4l-4 7h-3l2-7H7l-2 2H2l2-4-2-4h3l2 2h4L9 3h3z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5l-7 7 7 7"/></svg>',
};

class NavConsoleCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._aircraft = new Map();
    this._selectedId = null;
    this._lastFlightsStamp = null;
    this._lastUpdate = 0;
    this._initialSyncDone = false;
    this._sweepAngle = 0;
    this._tileCache = new Map();
    this._staticKey = '';
    this._raf = null;
    this._lastFrame = 0;
    this._audio = null;
    this._armed = false;
    this._forecast = null;
  }

  static getStubConfig() {
    return { radar: { entity: 'sensor.flightradar24_current_in_area', radius: 20 } };
  }

  getCardSize() { return 12; }

  getGridOptions() { return { columns: 'full', rows: 'auto' }; }

  setConfig(config) {
    if (!config || typeof config !== 'object') throw new Error('nav-console-card: invalid configuration');
    const cfg = merge(DEFAULTS, config);
    if (config.radar && config.radar.map_brightness != null && config.radar.map_opacity == null) cfg.radar.map_opacity = config.radar.map_brightness;
    if (!['mi', 'km'].includes(cfg.radar.distance_unit)) throw new Error('nav-console-card: radar.distance_unit must be mi or km');
    if (!(Number(cfg.radar.radius) > 0)) throw new Error('nav-console-card: radar.radius must be a positive number');
    this._config = cfg;
    this._rules = (Array.isArray(cfg.radar.highlights) ? cfg.radar.highlights : [])
      .map((r) => (typeof r === 'string' ? { preset: r } : r))
      .filter((r) => r && typeof r === 'object')
      .map((r) => ({ ...(HIGHLIGHT_PRESETS[r.preset] || {}), ...r }))
      .map((r) => ({ ...r, color: r.color || '#ff4fd8', icon: r.icon || 'arrow', label: r.label || r.name || 'FLAG' }));
    try { this._armed = localStorage.getItem('nav-console-card-sound') === '1'; } catch (e) { this._armed = false; }
    this._view = cfg.right.view === 'contacts' ? 'contacts' : 'status';
    this._showMap = cfg.radar.map !== false;
    this._built = false;
    if (this.isConnected) this._build();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this._subscribeForecast();
    this._update();
    if (this._el) this._el.rcards.childNodes.forEach((card) => { card.hass = hass; });
  }

  connectedCallback() {
    if (this._config && !this._built) this._build();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this);
    if (this._roObs && this._el) this._roObs.observe(this._el.ro);
    this._startLoop();
    this._subscribeForecast();
  }

  disconnectedCallback() {
    if (this._ro) this._ro.disconnect();
    if (this._roObs) this._roObs.disconnect();
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._unsubscribeForecast();
  }

  // ---------------------------------------------------------------- weather forecast (high / low)

  _subscribeForecast() {
    const id = this._config?.right?.weather;
    const conn = this._hass?.connection;
    if (!id || !conn || !this.isConnected || this._fcEntity === id) return;
    this._unsubscribeForecast();
    this._fcEntity = id;
    try {
      this._fcUnsub = conn.subscribeMessage((ev) => {
        this._forecast = Array.isArray(ev?.forecast) ? ev.forecast : null;
        this._rightHtml = '';
        this._renderRight();
      }, { type: 'weather/subscribe_forecast', forecast_type: 'daily', entity_id: id });
      Promise.resolve(this._fcUnsub).catch(() => { this._fcUnsub = null; });
    } catch (e) { this._fcUnsub = null; }
  }

  _unsubscribeForecast() {
    const u = this._fcUnsub;
    this._fcUnsub = null;
    this._fcEntity = null;
    if (u) Promise.resolve(u).then((fn) => typeof fn === 'function' && fn()).catch(() => {});
  }

  // ---------------------------------------------------------------- DOM

  _build() {
    if (!this._config) return;
    const c = this._config;
    const r = c.radar;
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="nv ${c.aurebesh ? '' : 'noab'}">
          <div class="pn side left">
            <div class="lslots"></div>
            <button class="tab tab-map" title="Map lines on or off" aria-label="Toggle map lines">${ICON.map}</button>
          </div>
          <div class="pn center">
            <canvas class="cv-static"></canvas>
            <canvas class="cv-live"></canvas>
            <div class="ovl ttl">AIRSPACE<span class="ab">airspace scan</span></div>
            <div class="ovl cnt">0000</div>
            <div class="ovl today"><b>0000</b><span>TODAY ≤ 10 KM</span></div>
            <div class="ovl stale">STALE</div>
            <button class="ovl snd ${r.sound_alerts !== 'none' ? 'show' : ''} ${this._armed ? 'armed' : ''}" aria-label="Sound alerts">${this._armed ? ICON.speakerOn : ICON.speakerOff}</button>
            <div class="ovl ro"></div>
          </div>
          <div class="pn side right">
            <div class="hdb"><span class="rt">STATUS</span><span class="ab rta">status</span></div>
            <div class="rbody"></div>
            <div class="rcards"></div>
            <button class="tab tab-view" title="Aircraft contacts" aria-label="Show aircraft contacts">${ICON.plane}</button>
          </div>
        </div>
      </ha-card>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._el = {
      nv: $('.nv'), left: $('.lslots'), center: $('.center'), cvS: $('.cv-static'), cvL: $('.cv-live'),
      cnt: $('.cnt'), stale: $('.stale'), snd: $('.snd'), ro: $('.ro'), rt: $('.rt'), rta: $('.rta'), rbody: $('.rbody'),
      tabView: $('.tab-view'), right: $('.right'), rcards: $('.rcards'), today: $('.today'),
    };
    // the readout grows when long lines wrap; keep the radar clear of it
    this._roObs = new ResizeObserver(() => {
      const h = this._el.ro.getBoundingClientRect().height;
      if (Math.abs(h - (this._roH || 0)) < 1) return;
      this._roH = h;
      this._geom();
      this._staticKey = '';
      this._drawStatic();
    });
    this._roObs.observe(this._el.ro);
    this._childCards = [];
    this._buildChildCards();
    this._ctxS = this._el.cvS.getContext('2d');
    this._ctx = this._el.cvL.getContext('2d');
    $('.tab-map').addEventListener('click', () => { this._showMap = !this._showMap; this._staticKey = ''; this._drawStatic(); });
    this._el.tabView.addEventListener('click', () => this._setView(this._view === 'status' ? 'contacts' : 'status'));
    this._el.snd.addEventListener('click', () => this._toggleSound());
    this._el.cvL.addEventListener('click', (e) => this._onCanvasClick(e));
    this._built = true;
    this._leftHtml = this._rightHtml = this._contactsHtml = this._roKey = '';
    this._resize();
    if (this._hass) this._update();
  }

  _setView(v) {
    this._view = v;
    this._rightHtml = this._contactsHtml = '';
    this._renderRight();
  }

  // Any Home Assistant cards listed under right.cards (for example a camera card) render
  // below the security list, built with HA's own card loader so every card type works.
  async _buildChildCards() {
    const list = Array.isArray(this._config.right?.cards) ? this._config.right.cards : [];
    if (!list.length || !window.loadCardHelpers) return;
    const token = {};
    this._childToken = token;
    let helpers;
    try { helpers = await window.loadCardHelpers(); } catch (e) { return; }
    if (token !== this._childToken) return;
    const make = (cfg) => {
      const el = helpers.createCardElement(cfg);
      if (this._hass) el.hass = this._hass;
      // custom cards that load later ask to be rebuilt once they're defined
      el.addEventListener('ll-rebuild', (ev) => { ev.stopPropagation(); el.replaceWith(make(cfg)); }, { once: true });
      return el;
    };
    for (const cfg of list) {
      try { this._el.rcards.appendChild(make(cfg)); } catch (e) { /* invalid card config: HA shows its own error card */ }
    }
  }

  _items(list) {
    return (Array.isArray(list) ? list : []).map((x) => (typeof x === 'string' ? { entity: x } : x)).filter((x) => x && x.entity);
  }

  _rowsHtml(items) {
    return items.map((it) => {
      const s = this._st(it.entity);
      if (!s) return `<div class="st mid"><span class="n">${esc(it.name || it.entity)}</span><span class="v">not found</span></div>`;
      const name = it.name || s.attributes.friendly_name || it.entity;
      return `<div class="st ${this._statusClass(s)}" data-entity="${esc(it.entity)}" role="button" tabindex="0">
        <span class="n"><ha-state-icon data-icon="${esc(it.entity)}"></ha-state-icon>${esc(name)}</span><span class="v">${esc(this._fmt(s))}</span></div>`;
    }).join('');
  }

  _bindRows(root, items) {
    root.querySelectorAll('[data-entity]').forEach((el) => {
      const act = () => {
        const id = el.dataset.entity;
        const it = items.find((x) => x.entity === id) || {};
        const mode = it.tap_action || (TOGGLE_DOMAINS.includes(id.split('.')[0]) ? 'toggle' : 'more-info');
        if (mode === 'toggle') this._hass.callService('homeassistant', 'toggle', { entity_id: id });
        else this._moreInfo(id);
      };
      el.addEventListener('click', act);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
    });
    this._iconsUpdate(root);
  }

  _resize() {
    if (!this._built) return;
    const c = this._config;
    const w = this.clientWidth || this.parentElement?.clientWidth || 900;
    this._el.nv.classList.toggle('narrow', w < 760);
    if (c.height === 'fill') this._el.nv.style.setProperty('--nv-height', `max(480px, calc(100vh - ${Number(c.height_offset) || 0}px))`);
    else this._el.nv.style.setProperty('--nv-height', typeof c.height === 'number' ? `${c.height}px` : c.height);
    const px = (v, d) => (typeof v === 'number' ? `${v}px` : v || d);
    const k = this._k();
    this._el.nv.style.setProperty('--nv-s', String(k));
    this._el.nv.style.setProperty('--nv-ab', String(Math.max(0.5, Math.min(3, Number(c.aurebesh_size) || 1))));
    this._el.nv.style.setProperty('--nv-lw', px(c.left?.width, `${Math.round(190 * k)}px`));
    this._el.nv.style.setProperty('--nv-rw', px(c.right?.width, `${Math.round(250 * k)}px`));
    const dpr = window.devicePixelRatio || 1;
    this._w = Math.max(1, this._el.cvL.clientWidth);
    this._h = Math.max(1, this._el.cvL.clientHeight);
    for (const [cv, ctx] of [[this._el.cvS, this._ctxS], [this._el.cvL, this._ctx]]) {
      cv.width = Math.round(this._w * dpr);
      cv.height = Math.round(this._h * dpr);
      // exact backing-store ratio, so each CSS pixel maps to whole device pixels
      ctx.setTransform(cv.width / this._w, 0, 0, cv.height / this._h, 0, 0);
      ctx.imageSmoothingQuality = 'high';
    }
    this._watchDpr(dpr);
    this._geom();
    this._staticKey = '';
    this._drawStatic();
  }

  // Radar geometry. Proportions follow the mockup: 400 x 470 panel, rings to r=180, readout below.
  _geom() {
    const r = this._config.radar;
    const home = this._home();
    const roH = this._roH || 108 * this._k();
    this._cx = this._w / 2;
    this._cy = (this._h - roH) / 2 + 4;
    this._R = Math.max(40, Math.min(this._w, this._h - roH) / 2 - 16);
    this._radiusM = Number(r.radius) * (r.distance_unit === 'km' ? M_PER_KM : M_PER_MI);
    this._zoom = Math.log2(156543.03392 * Math.cos(toRad(home.lat)) * this._R / this._radiusM);
    this._scale = 2 ** this._zoom;
    this._homeWP = mercator(home.lat, home.lon);
  }

  // Browser zoom and moving between screens change the pixel density without resizing
  // the card, so watch for it and redraw at the new sharpness.
  _watchDpr(dpr) {
    if (this._dprQuery === dpr || !window.matchMedia) return;
    this._dprQuery = dpr;
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    mq.addEventListener('change', () => this._resize(), { once: true });
  }

  // Size multiplier for text, gauges and markers (config `scale`, 0.75 to 2).
  _k() { return Math.max(0.75, Math.min(2, Number(this._config?.scale) || 1)); }

  // Planes seen within today_radius_km today, from the Home Assistant sensor (see README).
  _todayCount() {
    const id = this._config?.radar?.today_count;
    const st = id && this._hass ? this._hass.states[id] : null;
    if (!st) return null;
    const v = parseInt(st.state, 10);
    return Number.isFinite(v) ? v : null;
  }

  _todayRadiusText() {
    const km = Number(this._config.radar.today_radius_km) || 10;
    return this._config.radar.distance_unit === 'mi' ? `${(km / 1.609344).toFixed(1)} MI` : `${km} KM`;
  }

  _home() {
    const r = this._config?.radar || {};
    if (r.latitude != null && r.longitude != null) return { lat: Number(r.latitude), lon: Number(r.longitude) };
    const hc = this._hass?.config;
    if (hc && hc.latitude != null) return { lat: hc.latitude, lon: hc.longitude };
    return { lat: 0, lon: 0 };
  }

  _toScreen(lat, lon) {
    const [x, y] = mercator(lat, lon);
    return [this._cx + (x - this._homeWP[0]) * this._scale, this._cy + (y - this._homeWP[1]) * this._scale];
  }

  // ---------------------------------------------------------------- static layer: map lines, stars, grid, radar frame

  _drawStatic() {
    if (!this._built || !this._hass || !this._col) return;
    const key = [this._w, this._h, window.devicePixelRatio, this._zoom.toFixed(3), this._showMap, this._col.acc, this._homeWP.join()].join('|');
    if (key === this._staticKey) return;
    this._staticKey = key;
    const ctx = this._ctxS;
    const c = this._col;
    const r = this._config.radar;
    const W = this._w; const H = this._h; const cx = this._cx; const cy = this._cy; const R = this._R;
    ctx.clearRect(0, 0, W, H);

    if (this._showMap) this._drawMapLines(key);

    // stars
    if (r.stars) {
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      ctx.save();
      ctx.fillStyle = c.txt;
      for (let i = 0; i < Math.round(W * H / 5000); i++) {
        ctx.globalAlpha = 0.25 + rnd() * 0.5;
        const s = rnd() < 0.15 ? 1.6 : 1;
        ctx.fillRect(rnd() * W, rnd() * H, s, s);
      }
      ctx.restore();
    }

    // faint grid: 20 cells across the ring diameter, as in the mockup
    const step = R / 9;
    ctx.save();
    ctx.strokeStyle = c.txt2;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let x = cx % step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = cy % step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.restore();

    // crosshair, X lines and sweep ellipse
    ctx.save();
    ctx.strokeStyle = c.acc;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(W, cy);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
    const dx = R * 0.833; const dy = R * 1.194;
    ctx.moveTo(cx - dx, cy - dy); ctx.lineTo(cx + dx, cy + dy);
    ctx.moveTo(cx + dx, cy - dy); ctx.lineTo(cx - dx, cy + dy);
    ctx.stroke();
    ctx.globalAlpha = 0.33;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 1.09, R * 0.656, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // range rings with labels
    ctx.save();
    ctx.strokeStyle = c.acc;
    ctx.fillStyle = c.acc;
    ctx.lineWidth = 2;
    ctx.shadowColor = c.acc;
    ctx.shadowBlur = 4;
    const k = this._k();
    ctx.font = `${10 * k}px ${c.mono}`;
    const unit = r.distance_unit.toUpperCase();
    for (let i = 1; i <= 4; i++) {
      const rr = R * i / 4;
      ctx.globalAlpha = i === 4 ? 1 : 0.75;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
      const v = Number(r.radius) * i / 4;
      ctx.globalAlpha = 1;
      ctx.fillText(`${Number.isInteger(v) ? v : v.toFixed(1)} ${unit}`, cx + 4 * k, cy - rr - 4 * k);
    }
    ctx.restore();

    // counting zone for the daily total
    if (r.today_count) {
      const rz = (Number(r.today_radius_km) || 10) * 1000 / this._radiusM * R;
      if (rz > 4 && rz < R * 1.2) {
        ctx.save();
        ctx.strokeStyle = c.amb;
        ctx.fillStyle = c.amb;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6 * k, 6 * k]);
        ctx.beginPath(); ctx.arc(cx, cy, rz, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // home marker
    ctx.save();
    ctx.fillStyle = c.acc;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7 * k); ctx.lineTo(cx + 6 * k, cy + 5 * k); ctx.lineTo(cx - 6 * k, cy + 5 * k); ctx.closePath();
    ctx.fill();
    ctx.font = `700 ${10 * k}px ${c.body}`;
    ctx.textAlign = 'center';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillText('HOME', cx, cy + 20 * k);
    ctx.restore();
  }

  // Map tiles reduced to faint accent-coloured lines: pixels that differ from the tile's land
  // colour (roads, borders, shorelines) become accent, everything else stays black.
  _drawMapLines(key) {
    const ctx = this._ctxS;
    const opacity = Math.max(0, Math.min(1, Number(this._config.radar.map_opacity)));
    const dpr = window.devicePixelRatio || 1;
    const z = Math.max(0, Math.min(16, Math.ceil(this._zoom + Math.log2(dpr))));
    const k = 2 ** (this._zoom - z);
    const n = 2 ** z;
    const hx = this._homeWP[0] * n;
    const hy = this._homeWP[1] * n;
    const x0 = Math.floor((hx - this._cx / k) / 256);
    const x1 = Math.floor((hx + (this._w - this._cx) / k) / 256);
    const y0 = Math.floor((hy - this._cy / k) / 256);
    const y1 = Math.floor((hy + (this._h - this._cy) / k) / 256);
    const rgb = parseColor(this._col.acc);
    const url = this._config.radar.tile_url || TILE_URL;
    for (let ty = Math.max(0, y0); ty <= Math.min(n - 1, y1); ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const wx = ((tx % n) + n) % n;
        const src = url.replace('{z}', z).replace('{x}', wx).replace('{y}', ty);
        const px = this._cx + (tx * 256 - hx) * k;
        const py = this._cy + (ty * 256 - hy) * k;
        this._lineTile(src, rgb).then((tile) => {
          if (!tile || this._staticKey !== key) return;
          ctx.save();
          ctx.globalAlpha = opacity;
          ctx.globalCompositeOperation = 'destination-over';
          ctx.drawImage(tile, px, py, 256 * k, 256 * k);
          ctx.restore();
        });
      }
    }
  }

  _lineTile(src, rgb) {
    const ck = `${src}|${rgb.join()}`;
    if (this._tileCache.has(ck)) return this._tileCache.get(ck);
    const p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const cv = document.createElement('canvas');
          cv.width = cv.height = 256;
          const x = cv.getContext('2d', { willReadFrequently: true });
          x.drawImage(img, 0, 0);
          const d = x.getImageData(0, 0, 256, 256);
          const px = d.data;
          // land colour = most common luminance in the tile
          const hist = new Uint32Array(256);
          for (let i = 0; i < px.length; i += 4) hist[(px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) | 0]++;
          let base = 0;
          for (let i = 1; i < 256; i++) if (hist[i] > hist[base]) base = i;
          for (let i = 0; i < px.length; i += 4) {
            const lum = px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
            const a = Math.max(0, Math.min(1, (Math.abs(lum - base) - 4) / 28));
            px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = a * 255;
          }
          x.putImageData(d, 0, 0);
          resolve(cv);
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
    this._tileCache.set(ck, p);
    if (this._tileCache.size > 200) this._tileCache.delete(this._tileCache.keys().next().value);
    return p;
  }

  // ---------------------------------------------------------------- data

  _update() {
    if (!this._built || !this._hass) return;
    this._readColors();
    this._geom();
    this._renderLeft();
    this._updateFlights();
    this._renderRight();
    this._drawStatic();
  }

  _readColors() {
    const cs = getComputedStyle(this._el.nv);
    const g = (v, d) => (cs.getPropertyValue(v).trim() || d);
    this._col = {
      acc: g('--acc', '#40e6d2'), txt: g('--txt', '#d4fdff'), txt2: g('--txt2', '#78b9c2'),
      red: g('--red', '#ff6f6f'), amb: g('--amb', '#ffb02e'),
      body: g('--body', '"News Cycle", sans-serif'), mono: g('--mono', 'monospace'),
    };
  }

  _st(id) { return id ? this._hass.states[id] : undefined; }

  _fmt(stateObj) {
    if (!stateObj) return '';
    try { if (this._hass.formatEntityState) return this._hass.formatEntityState(stateObj); } catch (e) { /* older HA */ }
    const u = stateObj.attributes.unit_of_measurement;
    if (u) return `${stateObj.state} ${u}`;
    const wx = { partlycloudy: 'partly cloudy', 'clear-night': 'clear', 'lightning-rainy': 'storms', 'snowy-rainy': 'sleet', 'windy-variant': 'windy' };
    const s = (wx[stateObj.state] || stateObj.state).replace(/[_-]/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  _num(id) {
    const s = this._st(id);
    const v = s ? parseFloat(s.state) : NaN;
    return Number.isFinite(v) ? v : null;
  }

  _moreInfo(entityId) {
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
  }

  _ringSvg(frac, text, color, size, dashed) {
    const f = Math.max(0, Math.min(1, frac || 0));
    const r = dashed ? 28 : 38;
    const w = dashed ? 5 : 6;
    const c = 2 * Math.PI * r;
    return `<svg viewBox="0 0 90 90" width="${size}" height="${size}" aria-hidden="true">
      ${dashed ? '<circle cx="45" cy="45" r="38" fill="none" stroke="var(--acc)" stroke-width="2" stroke-dasharray="14 6"/>' : ''}
      <circle cx="45" cy="45" r="${r}" fill="none" stroke="var(--off)" stroke-width="${w}"/>
      <circle cx="45" cy="45" r="${r}" fill="none" stroke="${color}" stroke-width="${w}" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 45 45)" style="filter:drop-shadow(0 0 4px ${color})"/>
      ${dashed ? '' : '<circle cx="45" cy="45" r="26" fill="none" stroke="var(--acc)" stroke-width="1.5" opacity=".6"/>'}
      <text x="45" y="${dashed ? 50 : 51}" text-anchor="middle" font-size="${dashed ? 15 : 18}" style="font-family:var(--mono);fill:var(--acc)">${esc(text)}</text></svg>`;
  }

  _renderLeft() {
    const L = this._config.left || {};
    const parts = [];
    if (L.outside_temp && this._st(L.outside_temp)) {
      const v = this._num(L.outside_temp);
      parts.push(`<div data-more="${esc(L.outside_temp)}" style="cursor:pointer"><div class="lb">${esc(L.outside_temp_name || 'Outside')} <span class="ab">outside</span></div>
        <div class="rd">${v != null ? `${Math.round(v)}°` : esc(this._st(L.outside_temp).state)}</div></div>`);
    }
    const lights = this._items(L.lights);
    if (lights.length) {
      parts.push(`<div class="lights"><div class="lb" style="margin-bottom:2px">${esc(L.lights_name || 'Lights')} <span class="ab">lights</span></div>${this._rowsHtml(lights)}</div>`);
    }
    const th = this._st(L.thermostat);
    if (th) {
      const a = th.attributes;
      const cur = Number(a.current_temperature);
      const set = a.temperature ?? (a.target_temp_low != null ? `${a.target_temp_low}-${a.target_temp_high}` : null);
      const min = Number(a.min_temp ?? 45);
      const max = Number(a.max_temp ?? 95);
      const frac = Number.isFinite(cur) ? (cur - min) / (max - min) : 0;
      const action = String(a.hvac_action || th.state || '').replace(/_/g, ' ');
      parts.push(`<div class="ring" data-more="${esc(L.thermostat)}" title="${set != null ? `Set ${esc(set)}° · ` : ''}${esc(action)}">${this._ringSvg(frac, Number.isFinite(cur) ? `${Math.round(cur)}°` : '--', 'var(--acc)', 90)}
        <div class="lb">${esc(L.thermostat_name || 'Thermostat')}</div>
        <div class="ab">${set != null ? `set ${esc(set)}` : esc(action)}</div></div>`);
    }
    const meter = Array.isArray(L.meter) ? L.meter : [];
    if (meter.length) {
      const ids = meter.map((m) => (typeof m === 'string' ? m : m.entity));
      const vals = ids.map((id) => this._num(id) ?? 0);
      const mx = Number(L.meter_max) || Math.max(100, ...vals.map((v) => v * 1.2));
      const top = Math.max(...vals);
      const rows = meter.map((m, i) => {
        const name = (typeof m === 'object' && m.name) || this._st(ids[i])?.attributes.friendly_name || ids[i];
        const w = Math.max(4, Math.min(100, vals[i] / mx * 100));
        return `<div class="mr ${vals[i] === top && top > 0 ? 'hi' : ''}" data-more="${esc(ids[i])}" title="${esc(name)}: ${esc(this._fmt(this._st(ids[i])))}"><span>${esc(String(name).slice(0, 5))}</span><b style="width:${w}%"></b></div>`;
      }).join('');
      parts.push(`<div class="mt"><div class="lb" style="margin-bottom:4px">${esc(L.meter_title || 'Power')}</div>${rows}</div>`);
    }
    if (L.humidity && this._st(L.humidity)) {
      const v = this._num(L.humidity);
      parts.push(`<div class="ring" data-more="${esc(L.humidity)}">${this._ringSvg((v ?? 0) / 100, v != null ? `${Math.round(v)}%` : '--', 'var(--grn)', 78, true)}
        <div class="lb">${esc(L.humidity_name || 'Humidity')}</div></div>`);
    }
    if (L.energy_today && this._st(L.energy_today)) {
      const v = this._num(L.energy_today);
      const u = this._st(L.energy_today).attributes.unit_of_measurement || '';
      parts.push(`<div data-more="${esc(L.energy_today)}" style="cursor:pointer"><div class="rd">${v != null ? v.toFixed(1) : esc(this._st(L.energy_today).state)}</div>
        <div class="lb" style="margin-top:3px">${esc(L.energy_today_name || `${u} today`)}</div></div>`);
    }
    // accepted under left: or at the top level, as an entity id or as { entity, ... }
    const appCfg = (v) => (typeof v === 'string' ? { entity: v } : v && typeof v === 'object' ? v : null);
    const missing = (name, cfg) => `<div class="ap warn"><div class="h"><span class="lb">${esc(name)}</span><span class="pill warn">NOT FOUND</span></div>
      <div class="kv warn"><span>Entity</span><b>${esc(cfg.entity || '(none set)')}</b></div></div>`;
    const sump = appCfg(L.sump_pump ?? this._config.sump_pump);
    if (sump) parts.push(this._st(sump.entity) ? this._sumpHtml(sump) : missing(sump.name || 'Sump pump', sump));
    const washer = appCfg(L.washer ?? this._config.washer);
    if (washer) parts.push(this._st(washer.entity) ? this._washerHtml(washer) : missing(washer.name || 'Washer', washer));
    const html = parts.join('') || '<div class="empty">Add sensors under left: in the card config</div>';
    if (html === this._leftHtml) { this._iconsUpdate(this._el.left); return; }
    this._leftHtml = html;
    this._el.left.innerHTML = html;
    this._el.left.querySelectorAll('[data-more]').forEach((n) => n.addEventListener('click', () => this._moreInfo(n.dataset.more)));
    this._bindRows(this._el.left, lights);
  }

  // ---------------------------------------------------------------- appliances (sump pump, washer)

  // Running if the entity is on / running, or (for a power sensor) above power_threshold watts.
  _applianceRunning(cfg) {
    const s = this._st(cfg.entity);
    if (!s) return false;
    if (this._isPower(s)) return parseFloat(s.state) > (Number(cfg.power_threshold) || 10);
    return /^(on|running|run|wash|washing|rinse|rinsing|spin|spinning|drying|soak|pre_?wash|active|pumping)$/i.test(s.state);
  }

  _isPower(s) { return Number.isFinite(parseFloat(s.state)) && !!s.attributes.unit_of_measurement; }

  _ago(ms) {
    if (!Number.isFinite(ms)) return '';
    const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ${m % 60} min ago`;
    return `${Math.floor(h / 24)} d ago`;
  }

  _mins(v) {
    if (v == null || !Number.isFinite(v)) return '';
    const m = Math.round(v);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  }

  // Minutes from a sensor holding either a number with a time unit, or a timestamp.
  _minutesFrom(id, until) {
    const s = this._st(id);
    if (!s) return null;
    const n = parseFloat(s.state);
    const u = String(s.attributes.unit_of_measurement || '').toLowerCase();
    if (Number.isFinite(n) && !/^\d{4}-/.test(s.state)) return u.startsWith('h') ? n * 60 : u.startsWith('s') ? n / 60 : n;
    const t = Date.parse(s.state);
    if (!Number.isFinite(t)) return null;
    return until ? Math.max(0, (t - Date.now()) / 60000) : (Date.now() - t) / 60000;
  }

  // For power-sensor appliances last_changed moves with every reading, so track the
  // running / stopped transitions the card sees itself.
  _track(key, cfg) {
    const s = this._st(cfg.entity);
    const running = this._applianceRunning(cfg);
    const t = (this._appState = this._appState || {})[key] || {};
    if (running && !t.running) t.start = Date.now();
    if (!running && t.running) t.stop = Date.now();
    t.running = running;
    this._appState[key] = t;
    if (!this._isPower(s)) {
      // on/off entities: last_changed is exactly when the current state began
      const lc = Date.parse(s.last_changed);
      if (running) t.start = lc; else t.stop = lc;
    }
    return t;
  }

  _sumpHtml(cfg) {
    const t = this._track('sump', cfg);
    const running = t.running;
    const runs = cfg.runs_today ? this._num(cfg.runs_today) : null;
    const runMin = cfg.runtime_today ? this._minutesFrom(cfg.runtime_today) : null;
    // the run counter changes when a run starts, which is the best "last run" for power sensors
    const counter = cfg.runs_today ? this._st(cfg.runs_today) : null;
    const last = running ? null : (t.stop || (counter && runs ? Date.parse(counter.last_changed) : NaN));
    const runningFor = running && t.start ? (Date.now() - t.start) / 60000 : null;
    const tooMany = !!cfg.alert_runs && runs != null && runs >= Number(cfg.alert_runs);
    const tooLong = !!cfg.alert_minutes && runningFor != null && runningFor >= Number(cfg.alert_minutes);
    const warn = tooMany || tooLong;
    const rows = [];
    if (runs != null) rows.push(`<div class="kv ${tooMany ? 'warn' : ''}"><span>Runs today</span><b>${Math.round(runs)}</b></div>`);
    if (runMin != null) rows.push(`<div class="kv"><span>Run time</span><b>${this._mins(runMin)}</b></div>`);
    if (runningFor != null) rows.push(`<div class="kv ${tooLong ? 'warn' : ''}"><span>Running for</span><b>${this._mins(runningFor)}</b></div>`);
    else if (Number.isFinite(last)) rows.push(`<div class="kv"><span>Last run</span><b>${this._ago(last)}</b></div>`);
    return `<div class="ap ${warn ? 'warn' : ''}" data-more="${esc(cfg.entity)}">
      <div class="h"><span class="lb">${esc(cfg.name || 'Sump pump')}</span><span class="pill ${tooLong ? 'warn' : running ? 'on' : ''}">${tooLong ? 'CHECK' : running ? 'RUNNING' : 'IDLE'}</span></div>
      ${rows.join('')}<div class="ab" style="margin-top:3px">${warn ? 'check pump' : running ? 'pumping' : 'dry dock'}</div></div>`;
  }

  _washerHtml(cfg) {
    const s = this._st(cfg.entity);
    const t = this._track('washer', cfg);
    const running = t.running;
    const reportsDone = /^(done|finished|complete|completed|end|ended)$/i.test(s.state);
    const sinceStop = t.stop ? (Date.now() - t.stop) / 60000 : null;
    const doneMin = cfg.done_minutes == null ? 60 : Number(cfg.done_minutes) || 0;
    const done = !running && (reportsDone || (sinceStop != null && sinceStop < doneMin));
    const left = cfg.remaining ? this._minutesFrom(cfg.remaining, true) : null;
    const stage = cfg.stage && this._st(cfg.stage) ? this._fmt(this._st(cfg.stage)) : '';
    const rows = [];
    if (running) {
      if (stage) rows.push(`<div class="kv"><span>Cycle</span><b>${esc(stage)}</b></div>`);
      if (left != null) rows.push(`<div class="kv"><span>Time left</span><b>${this._mins(left)}</b></div>`);
      else if (t.start) rows.push(`<div class="kv"><span>Started</span><b>${this._ago(t.start)}</b></div>`);
    } else if (done) {
      rows.push(`<div class="kv"><span>Finished</span><b>${this._ago(t.stop || Date.parse(s.last_changed))}</b></div>`);
    } else if (t.stop) {
      rows.push(`<div class="kv"><span>Last used</span><b>${this._ago(t.stop)}</b></div>`);
    }
    return `<div class="ap" data-more="${esc(cfg.entity)}">
      <div class="h"><span class="lb">${esc(cfg.name || 'Washer')}</span><span class="pill ${running ? 'on' : done ? 'done' : ''}">${running ? 'RUNNING' : done ? 'DONE' : 'IDLE'}</span></div>
      ${rows.join('')}<div class="ab" style="margin-top:3px">${running ? 'cycle active' : done ? 'unload' : 'standing by'}</div></div>`;
  }

  _statusClass(s) {
    const d = s.entity_id.split('.')[0];
    const st = s.state;
    if (st === 'unavailable' || st === 'unknown') return 'mid';
    if (TOGGLE_DOMAINS.includes(d)) return st === 'on' ? 'on' : '';
    if (d === 'lock') return st === 'locked' ? 'on' : (st === 'locking' || st === 'unlocking' ? 'mid' : 'warn');
    if (d === 'alarm_control_panel') {
      if (st === 'triggered') return 'warn';
      if (st.startsWith('armed')) return 'on';
      return st === 'disarmed' ? '' : 'mid';
    }
    if (d === 'cover') return st === 'closed' ? 'on' : (st === 'opening' || st === 'closing' ? 'mid' : 'warn');
    if (d === 'binary_sensor') {
      const dc = s.attributes.device_class;
      if (['door', 'garage_door', 'window', 'opening', 'lock', 'smoke', 'gas', 'moisture', 'problem', 'safety'].includes(dc)) return st === 'on' ? 'warn' : 'on';
      return st === 'on' ? 'on' : '';
    }
    return st === 'on' ? 'on' : '';
  }

  _weatherLine(wx) {
    const a = wx.attributes;
    const fc = this._forecast?.[0] || (Array.isArray(a.forecast) ? a.forecast[0] : null);
    if (fc && fc.temperature != null) {
      return `High ${Math.round(fc.temperature)}°${fc.templow != null ? ` · Low ${Math.round(fc.templow)}°` : ''}`;
    }
    return [a.humidity != null ? `Humidity ${Math.round(a.humidity)}%` : '', a.wind_speed != null ? `Wind ${Math.round(a.wind_speed)} ${a.wind_speed_unit || ''}` : '']
      .filter(Boolean).join(' · ');
  }

  _renderRight() {
    const contacts = this._view === 'contacts';
    this._el.rt.textContent = contacts ? 'CONTACTS' : 'STATUS';
    this._el.rta.textContent = contacts ? 'contacts' : 'status';
    this._el.tabView.innerHTML = contacts ? ICON.shield : ICON.plane;
    this._el.tabView.title = contacts ? 'Home status' : 'Aircraft contacts';
    this._el.right.classList.toggle('contacts', contacts);
    if (contacts) { this._renderContacts(); return; }
    const R = this._config.right || {};
    let html = '';
    const wx = this._st(R.weather);
    if (wx) {
      const t = wx.attributes.temperature != null ? ` · ${Math.round(wx.attributes.temperature)}°` : '';
      html += `<div class="wx" data-more="${esc(R.weather)}">${this._globeSvg()}
        <div style="font-size:13px">${esc(this._fmt(wx))}${t}</div>
        <div class="lb" style="margin-top:2px">${esc(this._weatherLine(wx))}</div></div>`;
    }
    const items = this._items(R.status);
    const n = this._visibleAircraft().filter((a) => !a.lost).length;
    let rows = '';
    if (this._config.radar.entity) {
      rows += `<div class="st on" data-view="contacts" role="button" tabindex="0" title="Show the flight list">
        <span class="n"><span class="ic">${ICON.plane}</span>Aircraft</span><span class="v">${n} now${this._todayCount() != null ? ` · ${this._todayCount()} today` : ''}</span></div>`;
    }
    rows += this._rowsHtml(items);
    html += `<div class="list">${rows}</div>`;
    if (html === this._rightHtml) { this._iconsUpdate(this._el.rbody); return; }
    this._rightHtml = html;
    this._contactsHtml = '';
    this._el.rbody.innerHTML = html;
    const on = (el, fn) => {
      el.addEventListener('click', fn);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
    };
    this._el.rbody.querySelectorAll('[data-more]').forEach((el) => on(el, () => this._moreInfo(el.dataset.more)));
    this._el.rbody.querySelectorAll('[data-view]').forEach((el) => on(el, () => this._setView('contacts')));
    this._bindRows(this._el.rbody, items);
  }

  _iconsUpdate(root) {
    root.querySelectorAll('ha-state-icon[data-icon]').forEach((ic) => {
      ic.hass = this._hass;
      ic.stateObj = this._st(ic.dataset.icon);
    });
  }

  _globeSvg() {
    const spin = this._config.motion
      ? '<animateTransform attributeName="transform" type="translate" from="0 0" to="-80 0" dur="24s" repeatCount="indefinite"/>' : '';
    return `<svg viewBox="0 0 100 100" width="80" height="80" aria-hidden="true" style="display:block;margin:0 auto 6px">
      <defs><clipPath id="nvgc"><circle cx="50" cy="50" r="40"/></clipPath>
      <g id="nvcont" fill="none" stroke="var(--acc)" stroke-width="2"><path d="M-30 -18 q10 -12 22 -6 q8 6 2 14 q-8 6 -4 14 q-10 6 -18 -4 q-8 -8 -2 -18z"/><path d="M6 -26 q12 -4 20 4 q6 10 -4 12 q-8 2 -10 -6 q-8 -2 -6 -10z"/><path d="M4 4 q12 -6 22 2 q6 12 -6 18 q-10 4 -14 -6 q-6 -6 -2 -14z"/><path d="M-22 16 q8 -2 12 6 q-2 8 -10 6 q-6 -4 -2 -12z"/></g></defs>
      <circle cx="50" cy="50" r="40" fill="var(--acc)" fill-opacity=".08" stroke="var(--acc)" stroke-width="2.5"/>
      <g clip-path="url(#nvgc)"><g>${spin}<use href="#nvcont" transform="translate(50 50) scale(1.1)"/><use href="#nvcont" transform="translate(130 50) scale(1.1)"/></g></g></svg>`;
  }

  // ---------------------------------------------------------------- flights

  _updateFlights() {
    const r = this._config.radar;
    const s = this._st(r.entity);
    if (!s) return;
    if (s.last_updated === this._lastFlightsStamp) return;
    this._lastFlightsStamp = s.last_updated;
    this._lastUpdate = Date.parse(s.last_updated) || Date.now();
    const flights = Array.isArray(s.attributes.flights) ? s.attributes.flights : [];
    const now = performance.now();
    const home = this._home();
    const seen = new Set();
    for (const f of flights) {
      const lat = Number(f.latitude);
      const lon = Number(f.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const reg = field(f.aircraft_registration);
      let id = field(f.aircraft_icao_24bit) || field(f.callsign) || reg || field(f.flight_number);
      if (!id || seen.has(id)) {
        // no usable identity: adopt the nearest anonymous track so it keeps its trail
        let best = null;
        let bestD = 10000;
        for (const cand of this._aircraft.values()) {
          if (!cand.anon || seen.has(cand.id)) continue;
          const d = haversine(cand.lat, cand.lon, lat, lon);
          if (d < bestD) { best = cand; bestD = d; }
        }
        id = best ? best.id : `anon-${Math.random().toString(36).slice(2, 8)}`;
      }
      seen.add(id);
      let ac = this._aircraft.get(id);
      const isNew = !ac;
      if (!ac) {
        ac = { id, anon: id.startsWith('anon-'), trail: [], lastSweep: -1e9, pinged: !this._initialSyncDone };
        this._aircraft.set(id, ac);
      }
      const prevAlt = ac.alt;
      ac.heli = isHelicopter(f);
      ac.callsign = field(f.callsign) || field(f.flight_number) || reg || field(f.aircraft_code) || (ac.heli ? 'HELI' : 'NO-ID');
      ac.alt = Number(f.altitude) || 0;
      ac.kts = Number(f.ground_speed) || 0;
      ac.hdg = Number(f.heading ?? f.track) || 0;
      ac.model = field(f.aircraft_model) || field(f.aircraft_code);
      ac.code = field(f.aircraft_code);
      ac.reg = reg;
      ac.airline = field(f.airline_short) || field(f.airline_icao);
      ac.from = field(f.airport_origin_code_iata) || field(f.airport_origin_code_icao);
      ac.to = field(f.airport_destination_code_iata) || field(f.airport_destination_code_icao);
      ac.fromName = field(f.airport_origin_city) || field(f.airport_origin_name);
      ac.toName = field(f.airport_destination_city) || field(f.airport_destination_name);
      ac.squawk = field(f.squawk);
      const wasEm = ac.emergency;
      ac.emergency = EMERGENCY_SQUAWKS.includes(ac.squawk);
      if (ac.emergency && !wasEm && this._initialSyncDone) this._ping('emergency');
      ac.photo = field(f.aircraft_photo_small) || field(f.aircraft_photo_medium);
      const wasFlag = ac.flag;
      ac.flag = this._matchRule(f, ac);
      if (ac.flag && !wasFlag && this._initialSyncDone) this._ping('highlight');
      ac.trend = prevAlt != null && Math.abs(ac.alt - prevAlt) >= 100 ? (ac.alt > prevAlt ? '▲' : '▼') : (ac.trend || '');
      if (!isNew) {
        ac.trail.push([ac.lat, ac.lon]);
        while (ac.trail.length > Math.max(0, Number(r.trail_length) || 0)) ac.trail.shift();
      }
      ac.lat = lat;
      ac.lon = lon;
      ac.t = now;
      ac.lost = 0;
      ac.dist = haversine(home.lat, home.lon, lat, lon);
    }
    for (const ac of this._aircraft.values()) {
      if (seen.has(ac.id)) continue;
      if (!ac.lost) ac.lost = now;
      if ((now - ac.lost) / 1000 > Number(r.linger_time)) {
        this._aircraft.delete(ac.id);
        if (this._selectedId === ac.id) this._selectedId = null;
      }
    }
    this._initialSyncDone = true;
    this._contactsHtml = '';
    if (this._view === 'status') this._rightHtml = '';
  }

  // First highlight rule this flight matches, or null.
  _matchRule(f, ac) {
    if (!this._rules || !this._rules.length) return null;
    const up = (v) => String(v || '').toUpperCase();
    const norm = (v) => up(v).replace(/[^A-Z0-9]/g, '');
    const callsign = up(field(f.callsign) || field(f.flight_number));
    const airline = [field(f.airline), field(f.airline_short), field(f.airline_icao), field(f.airline_iata)].join(' ').toLowerCase();
    const reg = norm(field(f.aircraft_registration));
    const hex = up(field(f.aircraft_icao_24bit));
    const code = up(field(f.aircraft_code));
    for (const r of this._rules) {
      const list = (v) => (Array.isArray(v) ? v : v != null ? [v] : []);
      if (list(r.callsign_prefix).some((p) => p && callsign.startsWith(up(p)))) return r;
      if (list(r.callsign).some((p) => p && callsign === up(p))) return r;
      if (list(r.airline).some((p) => p && airline.includes(String(p).toLowerCase()))) return r;
      if (list(r.registration).some((p) => p && reg === norm(p))) return r;
      if (list(r.icao24_prefix).some((p) => p && hex.startsWith(up(p)))) return r;
      if (list(r.aircraft_code).some((p) => p && code === up(p))) return r;
      if (r.canadian_military_serial && /^\d{5,6}$/.test(reg) && /^C[0-3]/.test(hex)) return r;
    }
    return null;
  }

  // Dead-reckoned display position for an aircraft at time `now`.
  _pos(ac, now) {
    if (!this._config.radar.smooth_motion || !ac.kts) return [ac.lat, ac.lon];
    const dt = Math.min((now - ac.t) / 1000, 120);
    return project(ac.lat, ac.lon, ac.hdg, ac.kts * 0.514444 * dt);
  }

  _visibleAircraft() {
    const max = this._radiusM ? this._radiusM * 1.05 : Infinity;
    return [...this._aircraft.values()].filter((a) => a.lat != null && a.dist <= max);
  }

  _altText(ft) {
    if (this._config.radar.altitude_unit === 'm') return `${Math.round(ft * 0.3048).toLocaleString()} M`;
    return ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${Math.round(ft).toLocaleString()} FT`;
  }

  _spdText(kts) { return this._config.radar.speed_unit === 'kmh' ? `${Math.round(kts * 1.852)} KM/H` : `${Math.round(kts)} KT`; }

  _distText(m) { const u = this._config.radar.distance_unit; return `${(m / (u === 'km' ? M_PER_KM : M_PER_MI)).toFixed(1)} ${u.toUpperCase()}`; }

  _renderContacts() {
    if (this._view !== 'contacts') return;
    const r = this._config.radar;
    const list = this._visibleAircraft().sort((a, b) => (b.emergency - a.emergency) || (!!b.flag - !!a.flag) || (!!a.lost - !!b.lost) || (a.dist - b.dist));
    const sel = this._aircraft.get(this._selectedId);
    let html = `<div class="st" data-back role="button" tabindex="0"><span class="n"><span class="ic">${ICON.back}</span>Home status</span><span class="v">${list.filter((a) => !a.lost).length} in range</span></div>`;
    if (sel && r.show_photo && sel.photo) html += `<img class="photo" src="${esc(sel.photo)}" alt="${esc(sel.model || sel.callsign)}" referrerpolicy="no-referrer">`;
    html += '<div class="list">';
    if (!list.length) html += '<div class="empty">No aircraft in range</div>';
    for (const ac of list) {
      const low = ac.alt < Number(r.low_altitude);
      const route = ac.from || ac.to ? `${ac.from || '???'} > ${ac.to || '???'}` : '';
      const det = r.show_details ? [ac.airline, ac.model, ac.reg, route].filter(Boolean).join(' · ') : '';
      html += `<div class="ct ${ac.id === this._selectedId ? 'sel' : ''} ${low ? 'low' : ''} ${ac.emergency ? 'em' : ''}" data-id="${esc(ac.id)}" style="${ac.lost ? 'opacity:.5' : ''}">
        <div class="a"><span class="cs" ${ac.flag && !ac.emergency ? `style="color:${esc(ac.flag.color)}"` : ''}>${ac.heli ? 'O ' : ''}${esc(ac.callsign)}${ac.emergency ? ` ${esc(ac.squawk)}` : ''}${ac.flag ? `<span class="tag" style="color:${esc(ac.flag.color)}">${esc(ac.flag.label)}</span>` : ''}</span><span>${esc(this._altText(ac.alt))}${esc(ac.trend || '')}</span></div>
        <div class="a" style="color:var(--txt2)"><span>${esc(this._spdText(ac.kts))}</span><span>${esc(this._distText(ac.dist))}</span></div>
        ${det ? `<div class="b">${esc(det)}</div>` : ''}</div>`;
    }
    html += '</div>';
    if (html === this._contactsHtml) return;
    this._contactsHtml = html;
    const scroll = this._el.rbody.querySelector('.list')?.scrollTop || 0;
    this._el.rbody.innerHTML = html;
    const lst = this._el.rbody.querySelector('.list');
    if (lst) lst.scrollTop = scroll;
    const back = this._el.rbody.querySelector('[data-back]');
    back.addEventListener('click', () => this._setView('status'));
    back.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._setView('status'); } });
    this._el.rbody.querySelectorAll('[data-id]').forEach((el) => el.addEventListener('click', () => this._select(el.dataset.id)));
  }

  _select(id) {
    this._selectedId = this._selectedId === id ? null : id;
    this._contactsHtml = '';
    this._renderContacts();
  }

  _onCanvasClick(e) {
    const rect = this._el.cvL.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best = null;
    let bd = 22 * this._k();
    for (const ac of this._visibleAircraft()) {
      if (ac.sx == null) continue;
      const d = Math.hypot(ac.sx - x, ac.sy - y);
      if (d < bd) { bd = d; best = ac; }
    }
    if (best) {
      this._selectedId = best.id;
      if (this._view !== 'contacts') this._setView('contacts');
    } else this._selectedId = null;
    this._contactsHtml = '';
    this._renderContacts();
  }

  // ---------------------------------------------------------------- sound

  _toggleSound() {
    this._armed = !this._armed;
    try { localStorage.setItem('nav-console-card-sound', this._armed ? '1' : '0'); } catch (e) { /* storage blocked */ }
    this._el.snd.classList.toggle('armed', this._armed);
    this._el.snd.innerHTML = this._armed ? ICON.speakerOn : ICON.speakerOff;
    if (this._armed) this._ping('contact', true);
  }

  _ping(kind, force) {
    const mode = this._config.radar.sound_alerts;
    if (!this._armed || mode === 'none') return;
    if (!force && mode !== 'all' && mode !== (kind === 'contact' ? 'new_contact' : kind)) return;
    if (kind === 'highlight' && !['all', 'highlight'].includes(mode)) return;
    try {
      this._audio = this._audio || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this._audio;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f0 = kind === 'emergency' ? 880 : kind === 'proximity' ? 1320 : kind === 'highlight' ? 990 : 1180;
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(f0 / 2, ctx.currentTime + 0.7);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 1);
    } catch (e) { /* audio unavailable */ }
  }

  // ---------------------------------------------------------------- live layer: sweep and aircraft

  _startLoop() {
    if (this._raf) return;
    const tick = (t) => {
      this._raf = requestAnimationFrame(tick);
      if (!this._built || !this._hass || !this._col || document.hidden) return;
      const animate = this._config.radar.sweep;
      // without the sweep, redraw only twice a second (blips still dead-reckon)
      if (!animate && t - this._lastFrame < 500) return;
      const dt = Math.min(0.1, (t - (this._lastFrame || t)) / 1000);
      this._lastFrame = t;
      if (animate) this._sweepAngle = (this._sweepAngle + dt * 360 / Math.max(1, Number(this._config.radar.sweep_period))) % 360;
      this._draw(t);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _draw(now) {
    const ctx = this._ctx;
    const r = this._config.radar;
    const c = this._col;
    const cx = this._cx; const cy = this._cy; const R = this._R;
    ctx.clearRect(0, 0, this._w, this._h);

    const sweepOn = r.sweep;
    if (sweepOn) {
      ctx.save();
      ctx.fillStyle = c.acc;
      for (let i = 0; i < 10; i++) {
        const a1 = toRad(this._sweepAngle - (i + 1) * 5 - 90);
        const a2 = toRad(this._sweepAngle - i * 5 - 90);
        ctx.globalAlpha = 0.32 * (1 - i / 10);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a1, a2); ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.acc;
      ctx.lineWidth = 2.5;
      const sa = toRad(this._sweepAngle);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(sa) * R, cy - Math.cos(sa) * R); ctx.stroke();
      ctx.restore();
    }

    const home = this._home();
    const k = this._k();
    const period = Math.max(1, Number(r.sweep_period)) * 1000;
    const alertM = Number(r.alert_distance) * (r.distance_unit === 'km' ? M_PER_KM : M_PER_MI);
    const vis = this._visibleAircraft();
    let selAc = null;
    for (const ac of vis) {
      const [lat, lon] = this._pos(ac, now);
      ac.dist = haversine(home.lat, home.lon, lat, lon);
      const [sx, sy] = this._toScreen(lat, lon);
      ac.sx = sx; ac.sy = sy;
      if (sweepOn) {
        const diff = (this._sweepAngle - bearing(home.lat, home.lon, lat, lon) + 360) % 360;
        if (diff < 8 && now - ac.lastSweep > period * 0.5) {
          ac.lastSweep = now;
          if (!ac.pinged) { ac.pinged = true; this._ping('contact'); }
          if (alertM && ac.dist < alertM) this._ping('proximity');
        }
      }
      // brightness: like the mockup, blips light up as the beam passes and settle at 35%
      const decay = sweepOn ? 0.35 + 0.65 * (1 - Math.min(1, (now - ac.lastSweep) / period)) : 1;
      const inten = (ac.lost ? 0.4 : 1) * decay;
      const low = ac.alt < Number(r.low_altitude);
      const pulse = ac.emergency || (alertM && ac.dist < alertM) ? 0.55 + 0.45 * Math.sin(now / 180) : 1;
      const color = ac.emergency ? c.red : ac.flag ? ac.flag.color : low ? c.amb : c.acc;

      if (ac.trail.length) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        const pts = [...ac.trail.map(([la, lo]) => this._toScreen(la, lo)), [sx, sy]];
        if (r.trail_style === 'dots') {
          pts.slice(0, -1).forEach(([px, py], i) => {
            ctx.globalAlpha = 0.15 + 0.45 * (i / pts.length);
            ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI * 2); ctx.fill();
          });
        } else {
          ctx.globalAlpha = 0.3 * inten;
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 5]);
          ctx.beginPath();
          pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(k, k);
      ctx.globalAlpha = Math.min(1, inten * pulse);
      ctx.fillStyle = color;
      ctx.strokeStyle = c.txt;
      ctx.lineWidth = 0.8;
      const icon = ac.flag && ac.flag.icon !== 'arrow' ? ac.flag.icon : ac.heli ? 'heli' : 'arrow';
      if (icon !== 'arrow' && icon !== 'heli') {
        // special icons don't show heading on their own, so add a heading tick
        ctx.save();
        ctx.rotate(toRad(ac.hdg));
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(0, -13); ctx.stroke();
        ctx.restore();
      }
      if (icon === 'heli') {
        ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else if (icon === 'star') {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const rr = i % 2 ? 3 : 7.5;
          const a = toRad(i * 36 - 90);
          ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (icon === 'roundel') {
        // RCAF roundel: blue ring, white ring, red centre
        ctx.fillStyle = '#2f5fbf'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, 4.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = ac.emergency ? c.red : '#e0303a'; ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, 7.6, 0, Math.PI * 2); ctx.stroke();
      } else if (icon === 'diamond') {
        ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(6, 0); ctx.lineTo(0, 7); ctx.lineTo(-6, 0); ctx.closePath();
        ctx.fill(); ctx.stroke();
      } else {
        ctx.rotate(toRad(ac.hdg));
        ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = Math.min(1, inten * pulse);
      ctx.font = `${10 * k}px ${c.mono}`;
      ctx.fillStyle = ac.emergency ? c.red : ac.flag ? ac.flag.color : c.txt;
      ctx.fillText(ac.callsign + (ac.emergency ? ` ${ac.squawk}` : ac.flag ? ` ${ac.flag.label}` : ''), sx + 9 * k, sy - 2 * k);
      ctx.font = `${9 * k}px ${c.mono}`;
      ctx.fillStyle = c.txt2;
      ctx.fillText(this._altText(ac.alt) + (ac.trend || ''), sx + 9 * k, sy + 9 * k);
      ctx.restore();

      if (ac.id === this._selectedId) selAc = ac;
    }

    if (selAc) {
      ctx.save();
      ctx.strokeStyle = c.amb;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(selAc.sx, selAc.sy, 15 * k, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    const n = vis.filter((a) => !a.lost).length;
    const cnt = String(n).padStart(4, '0');
    if (this._el.cnt.textContent !== cnt) {
      this._el.cnt.textContent = cnt;
      if (this._view === 'status') { this._rightHtml = ''; this._renderRight(); }
    }
    const today = this._todayCount();
    this._el.today.classList.toggle('show', today != null);
    this._el.stale.style.setProperty('--stale-off', today != null ? '44px' : '0px');
    if (today != null) {
      const t = String(today).padStart(4, '0');
      const b = this._el.today.firstElementChild;
      if (b.textContent !== t) b.textContent = t;
      const lbl = `TODAY ≤ ${this._todayRadiusText()}`;
      if (this._el.today.lastElementChild.textContent !== lbl) this._el.today.lastElementChild.textContent = lbl;
    }
    const staleAfter = Number(r.stale_after);
    const stale = staleAfter > 0 && n > 0 && this._lastUpdate && (Date.now() - this._lastUpdate) / 1000 > staleAfter;
    this._el.stale.classList.toggle('show', !!stale);
    if (stale) this._el.stale.textContent = `STALE ${Math.round((Date.now() - this._lastUpdate) / 1000)}S`;
    this._renderReadout(selAc);
    if (this._view === 'contacts' && !this._contactsHtml) this._renderContacts();
  }

  _renderReadout(ac) {
    let key;
    let html;
    if (!ac) {
      key = 'none';
      html = '<div class="k"><span>TRACKING</span><span class="ab">standing by</span></div><div class="l1">NO CONTACT</div><div class="l2">Tap a blip or a contact to track it</div>';
    } else {
      const r = this._config.radar;
      const home = this._home();
      const [lat, lon] = this._pos(ac, performance.now());
      const brg = bearing(home.lat, home.lon, lat, lon);
      const elev = elevationAngle(ac.dist, ac.alt, Number(this._hass?.config?.elevation) || 0);
      const look = `Look <b>${compass(brg)} (${String(Math.round(brg)).padStart(3, '0')}°)</b>, about <b>${Math.max(0, Math.round(elev))}° up</b> · ${esc(this._distText(ac.dist).toLowerCase())} away`;
      const place = (name, code) => (name && code ? `${esc(name)} (${esc(code)})` : esc(name || code));
      const route = ac.from || ac.to || ac.fromName || ac.toName
        ? `From <b>${place(ac.fromName, ac.from) || 'unknown'}</b> to <b>${place(ac.toName, ac.to) || 'unknown'}</b>` : '';
      const ft = Math.round(ac.alt);
      const m = Math.round(ac.alt * 0.3048);
      const altTxt = r.altitude_unit === 'm' ? `${m.toLocaleString()} m (${ft.toLocaleString()} ft)` : `${ft.toLocaleString()} ft (${m.toLocaleString()} m)`;
      const kmh = Math.round(ac.kts * 1.852);
      const spdTxt = r.speed_unit === 'kmh' ? `${kmh} km/h (${Math.round(ac.kts)} kt)` : `${Math.round(ac.kts)} kt (${kmh} km/h)`;
      const motion = `Heading <b>${compass(ac.hdg)}</b> · ${altTxt}${ac.trend === '▲' ? ' climbing' : ac.trend === '▼' ? ' descending' : ''} · ${spdTxt}`;
      const tag = ac.emergency ? 'emergency' : ac.flag ? (ac.flag.aurebesh || ac.flag.label.toLowerCase()) : ac.alt < Number(r.low_altitude) ? 'low flyer' : 'cruising';
      const head = [ac.emergency ? 'EMERGENCY' : ac.lost ? 'SIGNAL LOST' : 'TRACKING', ac.callsign, ac.flag ? String(ac.flag.name || ac.flag.label).toUpperCase() : '', ac.squawk ? `SQK ${ac.squawk}` : '']
        .filter(Boolean).map(esc).join(' · ');
      html = `<div class="k"><span>${head}</span><span class="ab">${tag}</span></div><div class="l1">${esc(ac.model || ac.code || ac.callsign)}${ac.airline ? ` <span style="color:var(--txt2);font-size:12px">${esc(ac.airline)}</span>` : ''}</div>
        <div class="l2">${look}</div>${route ? `<div class="l2">${route}</div>` : ''}<div class="l2">${motion}</div>`;
      key = html;
    }
    if (key === this._roKey) return;
    this._roKey = key;
    this._el.ro.classList.toggle('em', !!ac?.emergency);
    this._el.ro.innerHTML = html;
  }
}

ensureFonts();

if (!customElements.get('nav-console-card')) {
  customElements.define('nav-console-card', NavConsoleCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'nav-console-card',
    name: 'Falcon Gunnery nav console',
    description: 'Star Wars nav console: gauges, flight radar, and status board (Falcon Gunnery theme).',
    preview: false,
    documentationURL: 'https://github.com/marknoordam/Falcon-Gunnery-Card',
  });
  console.info(`%c FALCON-GUNNERY-CARD %c v${VERSION} `, 'background:#40e6d2;color:#01080b;font-weight:700', 'color:#40e6d2');
}
