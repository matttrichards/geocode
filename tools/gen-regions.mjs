// SPDX-License-Identifier: Apache-2.0
/* ============================================================
   gen-regions.mjs — build the FROZEN geo7 region table.

   Inputs (Natural Earth 1:50m, public domain):
     data/ne_50m_admin_0_countries.geojson
     data/ne_50m_admin_1_states_provinces.geojson   (covers 9 large countries)

   Rules (per design decisions):
   - One box per CONTIGUOUS country (no political subdivisions).
   - Non-contiguous far pieces (> SPLIT_GAP° from the main landmass) get their
     own box, labelled obviously:
        * separately ISO-coded territory  -> SOV-<ISO2>     (US-PR, FR-PF, GB-FK)
        * named via admin-1 iso_3166_2     -> e.g. US-AK, US-HI
        * famous integral region (override)-> EC-W, ES-CN, FR-GF, ...
        * else                             -> <KEY>-2, -3 ...
   - Antimeridian crossers kept as ONE continuous box (lon may exceed 180).
   - Cells are sized at the equator-most latitude elsewhere (codec), so boxes
     only ever need MORE characters, never coarser than 18 m.

   Output: regions.v1.json  +  a summary to stdout for review.
   Deterministic & reproducible: same inputs -> identical output.
   ============================================================ */

import fs from "node:fs";

const DIR = new URL("../data/", import.meta.url).pathname;
const admin0 = JSON.parse(fs.readFileSync(DIR + "ne_50m_admin_0_countries.geojson", "utf8"));
const admin1 = JSON.parse(fs.readFileSync(DIR + "ne_50m_admin_1_states_provinces.geojson", "utf8"));

const MERGE_GAP = 2.0;   // polygons within this many degrees merge into one cluster
const SPLIT_GAP = 5.0;   // a cluster farther than this from the main is broken out
const MARGIN = 0.03;     // degrees of safety padding added to every box

// Countries kept as a SINGLE box even though they're non-contiguous, because the
// populous part isn't the largest landmass (so an area-based split would bury the
// capital in a "-2" code). Distance alone can't separate these from Alaska, so
// they're an explicit, reviewable keep-whole list.
const NO_SPLIT = new Set(["MY", "GQ"]);

// Famous integral far-regions with no own ISO code and not in sparse admin-1.
// Each: label + a bbox [minLat,maxLat,minLon,maxLon] the cluster centroid must fall in.
const OVERRIDES = [
  ["FR-GF", [2, 6, -55, -51]],     // French Guiana
  ["FR-GP", [15.8, 16.6, -61.9, -61]], // Guadeloupe
  ["FR-MQ", [14.3, 15.0, -61.3, -60.7]], // Martinique
  ["FR-RE", [-21.5, -20.8, 55.2, 55.9]], // Réunion
  ["FR-YT", [-13.1, -12.6, 45.0, 45.4]], // Mayotte
  ["EC-W",  [-1.6, 0.8, -92.2, -89]],  // Galápagos
  ["CL-EI", [-27.3, -27.0, -109.6, -109.1]], // Easter Island
  ["ES-CN", [27.4, 29.6, -18.4, -13.2]], // Canary Islands
  ["PT-20", [36.8, 39.9, -31.5, -24.9]], // Azores
  ["PT-30", [32.3, 33.2, -17.4, -16.1]], // Madeira
  ["FR-GP", [14.0, 17.0, -62.0, -60.6]], // French Antilles (Guadeloupe + Martinique)
  ["NL-CW", [11.7, 12.9, -70.3, -67.9]], // Dutch Caribbean ABC (Aruba/Curaçao/Bonaire)
  ["NL-SX", [17.0, 18.3, -63.5, -62.8]], // Dutch Caribbean SSS (St-Maarten/Saba/St-Eustatius)
  ["NO-SJ", [74.0, 81.5, 8.0, 35.0]],    // Svalbard
  ["NO-SJ", [70.4, 71.4, -9.3, -7.4]],   // Jan Mayen
];

// ── geometry helpers ──────────────────────────────────────
const polysOf = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
function ringsBBox(poly) {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const ring of poly) for (const [lon, lat] of ring) {
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
  }
  return [minLat, maxLat, minLon, maxLon];
}
const bboxArea = (b) => (b[1] - b[0]) * (b[3] - b[2]);
const bboxCentroid = (b) => [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2];
function bboxGap(p, q) {
  const dLat = Math.max(0, p[0] - q[1], q[0] - p[1]);
  const dLon = Math.max(0, p[2] - q[3], q[2] - p[3]);
  return Math.max(dLat, dLon);
}
function unionBox(boxes) {
  let b = [90, -90, 180, -180];
  for (const x of boxes) b = [Math.min(b[0], x[0]), Math.max(b[1], x[1]), Math.min(b[2], x[2]), Math.max(b[3], x[3])];
  return b;
}

