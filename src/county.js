/* ================= Athens-Clarke County live site data =================
   Parcels, zoning, overlays, utilities and roads come from the county's public ArcGIS server.
   Flood zones and base flood elevations come from FEMA's National Flood Hazard Layer, ground elevation from USGS 3DEP,
   and soils from USDA Soil Data Access. All of these are public and need no account or key. */
const ACC = 'https://enigma.accgov.com/server/rest/services';
const CL = `${ACC}/Clariti/ClaritiMap/MapServer`;
const ACC_BOUNDS = { s: 33.84, n: 34.04, w: -83.54, e: -83.23 };
const ZONING_CODE_URL = 'https://library.municode.com/ga/athens-clarke_county/codes/code_of_ordinances?nodeId=PTIIICOOR_TIT9ZODEST_ARTIZO';
const EMBEDDED = window.self !== window.top;
const CTX = { parcels: new Map(), water: [], sewer: [], hydrants: [], manholes: [], roads: [], intersections: [], report: null, selected: null, pick: false, hover: null, show: true };
S.ctx = CTX;

const inACC = (lat, lng) => lat > ACC_BOUNDS.s && lat < ACC_BOUNDS.n && lng > ACC_BOUNDS.w && lng < ACC_BOUNDS.e;
const kOf = () => Math.cos(S.geo.lat * DEG);
const ll2w = (lng, lat) => [(lng - S.geo.lng) * FT_PER_DEG_LAT * kOf(), (lat - S.geo.lat) * FT_PER_DEG_LAT];
const w2ll = (p) => [S.geo.lng + p[0] / (FT_PER_DEG_LAT * kOf()), S.geo.lat + p[1] / FT_PER_DEG_LAT];

async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json(); if (j.error) throw new Error(j.error.message || 'service error');
  return j;
}
/* Query any ArcGIS layer. `geom` is an envelope [w,s,e,n] in lat/lng, or a polygon in world feet. */
function arcQuery(layerUrl, { geom, where, fields = '*', geometry = true, distance, offset = 0.000004 } = {}) {
  const p = new URLSearchParams({ f: 'json', outFields: fields, returnGeometry: String(geometry), outSR: '4326', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' });
  if (where) p.set('where', where);
  if (Array.isArray(geom) && typeof geom[0] === 'number') { p.set('geometry', geom.join(',')); p.set('geometryType', 'esriGeometryEnvelope'); }
  else if (geom) { p.set('geometry', JSON.stringify({ rings: [geom.map(w2ll).concat([w2ll(geom[0])])], spatialReference: { wkid: 4326 } })); p.set('geometryType', 'esriGeometryPolygon'); }
  if (distance) { p.set('distance', distance); p.set('units', 'esriSRUnit_Foot'); }
  if (geometry && offset) p.set('maxAllowableOffset', offset);
  return getJSON(`${layerUrl}/query`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p.toString() }).then(j => j.features || []);
}
const ringsOf = (g) => (g && g.rings ? g.rings : []).map(r => ccw(r.slice(0, -1).map(([x, y]) => ll2w(x, y)))).filter(r => r.length >= 3 && Math.abs(area(r)) > 4);
const pathsOf = (g) => (g && g.paths ? g.paths : []).map(p => p.map(([x, y]) => ll2w(x, y))).filter(p => p.length >= 2);
const ptOf = (g) => g && g.x != null ? ll2w(g.x, g.y) : null;

/* clipping to an axis-aligned box (world feet) */
function clipPoly(poly, b) {
  let out = poly;
  const edges = [[p => p[0] >= b.x0, (a, c) => [b.x0, a[1] + (c[1] - a[1]) * (b.x0 - a[0]) / (c[0] - a[0])]], [p => p[0] <= b.x1, (a, c) => [b.x1, a[1] + (c[1] - a[1]) * (b.x1 - a[0]) / (c[0] - a[0])]],
    [p => p[1] >= b.y0, (a, c) => [a[0] + (c[0] - a[0]) * (b.y0 - a[1]) / (c[1] - a[1]), b.y0]], [p => p[1] <= b.y1, (a, c) => [a[0] + (c[0] - a[0]) * (b.y1 - a[1]) / (c[1] - a[1]), b.y1]]];
  for (const [ins, cut] of edges) {
    const inp = out; out = []; if (!inp.length) break;
    for (let i = 0; i < inp.length; i++) { const a = inp[(i - 1 + inp.length) % inp.length], c = inp[i]; if (ins(c)) { if (!ins(a)) out.push(cut(a, c)); out.push(c); } else if (ins(a)) out.push(cut(a, c)); }
  }
  return out.length >= 3 && Math.abs(area(out)) > 4 ? ccw(out) : null;
}
function clipLine(line, b) {
  const out = []; let cur = null;
  for (let i = 1; i < line.length; i++) {
    let [x0, y0] = line[i - 1], [x1, y1] = line[i]; let t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0; let ok = true;
    for (const [p, q] of [[-dx, x0 - b.x0], [dx, b.x1 - x0], [-dy, y0 - b.y0], [dy, b.y1 - y0]]) { if (p === 0) { if (q < 0) { ok = false; break; } } else { const r = q / p; if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; } } }
    if (!ok) { cur = null; continue; }
    const a = [x0 + dx * t0, y0 + dy * t0], c = [x0 + dx * t1, y0 + dy * t1];
    if (cur && t0 === 0) cur.push(c); else { cur = [a, c]; out.push(cur); }
    if (t1 < 1) cur = null;
  }
  return out;
}
function nearestOnLines(lines, poly) {
  let best = null;
  for (const l of lines) for (let i = 1; i < l.pts.length; i++) {
    const a = l.pts[i - 1], b = l.pts[i];
    for (const q of poly) { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); const pt = [a[0] + dx * t, a[1] + dy * t]; const d = polyDist(pt, poly); if (!best || d < best.d) best = { d, pt, line: l }; }
    for (const q of [a, b]) { const d = polyDist(q, poly); if (!best || d < best.d) best = { d, pt: q, line: l }; }
  }
  return best;
}

/* ---------- live parcel overlay ---------- */
let ovTimer = 0, ovBusy = false, ovKey = '', ovAgain = false;
function scheduleOverlay() { clearTimeout(ovTimer); ovTimer = setTimeout(loadOverlay, 350); }
async function loadOverlay() {
  if (!S.geo || !CTX.show || EMBEDDED || CW < 50) return;
  if (ovBusy) { ovAgain = true; return; }
  const nw = w2ll(S2W(0, 0)), se = w2ll(S2W(CW, CH));
  if (!inACC((nw[1] + se[1]) / 2, (nw[0] + se[0]) / 2)) return;
  if (CW / view.s > 5000) { setCountyNote('Zoom in to see county parcel lines.'); return; }
  const env = [nw[0], se[1], se[0], nw[1]].map(v => +v.toFixed(5));
  const key = env.join(','); if (key === ovKey) return; ovKey = key;
  ovBusy = true;
  try {
    const fs = await arcQuery(`${ACC}/ACC_Parcels/FeatureServer/0`, { geom: env, fields: 'OBJECTID,PARCEL_NO,PAR_ADD,ACRES,OWNER_NAME', offset: 0.000003 });
    for (const f of fs) if (!CTX.parcels.has(f.attributes.OBJECTID)) CTX.parcels.set(f.attributes.OBJECTID, { a: f.attributes, g: f.geometry, rings: ringsOf(f.geometry) });
    if (CTX.parcels.size > 4000) { const keep = [...CTX.parcels.entries()].slice(-2500); CTX.parcels = new Map(keep); }
    setCountyNote(`${fs.length} county parcels in view. ${CTX.pick ? 'Click one to load it.' : 'Click “Pick a parcel on the map”, then click a lot.'}`);
    draw();
  } catch (e) { setCountyNote(`County parcel service did not answer (${e.message}). Try again in a moment.`); ovKey = ''; }
  ovBusy = false;
  if (ovAgain) { ovAgain = false; scheduleOverlay(); }
}
function reprojectOverlay() { for (const p of CTX.parcels.values()) p.rings = ringsOf(p.g); }
function parcelAt(w) { for (const p of CTX.parcels.values()) for (const r of p.rings) if (inside(w, r)) return p; return null; }

