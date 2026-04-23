// AriaColony — isometric colony builder. Single-file vanilla JS, canvas-based.
// Everything procedural — no image assets.
(() => {
'use strict';

// ─── Constants ──────────────────────────────────────────────────────────────
const TILE_W = 64;   // isometric diamond width (pixels)
const TILE_H = 32;   // isometric diamond height
const MAP_SIZE = 40; // square map dimension
const TERRAIN = { GRASS: 0, WATER: 1, STONE: 2, FOREST: 3, SAND: 4 };
// Per-terrain visual height. Water sits flat (recessed), stone rises the most,
// grass/forest sit at a middling altitude. Heights are pixels at zoom=1.
const TERRAIN_HEIGHT = {
  [TERRAIN.WATER]: 0,
  [TERRAIN.SAND]: 3,
  [TERRAIN.GRASS]: 5,
  [TERRAIN.FOREST]: 5,
  [TERRAIN.STONE]: 9,
};
const BUILDINGS = {
  TOWN_HALL:   { id: 'TOWN_HALL',   name: 'Town Hall',   icon: '🏰', w: 2, h: 2, cost: { wood: 40 },              workers: 0, houses: 3, desc: 'Heart of your colony. Start here.' },
  HOUSE:       { id: 'HOUSE',       name: 'House',       icon: '🏠', w: 1, h: 1, cost: { wood: 20 },              workers: 0, houses: 4, desc: 'Houses 4 colonists.' },
  LUMBERYARD:  { id: 'LUMBERYARD',  name: 'Lumberyard',  icon: '🪓', w: 2, h: 1, cost: { wood: 25 },              workers: 2, produces: 'wood', rate: 1.2,    desc: 'Workers harvest nearby forest.' },
  FARM:        { id: 'FARM',        name: 'Farm',        icon: '🌾', w: 2, h: 2, cost: { wood: 30 },              workers: 2, produces: 'food', rate: 0.9,    desc: 'Grows food on grass.' },
  QUARRY:      { id: 'QUARRY',      name: 'Quarry',      icon: '⛏️', w: 2, h: 1, cost: { wood: 35 },              workers: 2, produces: 'stone', rate: 0.7,   desc: 'Must touch stone tiles.' },
  MARKET:      { id: 'MARKET',      name: 'Market',      icon: '🏪', w: 1, h: 1, cost: { wood: 25, stone: 10 },   workers: 1, produces: 'gold', rate: 0.4,    desc: 'Converts resources to gold.' },
  WELL:        { id: 'WELL',        name: 'Well',        icon: '⛲', w: 1, h: 1, cost: { stone: 20 },             workers: 0, desc: 'Boosts nearby farms.' },
  WATCHTOWER:  { id: 'WATCHTOWER',  name: 'Watchtower',  icon: '🗼', w: 1, h: 1, cost: { wood: 20, stone: 20 },   workers: 1, desc: 'Extends your view + happiness.' },
};
const BUILD_ORDER = ['TOWN_HALL', 'HOUSE', 'LUMBERYARD', 'FARM', 'QUARRY', 'MARKET', 'WELL', 'WATCHTOWER'];

// ─── Canvas + world state ───────────────────────────────────────────────────
const canvas = document.getElementById('game');
// `ctx` is `let` (not const) so renderWorld() can swap it for the offscreen
// world canvas during terrain bake. Every draw fn reads the live `ctx`, so
// this swap redirects the whole call-tree without per-fn plumbing.
let ctx = canvas.getContext('2d');
const mainCtx = ctx;
// Offscreen world cache — terrain + trees + rocks + shore fringe bake here.
// Only redrawn when `state.worldDirty` is set. Every frame we blit it to the
// main canvas, then draw dynamics (buildings, colonists, effects) on top.
// Buildings stay out of the cache so colonists z-sort correctly against them.
const worldCanvas = document.createElement('canvas');
const worldCtx = worldCanvas.getContext('2d');
const miniCanvas = document.querySelector('#minimap canvas');
const miniCtx = miniCanvas.getContext('2d');

const state = {
  camX: 0, camY: 0, zoom: 1,
  map: [],              // [y][x] → terrain type
  buildings: [],        // { id, kind, x, y, constructed, progress, workers[] }
  colonists: [],        // { id, x, y, targetX, targetY, job, building, home, state, anim }
  resources: { food: 20, wood: 60, stone: 15, gold: 0 },
  resourceDelta: {},    // per-second recent deltas for UI
  capacity: { pop: 0 },
  pop: 0,
  selected: null,       // {kind: building-to-place}
  hoverTile: null,
  selectedEntity: null, // {type, ref}
  time: 0,              // seconds since start
  dayLen: 120,          // seconds per full day
  speed: 1,
  paused: false,
  nextId: 1,
  // Global tick counter (OpenRCT2 + OpenTTD pattern). One int drives every
  // animation: water shimmer, smoke, selection pulse, banner wave.
  tick: 0,
  // Dual-canvas bookkeeping. Any change to the static world — pan, zoom, map
  // edit, build, demolish, resize — flips this so renderWorld() runs once on
  // the next frame to rebake the terrain cache.
  worldDirty: true,
};
function markWorldDirty() { state.worldDirty = true; }

// ─── Device pixel ratio resize ──────────────────────────────────────────────
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Offscreen world cache shares the viewport dimensions. Transform in CSS
  // pixels just like the main context — worldToScreen stays coordinate-compatible.
  worldCanvas.width = w;
  worldCanvas.height = h;
  worldCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  markWorldDirty();
}
window.addEventListener('resize', resize);
resize();

// ─── Map generation — simple procedural terrain ─────────────────────────────
function generateMap() {
  const m = [];
  const cx = MAP_SIZE / 2, cy = MAP_SIZE / 2;
  // Seeded pseudo-random
  let seed = Math.floor(Math.random() * 1e9);
  const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  // Noise-ish — sum of sines
  const noise = (x, y) =>
    Math.sin(x * 0.31 + y * 0.22) * 0.5 +
    Math.sin(x * 0.11 - y * 0.18 + 2.1) * 0.35 +
    Math.sin(x * 0.55 + y * 0.4 + 4.7) * 0.15;
  for (let y = 0; y < MAP_SIZE; y++) {
    m[y] = [];
    for (let x = 0; x < MAP_SIZE; x++) {
      const n = noise(x + seed * 0.0001, y + seed * 0.00017);
      const dc = Math.hypot(x - cx, y - cy);
      let t = TERRAIN.GRASS;
      if (n > 0.55) t = TERRAIN.FOREST;
      else if (n < -0.6) t = TERRAIN.STONE;
      if (dc > MAP_SIZE * 0.48 - 2) {
        const edgeNoise = noise(x * 2, y * 2);
        if (edgeNoise > 0.1) t = TERRAIN.WATER;
      }
      m[y][x] = t;
    }
  }
  // Ensure a grassy plaza at map center
  for (let y = cy - 3; y <= cy + 3; y++)
    for (let x = cx - 3; x <= cx + 3; x++)
      if (y >= 0 && x >= 0 && y < MAP_SIZE && x < MAP_SIZE) m[y][x] = TERRAIN.GRASS;
  return m;
}
state.map = generateMap();

// ─── Isometric projection ───────────────────────────────────────────────────
function worldToScreen(wx, wy) {
  // Tile (wx,wy) → pixel (sx,sy) center of diamond top.
  const sx = (wx - wy) * (TILE_W / 2) * state.zoom;
  const sy = (wx + wy) * (TILE_H / 2) * state.zoom;
  return {
    x: sx + state.camX + window.innerWidth / 2,
    y: sy + state.camY + window.innerHeight * 0.3,
  };
}
function screenToWorld(sx, sy) {
  const x = (sx - state.camX - window.innerWidth / 2) / state.zoom;
  const y = (sy - state.camY - window.innerHeight * 0.3) / state.zoom;
  const wx = (x / (TILE_W / 2) + y / (TILE_H / 2)) / 2;
  const wy = (y / (TILE_H / 2) - x / (TILE_W / 2)) / 2;
  return { x: Math.floor(wx), y: Math.floor(wy) };
}

// ─── Rendering primitives ───────────────────────────────────────────────────
function drawDiamond(cx, cy, w, h, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

// Darken an rgb(r,g,b) color by a factor (0..1). Used for iso face shading.
function darkenRgb(rgb, factor) {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgb);
  if (!m) return rgb;
  return `rgb(${Math.floor(+m[1]*factor)},${Math.floor(+m[2]*factor)},${Math.floor(+m[3]*factor)})`;
}

// Isometric "block" — top diamond plus its two south-facing side faces, which
// give the ground real depth. Paint order inside the function draws faces
// first then the top, so faces correctly sit below the top edge.
function drawTileBlock(cx, cy, w, h, topColor, depth, stroke) {
  if (depth > 0.5) {
    // Right face (SE-facing)
    ctx.fillStyle = darkenRgb(topColor, 0.68);
    ctx.beginPath();
    ctx.moveTo(cx + w/2, cy);
    ctx.lineTo(cx, cy + h/2);
    ctx.lineTo(cx, cy + h/2 + depth);
    ctx.lineTo(cx + w/2, cy + depth);
    ctx.closePath(); ctx.fill();
    // Left face (SW-facing) — slightly brighter
    ctx.fillStyle = darkenRgb(topColor, 0.82);
    ctx.beginPath();
    ctx.moveTo(cx - w/2, cy);
    ctx.lineTo(cx, cy + h/2);
    ctx.lineTo(cx, cy + h/2 + depth);
    ctx.lineTo(cx - w/2, cy + depth);
    ctx.closePath(); ctx.fill();
  }
  // Top diamond
  drawDiamond(cx, cy, w, h, topColor, stroke);
}

function tileHeight(x, y) {
  if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) return 0;
  return TERRAIN_HEIGHT[state.map[y][x]] || 0;
}
// Highest tile-height under a building footprint — buildings sit on that crown.
function buildingTopHeight(b) {
  const def = BUILDINGS[b.kind];
  let max = 0;
  for (let dy = 0; dy < def.h; dy++)
    for (let dx = 0; dx < def.w; dx++) {
      max = Math.max(max, tileHeight(b.x + dx, b.y + dy));
    }
  return max;
}