// Shift a feature's polygons into a continuous longitude frame if it crosses the
// antimeridian (has land both far-west and far-east). Returns polygons whose lons
// may exceed 180 so the box stays continuous.
function normalizeAntimeridian(polys) {
  // v1: no longitude shifting. Antimeridian-crossing pieces simply become their
  // own far clusters (e.g. RU-CHU Chukotka, NZ Chatham Islands), which keeps every
  // box's longitude in [-180,180] and avoids whole-country longitude shifts.
  return polys;
}

// Cluster a set of {bb} by bbox gap <= MERGE_GAP (union-find).
function cluster(items) {
  const parent = items.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
      if (bboxGap(items[i].bb, items[j].bb) <= MERGE_GAP) { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }
  const groups = {};
  items.forEach((it, i) => { const r = find(i); (groups[r] = groups[r] || []).push(it); });
  return Object.values(groups);
}

// ── sovereign ISO2 map: SOVEREIGNT name -> ISO2 of its own feature ──
const sovISO2 = {};
for (const f of admin0.features) {
  const p = f.properties;
  if (p.ADMIN === p.SOVEREIGNT) {
    const iso = p.ISO_A2_EH && p.ISO_A2_EH !== "-99" ? p.ISO_A2_EH : p.ISO_A2;
    if (iso && iso !== "-99") sovISO2[p.SOVEREIGNT] = iso;
  }
}

// ── admin-1 index (for naming far clusters in covered countries) ──
const admin1Index = [];
for (const f of admin1.features) {
  const code = f.properties.iso_3166_2;
  if (!code || code === "-99") continue;
  const boxes = polysOf(f.geometry).map(ringsBBox);
  admin1Index.push({ code, country: f.properties.iso_a2, box: unionBox(boxes) });
}
// Match a far cluster's centroid to an admin-1 unit OF THE SAME COUNTRY ONLY
// (prevents cross-border mislabels like Alaska->RU-KAM). Prefer the smallest box.
function admin1Label(centroid, country) {
  const [lat, lon] = centroid;
  let best = null, bestArea = Infinity;
  for (const u of admin1Index) {
    if (u.country !== country) continue;
    if (lat >= u.box[0] - 0.1 && lat <= u.box[1] + 0.1 && lon >= u.box[2] - 0.1 && lon <= u.box[3] + 0.1) {
      const a = bboxArea(u.box);
      if (a < bestArea) { bestArea = a; best = u.code; }
    }
  }
  return best;
}
function overrideLabel(centroid) {
  const [lat, lon] = centroid;
  for (const [label, b] of OVERRIDES) if (lat >= b[0] && lat <= b[1] && lon >= b[2] && lon <= b[3]) return label;
  return null;
}

// ── build regions ─────────────────────────────────────────
const regions = {};   // key -> { box, name, source }
const names = {};
const splits = [];
const anomalies = [];

function addRegion(key, box, name, source) {
  const padded = [box[0] - MARGIN, box[1] + MARGIN, box[2] - MARGIN, box[3] + MARGIN];
  if (regions[key]) { regions[key].box = unionBox([regions[key].box, padded]); return; }
  regions[key] = { box: padded, name, source };
  names[key] = name;
}

for (const f of admin0.features) {
  const p = f.properties;
  const isoEH = p.ISO_A2_EH && p.ISO_A2_EH !== "-99" ? p.ISO_A2_EH : null;
  const iso = isoEH || (p.ISO_A2 && p.ISO_A2 !== "-99" ? p.ISO_A2 : null);
  const isSovereign = p.ADMIN === p.SOVEREIGNT;
  const parent = sovISO2[p.SOVEREIGNT];
  // base key for this feature's MAIN landmass
  let baseKey;
  if (isSovereign && iso) baseKey = iso;
  else if (parent && iso && parent !== iso) baseKey = `${parent}-${iso}`;
  else if (iso) baseKey = iso;
  else { anomalies.push(`no ISO for ${p.ADMIN}`); continue; }
  const countryForAdmin1 = isSovereign ? iso : parent;

  const polys = normalizeAntimeridian(polysOf(f.geometry));
  const items = polys.map((poly) => ({ bb: ringsBBox(poly) }));
  const groups = cluster(items).map((g) => {
    const b = unionBox(g.map((x) => x.bb));
    return { box: b, area: bboxArea(b), centroid: bboxCentroid(b) };
  }).sort((a, c) => c.area - a.area);

  const main = groups[0];
  addRegion(baseKey, main.box, p.NAME || p.ADMIN, "main");

  // far clusters
  for (const g of groups.slice(1)) {
    if (bboxGap(main.box, g.box) <= SPLIT_GAP || NO_SPLIT.has(baseKey)) { // fold into main
      regions[baseKey].box = unionBox([regions[baseKey].box, [g.box[0] - MARGIN, g.box[1] + MARGIN, g.box[2] - MARGIN, g.box[3] + MARGIN]]);
      continue;
    }
    // genuinely far -> own region, find the best label
    const a1 = admin1Label(g.centroid, countryForAdmin1);
    let key = a1 || overrideLabel(g.centroid);
    let src = a1 ? "admin1" : (key ? "override" : "numeric");
    if (!key) {
      let n = 2; while (regions[`${baseKey}-${n}`]) n++;
      key = `${baseKey}-${n}`;
    }
    addRegion(key, g.box, p.NAME || p.ADMIN, src);
    splits.push({ from: baseKey, key, src, centroid: g.centroid.map((x) => +x.toFixed(1)) });
  }
}