function drawCounty() {
  if (!S.geo || EMBEDDED) return;
  if (CTX.show && CTX.parcels.size) {
    ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = TOK.paint; ctx.globalAlpha = 0.75;
    ctx.beginPath(); for (const p of CTX.parcels.values()) for (const r of p.rings) pathPoly(r, false); ctx.stroke(); ctx.restore();
    if (CTX.hover) { ctx.save(); ctx.fillStyle = TOK.paint; ctx.globalAlpha = 0.25; ctx.beginPath(); for (const r of CTX.hover.rings) pathPoly(r, false); ctx.fill(); ctx.restore(); }
    if (view.s > 0.6) {
      ctx.font = `500 10px ${TOK.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const p of CTX.parcels.values()) { const r = p.rings[0]; if (!r) continue; const bb = bbox(r); if ((bb.x1 - bb.x0) * view.s < 70) continue; const s = W2S(centroid(r)); label((p.a.PAR_ADD || '').trim(), s[0], s[1], 0, TOK.dim, TOK.bg); }
    }
  }
  // utilities and roads near the loaded parcel
  ctx.save(); ctx.lineCap = 'round';
  for (const r of CTX.roads) { pathLine(r.pts); ctx.strokeStyle = TOK.dim; ctx.globalAlpha = 0.35; ctx.lineWidth = Math.max(2, (r.width || 24) * view.s); ctx.stroke(); }
  ctx.globalAlpha = 0.9;
  for (const l of CTX.water) { pathLine(l.pts); ctx.strokeStyle = '#2a7fd4'; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.stroke(); }
  for (const l of CTX.sewer) { pathLine(l.pts); ctx.strokeStyle = '#3f9a3a'; ctx.lineWidth = 2; ctx.setLineDash([8, 4]); ctx.stroke(); }
  ctx.setLineDash([]);
  for (const h of CTX.hydrants) { const s = W2S(h.pt); ctx.beginPath(); ctx.arc(s[0], s[1], 4.5, 0, 7); ctx.fillStyle = '#d23b2a'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke(); }
  for (const m of CTX.manholes) { const s = W2S(m.pt); ctx.beginPath(); ctx.arc(s[0], s[1], 3.5, 0, 7); ctx.fillStyle = '#3f9a3a'; ctx.fill(); }
  for (const i of CTX.intersections) { const s = W2S(i.pt); ctx.beginPath(); ctx.rect(s[0] - 4, s[1] - 4, 8, 8); ctx.strokeStyle = TOK.dim; ctx.lineWidth = 1.5; ctx.stroke(); }
  ctx.restore();
}

/* ---------- load one parcel and everything about it ---------- */
const ZONE_USE = (z) => { z = (z || '').toUpperCase(); if (/^RS|^AR/.test(z)) return z.startsWith('AR') ? 'agricultural' : 'single_family'; if (/^RM/.test(z)) return 'multifamily'; if (/^C-O|^E-O/.test(z)) return 'office'; if (/^C-/.test(z)) return 'commercial'; if (/^E-I|^I/.test(z)) return 'industrial'; if (/^G|^P|^IN/.test(z)) return 'institutional'; return 'vacant'; };
const ROAD_CLASS = (c) => { c = (c || '').toUpperCase(); if (c.includes('LOOP') || c.includes('RAMP')) return 'state_route'; if (c.includes('MINOR ARTERIAL')) return 'minor_arterial'; if (c.includes('ARTERIAL')) return 'major_arterial'; if (c.includes('COLLECTOR')) return 'collector'; return 'local'; };
const ROAD_RANK = { local: 0, collector: 1, minor_arterial: 2, major_arterial: 3, state_route: 4 };
const GEO_FIELDS = ['siteConditions.floodplainAreas', 'siteConditions.wetlands', 'siteConditions.streams', 'siteConditions.existingStructures', 'siteConditions.contours', 'siteConditions.lowPointLocation', 'utilities.sewerTieInLocation', 'utilities.waterTieInLocation', 'parcel.easements', 'parcel.adjacentUses', 'access.accessPoints', 'siteConditions.protectedTrees', 'grading.limitsOfDisturbance', 'stormwater.pondLocation', 'stormwater.outfallLocation', 'utilities.transformerPadLocation', 'siteFeatures.fencing', 'grading.retainingWalls'];

async function loadCountyParcel(p) {
  if (!p || !p.g) return;
  const t0 = performance.now();
  // Put the origin at the southwest corner of the parcel's bounding box, as the schema specifies.
  const ring0 = p.g.rings.reduce((a, r) => r.length > a.length ? r : a, []);
  const lng0 = Math.min(...ring0.map(q => q[0])), lat0 = Math.min(...ring0.map(q => q[1]));
  S.geo = { lat: lat0, lng: lng0 }; mapState = mapState === 'blocked' ? 'blocked' : 'idle';
  reprojectOverlay();
  const rings = ringsOf(p.g); const ring = rings.reduce((a, r) => Math.abs(area(r)) > Math.abs(area(a)) ? r : a, rings[0]);
  for (const id of GEO_FIELDS) { delete S.F[id]; S.touched.delete(id); }
  CTX.water = []; CTX.sewer = []; CTX.hydrants = []; CTX.manholes = []; CTX.roads = []; CTX.intersections = [];
  S.parcel = ccw(ring.map(q => [+q[0].toFixed(2), +q[1].toFixed(2)]));
  CTX.selected = p; CTX.pick = false; $('#btnPick').classList.remove('on');
  const R = { parcel: p.a, findings: [], filled: [], sources: new Set(['Athens-Clarke County GIS']) };
  CTX.report = R;
  const set = (id, v, why) => { if (v === undefined || v === null || (typeof v === 'number' && !isFinite(v))) return; S.F[id] = v; S.touched.add(id); R.filled.push([id, v, why]); };
  const find = (group, text, level = 'info') => R.findings.push({ group, text, level });
  setStatus('Loading parcel data…', 0.05); renderSiteData();
  afterParcelChange(true, true);

  const P = S.parcel; const bb0 = bbox(P); const pad = 400;
  const box = { x0: bb0.x0 - pad, y0: bb0.y0 - pad, x1: bb0.x1 + pad, y1: bb0.y1 + pad };
  const boxLL = [w2ll([box.x0, box.y0]), w2ll([box.x1, box.y1])]; const env = [boxLL[0][0], boxLL[0][1], boxLL[1][0], boxLL[1][1]].map(v => +v.toFixed(6));
  const site = { x0: bb0.x0 - 60, y0: bb0.y0 - 60, x1: bb0.x1 + 60, y1: bb0.y1 + 60 };
  const touchesParcel = (poly) => polysOverlap(poly, P);
  const safe = async (label, fn) => { try { return await fn(); } catch (e) { find('Data gaps', `${label}: the service did not answer (${e.message}).`, 'warn'); return null; } };
  const jobs = [];

  // parcel basics
  set('parcel.boundary', P, 'County parcel');
  set('parcel.grossAreaAcres', +(Math.abs(area(P)) / 43560).toFixed(3), 'Computed from county boundary');
  find('Parcel', `${p.a.PARCEL_NO} · ${(p.a.PAR_ADD || '').trim()} · ${fmt(p.a.ACRES, 2)} ac on the tax record (${fmt(Math.abs(area(P)) / 43560, 2)} ac by geometry)`);

  jobs.push(safe('Parcel record', async () => {
    const f = (await arcQuery(`${CL}/0`, { where: `PARCEL_NO='${p.a.PARCEL_NO}'`, geometry: false }))[0];
    if (f) { const a = f.attributes; R.parcel = { ...p.a, ...a }; if (a.OWNER_NAME) find('Parcel', `Owner of record: ${a.OWNER_NAME.trim()}${a.OWNER_ADD ? `, ${a.OWNER_ADD.trim()} ${a.CITY || ''} ${a.STATE || ''}` : ''}`); if (a.LEGAL_DESC && a.LEGAL_DESC.trim()) find('Parcel', `Legal description: ${a.LEGAL_DESC.trim()}`); if (a.EXEMPTION && a.EXEMPTION.trim()) find('Parcel', `Tax exemption: ${a.EXEMPTION.trim()}`); }
  }));
  jobs.push(safe('Zoning', async () => {
    const fs = await arcQuery(`${CL}/54`, { geom: P, geometry: false, fields: 'PARCEL_NO,CurrentZn,CombinedZn,SplitZoned' });
    const own = fs.find(f => f.attributes.PARCEL_NO === p.a.PARCEL_NO) || fs[0];
    if (own) {
      const z = (own.attributes.CurrentZn || '').trim(); set('zoning.district', own.attributes.CombinedZn && own.attributes.CombinedZn.trim() || z, 'County zoning layer');
      find('Zoning', `Zoned <b>${esc(z)}</b>${own.attributes.CombinedZn && own.attributes.CombinedZn.trim() !== z ? ` (${esc(own.attributes.CombinedZn.trim())})` : ''}. <a href="${ZONING_CODE_URL}" target="_blank" rel="noopener">Read the ACC zoning code</a> for its setbacks, height and parking, then save them as a jurisdiction profile.`, 'key');
      if (own.attributes.SplitZoned && own.attributes.SplitZoned.trim()) find('Zoning', 'This parcel is split-zoned.', 'warn');
      if (z.includes('PD')) set('zoning.entitlementPath', 'planned_development', 'Zoned as a planned development');
    }
  }));
  const OVERLAY_LAYERS = [
    [37, 'Moratorium', (a) => `Development moratorium: ${a.NAME || ''}${a.EXPIRE_DATE ? `, expires ${new Date(a.EXPIRE_DATE).toLocaleDateString()}` : ''}`, 'error'],
    [39, 'historic', (a) => `Local historic district: ${a.District}`, 'warn'], [40, 'historic', (a) => `Local historic site: ${a.SiteName || a.SiteCode}`, 'warn'],
    [41, 'historic', (a) => `National Register district: ${a.District}`, 'info'], [42, 'historic', (a) => `National Register site: ${a.SiteName}`, 'info'],
    [44, 'corridor', (a) => `Corridor designation: ${a.Street || ''} ${a.Corridor_D || ''}`.trim(), 'info'], [45, 'airport', (a) => `Airport overlay: ${a.airport_ov || ''}`, 'warn'],
    [46, null, (a) => `Special use approval on record: ${[a.Rezone1, a.Rezone2, a.Projects].filter(Boolean).join(', ')}`, 'warn'], [48, null, (a) => `Conditional use on record: ${a.Cond_Use || ''}`, 'warn'],
    [49, 'downtown', (a) => `Downtown design area: ${a.DtwnDesign || a.Annotation || ''}`, 'warn'], [50, null, (a) => `Planned development on record: ${[a.plan_dev, a.PROJECTS].filter(Boolean).join(', ')}`, 'warn'],
    [51, null, (a) => `Zoning conditions apply: ${[a.zn_w_cond, a.Rezone1, a.Rezone2, a.PROJECTS].filter(Boolean).join(', ')}. Read the rezoning case for conditions.`, 'warn'],
    [52, 'corridor', (a) => `Special district overlay: ${a.special_ov || a.Annotation}`, 'warn'], [53, null, (a) => `RM-LTD overlay: ${a.rm_limited || ''}`, 'warn'],
    [36, null, (a) => `Within a federal land buffer${a.Buffer ? ` (${a.Buffer})` : ''}`, 'warn'], [47, null, (a) => `Design standard subdivision: ${a.Subd_Name || ''}`, 'info'],
    [55, null, (a) => `Future land use: ${a.Updated_FL}`, 'info'], [71, null, (a) => `Jurisdiction: ${a.NAME}`, 'info'], [69, null, (a) => `Fire district ${a.FIREDIST || a.DISTRICT_ || ''}, station ${a.STATION || ''}`, 'info'],
    [18, null, (a) => `Cell tower on or touching the parcel: ${a.Company || ''} ${a.Height ? a.Height + ' ft' : ''}`, 'warn'], [19, null, (a) => `Billboard on or touching the parcel${a.OVERALL_HE ? `, ${a.OVERALL_HE} ft tall` : ''}`, 'warn'],
    [16, null, (a) => `Septic system permit on record (${a.Permit_No || 'no number'}, ${a.Facility_Type || ''})`, 'info'], [14, null, (a) => `Existing stormwater BMP: ${a.BMP_Type || ''} ${a.Development_Name || ''}`.trim(), 'info'],
  ];
  jobs.push(safe('Overlays', async () => {
    const overlays = new Set(F('zoning.overlays') || []);
    await Promise.all(OVERLAY_LAYERS.map(async ([id, ov, txt, lvl]) => {
      const fs = await arcQuery(`${CL}/${id}`, { geom: inset(P, 3) || P, geometry: false }).catch(() => []);
      const seen = new Set();
      for (const f of fs) { const t = txt(f.attributes); if (seen.has(t)) continue; seen.add(t); find(id === 55 || id === 71 || id === 69 ? 'Planning' : 'Zoning', esc(t), lvl === 'error' ? 'error' : lvl); if (ov && ov !== 'Moratorium') { overlays.add(ov); if (ov === 'downtown') overlays.add('design_review'); } }
    }));
    set('zoning.overlays', [...overlays], 'County overlay layers');
  }));
  // neighbors → adjacent land uses
  jobs.push(safe('Neighboring parcels', async () => {
    const big = inset(P, -12) || P;
    const nb = (await arcQuery(`${ACC}/ACC_Parcels/FeatureServer/0`, { geom: big, fields: 'PARCEL_NO,PAR_ADD' })).filter(f => f.attributes.PARCEL_NO !== p.a.PARCEL_NO);
    if (!nb.length) return;
    const ids = [...new Set(nb.map(f => f.attributes.PARCEL_NO))].slice(0, 40).map(s => `'${s.replace(/'/g, "''")}'`).join(',');
    const zs = await arcQuery(`${CL}/54`, { where: `PARCEL_NO IN (${ids})`, geometry: false, fields: 'PARCEL_NO,CurrentZn' });
    const zmap = new Map(zs.map(z => [z.attributes.PARCEL_NO, (z.attributes.CurrentZn || '').trim()]));
    const c = centroid(P); const bySide = {};
    for (const f of nb) {
      const r = ringsOf(f.geometry)[0]; if (!r) continue; const q = centroid(r); const dx = q[0] - c[0], dy = q[1] - c[1];
      const side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'north' : 'south');
      const z = zmap.get(f.attributes.PARCEL_NO) || ''; const use = ZONE_USE(z);
      const rank = { single_family: 5, multifamily: 4, industrial: 3, commercial: 2, office: 2, institutional: 1, agricultural: 1, vacant: 0 }[use] || 0;
      if (!bySide[side] || rank > bySide[side].rank) bySide[side] = { use, rank, z, addr: (f.attributes.PAR_ADD || '').trim() };
    }
    const list = Object.entries(bySide).map(([side, v]) => ({ side, use: v.use }));
    set('parcel.adjacentUses', list, 'Zoning of touching parcels');
    find('Neighbors', Object.entries(bySide).map(([s, v]) => `${s}: ${esc(v.z || '—')} (${optLabel(v.use)})`).join(' · '), Object.values(bySide).some(v => v.use === 'single_family' || v.use === 'multifamily') ? 'warn' : 'info');
  }));
  // roads, frontage, intersections, ROW expansion
  jobs.push(safe('Roads', async () => {
    const [rs, widths, lanes, ints, roww, walks] = await Promise.all([
      arcQuery(`${CL}/70`, { geom: env, fields: 'ROAD_NAME,CLASSIFICA,E911Class,SEGMENTID' }),
      arcQuery(`${ACC}/TPWStreetWidth/FeatureServer/0`, { geom: env, fields: 'SEGMENTID,STREETWIDTH', geometry: false }).catch(() => []),
      arcQuery(`${ACC}/TPWStreetNumberOfLanes/FeatureServer/0`, { geom: env, fields: 'SEGMENTID,NUMLANES', geometry: false }).catch(() => []),
      arcQuery(`${ACC}/TPW_Streets/FeatureServer/0`, { geom: env, fields: 'STREETS' }).catch(() => []),
      arcQuery(`${CL}/61`, { geom: inset(P, -80) || P, geometry: false }).catch(() => []),
      arcQuery(`${CL}/13`, { geom: inset(P, -60) || P, fields: 'TYPE,SingleBoth' }).catch(() => []),
    ]);
    const wmap = new Map(widths.map(f => [f.attributes.SEGMENTID, f.attributes.STREETWIDTH])), lmap = new Map(lanes.map(f => [f.attributes.SEGMENTID, f.attributes.NUMLANES]));
    CTX.roads = rs.flatMap(f => pathsOf(f.geometry).flatMap(l => clipLine(l, box)).map(pts => ({ pts, name: (f.attributes.ROAD_NAME || '').trim(), cls: ROAD_CLASS(f.attributes.CLASSIFICA || f.attributes.E911Class), width: +wmap.get(f.attributes.SEGMENTID) || null, lanes: +lmap.get(f.attributes.SEGMENTID) || null })));
    CTX.intersections = ints.map(f => ({ pt: ptOf(f.geometry), name: f.attributes.STREETS })).filter(i => i.pt);
    // frontage: lot lines within 90 ft of a road centerline and roughly parallel to it
    const E = edgeInfo(ccw(S.parcel)); let best = null; const fronts = [];
    for (const e of E) {
      const m = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2]; let near = null;
      for (const r of CTX.roads) for (let i = 1; i < r.pts.length; i++) { const d = segDist(m, r.pts[i - 1], r.pts[i]); if (!near || d < near.d) near = { d, r, a: r.pts[i - 1], b: r.pts[i] }; }
      if (!near || near.d > 90 || e.len < 20) continue;
      const u1 = [(e.b[0] - e.a[0]) / e.len, (e.b[1] - e.a[1]) / e.len], L2 = Math.hypot(near.b[0] - near.a[0], near.b[1] - near.a[1]) || 1; const u2 = [(near.b[0] - near.a[0]) / L2, (near.b[1] - near.a[1]) / L2];
      if (Math.abs(u1[0] * u2[0] + u1[1] * u2[1]) < 0.6) continue;
      fronts.push({ e, road: near.r }); const score = ROAD_RANK[near.r.cls] * 10000 + e.len; if (!best || score > best.score) best = { score, e, road: near.r };
    }
    if (best) {
      const n = [(best.e.b[1] - best.e.a[1]) / best.e.len, -(best.e.b[0] - best.e.a[0]) / best.e.len];
      const side = Math.abs(n[0]) > Math.abs(n[1]) ? (n[0] > 0 ? 'east' : 'west') : (n[1] > 0 ? 'north' : 'south');
      set('parcel.frontageSide', side, `Faces ${best.road.name}`);
      set('access.roadClassification', best.road.cls, `${best.road.name} classification`);
      const names = [...new Set(fronts.map(f => f.road.name))];
      find('Access', `Frontage on ${names.map(esc).join(' and ')}${names.length > 1 ? ' (corner lot)' : ''}. ${esc(best.road.name)}: ${optLabel(best.road.cls).toLowerCase()}${best.road.width ? `, ${best.road.width} ft wide` : ''}${best.road.lanes ? `, ${best.road.lanes} lanes` : ''}.`, 'key');
    } else find('Access', 'No public road centerline runs along this parcel. It may be landlocked or reached by easement.', 'warn');
    const near = CTX.intersections.map(i => ({ i, d: polyDist(i.pt, S.parcel) })).sort((a, b) => a.d - b.d)[0];
    if (near) find('Access', `Nearest intersection: ${esc(near.i.name || '')}, ${fmt(near.d)} ft from the property line.`);
    if (roww.length) find('Access', `Right-of-way expansion is planned along ${esc(roww.map(f => f.attributes.Road_Name).filter(Boolean).join(', '))}. Expect a dedication; set the right-of-way dedication depth.`, 'warn');
    if (walks.length) { set('access.frontageSidewalkRequired', true, 'Sidewalk network along frontage'); find('Access', `Existing or mapped sidewalk along the frontage (${walks.length} segment${walks.length > 1 ? 's' : ''}).`); }
  }));
  // utilities
  jobs.push(safe('Utilities', async () => {
    const [wm, sm, hy, mh] = await Promise.all([
      arcQuery(`${CL}/4`, { geom: env, fields: 'DIAMETER,MATERIAL,FACILITYID' }), arcQuery(`${CL}/5`, { geom: env, fields: 'DIAMETER,MATERIAL,FACILITYID,FROMMH,TOMH' }),
      arcQuery(`${CL}/6`, { geom: env, fields: 'FACILITYID,OPERABLE' }), arcQuery(`${CL}/7`, { geom: env, fields: 'FACILITYID,INVERTELEV,RIMELEV,INVERT' }),
    ]);
    CTX.water = wm.flatMap(f => pathsOf(f.geometry).flatMap(l => clipLine(l, box)).map(pts => ({ pts, dia: +f.attributes.DIAMETER || null, mat: f.attributes.MATERIAL, id: f.attributes.FACILITYID })));
    CTX.sewer = sm.flatMap(f => pathsOf(f.geometry).flatMap(l => clipLine(l, box)).map(pts => ({ pts, dia: +f.attributes.DIAMETER || null, mat: f.attributes.MATERIAL, id: f.attributes.FACILITYID })));
    CTX.hydrants = hy.map(f => ({ pt: ptOf(f.geometry), id: f.attributes.FACILITYID })).filter(h => h.pt);
    CTX.manholes = mh.map(f => ({ pt: ptOf(f.geometry), id: f.attributes.FACILITYID, inv: +f.attributes.INVERTELEV || null, rim: +f.attributes.RIMELEV || null })).filter(m => m.pt);
    const w = nearestOnLines(CTX.water, S.parcel);
    if (w) {
      set('utilities.waterTieInLocation', w.pt.map(v => +v.toFixed(1)), 'Nearest public water main');
      if (w.line.dia) set('utilities.waterMainDiameter', w.line.dia, `Main ${w.line.id || ''}`);
      set('utilities.offsiteExtensionLength', Math.round(Math.max(0, w.d - 75)), 'Distance to the nearest main beyond a typical 75 ft service run');
      find('Utilities', `Water: ${w.line.dia ? w.line.dia + '-inch ' : ''}${w.line.mat || ''} main ${fmt(w.d)} ft from the property line.`, w.d > 250 ? 'warn' : 'info');
    } else { find('Utilities', 'No public water main within 400 ft. Plan for an extension or a well.', 'warn'); set('utilities.offsiteExtensionLength', 400, 'No main within 400 ft'); }
    const s = nearestOnLines(CTX.sewer, S.parcel);
    if (s) {
      set('utilities.sewerAvailable', true, 'Public sewer mapped nearby'); set('utilities.sewerTieInLocation', s.pt.map(v => +v.toFixed(1)), 'Nearest public sewer main');
      const mhs = CTX.manholes.filter(m => m.inv > 100).map(m => ({ m, d: Math.hypot(m.pt[0] - s.pt[0], m.pt[1] - s.pt[1]) })).sort((a, b) => a.d - b.d);
      if (mhs[0] && mhs[0].d < 400) set('utilities.sewerInvertElevation', +mhs[0].m.inv.toFixed(2), `Manhole ${mhs[0].m.id} invert, ${fmt(mhs[0].d)} ft from the tie-in`);
      find('Utilities', `Sewer: ${s.line.dia ? s.line.dia + '-inch ' : ''}main ${fmt(s.d)} ft from the property line${mhs[0] && mhs[0].d < 400 ? `; nearest manhole ${mhs[0].m.id} has invert ${fmt(mhs[0].m.inv, 1)} ft${mhs[0].m.rim ? `, rim ${fmt(mhs[0].m.rim, 1)} ft` : ''}` : ''}.`, s.d > 250 ? 'warn' : 'info');
    } else { set('utilities.sewerAvailable', false, 'No sewer main within 400 ft'); find('Utilities', 'No public sewer main within 400 ft. A septic system or lift station may be needed.', 'warn'); }
    const hs = CTX.hydrants.map(h => ({ h, d: polyDist(h.pt, S.parcel) })).sort((a, b) => a.d - b.d);
    find('Utilities', hs.length ? `Fire hydrants: ${hs.length} within 400 ft; nearest ${fmt(hs[0].d)} ft from the property line.` : 'No fire hydrant within 400 ft of the parcel.', hs.length && hs[0].d < 300 ? 'info' : 'warn');
  }));
  // environment: flood (FEMA), wetlands, streams, river buffers, buildings, impervious, watershed
  jobs.push(safe('FEMA flood', async () => {
    R.sources.add('FEMA National Flood Hazard Layer');
    const fz = await arcQuery('https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28', { geom: env, fields: 'FLD_ZONE,ZONE_SUBTY,STATIC_BFE', offset: 0.000008 });
    const polys = []; let zone = 'X', bfe = null;
    for (const f of fz) {
      const z = f.attributes.FLD_ZONE; const rs = ringsOf(f.geometry);
      const hits = rs.some(touchesParcel);
      if (z && /^(A|V)/.test(z)) { for (const r of rs) { const c = clipPoly(r, site); if (c) polys.push(c); } if (hits) { zone = z === 'AE' && /FLOODWAY/i.test(f.attributes.ZONE_SUBTY || '') ? 'floodway' : z; if (f.attributes.STATIC_BFE > 0) bfe = Math.max(bfe || 0, f.attributes.STATIC_BFE); } }
      else if (hits && zone === 'X' && /0\.2 PCT/i.test(f.attributes.ZONE_SUBTY || '')) zone = 'X_shaded';
    }
    if (!bfe && /^A/.test(zone)) {
      const lines = await arcQuery('https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/16', { geom: env, fields: 'ELEV' }).catch(() => []);
      const el = lines.map(l => +l.attributes.ELEV).filter(v => v > 0); if (el.length) bfe = Math.max(...el);
    }
    const options = FIELDS['siteConditions.floodZone'].options;
    set('siteConditions.floodZone', options.includes(zone) ? zone : 'A', 'FEMA NFHL');
    if (polys.length) set('siteConditions.floodplainAreas', polys, 'FEMA special flood hazard areas');
    if (bfe) set('siteConditions.baseFloodElevation', +bfe.toFixed(1), 'FEMA base flood elevation');
    find('Environment', zone === 'X' ? 'FEMA flood zone X: minimal flood hazard.' : zone === 'X_shaded' ? 'Part of the parcel is in the 0.2% annual chance (500-year) floodplain.' : `Part of the parcel is in FEMA flood zone ${zone}${bfe ? `, base flood elevation ${fmt(bfe, 1)} ft` : ''}. Floodplain areas are excluded from building and parking.`, zone === 'X' ? 'info' : 'warn');
  }));
  jobs.push(safe('Wetlands, streams and buffers', async () => {
    const [wet, hydro, b75, b100, b150, b200, bld, imp, ws] = await Promise.all([
      arcQuery(`${CL}/35`, { geom: env, fields: 'CLASS_CODE' }), arcQuery(`${CL}/26`, { geom: env, fields: 'Type,source' }),
      arcQuery(`${CL}/31`, { geom: env, fields: 'NAME,BUFF_DIST' }).catch(() => []), arcQuery(`${CL}/32`, { geom: env, fields: 'DESCRIPTION,BUFF_DIST' }).catch(() => []),
      arcQuery(`${CL}/33`, { geom: env, fields: 'BUFF_DIST' }).catch(() => []), arcQuery(`${CL}/34`, { geom: env }).catch(() => []),
      arcQuery(`${CL}/2`, { geom: P, fields: 'Type,BLDG_ID' }), arcQuery(`${CL}/15`, { where: `PARCEL_NO='${p.a.PARCEL_NO}'`, geometry: false, fields: 'ImpervAcres,PercentImperv,ACRES,Type' }).catch(() => []),
      arcQuery(`${ACC}/ACC_Watersheds/FeatureServer/0`, { geom: P, geometry: false, fields: 'NAME' }).catch(() => []),
    ]);
    const wp = wet.flatMap(f => ringsOf(f.geometry)).map(r => clipPoly(r, site)).filter(Boolean);
    if (wp.length) { set('siteConditions.wetlands', wp, 'County wetlands layer'); find('Environment', `${wp.length} mapped wetland area${wp.length > 1 ? 's' : ''} on or next to the parcel (${[...new Set(wet.map(f => f.attributes.CLASS_CODE))].join(', ')}). Confirm with a delineation.`, 'warn'); }
    const st = hydro.flatMap(f => pathsOf(f.geometry)).flatMap(l => clipLine(l, site)).filter(l => polyLen(l) > 15);
    if (st.length) { set('siteConditions.streams', st, 'County hydrology lines'); find('Environment', `${st.length} mapped stream or drainage line${st.length > 1 ? 's' : ''} on or next to the parcel. State waters carry a 25 ft buffer; ACC river buffers may be larger.`, 'warn'); }
    const easements = [];
    for (const [fs, name] of [[b75, '75 ft river buffer'], [b100, '100 ft river buffer'], [b150, '150 ft river buffer'], [b200, '200 ft state water buffer']]) for (const f of fs) for (const r of ringsOf(f.geometry)) { if (!touchesParcel(r)) continue; const c = clipPoly(r, site); if (c) easements.push({ type: 'conservation', geometry: c, buildingAllowed: false, pavingAllowed: false, note: name }); }
    if (easements.length) { set('parcel.easements', easements, 'County river and state-water buffers'); find('Environment', `River or state-water buffer crosses the parcel: ${[...new Set(easements.map(e => e.note))].join(', ')}. Added as no-build, no-pave areas.`, 'warn'); }
    const bp = bld.flatMap(f => ringsOf(f.geometry)).filter(touchesParcel).map(r => clipPoly(r, site)).filter(Boolean);
    if (bp.length) { set('siteConditions.existingStructures', bp, 'County building footprints'); find('Site', `${bp.length} existing building${bp.length > 1 ? 's' : ''} (${fmt(bp.reduce((s, b) => s + Math.abs(area(b)), 0))} sf of footprint). Turn on “Demolition required” to clear them.`, 'info'); }
    if (imp.length) {
      // The county stores one record per surface type (parking, building, sidewalk...); add them up.
      const siteAc = +imp[0].attributes.ACRES || Math.abs(area(S.parcel)) / 43560;
      const byType = {}; let ac = 0;
      for (const r of imp) { const a = +r.attributes.ImpervAcres || 0; ac += a; const t = (r.attributes.Type || 'other').trim(); byType[t] = (byType[t] || 0) + a; }
      const frac = Math.min(1, ac / siteAc);
      const c = frac * num('stormwater.runoffCoefficientImpervious', 0.95) + (1 - frac) * num('stormwater.runoffCoefficientPervious', 0.25);
      set('stormwater.runoffCoefficientPre', +c.toFixed(2), `${fmt(frac * 100)}% existing impervious`);
      const parts = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, a]) => `${t} ${fmt(a / siteAc * 100, 1)}%`).join(', ');
      find('Site', `Existing impervious cover: ${fmt(frac * 100)}% (${fmt(ac, 2)} ac): ${esc(parts)}. Redevelopment may get credit for existing impervious area under the stormwater rules.`);
    }
    if (ws[0]) find('Environment', `Watershed: ${esc(ws[0].attributes.NAME)}.`);
  }));
  jobs.push(safe('Soils', async () => {
    R.sources.add('USDA NRCS Soil Data Access');
    const wkt = 'polygon((' + S.parcel.concat([S.parcel[0]]).map(q => w2ll(q).map(v => v.toFixed(6)).join(' ')).join(',') + '))';
    const q = `SELECT mu.musym, mu.muname, c.hydgrp, c.drainagecl, c.hydricrating, c.comppct_r FROM mapunit mu INNER JOIN component c ON c.mukey=mu.mukey AND c.majcompflag='Yes' WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${wkt}'))`;
    const j = await getJSON('https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, format: 'JSON' }) });
    const rows = (j.Table || []).map(r => ({ sym: r[0], name: r[1], hsg: r[2], drain: r[3], hydric: r[4] }));
    const uniq = [...new Map(rows.map(r => [r.sym, r])).values()];
    if (!uniq.length) return;
    const bad = uniq.some(r => /poorly/i.test(r.drain || '') || r.hydric === 'Yes');
    set('siteConditions.unsuitableSoils', bad, bad ? 'Poorly drained or hydric soil mapped' : 'Mapped soils are well drained');
    find('Environment', `Soils: ${uniq.map(r => `${esc(r.name)} (group ${r.hsg || '?'}, ${(r.drain || '').toLowerCase()})`).join('; ')}.`, bad ? 'warn' : 'info');
  }));
  jobs.push(safe('Elevation', async () => {
    R.sources.add('USGS 3DEP elevation');
    const N = 18, pts = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pts.push([bb0.x0 - 30 + (bb0.x1 - bb0.x0 + 60) * i / (N - 1), bb0.y0 - 30 + (bb0.y1 - bb0.y0 + 60) * j / (N - 1)]);
    const geom = { points: pts.map(w2ll).map(q => [+q[0].toFixed(7), +q[1].toFixed(7)]), spatialReference: { wkid: 4326 } };
    const body = new URLSearchParams({ f: 'json', geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true', geometry: JSON.stringify(geom) });
    const j = await getJSON('https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    const z = new Array(pts.length).fill(null);
    for (const s of j.samples || []) { const v = +s.value; if (isFinite(v) && v > -500) z[s.locationId] = v * 3.28084; }
    const inPts = pts.map((q, k) => ({ q, z: z[k] })).filter(o => o.z != null && inside(o.q, S.parcel));
    if (inPts.length < 4) return;
    let hi = inPts[0], lo = inPts[0]; for (const o of inPts) { if (o.z > hi.z) hi = o; if (o.z < lo.z) lo = o; }
    // least-squares plane z = a x + b y + c for average slope and fall direction
    const n = inPts.length; let sx = 0, sy = 0, sz = 0; for (const o of inPts) { sx += o.q[0]; sy += o.q[1]; sz += o.z; }
    const mx = sx / n, my = sy / n, mz = sz / n; let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
    for (const o of inPts) { const dx = o.q[0] - mx, dy = o.q[1] - my, dz = o.z - mz; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; sxz += dx * dz; syz += dy * dz; }
    const det = sxx * syy - sxy * sxy; const a = det ? (sxz * syy - syz * sxy) / det : 0, b = det ? (syz * sxx - sxz * sxy) / det : 0;
    const slope = Math.hypot(a, b) * 100; const bearing = ((Math.atan2(-a, -b) / DEG) + 360) % 360;
    set('siteConditions.elevationHigh', +hi.z.toFixed(1), 'USGS 3DEP');
    set('siteConditions.elevationLow', +lo.z.toFixed(1), 'USGS 3DEP');
    set('siteConditions.lowPointLocation', lo.q.map(v => +v.toFixed(1)), 'Lowest sampled point');
    set('siteConditions.averageSlope', +slope.toFixed(1), 'Plane fit to USGS 3DEP');
    set('siteConditions.slopeDirection', Math.round(bearing), 'Plane fit to USGS 3DEP');
    // contours by marching squares at the contour interval
    const iv = Math.max(0.5, num('siteConditions.contourInterval', 2)); const segs = {};
    const Z = (i, jj) => z[jj * N + i], Pt = (i, jj) => pts[jj * N + i];
    const lerp = (p1, z1, p2, z2, lv) => { const t = (lv - z1) / (z2 - z1); return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]; };
    const zmin = Math.min(...z.filter(v => v != null)), zmax = Math.max(...z.filter(v => v != null));
    for (let lv = Math.ceil(zmin / iv) * iv; lv <= zmax; lv += iv) {
      const list = segs[lv] = [];
      for (let jj = 0; jj < N - 1; jj++) for (let i = 0; i < N - 1; i++) {
        const c = [[Pt(i, jj), Z(i, jj)], [Pt(i + 1, jj), Z(i + 1, jj)], [Pt(i + 1, jj + 1), Z(i + 1, jj + 1)], [Pt(i, jj + 1), Z(i, jj + 1)]];
        if (c.some(k => k[1] == null)) continue;
        const cr = []; for (let k = 0; k < 4; k++) { const [p1, z1] = c[k], [p2, z2] = c[(k + 1) % 4]; if ((z1 < lv) !== (z2 < lv)) cr.push(lerp(p1, z1, p2, z2, lv)); }
        if (cr.length === 2) list.push(cr); else if (cr.length === 4) { list.push([cr[0], cr[1]]); list.push([cr[2], cr[3]]); }
      }
    }
    const contours = [];
    for (const [lv, list] of Object.entries(segs)) {
      const key = (p) => p[0].toFixed(2) + ',' + p[1].toFixed(2); const used = new Array(list.length).fill(false);
      for (let s0 = 0; s0 < list.length; s0++) {
        if (used[s0]) continue; used[s0] = true; const line = [list[s0][0], list[s0][1]];
        for (let grow = true; grow;) { grow = false; for (let k = 0; k < list.length; k++) { if (used[k]) continue; const [p, q] = list[k]; const e = key(line[line.length - 1]), s = key(line[0]);
          if (key(p) === e) { line.push(q); used[k] = grow = true; } else if (key(q) === e) { line.push(p); used[k] = grow = true; } else if (key(q) === s) { line.unshift(p); used[k] = grow = true; } else if (key(p) === s) { line.unshift(q); used[k] = grow = true; } } }
        if (polyLen(line) > 20) contours.push({ elevation: +(+lv).toFixed(1), geometry: line.map(q => [+q[0].toFixed(1), +q[1].toFixed(1)]) });
      }
    }
    if (contours.length) set('siteConditions.contours', contours, `${iv} ft contours from USGS 3DEP`);
    find('Topography', `Ground runs ${fmt(lo.z, 1)} to ${fmt(hi.z, 1)} ft (${fmt(hi.z - lo.z, 1)} ft of relief), average slope ${fmt(slope, 1)}% falling toward ${Math.round(bearing)}° (${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearing / 45) % 8]}).`, slope > 8 ? 'warn' : 'info');
  }));

  let done = 0; jobs.forEach(j => j.then(() => setStatus(`Loading parcel data… ${++done}/${jobs.length}`, done / jobs.length)));
  await Promise.all(jobs);
  if (CTX.report !== R) return; // another parcel was loaded meanwhile
  R.ms = Math.round(performance.now() - t0);
  const pkey = accProfileFor(F('zoning.district'));
  if (pkey) {
    applyProfile(pkey);
    for (const [id, v] of R.filled) { S.F[id] = v; S.touched.add(id); }
    const zf = R.findings.find(x => x.group === 'Zoning' && x.level === 'key');
    if (zf) zf.text = `Zoned <b>${esc(F('zoning.district'))}</b>. Applied the ${esc(PROFILES[pkey.slice(2)].label)} profile from the ACC zoning code: setbacks, height, FAR, coverage, landscaping, buffers and parking ratios. <a href="${ZONING_CODE_URL}" target="_blank" rel="noopener">Read the code</a>.`;
  } else if (F('zoning.district')) find('Zoning', `No built-in profile for ${esc(F('zoning.district'))} (planned developments follow their own approved plan). Generic values are still in use.`, 'warn');
  S.P.profile = S.P.profile; syncAutoObjects(true);
  renderAllSections(); computeEnv(); renderParcelFacts(); renderLegend(); renderObjList(); renderObjEditor(); renderReqBreak(); renderAnalysis(); renderSiteData();
  draw(); scheduleSolve(0);
  setStatus(`Loaded ${p.a.PARCEL_NO}: ${R.filled.length} inputs filled`, null);
  $('#rTabs [data-r="site"]').click();
}

/* ---------- search: address or parcel number ---------- */
async function countySearch(q) {
  const err = $('#mapErr'); err.hidden = true;
  if (EMBEDDED) { err.innerHTML = 'County data only loads in the hosted version of Lotline. Claude\'s viewer blocks outside connections.'; err.hidden = false; return; }
  const btn = $('#btnFind'); btn.disabled = true;
  try {
    const ll = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    let pt = null, parcel = null;
    if (ll) pt = { y: +ll[1], x: +ll[2] };
    else if (/^\s*\d{3}[A-Z0-9]?\d?\s*[A-Z]?\s*\d{3}/i.test(q) && !/\b(st|ave|rd|dr|ln|ct|way|blvd|hwy|pkwy|cir|pl)\b/i.test(q)) {
      const pn = q.trim().toUpperCase().replace(/'/g, "''");
      const tight = pn.replace(/\s+/g, ''); const spaced = tight.length > 5 ? tight.slice(0, 5) + ' ' + tight.slice(5) : tight;
      const fs = await arcQuery(`${ACC}/ACC_Parcels/FeatureServer/0`, { where: `PARCEL_NO LIKE '${pn.replace(/\s+/g, ' ')}%' OR PARCEL_NO LIKE '${spaced}%'`, fields: 'OBJECTID,PARCEL_NO,PAR_ADD,ACRES,OWNER_NAME' });
      if (fs[0]) parcel = { a: fs[0].attributes, g: fs[0].geometry };
    }
    // Street part only: city, state and ZIP lower the county geocoder's match score.
    const street = q.split(',')[0].replace(/\b(athens|winterville|bogart)\b\s*(ga|georgia)?\s*(\d{5}(-\d{4})?)?\s*$/i, '').replace(/\s+/g, ' ').trim();
    if (!pt && !parcel && /^\d/.test(street)) {
      // 1. the county address-point layer links addresses straight to parcel numbers
      const ap = await arcQuery(`${ACC}/ACC_Address_Point/FeatureServer/0`, { where: `UPPER(FullAdd) = '${street.toUpperCase().replace(/'/g, "''")}'`, fields: 'FullAdd,ParcelID', geometry: false }).catch(() => []);
      const pid = ap[0] && ap[0].attributes.ParcelID;
      if (pid) { const fs = await arcQuery(`${ACC}/ACC_Parcels/FeatureServer/0`, { where: `PARCEL_NO = '${pid.replace(/'/g, "''")}'`, fields: 'OBJECTID,PARCEL_NO,PAR_ADD,ACRES,OWNER_NAME' }); if (fs[0]) parcel = { a: fs[0].attributes, g: fs[0].geometry }; }
    }
    if (!pt && !parcel) {
      // 2. the county geocoder handles spelled-out or partial addresses
      const j = await getJSON(`${ACC}/Geocoder/CityworksLocator/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(street || q)}&outSR=4326&maxLocations=1&f=json`).catch(() => null);
      const c = j && j.candidates && j.candidates[0];
      if (c && c.score >= 80) pt = c.location;
    }
    if (!pt && !parcel) { btn.disabled = false; return locate(q); } // outside the county: fall back to the general geocoder
    if (!parcel && pt) {
      if (!inACC(pt.y, pt.x)) { btn.disabled = false; return locate(q); }
      const fs = await arcQuery(`${ACC}/ACC_Parcels/FeatureServer/0`, { geom: [pt.x - 0.00001, pt.y - 0.00001, pt.x + 0.00001, pt.y + 0.00001], fields: 'OBJECTID,PARCEL_NO,PAR_ADD,ACRES,OWNER_NAME' });
      if (fs[0]) parcel = { a: fs[0].attributes, g: fs[0].geometry };
    }
    btn.disabled = false;
    if (!parcel) { err.textContent = 'Found the location but no county parcel there.'; err.hidden = false; return; }
    if (!S.geo) S.geo = { lat: parcel.g.rings[0][0][1], lng: parcel.g.rings[0][0][0] };
    await loadCountyParcel(parcel);
  } catch (e) { btn.disabled = false; err.textContent = `County search failed: ${e.message}.`; err.hidden = false; }
}

/* ---------- panel ---------- */
function setCountyNote(t) { const n = $('#countyNote'); if (n) n.textContent = t; }
function renderSiteData() {
  const R = CTX.report, el = $('#siteDataOut');
  if (EMBEDDED) { el.innerHTML = '<p class="note">Live county data only loads in the hosted version of Lotline. Claude\'s viewer blocks outside connections, so open the GitHub Pages link to search Athens-Clarke parcels.</p>'; return; }
  if (!R) { el.innerHTML = '<p class="note">Search an Athens-Clarke address or parcel number on the Map tab, or turn on county parcels and pick one on the map. Lotline then pulls zoning, overlays, flood zone, wetlands, streams, soils, topography, utilities, roads and neighbors, and fills in the matching inputs.</p>'; return; }
  const order = ['Zoning', 'Access', 'Utilities', 'Environment', 'Topography', 'Site', 'Neighbors', 'Planning', 'Parcel', 'Data gaps'];
  const lv = { error: 'fail', warn: 'warn', key: 'info', info: 'pass' };
  const groups = order.map(g => [g, R.findings.filter(f => f.group === g)]).filter(([, l]) => l.length);
  el.innerHTML = `<div class="kv"><span><b style="font-family:var(--f-body)">${esc((R.parcel.PAR_ADD || '').trim())}</b></span><b>${esc(R.parcel.PARCEL_NO)}</b></div>
    ${groups.map(([g, list]) => `<div class="chkgrp"><div class="sub">${g}</div>${list.map(f => `<div class="chk ${lv[f.level] || 'pass'}"><i></i><span class="d" style="grid-row:span 2;color:var(--ink)">${f.text}</span></div>`).join('')}</div>`).join('')}
    <details class="more" open><summary>${R.filled.length} inputs filled from this data</summary><ul style="columns:1">${R.filled.filter(([id]) => FIELDS[id]).map(([id, v, why]) => `<li><b>${esc(FIELDS[id].label)}</b>: ${esc(id === 'parcel.boundary' ? `${v.length} corners` : Array.isArray(v) ? (typeof v[0] === 'number' ? v.map(n => fmt(n, 1)).join(', ') : `${v.length} item${v.length === 1 ? '' : 's'}`) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : optLabel(v))} <span class="note">· ${esc(why)}</span></li>`).join('')}</ul></details>
    <p class="note">Sources: ${[...R.sources].join(', ')}. Mapped data is for screening; confirm with a boundary survey, title search and agency letters.</p>`;
}

/* ---------- wiring ---------- */
const pickBtn = $('#btnPick');
pickBtn.addEventListener('click', () => {
  if (EMBEDDED) { setCountyNote('County data only loads in the hosted version. Claude\'s viewer blocks outside connections.'); return; }
  if (!S.geo) { setCountyNote('Search an address first so the map knows where to look.'); return; }
  CTX.pick = !CTX.pick; CTX.show = true; $('#showCounty').checked = true; pickBtn.classList.toggle('on', CTX.pick); ovKey = ''; loadOverlay();
  setCountyNote(CTX.pick ? 'Click a parcel on the plan to load it.' : '');
});
$('#showCounty').addEventListener('change', (e) => { CTX.show = e.target.checked; ovKey = ''; if (CTX.show) loadOverlay(); draw(); });
cv.addEventListener('pointerdown', (e) => {
  if (!CTX.pick || S.mode !== 'select' || !S.geo) return;
  const r = cv.getBoundingClientRect(); const w = S2W(e.clientX - r.left, e.clientY - r.top); const p = parcelAt(w);
  if (p) { e.stopImmediatePropagation(); loadCountyParcel(p); }
}, true);
cv.addEventListener('pointermove', (e) => {
  if (!CTX.pick || !S.geo) { if (CTX.hover) { CTX.hover = null; draw(); } return; }
  const r = cv.getBoundingClientRect(); const p = parcelAt(S2W(e.clientX - r.left, e.clientY - r.top));
  if (p !== CTX.hover) { CTX.hover = p; cv.title = p ? `${(p.a.PAR_ADD || '').trim()} · ${p.a.PARCEL_NO} · ${fmt(p.a.ACRES, 2)} ac` : ''; draw(); }
});
if (EMBEDDED) { $('#countyBox').querySelector('.note').innerHTML = '<b>Live Athens-Clarke parcels</b> load in the hosted version of Lotline. Claude\'s viewer blocks outside connections.'; }

/* Clear the previous parcel's county data when a search lands somewhere the county layers don't cover. */
function resetCountyContext() {
  CTX.report = null; CTX.selected = null; CTX.water = []; CTX.sewer = []; CTX.hydrants = []; CTX.manholes = []; CTX.roads = []; CTX.intersections = [];
  for (const id of GEO_FIELDS) { delete S.F[id]; S.touched.delete(id); }
  for (const id of ['zoning.district', 'zoning.overlays', 'siteConditions.floodZone', 'siteConditions.baseFloodElevation', 'siteConditions.elevationHigh', 'siteConditions.elevationLow', 'siteConditions.averageSlope', 'siteConditions.slopeDirection']) { delete S.F[id]; S.touched.delete(id); }
  renderSiteData();
}