// Static water ripple — deterministic per-tile detail baked into world cache.
// Animated sheen is a separate pass (see drawWaterSheen) on the main canvas.
function drawWaterRipple(cx, cy, w, h, tx, ty) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy - h/2);
  ctx.lineTo(cx + w/2, cy);
  ctx.lineTo(cx, cy + h/2);
  ctx.lineTo(cx - w/2, cy);
  ctx.closePath();
  ctx.clip();
  for (let i = 0; i < 2; i++) {
    const offset = Math.sin(tx * 0.7 + ty * 0.5 + i * Math.PI) * 2;
    ctx.strokeStyle = `rgba(200,230,255,${0.12 + 0.08 * Math.sin(tx + ty)})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx - w/2 * 0.6, cy + offset + i * 3);
    ctx.quadraticCurveTo(cx, cy - 2 + offset + i * 3, cx + w/2 * 0.6, cy + offset + i * 3);
    ctx.stroke();
  }
  ctx.restore();
}
// Animated water sheen — per-frame pass on the main canvas. One thin bright
// arc per water tile whose phase drifts with state.time and tile coord.
// Cheap (≈30 strokes/frame) and replaces the per-tile ripple animation we
// moved into the world cache.
function drawWaterSheen(x, y) {
  const p = worldToScreen(x, y);
  const w = TILE_W * state.zoom, h = TILE_H * state.zoom;
  const phase = Math.sin(state.time * 1.8 + x * 0.7 + y * 0.5);
  const alpha = 0.18 + 0.12 * Math.sin(state.time * 1.3 + x + y);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - h/2);
  ctx.lineTo(p.x + w/2, p.y);
  ctx.lineTo(p.x, p.y + h/2);
  ctx.lineTo(p.x - w/2, p.y);
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = `rgba(220,240,255,${alpha})`;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(p.x - w/2 * 0.65, p.y + phase * 2.5);
  ctx.quadraticCurveTo(p.x, p.y - 3 + phase * 2.5, p.x + w/2 * 0.65, p.y + phase * 2.5);
  ctx.stroke();
  ctx.restore();
}

// Shore fringe — paint a sand-like band on grass tiles that touch water.
function maybeDrawShoreFringe(cx, cy, x, y, w, h) {
  const neigh = [[0,1],[1,0],[0,-1],[-1,0],[1,1],[-1,1],[1,-1],[-1,-1]];
  let waterNeighbor = false;
  for (const [dx, dy] of neigh) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE) continue;
    if (state.map[ny][nx] === TERRAIN.WATER) { waterNeighbor = true; break; }
  }
  if (!waterNeighbor) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy - h/2);
  ctx.lineTo(cx + w/2, cy);
  ctx.lineTo(cx, cy + h/2);
  ctx.lineTo(cx - w/2, cy);
  ctx.closePath();
  ctx.clip();
  const grad = ctx.createRadialGradient(cx, cy, w * 0.1, cx, cy, w * 0.7);
  grad.addColorStop(0, 'rgba(232,206,152,0)');
  grad.addColorStop(0.6, 'rgba(232,206,152,0)');
  grad.addColorStop(1, 'rgba(232,206,152,0.55)');
  ctx.fillStyle = grad;
  ctx.fillRect(cx - w, cy - h, w*2, h*2);
  ctx.restore();
}

// 4 tree variants — deterministic by tile coord so each tree stays consistent.
function treeVariant(tx, ty) {
  return (tx * 91 + ty * 37 + (tx ^ ty)) & 3;
}

function terrainColors(type, _timeOfDay, tx, ty) {
  // Base colors — time-independent so the world cache stays static. The
  // global multiply overlay handles day/night; water animation is a
  // separately-drawn sheen, not a base color shift.
  const base = {
    [TERRAIN.GRASS]: [120 + (tx*37+ty*19)%15, 190 + (tx*13)%15, 100 + (ty*23)%20],
    [TERRAIN.FOREST]: [60, 130 + (tx*7+ty*11)%20, 60],
    [TERRAIN.STONE]: [140, 138, 142],
    [TERRAIN.WATER]: [70, 160 + ((tx*13+ty*7)%20 - 10), 200],
    [TERRAIN.SAND]: [220, 200, 150],
  }[type];
  return `rgb(${base[0]},${base[1]},${base[2]})`;
}

// Sky gradient by time-of-day — reactive background
function drawSky() {
  const t = (state.time % state.dayLen) / state.dayLen;
  const dawn = t < 0.15, day = t < 0.55, dusk = t < 0.7;
  let top, mid;
  if (dawn) { top = '#ffd1a0'; mid = '#ff9c8a'; }
  else if (day) { top = '#87ceeb'; mid = '#b7e0f0'; }
  else if (dusk) { top = '#3a2755'; mid = '#eb4d63'; }
  else { top = '#0c0a24'; mid = '#1a1636'; }
  const g = ctx.createLinearGradient(0, 0, 0, window.innerHeight);
  g.addColorStop(0, top); g.addColorStop(1, mid);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  // Stars at night
  if (!dawn && !day && !dusk) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 50; i++) {
      const x = (i * 73) % window.innerWidth;
      const y = (i * 47) % (window.innerHeight * 0.5);
      const tw = 0.5 + Math.sin(state.time * 3 + i) * 0.5;
      ctx.globalAlpha = tw * 0.8;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;
  }
  // Sun/moon
  const ax = window.innerWidth * (0.1 + t * 0.8);
  const ay = window.innerHeight * 0.3 - Math.sin(t * Math.PI * 2) * window.innerHeight * 0.2;
  const isMoon = t > 0.7 || t < 0.08;
  ctx.fillStyle = isMoon ? 'rgba(240,240,255,0.85)' : 'rgba(255,220,140,0.9)';
  ctx.shadowColor = isMoon ? 'rgba(200,200,255,0.6)' : 'rgba(255,200,100,0.7)';
  ctx.shadowBlur = 30;
  ctx.beginPath();
  ctx.arc(ax, ay, isMoon ? 24 : 32, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Clouds
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  for (let i = 0; i < 4; i++) {
    const cx = (window.innerWidth * ((i*0.3 + state.time*0.01) % 1.2)) - 60;
    const cy = window.innerHeight * (0.08 + i*0.04);
    for (let j = 0; j < 3; j++) {
      ctx.beginPath(); ctx.arc(cx + j*14, cy, 16, 0, Math.PI*2); ctx.fill();
    }
  }
}

// Unciv-style edge blending — for each cardinal neighbor with different
// terrain, paint a soft gradient from that edge inward using the neighbor's
// color. Cheap substitute for a 20-way edge-sprite sheet; gives the same
// "biomes bleed into each other" look without needing art assets.
const EDGE_BLEND_RGB = {
  [TERRAIN.GRASS]:  [125, 195, 100],
  [TERRAIN.FOREST]: [58,  138, 74],
  [TERRAIN.STONE]:  [138, 138, 138],
  [TERRAIN.WATER]:  [80,  170, 210],
  [TERRAIN.SAND]:   [222, 200, 150],
};
// Edge midpoint offsets (screen-space) for each cardinal neighbor, plus the
// neighbor's tile-coord delta. Names are compass directions in iso view.
const EDGE_DIRS = [
  { dx:  0, dy: -1, ex:  0.25, ey: -0.25 }, // NE — neighbor (x, y-1)
  { dx:  1, dy:  0, ex:  0.25, ey:  0.25 }, // SE — neighbor (x+1, y)
  { dx:  0, dy:  1, ex: -0.25, ey:  0.25 }, // SW — neighbor (x, y+1)
  { dx: -1, dy:  0, ex: -0.25, ey: -0.25 }, // NW — neighbor (x-1, y)
];
function drawEdgeBlends(cx, cy, x, y, w, h) {
  const myT = state.map[y][x];
  for (const d of EDGE_DIRS) {
    const nx = x + d.dx, ny = y + d.dy;
    if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE) continue;
    const nt = state.map[ny][nx];
    if (nt === myT) continue;
    const c = EDGE_BLEND_RGB[nt];
    if (!c) continue;
    // Water blends strongest (most visible), stone weakest so rocky transitions
    // stay crisp. Tuned by eye.
    const alpha = nt === TERRAIN.WATER ? 0.55 : nt === TERRAIN.STONE ? 0.35 : 0.45;
    const mx = cx + d.ex * w, my = cy + d.ey * h;
    const grad = ctx.createLinearGradient(mx, my, cx, cy);
    grad.addColorStop(0,    `rgba(${c[0]},${c[1]},${c[2]},${alpha})`);
    grad.addColorStop(0.85, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - h/2);
    ctx.lineTo(cx + w/2, cy);
    ctx.lineTo(cx, cy + h/2);
    ctx.lineTo(cx - w/2, cy);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = grad;
    ctx.fillRect(cx - w, cy - h, w*2, h*2);
    ctx.restore();
  }
}

// ─── Tile drawing ──────────────────────────────────────────────────────────
function drawTile(x, y) {
  const p = worldToScreen(x, y);
  const t = (state.time % state.dayLen) / state.dayLen;
  const terr = state.map[y][x];
  const color = terrainColors(terr, t, x, y);
  const tw = TILE_W * state.zoom, th = TILE_H * state.zoom;
  const depth = tileHeight(x, y) * state.zoom;
  // Lift top face by the tile's height so stacked blocks shade correctly.
  const cy = p.y - depth;
  drawTileBlock(p.x, cy, tw, th, color, depth, 'rgba(0,0,0,0.18)');
  // Edge blending — biomes bleed softly into each other at transitions.
  drawEdgeBlends(p.x, cy, x, y, tw, th);
  // Shore fringe on grass adjacent to water (sand-like band layered over blend)
  if (terr === TERRAIN.GRASS) maybeDrawShoreFringe(p.x, cy, x, y, tw, th);
  // Decoration per terrain (offset by tile height)
  if (terr === TERRAIN.FOREST) {
    drawTree(p.x, cy - 4 * state.zoom, state.zoom, x, y);
  } else if (terr === TERRAIN.STONE) {
    drawRock(p.x, cy - 2 * state.zoom, state.zoom, x, y);
  } else if (terr === TERRAIN.WATER) {
    drawWaterRipple(p.x, cy, tw, th, x, y);
  }
}
// 4-variant tree — pine tall, pine short, deciduous wide, bushy
function drawTree(cx, cy, sc, tx, ty) {
  const v = tx !== undefined ? treeVariant(tx, ty) : 0;
  const jitter = ((tx * 13 + ty * 17) & 7) - 3; // -3..+4 px x-jitter for variety
  const jy = ((tx * 7 + ty * 29) & 3) - 1;       // -1..+2 px y
  cx += jitter * sc * 0.4;
  cy += jy * sc * 0.3;
  if (v === 0) {
    // Tall pine — triangular foliage stacked
    ctx.fillStyle = '#5a3a1e';
    ctx.fillRect(cx - 1.5*sc, cy - 3*sc, 3*sc, 10*sc);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = ['#2e6a3c', '#3a8a4a', '#4aa05a'][i];
      ctx.beginPath();
      ctx.moveTo(cx, cy - 22*sc + i*6*sc);
      ctx.lineTo(cx + (7 - i*1.4)*sc, cy - 12*sc + i*5*sc);
      ctx.lineTo(cx - (7 - i*1.4)*sc, cy - 12*sc + i*5*sc);
      ctx.closePath(); ctx.fill();
    }
  } else if (v === 1) {
    // Short pine
    ctx.fillStyle = '#5a3a1e';
    ctx.fillRect(cx - 1.5*sc, cy - 2*sc, 3*sc, 7*sc);
    ctx.fillStyle = '#3a8a4a';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 16*sc);
    ctx.lineTo(cx + 8*sc, cy - 4*sc);
    ctx.lineTo(cx - 8*sc, cy - 4*sc);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4aa05a';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 11*sc);
    ctx.lineTo(cx + 6*sc, cy - 1*sc);
    ctx.lineTo(cx - 6*sc, cy - 1*sc);
    ctx.closePath(); ctx.fill();
  } else if (v === 2) {
    // Wide deciduous — broad oval canopy
    ctx.fillStyle = '#5a3a1e';
    ctx.fillRect(cx - 2*sc, cy - 4*sc, 4*sc, 10*sc);
    ctx.fillStyle = '#2e6a3c';
    ctx.beginPath(); ctx.ellipse(cx, cy - 12*sc, 11*sc, 9*sc, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#55a55e';
    ctx.beginPath(); ctx.ellipse(cx - 3*sc, cy - 14*sc, 6*sc, 5*sc, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#74c07e';
    ctx.beginPath(); ctx.ellipse(cx + 4*sc, cy - 15*sc, 4*sc, 4*sc, 0, 0, Math.PI*2); ctx.fill();
  } else {
    // Bushy / scrub
    ctx.fillStyle = '#5a3a1e';
    ctx.fillRect(cx - 1.5*sc, cy - 2*sc, 3*sc, 7*sc);
    ctx.fillStyle = '#3a7a48';
    ctx.beginPath(); ctx.arc(cx, cy - 8*sc, 6.5*sc, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#4a9052';
    ctx.beginPath(); ctx.arc(cx - 4*sc, cy - 11*sc, 4*sc, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 4*sc, cy - 10*sc, 4.5*sc, 0, Math.PI*2); ctx.fill();
  }
}
// Rock variants — different boulder shapes per tile so stone outcrops stop
// reading as a gray floor and start reading as a rocky area. Colors cover
// three weathered-stone shades; each boulder is a shaded pentagon with a
// light top-left highlight polygon and an optional moss speckle.
function rockVariant(tx, ty) { return ((tx * 31) ^ (ty * 17)) & 3; }
function drawRock(cx, cy, sc, tx, ty) {
  const v = tx !== undefined ? rockVariant(tx, ty) : 0;
  const jitter = ((tx * 13 + ty * 17) & 7) - 3;
  cx += jitter * sc * 0.4;
  // Four boulder archetypes — tuple of (base, highlight, shadow, rotation, scale).
  const stones = [
    // v0: one tall central boulder + small buddy on the right
    [[cx,       cy,      1.0, '#787480', '#9a96a4', '#4e4a56', 0],
     [cx + 7*sc, cy + 2*sc, 0.55, '#6e6a76', '#8a8692', '#4a4650', 0]],
    // v1: two boulders stacked
    [[cx - 4*sc, cy + 1*sc, 0.72, '#8a8692', '#a8a4b2', '#5a5664', 0],
     [cx + 2*sc, cy - 4*sc, 0.8, '#787480', '#989590', '#4a4650', 0]],
    // v2: flat wide slab + pebble
    [[cx,       cy + 1*sc, 1.1, '#6e6a76', '#8e8a96', '#454150', 1],
     [cx - 6*sc, cy - 2*sc, 0.45, '#585460', '#7a7682', '#3a3640', 0]],
    // v3: cluster of three small rocks
    [[cx - 5*sc, cy + 1*sc, 0.55, '#6e6a76', '#8a8692', '#4a4650', 0],
     [cx + 0*sc, cy - 3*sc, 0.6,  '#787480', '#989590', '#4e4a56', 0],
     [cx + 6*sc, cy + 0*sc, 0.5,  '#585460', '#7a7682', '#3a3640', 0]],
  ][v];
  for (const [rx, ry, s, base, hi, sh, flat] of stones) {
    // Base pentagon — slightly flattened for the "slab" variant.
    const ph = flat ? 0.55 : 1.0;
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.moveTo(rx - 7*s*sc, ry + 2*s*sc);
    ctx.lineTo(rx - 5.5*s*sc, ry - 5*s*sc*ph);
    ctx.lineTo(rx + 1*s*sc, ry - 6*s*sc*ph);
    ctx.lineTo(rx + 6*s*sc, ry - 2*s*sc*ph);
    ctx.lineTo(rx + 4*s*sc, ry + 3*s*sc);
    ctx.closePath();
    ctx.fill();
    // Top-left highlight polygon — light-source from upper-left
    ctx.fillStyle = hi;
    ctx.beginPath();
    ctx.moveTo(rx - 5.5*s*sc, ry - 5*s*sc*ph);
    ctx.lineTo(rx + 1*s*sc, ry - 6*s*sc*ph);
    ctx.lineTo(rx - 1*s*sc, ry - 3*s*sc*ph);
    ctx.lineTo(rx - 4*s*sc, ry - 2*s*sc*ph);
    ctx.closePath();
    ctx.fill();
    // Right-side shadow wedge
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.moveTo(rx + 6*s*sc, ry - 2*s*sc*ph);
    ctx.lineTo(rx + 4*s*sc, ry + 3*s*sc);
    ctx.lineTo(rx + 1.5*s*sc, ry + 0.5*s*sc);
    ctx.lineTo(rx + 3*s*sc, ry - 3*s*sc*ph);
    ctx.closePath();
    ctx.fill();
    // Dark outline — thin so the boulder reads crisp
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(rx - 7*s*sc, ry + 2*s*sc);
    ctx.lineTo(rx - 5.5*s*sc, ry - 5*s*sc*ph);
    ctx.lineTo(rx + 1*s*sc, ry - 6*s*sc*ph);
    ctx.lineTo(rx + 6*s*sc, ry - 2*s*sc*ph);
    ctx.lineTo(rx + 4*s*sc, ry + 3*s*sc);
    ctx.closePath();
    ctx.stroke();
    // Moss speckle — small green patch on some boulders (deterministic)
    if (((tx||0) * 7 + (ty||0) * 11 + Math.round(rx)) % 5 === 0) {
      ctx.fillStyle = 'rgba(90,140,70,0.55)';
      ctx.beginPath();
      ctx.ellipse(rx - 2*s*sc, ry - 4*s*sc*ph, 1.8*s*sc, 0.8*s*sc, 0, 0, Math.PI*2);
      ctx.fill();
    }
  }
}

// ─── Building rendering ────────────────────────────────────────────────────
function drawBuildingArt(b, cx, cy, sc, ghost = false) {
  const def = BUILDINGS[b.kind];
  const wPix = def.w * TILE_W * sc;
  const hPix = def.h * TILE_H * sc;
  const alpha = ghost ? 0.5 : 1;
  ctx.globalAlpha = alpha;
  // Soft elliptical drop shadow — radial gradient fades to transparent at
  // edges so buildings sit on their tile instead of floating.
  if (!ghost) {
    const sw = wPix * 0.75, sh = hPix * 0.75;
    ctx.save();
    const grad = ctx.createRadialGradient(cx, cy + 3*sc, sw * 0.15, cx, cy + 3*sc, sw * 0.85);
    grad.addColorStop(0, 'rgba(0,0,0,0.5)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 3*sc, sw, sh * 0.55, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
  // Foundation
  ctx.fillStyle = ghost ? '#88dd88' : '#7a5a3a';
  drawDiamond(cx, cy, wPix, hPix);
  // Per-building wind phase so flags on adjacent buildings don't wave in lockstep.
  const windPhase = state.tick * 0.18 + (b.id || 0);
  const flagWave = Math.sin(windPhase) * 2.5 * sc;   // tip x offset
  const flagCurl = Math.sin(windPhase * 1.3) * 1.2 * sc; // mid y curve
  // Building-specific art
  if (b.kind === 'TOWN_HALL') {
    // Castle body with merlons on the parapet.
    drawWalls(cx, cy, wPix * 0.8, hPix * 0.65, 30*sc, '#c48e5a', '#8a5a3a');
    // Parapet band above the walls
    ctx.fillStyle = '#a07450';
    ctx.fillRect(cx - wPix*0.4, cy - 17*sc, wPix*0.8, 2.5*sc);
    ctx.fillStyle = '#8a5a3a';
    // Crenellations — alternating teeth along the top
    for (let i = 0; i < 6; i++) {
      const tx = cx - wPix*0.4 + i * (wPix*0.8 / 6) + wPix*0.8 / 12;
      ctx.fillRect(tx - 2*sc, cy - 21*sc, 3*sc, 4*sc);
    }
    // Arched wooden door with iron bands
    ctx.fillStyle = '#5a3a1e';
    ctx.beginPath();
    ctx.moveTo(cx - 4*sc, cy - 1*sc);
    ctx.lineTo(cx - 4*sc, cy - 9*sc);
    ctx.quadraticCurveTo(cx, cy - 13*sc, cx + 4*sc, cy - 9*sc);
    ctx.lineTo(cx + 4*sc, cy - 1*sc);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#2a1a0e'; ctx.lineWidth = 0.6;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(cx - 4*sc, cy - 1*sc - i*2*sc);
      ctx.lineTo(cx + 4*sc, cy - 1*sc - i*2*sc);
      ctx.stroke();
    }
    // Slit windows flanking the door
    ctx.fillStyle = '#1a1228';
    ctx.fillRect(cx - 10*sc, cy - 11*sc, 1.5*sc, 5*sc);
    ctx.fillRect(cx + 8*sc, cy - 11*sc, 1.5*sc, 5*sc);
    // Central keep rising above the main body
    ctx.fillStyle = '#b88050';
    ctx.fillRect(cx - 5*sc, cy - 32*sc, 10*sc, 12*sc);
    ctx.fillStyle = '#8a5a3a';
    ctx.fillRect(cx - 5*sc, cy - 32*sc, 10*sc, 1.5*sc); // dark top band
    // Keep crenellations
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(cx - 5*sc + i * 3.5*sc, cy - 35*sc, 2.2*sc, 3*sc);
    }
    // Flag pole + waving banner
    ctx.fillStyle = '#aaa';
    ctx.fillRect(cx - 0.5*sc, cy - 48*sc, 1*sc, 14*sc);
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.moveTo(cx + 0.5*sc, cy - 48*sc);
    ctx.quadraticCurveTo(
      cx + 5*sc + flagWave, cy - 45*sc + flagCurl,
      cx + 10*sc + flagWave, cy - 44*sc
    );
    ctx.quadraticCurveTo(
      cx + 5*sc + flagWave, cy - 41*sc + flagCurl,
      cx + 0.5*sc, cy - 40*sc
    );
    ctx.closePath(); ctx.fill();
    // Chimney on the keep
    drawChimney(cx, cy, sc, 6, -32);
  } else if (b.kind === 'HOUSE') {
    drawWalls(cx, cy, wPix * 0.7, hPix * 0.62, 16*sc, '#d4a574', '#8a3a2a');
    // Door with frame
    ctx.fillStyle = '#3a2412';
    ctx.fillRect(cx - 2.4*sc, cy - 7*sc, 4.8*sc, 8*sc);
    ctx.fillStyle = '#5a3a1e';
    ctx.fillRect(cx - 2*sc, cy - 6.5*sc, 4*sc, 7.5*sc);
    // Door handle
    ctx.fillStyle = '#d4b060';
    ctx.fillRect(cx + 1.2*sc, cy - 3*sc, 0.6*sc, 0.6*sc);
    // Window with cross mullion
    ctx.fillStyle = '#3a2412'; ctx.fillRect(cx + 5*sc, cy - 11*sc, 4*sc, 4*sc);
    ctx.fillStyle = '#f6c56b'; ctx.fillRect(cx + 5.4*sc, cy - 10.6*sc, 3.2*sc, 3.2*sc);
    ctx.strokeStyle = '#3a2412'; ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx + 7*sc, cy - 10.6*sc); ctx.lineTo(cx + 7*sc, cy - 7.4*sc);
    ctx.moveTo(cx + 5.4*sc, cy - 9*sc);  ctx.lineTo(cx + 8.6*sc, cy - 9*sc);
    ctx.stroke();
    // Flower box under the window
    ctx.fillStyle = '#5a3a1e';
    ctx.fillRect(cx + 4.6*sc, cy - 7*sc, 4.8*sc, 1.2*sc);
    ctx.fillStyle = '#e85a5a';
    ctx.beginPath(); ctx.arc(cx + 5.5*sc, cy - 7.2*sc, 0.6*sc, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#f6c56b';
    ctx.beginPath(); ctx.arc(cx + 7*sc, cy - 7.2*sc, 0.6*sc, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#9a4fbf';
    ctx.beginPath(); ctx.arc(cx + 8.3*sc, cy - 7.2*sc, 0.6*sc, 0, Math.PI*2); ctx.fill();
    // Chimney on the roof ridge
    drawChimney(cx, cy, sc, -5, -14, 2.4, 6);
  } else if (b.kind === 'LUMBERYARD') {
    drawWalls(cx, cy, wPix * 0.72, hPix * 0.55, 16*sc, '#a87a4e', '#6a4a2e');
    // Sawhorse on the left — two crossed legs with a plank on top.
    ctx.strokeStyle = '#5a3a1e'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 20*sc, cy - 6*sc); ctx.lineTo(cx - 16*sc, cy - 1*sc);
    ctx.moveTo(cx - 16*sc, cy - 6*sc); ctx.lineTo(cx - 20*sc, cy - 1*sc);
    ctx.stroke();
    ctx.fillStyle = '#8a5a3a';
    ctx.fillRect(cx - 22*sc, cy - 7*sc, 8*sc, 1.4*sc);
    // Logs stacked on the right — round ends visible.
    for (let i = 0; i < 3; i++) {
      const ly = cy - 3*sc - i * 2.2*sc;
      ctx.fillStyle = '#7a4a24';
      ctx.fillRect(cx + 10*sc, ly, 10*sc, 2*sc);
      ctx.fillStyle = '#c4a070';
      ctx.beginPath(); ctx.arc(cx + 10*sc, ly + 1*sc, 1*sc, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#8a5a3a';
      ctx.beginPath(); ctx.arc(cx + 10*sc, ly + 1*sc, 0.5*sc, 0, Math.PI*2); ctx.fill();
    }
    // Wood chips on the ground
    ctx.fillStyle = '#c4a070';
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(cx - 18*sc + i * 3*sc, cy + 1*sc + (i%2)*sc, 1.2*sc, 0.6*sc);
    }
    // Chimney (for the drying furnace)
    drawChimney(cx, cy, sc, -6, -14);
  } else if (b.kind === 'FARM') {
    // Wooden fence posts around the field perimeter
    ctx.fillStyle = '#6a4a2e';
    for (let i = 0; i < 4; i++) {
      const fx = cx - wPix*0.4 + i * (wPix*0.8 / 3);
      ctx.fillRect(fx - 0.5*sc, cy + 8*sc, 1*sc, 3*sc);
    }
    // Plowed rows — alternating dark/light soil with crop tufts.
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      const ry = cy + (r - 1.5) * 5*sc;
      const rx = cx + (r - 1.5) * 8*sc;
      ctx.fillStyle = r % 2 === 0 ? '#6e4a28' : '#8a5a34';
      drawDiamond(rx, ry, wPix * 0.35, hPix * 0.18);
      // Wheat tufts
      ctx.strokeStyle = '#d4a040'; ctx.lineWidth = 0.7;
      ctx.fillStyle = '#f4d06f';
      for (let j = 0; j < 5; j++) {
        const wx = rx - 8*sc + j * 3.4*sc;
        const wy = ry - 1*sc;
        ctx.beginPath();
        ctx.moveTo(wx, wy + 3*sc);
        ctx.lineTo(wx, wy - 4*sc);
        ctx.stroke();
        ctx.fillRect(wx - 0.6*sc, wy - 5*sc, 1.2*sc, 1.6*sc);
      }
    }
    // Scarecrow at the top corner
    const scx = cx + wPix*0.3, scy = cy - 6*sc;
    ctx.fillStyle = '#8a5a3a';
    ctx.fillRect(scx - 0.4*sc, scy, 0.8*sc, 8*sc);         // pole
    ctx.fillRect(scx - 3*sc, scy + 2*sc, 6*sc, 0.8*sc);    // crossbar
    ctx.fillStyle = '#c4a070';
    ctx.beginPath(); ctx.arc(scx, scy - 0.5*sc, 1.6*sc, 0, Math.PI*2); ctx.fill(); // head
    ctx.fillStyle = '#5a3a1e';                              // hat
    ctx.fillRect(scx - 1.8*sc, scy - 2.2*sc, 3.6*sc, 0.8*sc);
    ctx.beginPath();
    ctx.moveTo(scx - 1.2*sc, scy - 2.2*sc);
    ctx.lineTo(scx, scy - 3.6*sc);
    ctx.lineTo(scx + 1.2*sc, scy - 2.2*sc);
    ctx.closePath(); ctx.fill();
  } else if (b.kind === 'QUARRY') {
    // Pit with soft gradient floor.
    const grad = ctx.createRadialGradient(cx, cy - 1*sc, 2*sc, cx, cy - 1*sc, wPix * 0.5);
    grad.addColorStop(0, '#2a252e');
    grad.addColorStop(1, '#4a454f');
    ctx.fillStyle = grad;
    drawDiamond(cx, cy, wPix * 0.8, hPix * 0.6);
    // Scaffolding — two wooden planks on supports along the left edge.
    ctx.strokeStyle = '#6a4a2e'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 14*sc, cy - 2*sc); ctx.lineTo(cx - 14*sc, cy - 10*sc);
    ctx.moveTo(cx - 8*sc,  cy - 3*sc); ctx.lineTo(cx - 8*sc,  cy - 11*sc);
    ctx.stroke();
    ctx.fillStyle = '#8a5a3a';
    ctx.fillRect(cx - 16*sc, cy - 11*sc, 10*sc, 1.4*sc);
    // Rocks — piles of chunked stone with highlights.
    for (let i = 0; i < 6; i++) {
      const rx = cx + ((i * 73) % 20 - 10) * sc;
      const ry = cy - 1*sc + ((i * 41) % 8 - 4) * sc;
      const rs = 2.4 + (i % 3) * 0.8;
      ctx.fillStyle = ['#9a9aa2', '#7a7a82', '#6a6a72'][i % 3];
      ctx.beginPath(); ctx.arc(rx, ry, rs*sc, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.arc(rx - 0.8*sc, ry - 0.8*sc, rs*0.4*sc, 0, Math.PI*2); ctx.fill();
    }
    // Minecart on the right
    ctx.fillStyle = '#3a2412';
    ctx.fillRect(cx + 8*sc, cy - 2*sc, 8*sc, 4*sc);
    ctx.fillStyle = '#6a6a72';  // stones inside
    ctx.fillRect(cx + 9*sc, cy - 3*sc, 6*sc, 1.5*sc);
    ctx.fillStyle = '#1a1228';
    ctx.beginPath(); ctx.arc(cx + 9*sc, cy + 2*sc, 1.2*sc, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 15*sc, cy + 2*sc, 1.2*sc, 0, Math.PI*2); ctx.fill();
  } else if (b.kind === 'MARKET') {
    drawWalls(cx, cy, wPix * 0.62, hPix * 0.55, 11*sc, '#e8b876', '#8a5a3a');
    // Striped awning (red/white) instead of flat red
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - wPix*0.38, cy - 12*sc);
    ctx.lineTo(cx + wPix*0.38, cy - 12*sc);
    ctx.lineTo(cx + wPix*0.32, cy - 19*sc);
    ctx.lineTo(cx - wPix*0.32, cy - 19*sc);
    ctx.closePath();
    ctx.clip();
    const stripeW = 4 * sc;
    const span = wPix * 0.76;
    for (let i = 0; i < span / stripeW; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#e85a5a' : '#f4ecdb';
      ctx.fillRect(cx - wPix*0.38 + i * stripeW, cy - 19*sc, stripeW, 8*sc);
    }
    ctx.restore();
    // Awning edge line
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx - wPix*0.38, cy - 12*sc);
    ctx.lineTo(cx + wPix*0.38, cy - 12*sc);
    ctx.stroke();
    // Barrels (left)
    for (let i = 0; i < 2; i++) {
      const bx = cx - 15*sc + i * 5*sc, by = cy;
      ctx.fillStyle = '#8a5a3a';
      ctx.fillRect(bx - 2*sc, by - 4*sc, 4*sc, 6*sc);
      ctx.strokeStyle = '#2a1a0e'; ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(bx - 2*sc, by - 2.5*sc); ctx.lineTo(bx + 2*sc, by - 2.5*sc);
      ctx.moveTo(bx - 2*sc, by - 1*sc);   ctx.lineTo(bx + 2*sc, by - 1*sc);
      ctx.stroke();
    }
    // Fruit basket (right)
    ctx.fillStyle = '#8a5a3a';
    ctx.fillRect(cx + 12*sc, cy - 3*sc, 6*sc, 4*sc);
    const fruitColors = ['#e85a5a', '#f6c56b', '#9a4fbf', '#7ce27c'];
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = fruitColors[i];
      ctx.beginPath();
      ctx.arc(cx + 13*sc + (i%2)*2*sc, cy - 4*sc + Math.floor(i/2)*1.3*sc, 0.9*sc, 0, Math.PI*2);
      ctx.fill();
    }
    // Coin sign
    ctx.fillStyle = '#f6c56b';
    ctx.beginPath(); ctx.arc(cx, cy - 5*sc, 2.5*sc, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#b8893f'; ctx.lineWidth = 0.6; ctx.stroke();
  } else if (b.kind === 'WELL') {
    // Stone ring — two tones for depth
    ctx.fillStyle = '#5a5660';
    ctx.beginPath(); ctx.ellipse(cx, cy - 1*sc, 13*sc, 6.5*sc, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#8a8692';
    ctx.beginPath(); ctx.ellipse(cx, cy - 2*sc, 12*sc, 6*sc, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#4fb3d9';
    ctx.beginPath(); ctx.ellipse(cx, cy - 3*sc, 9*sc, 4*sc, 0, 0, Math.PI*2); ctx.fill();
    // Water ripple highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.ellipse(cx - 2*sc, cy - 3.5*sc, 3*sc, 1*sc, 0, 0, Math.PI*2); ctx.stroke();
    // Wooden supports for the winch
    ctx.fillStyle = '#6a4a2e';
    ctx.fillRect(cx - 8*sc, cy - 16*sc, 1.5*sc, 14*sc);
    ctx.fillRect(cx + 6.5*sc, cy - 16*sc, 1.5*sc, 14*sc);
    // Winch handle
    ctx.fillStyle = '#8a5a3a';
    ctx.fillRect(cx - 8*sc, cy - 16*sc, 17*sc, 1.4*sc);
    // Rope + bucket
    ctx.strokeStyle = '#3a2412'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(cx, cy - 15*sc); ctx.lineTo(cx, cy - 7*sc); ctx.stroke();
    ctx.fillStyle = '#6a4a2e';
    ctx.fillRect(cx - 2*sc, cy - 7*sc, 4*sc, 3*sc);
    // Peaked roof with shading
    ctx.fillStyle = '#8a5a3a';
    ctx.beginPath();
    ctx.moveTo(cx - 10*sc, cy - 16*sc);
    ctx.lineTo(cx, cy - 24*sc);
    ctx.lineTo(cx + 10*sc, cy - 16*sc);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#6a4020';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 24*sc);
    ctx.lineTo(cx + 10*sc, cy - 16*sc);
    ctx.lineTo(cx, cy - 16*sc);
    ctx.closePath(); ctx.fill();
  } else if (b.kind === 'WATCHTOWER') {
    // Three stone segments — base → mid → top — each slightly darker.
    ctx.fillStyle = '#9a8a6a';
    ctx.fillRect(cx - 9*sc, cy - 14*sc, 18*sc, 14*sc);
    ctx.fillStyle = '#7a6a50';
    ctx.fillRect(cx - 8*sc, cy - 28*sc, 16*sc, 14*sc);
    ctx.fillStyle = '#6a5a3e';
    ctx.fillRect(cx - 7*sc, cy - 40*sc, 14*sc, 12*sc);
    // Stone block lines
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.5;
    for (let seg = 0; seg < 3; seg++) {
      const top = cy - (14 + seg * 14)*sc;
      const halfw = (9 - seg) * sc;
      for (let y = 2; y < 12; y += 3) {
        const off = (y % 2 === 0) ? 0 : halfw / 2;
        ctx.beginPath();
        ctx.moveTo(cx - halfw, top + y*sc);
        ctx.lineTo(cx + halfw, top + y*sc);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - halfw + off, top + y*sc);
        ctx.lineTo(cx - halfw + off, top + (y + 3)*sc);
        ctx.stroke();
      }
    }
    // Arrow slits at each tier
    ctx.fillStyle = '#1a1228';
    ctx.fillRect(cx - 0.8*sc, cy - 11*sc, 1.6*sc, 3.5*sc);
    ctx.fillRect(cx - 0.8*sc, cy - 25*sc, 1.6*sc, 3.5*sc);
    // Wooden viewing platform with railing
    ctx.fillStyle = '#6a4a2e';
    ctx.fillRect(cx - 11*sc, cy - 41*sc, 22*sc, 3*sc);
    ctx.strokeStyle = '#3a2412'; ctx.lineWidth = 0.8;
    for (let i = 0; i < 5; i++) {
      const rx = cx - 10*sc + i * 5*sc;
      ctx.beginPath();
      ctx.moveTo(rx, cy - 41*sc); ctx.lineTo(rx, cy - 45*sc);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - 10*sc, cy - 45*sc); ctx.lineTo(cx + 10*sc, cy - 45*sc);
    ctx.stroke();
    // Flag pole + banner
    ctx.fillStyle = '#aaa';
    ctx.fillRect(cx - 0.5*sc, cy - 54*sc, 1*sc, 10*sc);
    ctx.fillStyle = '#4fb3d9';
    ctx.beginPath();
    ctx.moveTo(cx + 0.5*sc, cy - 54*sc);
    ctx.quadraticCurveTo(
      cx + 4*sc + flagWave * 0.7, cy - 51*sc + flagCurl * 0.7,
      cx + 8*sc + flagWave * 0.7, cy - 50*sc
    );
    ctx.quadraticCurveTo(
      cx + 4*sc + flagWave * 0.7, cy - 48*sc + flagCurl * 0.7,
      cx + 0.5*sc, cy - 48*sc
    );
    ctx.closePath(); ctx.fill();
  }
  // Night glow — warm window flicker on completed inhabited buildings when
  // the sun is down. Cheap: a couple shadow-blurred dots per structure.
  if (!ghost && b.constructed) {
    const t = (state.time % state.dayLen) / state.dayLen;
    const dayness = 0.5 + 0.5 * Math.sin((t - 0.25) * Math.PI * 2); // 0 midnight, 1 noon
    if (dayness < 0.45) {
      const glow = (0.45 - dayness) / 0.45;  // 0..1 as night deepens
      ctx.save();
      ctx.shadowColor = 'rgba(255,190,100,0.85)';
      ctx.shadowBlur = 12 * sc * glow;
      ctx.fillStyle = `rgba(255,210,120,${0.65 + 0.3 * glow})`;
      const flick = 1 + 0.15 * Math.sin(state.time * 4 + b.id);
      if (b.kind === 'TOWN_HALL') {
        ctx.fillRect(cx - 4*sc, cy - 16*sc, 3*sc * flick, 3*sc);
        ctx.fillRect(cx + 2*sc, cy - 16*sc, 3*sc * flick, 3*sc);
      } else if (b.kind === 'HOUSE' || b.kind === 'MARKET') {
        ctx.fillRect(cx + 5*sc, cy - 10*sc, 3*sc * flick, 3*sc);
      } else if (b.kind === 'WATCHTOWER') {
        ctx.fillRect(cx - 3*sc, cy - 38*sc, 2*sc, 2*sc);
        ctx.fillRect(cx + 1*sc, cy - 38*sc, 2*sc, 2*sc);
      } else if (b.kind === 'LUMBERYARD' || b.kind === 'FARM') {
        ctx.fillRect(cx - 6*sc, cy - 8*sc, 2.5*sc * flick, 2.5*sc);
      }
      ctx.restore();
    }
  }
  // Chimney smoke — constant rising puffs on completed inhabited buildings.
  // Each puff lives `lifetime` frames; 5 staggered puffs give a continuous
  // plume. Time-of-day modulates output (fires burn hotter at night).
  if (!ghost && b.constructed && CHIMNEY_SPOTS[b.kind]) {
    const spot = CHIMNEY_SPOTS[b.kind];
    const chx = cx + spot[0] * sc;
    const chy = cy + spot[1] * sc;
    const t = (state.time % state.dayLen) / state.dayLen;
    const dayness = 0.5 + 0.5 * Math.sin((t - 0.25) * Math.PI * 2);
    const nightBoost = 0.6 + 0.4 * (1 - dayness); // warmer at night
    const lifetime = 120;
    for (let i = 0; i < 5; i++) {
      const age = (state.tick + (b.id || 0) * 11 + i * 24) % lifetime;
      const phase = age / lifetime;
      const rise = phase * 26 * sc;
      const drift = Math.sin(phase * Math.PI * 2 + (b.id || 0)) * 2.5 * sc;
      const alpha = (1 - phase) * 0.38 * nightBoost;
      const radius = (1.2 + phase * 2.4) * sc;
      ctx.fillStyle = `rgba(210,210,215,${alpha})`;
      ctx.beginPath();
      ctx.arc(chx + drift, chy - rise, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Construction overlay
  if (!b.constructed) {
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#000';
    drawDiamond(cx, cy, wPix, hPix);
    ctx.globalAlpha = 1;
    // Construction dust — 3 tan orbs orbiting the progress arc, implying
    // active work. Faster orbit when progress is higher (more workers).
    const orbitSpeed = 0.05 + b.progress * 0.08;
    for (let i = 0; i < 3; i++) {
      const a = state.tick * orbitSpeed + (i * Math.PI * 2 / 3);
      const dx = Math.cos(a) * 14 * sc;
      const dy = Math.sin(a) * 6 * sc; // squashed for iso perspective
      ctx.fillStyle = `rgba(222,190,140,${0.55 + 0.35 * Math.sin(a * 2)})`;
      ctx.beginPath();
      ctx.arc(cx + dx, cy - 6*sc + dy, 2 * sc, 0, Math.PI * 2);
      ctx.fill();
    }
    // Progress arc
    ctx.strokeStyle = '#f6c56b'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy - 10*sc, 10*sc, -Math.PI/2, -Math.PI/2 + Math.PI*2*b.progress);
    ctx.stroke();
    ctx.fillStyle = '#f6c56b'; ctx.font = `bold ${11*sc}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(Math.floor(b.progress * 100) + '%', cx, cy - 6*sc);
  }
  ctx.globalAlpha = 1;
}
// Relative chimney top positions per building kind — smoke rises from here.
// Kept in sync with drawChimney calls inside each building's art block.
const CHIMNEY_SPOTS = {
  HOUSE:      [-5, -21],
  TOWN_HALL:  [6, -39],
  LUMBERYARD: [-6, -21],
};
// Walls — two-tone shaded rectangle with a peaked roof that also has a
// highlight slope and a shadow slope. Light from upper-left.
function drawWalls(cx, cy, wallW, wallH, roofH, bodyColor, roofColor) {
  const halfW = wallW / 2;
  const wallTop = cy - roofH * 0.55;
  // Body — lit half
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.moveTo(cx - halfW, cy);
  ctx.lineTo(cx - halfW, wallTop);
  ctx.lineTo(cx + halfW, wallTop);
  ctx.lineTo(cx + halfW, cy);
  ctx.closePath(); ctx.fill();
  // Body — shadow half overlay (right side, diagonal wash)
  ctx.fillStyle = darkenRgb(hexToRgb(bodyColor), 0.75);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + halfW, cy);
  ctx.lineTo(cx + halfW, wallTop);
  ctx.lineTo(cx, wallTop);
  ctx.closePath(); ctx.fill();
  // Subtle plank/brick texture — faint horizontal lines across the wall
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.6;
  for (let y = wallTop + 3; y < cy - 1; y += 4) {
    ctx.beginPath();
    ctx.moveTo(cx - halfW + 1, y);
    ctx.lineTo(cx + halfW - 1, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
  ctx.strokeRect(cx - halfW, wallTop, wallW, roofH * 0.55);

  // Roof — left slope (lit)
  ctx.fillStyle = roofColor;
  ctx.beginPath();
  ctx.moveTo(cx - halfW - 2, wallTop);
  ctx.lineTo(cx, cy - roofH);
  ctx.lineTo(cx, wallTop);
  ctx.closePath(); ctx.fill();
  // Roof — right slope (shadow)
  ctx.fillStyle = darkenRgb(hexToRgb(roofColor), 0.68);
  ctx.beginPath();
  ctx.moveTo(cx, wallTop);
  ctx.lineTo(cx, cy - roofH);
  ctx.lineTo(cx + halfW + 2, wallTop);
  ctx.closePath(); ctx.fill();
  // Roof shingle lines — thin stripes following slope
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.6;
  for (let i = 1; i <= 3; i++) {
    const ratio = i / 4;
    const yLeft = wallTop - (roofH - roofH * 0.55) * ratio;
    ctx.beginPath();
    ctx.moveTo(cx - halfW - 2 + (halfW + 2) * ratio, yLeft);
    ctx.lineTo(cx + halfW + 2 - (halfW + 2) * ratio, yLeft);
    ctx.stroke();
  }
  // Ridge line
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - roofH);
  ctx.lineTo(cx, wallTop);
  ctx.stroke();
}
// Draw a small stone chimney at (ox, oy) offset from building center.
function drawChimney(cx, cy, sc, ox, oy, w = 3, h = 7) {
  const x = cx + ox * sc, y = cy + oy * sc;
  ctx.fillStyle = '#6a5a50';
  ctx.fillRect(x - w*sc/2, y - h*sc, w*sc, h*sc);
  ctx.fillStyle = '#4a3e38';
  ctx.fillRect(x - w*sc/2, y - (h+0.5)*sc, w*sc, 0.9*sc);
  // Brick lines
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.5;
  for (let i = 1; i < h; i += 2) {
    ctx.beginPath();
    ctx.moveTo(x - w*sc/2, y - i*sc);
    ctx.lineTo(x + w*sc/2, y - i*sc);
    ctx.stroke();
  }
}