// ── validate: every land vertex lies inside its region box ──
let vChecked = 0, vBad = 0;
function inBox(lat, lon, b) {
  // handle antimeridian boxes (maxLon may exceed 180)
  let L = lon;
  if (b[3] > 180 && L < b[2]) L += 360;
  return lat >= b[0] && lat <= b[1] && L >= b[2] && L <= b[3];
}
// (light validation: check feature main-cluster vertices against SOME region of that feature)
for (const f of admin0.features) {
  const p = f.properties;
  const isoEH = p.ISO_A2_EH && p.ISO_A2_EH !== "-99" ? p.ISO_A2_EH : null;
  const iso = isoEH || (p.ISO_A2 && p.ISO_A2 !== "-99" ? p.ISO_A2 : null);
  if (!iso) continue;
  const candidates = Object.values(regions).map((r) => r.box);
  for (const poly of normalizeAntimeridian(polysOf(f.geometry)))
    for (const ring of poly)
      for (const [lon, lat] of ring) {
        vChecked++;
        if (!candidates.some((b) => inBox(lat, lon, b))) vBad++;
      }
}

// ── write output ──────────────────────────────────────────
const out = {};
for (const [k, v] of Object.entries(regions)) out[k] = v.box.map((x) => +x.toFixed(4));

// FROZEN grid dimensions, precomputed once here so that the codec never calls
// cos()/log() — the only platform-dependent (non-bit-reproducible) functions.
// Every implementation reads these integers and yields identical codes. See SPEC §4.
// cells[key] = [latCells, lonCells, numChars].
const TARGET_M = 18.0, LAT_M = 111320.0, BASE = 28;
const equatorMostLat = (a, b) => (a <= 0 && b >= 0) ? 0 : (Math.abs(a) < Math.abs(b) ? a : b);
function numCharsExact(total) {            // smallest k>=1 with BASE^k >= total (integer-only)
  if (total <= 1) return 1;
  let k = 0, p = 1n; const T = BigInt(total);
  while (p < T) { p *= BigInt(BASE); k++; }
  return k === 0 ? 1 : k;
}
const cells = {};
for (const [k, b] of Object.entries(out)) {
  const [minLat, maxLat, minLon, maxLon] = b;
  const lonM = LAT_M * Math.cos(Math.abs(equatorMostLat(minLat, maxLat)) * Math.PI / 180);
  const latCells = Math.max(1, Math.ceil((maxLat - minLat) * LAT_M / TARGET_M));
  const lonCells = Math.max(1, Math.ceil((maxLon - minLon) * lonM / TARGET_M));
  cells[k] = [latCells, lonCells, numCharsExact(latCells * lonCells)];
}

fs.writeFileSync(new URL("../regions.v1.json", import.meta.url).pathname,
  JSON.stringify({ version: 1, target_m: 18, generated_from: "Natural Earth 1:50m", regions: out, cells, names }, null, 0));

// Emit a codec-importable ES module (the frozen data the codec consumes).
const jsmod =
  "// SPDX-License-Identifier: CC0-1.0\n" +
  "// AUTO-GENERATED by tools/gen-regions.mjs — DO NOT EDIT BY HAND.\n" +
  "// Frozen geo7 region table v1 (source: Natural Earth 1:50m). Mirror of regions.v1.json.\n" +
  "export const REGION_VERSION = 1;\n" +
  "export const BBOXES = " + JSON.stringify(out) + ";\n" +
  "// CELLS[key] = [latCells, lonCells, numChars] — FROZEN grid dimensions.\n" +
  "// Precomputed so encode/decode never call cos()/log(); identical results in any language.\n" +
  "export const CELLS = " + JSON.stringify(cells) + ";\n" +
  "export const COUNTRY_NAMES = " + JSON.stringify(names) + ";\n";
fs.writeFileSync(new URL("../js/regions.gen.js", import.meta.url).pathname, jsmod);

// ── summary ───────────────────────────────────────────────
console.log("regions:", Object.keys(regions).length);
console.log("splits (non-contiguous breakouts):", splits.length,
  "| by source:", ["admin1", "override", "numeric"].map((s) => s + "=" + splits.filter((x) => x.src === s).length).join(" "));
console.log("vertices checked:", vChecked, "| outside-any-box:", vBad);
console.log("\n-- sample splits --");
for (const s of splits.filter((x) => x.src !== "numeric").slice(0, 25)) console.log(`  ${s.key}  (${s.src})  from ${s.from}  @${s.centroid}`);
console.log("\n-- numeric-fallback splits (need review) --");
for (const s of splits.filter((x) => x.src === "numeric")) console.log(`  ${s.key}  @${s.centroid}`);
console.log("\n-- anomalies --", anomalies.length ? anomalies.join("; ") : "none");