// ─── Colonist rendering ────────────────────────────────────────────────────
// Tool sprites for working colonists. Drawn in the "front" hand.
const JOB_TOOLS = {
  LUMBERYARD: 'axe',
  QUARRY:     'pick',
  FARM:       'scythe',
  MARKET:     'coin',
  TOWN_HALL:  null,
  HOUSE:      null,
  WELL:       null,
  WATCHTOWER: 'spear',
};
function drawColonist(c) {
  const p = worldToScreen(c.x, c.y);
  const sc = state.zoom;
  // Lift the colonist onto whatever tile they're standing on.
  const lift = tileHeight(Math.floor(c.x), Math.floor(c.y)) * sc;
  p.y -= lift;
  // Movement vector → facing and walk amount. Walk distance is accumulated
  // on the colonist object in update(), so the step cycle advances only
  // when actually moving (idle villagers stand still).
  const dx = c.targetX - c.x, dy = c.targetY - c.y;
  const moving = Math.hypot(dx, dy) > 0.04;
  // Face: -1 = left-facing, +1 = right-facing. Derived from iso x delta.
  const face = (dx - dy) >= 0 ? 1 : -1;
  const walkPhase = (c.walkDist || 0) * 9;
  const step = moving ? Math.sin(walkPhase) : 0;
  // Pose values
  const bob    = moving ? Math.abs(Math.cos(walkPhase)) * 0.8 * sc : Math.sin(state.time * 2 + c.id) * 0.3 * sc;
  const legA   = step *  2.2 * sc;
  const legB   = step * -2.2 * sc;
  const armA   = step * -2.8 * sc;
  const armB   = step *  2.8 * sc;

  // Soft drop shadow (elliptical, squashed for iso perspective)
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 1*sc, 4*sc, 1.6*sc, 0, 0, Math.PI*2);
  ctx.fill();

  // Legs — behind the body, so draw first.
  ctx.fillStyle = '#3a2a48';
  ctx.fillRect(p.x - 2.4*sc + legA, p.y - 3*sc, 2*sc, 3.5*sc);
  ctx.fillRect(p.x + 0.4*sc + legB, p.y - 3*sc, 2*sc, 3.5*sc);
  // Boots — tiny darker caps
  ctx.fillStyle = '#1a1228';
  ctx.fillRect(p.x - 2.6*sc + legA, p.y - 0.4*sc, 2.4*sc, 1.1*sc);
  ctx.fillRect(p.x + 0.2*sc + legB, p.y - 0.4*sc, 2.4*sc, 1.1*sc);

  // Back arm — partially hidden behind torso
  const shirt = c.color || '#6aa8e0';
  const shirtShade = darkenRgb(shirt.startsWith('#') ? hexToRgb(shirt) : shirt, 0.72);
  ctx.fillStyle = shirtShade;
  ctx.fillRect(p.x + (face > 0 ? -3.6 : 2.6)*sc, p.y - 8*sc + armB - bob, 1.8*sc, 5*sc);

  // Torso — tapered rectangle via trapezoid path for shoulders.
  ctx.fillStyle = shirt;
  ctx.beginPath();
  ctx.moveTo(p.x - 2.6*sc, p.y - 3*sc);               // lower-left hip
  ctx.lineTo(p.x + 2.6*sc, p.y - 3*sc);               // lower-right hip
  ctx.lineTo(p.x + 3.0*sc, p.y - 8.5*sc);             // upper-right shoulder
  ctx.lineTo(p.x - 3.0*sc, p.y - 8.5*sc);             // upper-left shoulder
  ctx.closePath();
  ctx.fill();
  // Torso shading — darker band along the shadow-facing side
  ctx.fillStyle = shirtShade;
  ctx.beginPath();
  ctx.moveTo(p.x + (face > 0 ? 0.4 : -2.6)*sc, p.y - 3*sc);
  ctx.lineTo(p.x + (face > 0 ? 2.6 : -0.4)*sc, p.y - 3*sc);
  ctx.lineTo(p.x + (face > 0 ? 3.0 : -0.6)*sc, p.y - 8.5*sc);
  ctx.lineTo(p.x + (face > 0 ? 0.6 : -3.0)*sc, p.y - 8.5*sc);
  ctx.closePath();
  ctx.fill();
  // Belt
  ctx.fillStyle = '#5a3a1e';
  ctx.fillRect(p.x - 2.6*sc, p.y - 3.8*sc, 5.2*sc, 0.8*sc);

  // Front arm + optional tool. Drawn last so it sits on top of the torso.
  ctx.fillStyle = shirt;
  const frontArmX = p.x + (face > 0 ? 2.4 : -4.2)*sc;
  ctx.fillRect(frontArmX, p.y - 8*sc + armA - bob, 1.8*sc, 5*sc);
  // Hand — small skin circle at the arm tip
  ctx.fillStyle = '#f4c7a0';
  ctx.beginPath();
  ctx.arc(frontArmX + 0.9*sc, p.y - 3.2*sc + armA - bob, 0.95*sc, 0, Math.PI*2);
  ctx.fill();
  // Tool
  if (c.job && JOB_TOOLS[c.job]) {
    drawColonistTool(JOB_TOOLS[c.job], frontArmX + 0.9*sc, p.y - 3.2*sc + armA - bob, sc, face, walkPhase);
  }

  // Head
  ctx.fillStyle = '#f4c7a0';
  ctx.beginPath();
  ctx.arc(p.x + face * 0.2*sc, p.y - 10.2*sc - bob, 2.4*sc, 0, Math.PI*2);
  ctx.fill();
  // Face shading on the shadow side
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.arc(p.x + face * -1.1*sc, p.y - 10.2*sc - bob, 1.4*sc, 0, Math.PI*2);
  ctx.fill();
  // Hair / hood — darker cap hugging the crown
  const hairColors = ['#3a2755', '#5a3a1e', '#2a1a1a', '#6a4020'];
  ctx.fillStyle = hairColors[c.id % hairColors.length];
  ctx.beginPath();
  ctx.arc(p.x + face * 0.2*sc, p.y - 11.6*sc - bob, 2.4*sc, Math.PI * 1.05, Math.PI * 1.95, false);
  ctx.lineTo(p.x + face * 0.2*sc + 2.4*sc, p.y - 11.6*sc - bob);
  ctx.closePath();
  ctx.fill();
  // Eye — one dot facing forward
  ctx.fillStyle = '#1a1228';
  ctx.fillRect(p.x + face * 1.1*sc, p.y - 10.4*sc - bob, 0.7*sc, 0.7*sc);
}
function drawColonistTool(kind, hx, hy, sc, face, walkPhase) {
  // Subtle tool bob so it swings slightly with the step cycle.
  const wobble = Math.sin(walkPhase * 2) * 0.4 * sc;
  ctx.save();
  ctx.translate(hx, hy + wobble);
  if (kind === 'axe') {
    ctx.fillStyle = '#6a3a1e';
    ctx.fillRect(-0.5*sc, -7*sc, 1*sc, 8*sc);
    ctx.fillStyle = '#9a9a9a';
    ctx.beginPath();
    ctx.moveTo(-0.5*sc, -7*sc);
    ctx.lineTo(2.8*sc * face, -7.8*sc);
    ctx.lineTo(2.2*sc * face, -5.2*sc);
    ctx.lineTo(0.5*sc, -5*sc);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#4a4a4a'; ctx.lineWidth = 0.6; ctx.stroke();
  } else if (kind === 'pick') {
    ctx.fillStyle = '#6a3a1e';
    ctx.fillRect(-0.5*sc, -7*sc, 1*sc, 8*sc);
    ctx.strokeStyle = '#8a8a94'; ctx.lineWidth = 1.4*sc;
    ctx.beginPath();
    ctx.moveTo(-2.8*sc * face, -7.5*sc);
    ctx.lineTo(2.8*sc * face, -6.5*sc);
    ctx.stroke();
  } else if (kind === 'scythe') {
    ctx.fillStyle = '#6a3a1e';
    ctx.fillRect(-0.5*sc, -8*sc, 1*sc, 9*sc);
    ctx.strokeStyle = '#bfbfbf'; ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(1.5*sc * face, -8*sc, 4*sc, Math.PI * 0.9, Math.PI * 1.6, face < 0);
    ctx.stroke();
  } else if (kind === 'spear') {
    ctx.fillStyle = '#6a3a1e';
    ctx.fillRect(-0.3*sc, -10*sc, 0.8*sc, 11*sc);
    ctx.fillStyle = '#d4d4dc';
    ctx.beginPath();
    ctx.moveTo(-0.5*sc, -10*sc);
    ctx.lineTo(0.5*sc, -10*sc);
    ctx.lineTo(0, -12.5*sc);
    ctx.closePath(); ctx.fill();
  } else if (kind === 'coin') {
    ctx.fillStyle = '#f6c56b';
    ctx.beginPath();
    ctx.arc(1.5*sc * face, -4.5*sc, 1.4*sc, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#b8893f'; ctx.lineWidth = 0.5; ctx.stroke();
  }
  ctx.restore();
}
// Accept hex strings in darkenRgb — needed for colonist shirt shading.
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 'rgb(120,120,120)';
  return `rgb(${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)})`;
}

// ─── Can place check ──────────────────────────────────────────────────────
function canPlace(kind, tx, ty) {
  const def = BUILDINGS[kind];
  if (!def) return false;
  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) {
      const x = tx + dx, y = ty + dy;
      if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) return false;
      const t = state.map[y][x];
      if (t === TERRAIN.WATER) return false;
      // Cannot overlap existing building
      for (const b of state.buildings) {
        const bd = BUILDINGS[b.kind];
        if (x >= b.x && x < b.x + bd.w && y >= b.y && y < b.y + bd.h) return false;
      }
    }
  }
  // Type-specific adjacency rules
  if (kind === 'QUARRY') {
    let touchesStone = false;
    for (let dy = -1; dy <= def.h; dy++)
      for (let dx = -1; dx <= def.w; dx++) {
        const x = tx + dx, y = ty + dy;
        if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) continue;
        if (state.map[y][x] === TERRAIN.STONE) touchesStone = true;
      }
    if (!touchesStone) return false;
  }
  return true;
}
function canAfford(kind) {
  const def = BUILDINGS[kind];
  for (const res in def.cost) if ((state.resources[res] || 0) < def.cost[res]) return false;
  return true;
}

// ─── Place building ───────────────────────────────────────────────────────
function placeBuilding(kind, tx, ty) {
  if (!canPlace(kind, tx, ty) || !canAfford(kind)) return false;
  const def = BUILDINGS[kind];
  for (const res in def.cost) state.resources[res] -= def.cost[res];
  const b = { id: state.nextId++, kind, x: tx, y: ty, constructed: false, progress: 0, workers: [] };
  state.buildings.push(b);
  if (def.houses) state.capacity.pop += def.houses;
  toast(`${def.name} placed — colonists will build it.`);
  return true;
}

// ─── Update — tick simulation ─────────────────────────────────────────────
let lastT = performance.now();
function update(dt) {
  state.time += dt;
  // Construct buildings (need nearby colonist OR TownHall's starting crew)
  for (const b of state.buildings) {
    if (b.constructed) continue;
    // Progress on construction. Town Hall completes itself on flat grass.
    const speed = 0.05 + (state.pop * 0.01);
    b.progress = Math.min(1, b.progress + dt * speed);
    if (b.progress >= 1) {
      b.constructed = true;
      toast(`${BUILDINGS[b.kind].name} complete!`);
      // On town hall complete, spawn 3 colonists
      if (b.kind === 'TOWN_HALL' && state.colonists.length === 0) {
        for (let i = 0; i < 3; i++) spawnColonist(b);
      }
    }
  }
  // Recompute capacity from completed houses
  let cap = 0;
  for (const b of state.buildings) if (b.constructed && BUILDINGS[b.kind].houses) cap += BUILDINGS[b.kind].houses;
  state.capacity.pop = cap;
  // Spawn colonists if we have pop capacity + food
  const spawnInterval = 8; // sec between spawn attempts
  if (state.time - (state._lastSpawn || 0) > spawnInterval) {
    state._lastSpawn = state.time;
    if (state.pop < state.capacity.pop && state.resources.food >= 5) {
      const th = state.buildings.find(b => b.kind === 'TOWN_HALL' && b.constructed);
      if (th) { spawnColonist(th); state.resources.food -= 5; }
    }
  }
  // Update colonists
  for (const c of state.colonists) updateColonist(c, dt);
  // Production tick — each constructed production building generates per-sec
  const perSec = {};
  for (const b of state.buildings) {
    if (!b.constructed) continue;
    const def = BUILDINGS[b.kind];
    if (!def.produces) continue;
    // Efficiency = workers assigned / workers needed
    const eff = def.workers > 0 ? Math.min(1, b.workers.length / def.workers) : 1;
    // Adjacency bonus (Lumberyard near forest, Farm near water/well)
    let adj = 1;
    if (b.kind === 'LUMBERYARD') adj = 0.4 + 0.6 * nearbyCount(b, TERRAIN.FOREST) / 6;
    if (b.kind === 'FARM') adj = 0.6 + 0.4 * nearbyBuilding(b, 'WELL') * 1.0;
    if (b.kind === 'MARKET') {
      // Market consumes 1 food + 1 wood per produced gold
      const amt = def.rate * eff * dt;
      if (state.resources.food > amt && state.resources.wood > amt) {
        state.resources.food -= amt; state.resources.wood -= amt;
        state.resources.gold += amt;
        perSec.gold = (perSec.gold || 0) + amt;
      }
      continue;
    }
    const amt = def.rate * eff * adj * dt;
    state.resources[def.produces] = (state.resources[def.produces] || 0) + amt;
    perSec[def.produces] = (perSec[def.produces] || 0) + amt;
  }
  // Smooth delta for UI display
  for (const r in perSec) state.resourceDelta[r] = (state.resourceDelta[r] || 0) * 0.8 + (perSec[r] / dt) * 0.2;
  // Passive food consumption
  if (state.pop > 0) {
    const cost = state.pop * 0.08 * dt;
    state.resources.food = Math.max(0, state.resources.food - cost);
  }
}
function spawnColonist(fromBuilding) {
  const c = {
    id: state.nextId++,
    x: fromBuilding.x + 0.5, y: fromBuilding.y + 0.5,
    targetX: fromBuilding.x + 0.5, targetY: fromBuilding.y + 0.5,
    job: null, building: null, home: fromBuilding,
    stateTime: 0, cooldown: 0,
    color: ['#6aa8e0','#d87a5a','#7ce27c','#c088d0','#f6c56b'][state.nextId % 5],
  };
  state.colonists.push(c);
  state.pop++;
}
function updateColonist(c, dt) {
  // Simple "walk to random target" idle behavior for now. Assign job if not working.
  if (!c.job) {
    // Find a production building that needs a worker
    const candidates = state.buildings.filter(b => {
      if (!b.constructed) return false;
      const def = BUILDINGS[b.kind];
      return def.workers && b.workers.length < def.workers;
    });
    if (candidates.length > 0) {
      const b = candidates[Math.floor(Math.random() * candidates.length)];
      c.job = b.kind; c.building = b; b.workers.push(c);
      c.targetX = b.x + BUILDINGS[b.kind].w / 2; c.targetY = b.y + BUILDINGS[b.kind].h / 2;
    } else {
      // Wander
      if (c.cooldown <= 0) {
        c.cooldown = 2 + Math.random() * 4;
        c.targetX = c.x + (Math.random() - 0.5) * 5;
        c.targetY = c.y + (Math.random() - 0.5) * 5;
      }
      c.cooldown -= dt;
    }
  } else {
    // Worker: bob between building and a random nearby tile (simulating labor)
    if (c.cooldown <= 0) {
      c.cooldown = 3 + Math.random() * 2;
      if (Math.random() < 0.5) {
        c.targetX = c.building.x + BUILDINGS[c.building.kind].w / 2;
        c.targetY = c.building.y + BUILDINGS[c.building.kind].h / 2;
      } else {
        c.targetX = c.building.x + (Math.random() - 0.5) * 4;
        c.targetY = c.building.y + (Math.random() - 0.5) * 4;
      }
    }
    c.cooldown -= dt;
  }
  // Move toward target
  const dx = c.targetX - c.x, dy = c.targetY - c.y;
  const d = Math.hypot(dx, dy);
  if (d > 0.01) {
    const speed = 1.5;
    const step = Math.min(speed * dt, d);
    c.x += (dx / d) * step;
    c.y += (dy / d) * step;
    c.walkDist = (c.walkDist || 0) + step;
  }
  // Clamp inside map
  c.x = Math.max(0, Math.min(MAP_SIZE - 1, c.x));
  c.y = Math.max(0, Math.min(MAP_SIZE - 1, c.y));
}
function nearbyCount(b, terrain) {
  const def = BUILDINGS[b.kind]; let n = 0;
  for (let dy = -2; dy <= def.h + 1; dy++)
    for (let dx = -2; dx <= def.w + 1; dx++) {
      const x = b.x + dx, y = b.y + dy;
      if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) continue;
      if (state.map[y][x] === terrain) n++;
    }
  return n;
}
function nearbyBuilding(b, kind) {
  const def = BUILDINGS[b.kind];
  for (const other of state.buildings) {
    if (other === b || other.kind !== kind || !other.constructed) continue;
    const od = BUILDINGS[other.kind];
    const overlap =
      other.x < b.x + def.w + 2 && other.x + od.w + 2 > b.x &&
      other.y < b.y + def.h + 2 && other.y + od.h + 2 > b.y;
    if (overlap) return 1;
  }
  return 0;
}

// ─── Render frame ──────────────────────────────────────────────────────────
// Rebake the static world (terrain, trees, rocks, shore fringe) into the
// offscreen world canvas. Called only when state.worldDirty is set.
function renderWorld() {
  const prev = ctx;
  ctx = worldCtx;
  try {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (let y = 0; y < MAP_SIZE; y++)
      for (let x = 0; x < MAP_SIZE; x++)
        drawTile(x, y);
  } finally {
    ctx = prev;
  }
}
function render() {
  drawSky();
  // Bake the static world on demand; then blit it onto the main canvas so
  // the dynamic pass has a finished terrain to paint entities over.
  if (state.worldDirty) { renderWorld(); state.worldDirty = false; }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);   // draw in device pixels for a 1:1 blit
  ctx.drawImage(worldCanvas, 0, 0);
  ctx.restore();
  // Dynamic pass — buildings + colonists + water sheen, all z-sorted together
  // so colonists hide correctly behind tall structures and appear in front
  // when south of them.
  const drawList = [];
  for (let y = 0; y < MAP_SIZE; y++)
    for (let x = 0; x < MAP_SIZE; x++)
      if (state.map[y][x] === TERRAIN.WATER)
        drawList.push({ type: 'water-sheen', x, y, depth: x + y + 0.01 });
  for (const b of state.buildings) {
    const def = BUILDINGS[b.kind];
    drawList.push({ type: 'building', ref: b, x: b.x, y: b.y, depth: (b.x + def.w - 0.5) + (b.y + def.h - 0.5) + 0.3 });
  }
  for (const c of state.colonists)
    drawList.push({ type: 'colonist', ref: c, depth: c.x + c.y + 0.2 });
  drawList.sort((a, b) => a.depth - b.depth);
  for (const item of drawList) {
    if (item.type === 'water-sheen') drawWaterSheen(item.x, item.y);
    else if (item.type === 'building') {
      const def = BUILDINGS[item.ref.kind];
      const p = worldToScreen(item.x + def.w/2 - 0.5, item.y + def.h/2 - 0.5);
      const lift = buildingTopHeight(item.ref) * state.zoom;
      drawBuildingArt(item.ref, p.x, p.y - lift, state.zoom);
    }
    else if (item.type === 'colonist') drawColonist(item.ref);
  }
  // Hover preview
  if (state.selected && state.hoverTile) {
    const def = BUILDINGS[state.selected];
    const ok = canPlace(state.selected, state.hoverTile.x, state.hoverTile.y) && canAfford(state.selected);
    ctx.globalAlpha = 0.55;
    // Highlight footprint — lifted onto each tile's height
    for (let dy = 0; dy < def.h; dy++)
      for (let dx = 0; dx < def.w; dx++) {
        const tx = state.hoverTile.x + dx, ty = state.hoverTile.y + dy;
        const p = worldToScreen(tx, ty);
        const lift = tileHeight(tx, ty) * state.zoom;
        drawDiamond(p.x, p.y - lift, TILE_W * state.zoom, TILE_H * state.zoom, ok ? '#7ce27c' : '#e85a5a', '#fff');
      }
    ctx.globalAlpha = 1;
    // Ghost building
    const g = { id: -1, kind: state.selected, constructed: true, progress: 1, x: state.hoverTile.x, y: state.hoverTile.y };
    const p = worldToScreen(state.hoverTile.x + def.w/2 - 0.5, state.hoverTile.y + def.h/2 - 0.5);
    const lift = buildingTopHeight(g) * state.zoom;
    drawBuildingArt(g, p.x, p.y - lift, state.zoom, true);
  }
  // Selection highlight — pulsing (OpenTTD PALETTE_TILE_RED_PULSATING port).
  if (state.selectedEntity && state.selectedEntity.type === 'building') {
    const b = state.selectedEntity.ref;
    const def = BUILDINGS[b.kind];
    const p = worldToScreen(b.x + def.w/2 - 0.5, b.y + def.h/2 - 0.5);
    const lift = buildingTopHeight(b) * state.zoom;
    const pulse = 0.55 + 0.45 * Math.sin(state.tick * 0.12);
    ctx.strokeStyle = `rgba(246,197,107,${pulse})`;
    ctx.lineWidth = 2;
    const w = def.w * TILE_W * state.zoom, h = def.h * TILE_H * state.zoom;
    drawDiamond(p.x, p.y - lift, w + 8, h + 8, null, `rgba(246,197,107,${pulse})`);
  }
  // Dawn/dusk color grade — port of OpenRCT2's LightFX.cpp asymmetric R/G/B
  // curve so nights go BLUE (not gray). Built around "dayness" ∈ [0,1] where
  // 1 = noon, 0 = midnight. Separate power curves per channel give the warm
  // dawn/dusk crossover without lookup tables.
  {
    const tt = (state.time % state.dayLen) / state.dayLen;
    // dayness: 1 at noon (tt=0.25→0.5? our convention tt=0 is midnight)
    // Existing code uses tt=0 as dawn, tt=0.5 as dusk-ish. Remap to a sine:
    const dayness = 0.5 + 0.5 * Math.sin((tt - 0.25) * Math.PI * 2);
    if (dayness < 0.95) {
      const night = Math.pow(1 - dayness, 1.5); // 0 day → 1 midnight
      // Asymmetric channel curves (OpenRCT2 LightFX.cpp:842-940 adapted):
      const r = Math.floor(255 * (1 - night * 0.78));           // strongest drop
      const g = Math.floor(255 * (1 - night * 0.65));           // middle
      const b = Math.floor(255 * (1 - night * 0.38));           // keeps blue alive
      // Add warm skew near dawn/dusk when sun is near horizon.
      const horizon = Math.max(0, 1 - Math.abs(dayness - 0.18) * 10) + Math.max(0, 1 - Math.abs(dayness - 0.12) * 10);
      const rWarm = Math.min(255, r + Math.floor(40 * horizon));
      const gWarm = Math.min(255, g + Math.floor(20 * horizon));
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.85 * night + 0.15 * horizon;
      ctx.fillStyle = `rgb(${rWarm},${gWarm},${b})`;
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.restore();
    }
  }
  // Minimap
  renderMiniMap();
}
function renderMiniMap() {
  const mw = miniCanvas.width, mh = miniCanvas.height;
  miniCtx.fillStyle = '#1a1636';
  miniCtx.fillRect(0, 0, mw, mh);
  const sx = mw / MAP_SIZE, sy = mh / MAP_SIZE;
  for (let y = 0; y < MAP_SIZE; y++)
    for (let x = 0; x < MAP_SIZE; x++) {
      const t = state.map[y][x];
      miniCtx.fillStyle = { 0:'#7bc77b', 1:'#4fb3d9', 2:'#8a8a8a', 3:'#3a8a4a', 4:'#e4cb8a' }[t];
      miniCtx.fillRect(x * sx, y * sy, Math.ceil(sx), Math.ceil(sy));
    }
  miniCtx.fillStyle = '#f6c56b';
  for (const b of state.buildings) {
    const d = BUILDINGS[b.kind];
    miniCtx.fillRect(b.x * sx, b.y * sy, Math.max(2, d.w * sx), Math.max(2, d.h * sy));
  }
  miniCtx.fillStyle = '#fff';
  for (const c of state.colonists) miniCtx.fillRect(c.x * sx, c.y * sy, 1.5, 1.5);
}

// ─── HUD update ────────────────────────────────────────────────────────────
const hudEl = document.getElementById('hud');
function renderHUD() {
  const resources = [
    { k: 'food', ico: '🌾' }, { k: 'wood', ico: '🪵' },
    { k: 'stone', ico: '🪨' }, { k: 'gold', ico: '💰' },
  ];
  let html = '';
  for (const r of resources) {
    const v = Math.floor(state.resources[r.k] || 0);
    const d = state.resourceDelta[r.k] || 0;
    const dStr = d > 0.02 ? `+${d.toFixed(1)}/s` : d < -0.02 ? `${d.toFixed(1)}/s` : '';
    html += `<div class="resource"><span class="ico">${r.ico}</span><span class="val">${v}</span><span class="delta">${dStr}</span></div>`;
  }
  html += `<div class="resource"><span class="ico">👥</span><span class="val">${state.pop}/${state.capacity.pop}</span></div>`;
  hudEl.innerHTML = html;
}
const paletteEl = document.getElementById('palette');
function renderPalette() {
  let html = '';
  for (const k of BUILD_ORDER) {
    const def = BUILDINGS[k];
    const afford = canAfford(k);
    const selected = state.selected === k ? 'selected' : '';
    const disabled = !afford ? 'disabled' : '';
    const costStr = Object.entries(def.cost).map(([r, v]) =>
      `<span class="${state.resources[r] < v ? 'cant' : ''}">${v}${r[0]}</span>`
    ).join(' ');
    html += `<button class="build-btn ${selected} ${disabled}" data-kind="${k}">
      <div class="bico">${def.icon}</div>
      <div class="bname">${def.name}</div>
      <div class="bcost">${costStr}</div>
    </button>`;
  }
  paletteEl.innerHTML = html;
  paletteEl.querySelectorAll('.build-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.kind;
      if (!canAfford(k)) { toast(`Not enough resources for ${BUILDINGS[k].name}.`); return; }
      state.selected = state.selected === k ? null : k;
      state.selectedEntity = null;
      renderPalette();
      updateInfo();
    });
  });
}
const infoEl = document.getElementById('info');
const infoTitleEl = document.getElementById('info-title');
const infoBodyEl = document.getElementById('info-body');
const infoActionEl = document.getElementById('info-action');
function updateInfo() {
  if (state.selected) {
    const def = BUILDINGS[state.selected];
    infoEl.classList.remove('hidden');
    infoTitleEl.textContent = `Build ${def.name}`;
    infoBodyEl.innerHTML = `
      <div class="row"><span>Size</span><span>${def.w}×${def.h}</span></div>
      <div class="row"><span>Cost</span><span>${Object.entries(def.cost).map(([r,v])=>`${v} ${r}`).join(', ')}</span></div>
      ${def.produces ? `<div class="row"><span>Produces</span><span>${def.produces} @ ${def.rate}/s</span></div>` : ''}
      ${def.workers ? `<div class="row"><span>Workers</span><span>${def.workers}</span></div>` : ''}
      ${def.houses ? `<div class="row"><span>Houses</span><span>${def.houses}</span></div>` : ''}
      <div class="tip">${def.desc}</div>
    `;
    infoActionEl.style.display = 'none';
  } else if (state.selectedEntity && state.selectedEntity.type === 'building') {
    const b = state.selectedEntity.ref;
    const def = BUILDINGS[b.kind];
    infoEl.classList.remove('hidden');
    infoTitleEl.textContent = def.name;
    infoBodyEl.innerHTML = `
      <div class="row"><span>Status</span><span>${b.constructed ? 'Active' : `Building ${Math.floor(b.progress*100)}%`}</span></div>
      ${def.produces ? `<div class="row"><span>Produces</span><span>${def.produces}</span></div>` : ''}
      ${def.workers ? `<div class="row"><span>Workers</span><span>${b.workers.length}/${def.workers}</span></div>` : ''}
      ${def.houses ? `<div class="row"><span>Capacity</span><span>${def.houses}</span></div>` : ''}
      <div class="tip">${def.desc}</div>
    `;
    infoActionEl.textContent = 'Demolish (refund 50%)';
    infoActionEl.style.display = '';
    infoActionEl.onclick = () => demolish(b);
  } else {
    infoEl.classList.add('hidden');
  }
}
function demolish(b) {
  const def = BUILDINGS[b.kind];
  for (const r in def.cost) state.resources[r] = (state.resources[r] || 0) + Math.floor(def.cost[r] * 0.5);
  // Remove workers back to pool
  for (const c of b.workers) { c.job = null; c.building = null; }
  state.buildings = state.buildings.filter(x => x !== b);
  state.selectedEntity = null;
  toast(`${def.name} demolished.`);
  updateInfo();
  save();
}

// ─── Toast helper ──────────────────────────────────────────────────────────
const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
}

// ─── Input: pan + place + select ──────────────────────────────────────────
let dragging = false, dragStart = null, dragMoved = false;
let pinchStart = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  dragging = true; dragMoved = false;
  dragStart = { x: e.clientX, y: e.clientY, camX: state.camX, camY: state.camY };
});
canvas.addEventListener('pointermove', (e) => {
  if (dragging && dragStart) {
    const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
    if (Math.hypot(dx, dy) > 5) dragMoved = true;
    if (dragMoved) {
      state.camX = dragStart.camX + dx; state.camY = dragStart.camY + dy;
      markWorldDirty();
    }
  }
  const w = screenToWorld(e.clientX, e.clientY);
  if (w.x >= 0 && w.y >= 0 && w.x < MAP_SIZE && w.y < MAP_SIZE) state.hoverTile = w;
  else state.hoverTile = null;
});
canvas.addEventListener('pointerup', (e) => {
  if (!dragMoved) {
    const w = screenToWorld(e.clientX, e.clientY);
    onTap(w);
  }
  dragging = false; dragStart = null;
});
canvas.addEventListener('pointercancel', () => { dragging = false; dragStart = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const d = e.deltaY > 0 ? 0.9 : 1.1;
  state.zoom = Math.max(0.5, Math.min(2.2, state.zoom * d));
  markWorldDirty();
}, { passive: false });

function onTap(w) {
  if (w.x < 0 || w.y < 0 || w.x >= MAP_SIZE || w.y >= MAP_SIZE) return;
  if (state.selected) {
    const ok = placeBuilding(state.selected, w.x, w.y);
    if (!ok) toast('Can\'t build there.');
    renderPalette(); updateInfo();
    save();
  } else {
    // Check for building selection
    for (const b of state.buildings) {
      const def = BUILDINGS[b.kind];
      if (w.x >= b.x && w.x < b.x + def.w && w.y >= b.y && w.y < b.y + def.h) {
        state.selectedEntity = { type: 'building', ref: b };
        updateInfo();
        return;
      }
    }
    state.selectedEntity = null;
    updateInfo();
  }
}

// ─── Keyboard shortcuts ────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { state.selected = null; state.selectedEntity = null; renderPalette(); updateInfo(); }
  const panStep = 30;
  if (e.key === 'ArrowLeft') { state.camX += panStep; markWorldDirty(); }
  if (e.key === 'ArrowRight') { state.camX -= panStep; markWorldDirty(); }
  if (e.key === 'ArrowUp') { state.camY += panStep; markWorldDirty(); }
  if (e.key === 'ArrowDown') { state.camY -= panStep; markWorldDirty(); }
  if (e.key === ' ') { e.preventDefault(); state.paused = !state.paused; }
  if (e.key >= '1' && e.key <= '8') {
    const k = BUILD_ORDER[parseInt(e.key, 10) - 1];
    if (k && canAfford(k)) { state.selected = k; renderPalette(); updateInfo(); }
  }
});

// ─── Speed + menu buttons ──────────────────────────────────────────────────
const speedBtn = document.getElementById('speed-btn');
speedBtn.addEventListener('click', () => {
  const steps = [1, 2, 3, 0];
  const idx = steps.indexOf(state.speed);
  state.speed = steps[(idx + 1) % steps.length];
  state.paused = state.speed === 0;
  speedBtn.textContent = state.paused ? '⏸' : (state.speed + 'x');
});
document.getElementById('menu-btn').addEventListener('click', () => {
  if (confirm('Restart colony? This wipes your progress.')) {
    localStorage.removeItem('aria-colony-save');
    location.reload();
  }
});
document.getElementById('welcome-start').addEventListener('click', () => {
  document.getElementById('welcome').classList.add('hidden');
  // Pre-select town hall on first run
  if (state.buildings.length === 0) {
    state.selected = 'TOWN_HALL';
    renderPalette();
    updateInfo();
    toast('Place your Town Hall near the center.');
  }
});

// ─── Save / load ───────────────────────────────────────────────────────────
function save() {
  try {
    const snapshot = {
      map: state.map, buildings: state.buildings,
      colonists: state.colonists.map(c => ({ ...c, building: c.building?.id, home: c.home?.id })),
      resources: state.resources, pop: state.pop, time: state.time, nextId: state.nextId,
    };
    localStorage.setItem('aria-colony-save', JSON.stringify(snapshot));
  } catch {}
}

// URL-hash-encoded map share (isocity pattern, ported). Encodes just the
// map terrain so anyone can open a URL and see your starting landscape.
// Full save (buildings + colonists) stays in localStorage.
function encodeMapToHash() {
  try {
    const u8 = new Uint8Array(MAP_SIZE * MAP_SIZE);
    for (let y = 0; y < MAP_SIZE; y++)
      for (let x = 0; x < MAP_SIZE; x++) u8[y * MAP_SIZE + x] = state.map[y][x] & 0xff;
    // base64url
    let bin = ''; for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return b64;
  } catch { return ''; }
}
function decodeMapFromHash(hash) {
  try {
    const b64 = hash.replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const bin = atob(b64 + pad);
    if (bin.length !== MAP_SIZE * MAP_SIZE) return null;
    const m = [];
    for (let y = 0; y < MAP_SIZE; y++) {
      m[y] = [];
      for (let x = 0; x < MAP_SIZE; x++) m[y][x] = bin.charCodeAt(y * MAP_SIZE + x);
    }
    return m;
  } catch { return null; }
}
function updateHashState() {
  try { history.replaceState(null, '', '#' + encodeMapToHash()); } catch {}
}
window.addEventListener('popstate', () => {
  const h = location.hash.slice(1);
  if (!h) return;
  const m = decodeMapFromHash(h);
  if (m) {
    state.map = m;
    state.buildings = []; state.colonists = []; state.pop = 0;
    state.resources = { food: 20, wood: 60, stone: 15, gold: 0 };
    state.selected = null; state.selectedEntity = null;
    markWorldDirty();
    toast('Loaded shared map from URL.');
  }
});
function load() {
  try {
    const raw = localStorage.getItem('aria-colony-save');
    if (!raw) return false;
    const s = JSON.parse(raw);
    state.map = s.map; state.buildings = s.buildings;
    state.resources = s.resources; state.pop = s.pop; state.time = s.time; state.nextId = s.nextId;
    // Re-link colonists to building refs
    const byId = new Map(state.buildings.map(b => [b.id, b]));
    state.colonists = s.colonists.map(c => ({ ...c, building: byId.get(c.building) || null, home: byId.get(c.home) || null }));
    // Re-attach worker refs
    for (const b of state.buildings) b.workers = state.colonists.filter(c => c.building === b);
    document.getElementById('welcome').classList.add('hidden');
    return true;
  } catch { return false; }
}

// ─── Main loop ────────────────────────────────────────────────────────────
function loop(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000) * (state.paused ? 0 : state.speed);
  lastT = now;
  // Global tick drives all animation. One int, shared across systems.
  state.tick = (state.tick + 1) >>> 0;
  update(dt);
  render();
  renderHUD();
  requestAnimationFrame(loop);
}
// Init — precedence: URL hash (shared map) > localStorage save > fresh gen.
const hashArg = location.hash.slice(1);
let loadedFromHash = false;
if (hashArg) {
  const m = decodeMapFromHash(hashArg);
  if (m) { state.map = m; loadedFromHash = true; toast('Loaded shared map from URL.'); }
}
if (!loadedFromHash && !load()) {
  // Center camera on map middle
  const p = worldToScreen(MAP_SIZE / 2, MAP_SIZE / 2);
  state.camX -= p.x - window.innerWidth / 2;
  state.camY -= p.y - window.innerHeight * 0.4;
  // First-run: share the generated map as a URL people can copy.
  updateHashState();
}
renderPalette();
updateInfo();
setInterval(save, 10000);
// Keep hash in sync with any map-changing action so copy-and-share always works.
setInterval(updateHashState, 5000);
requestAnimationFrame(loop);

})();
