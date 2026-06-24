// SPDX-License-Identifier: Apache-2.0
/* ============================================================
   geo7 — streamlined "code → directions" app
   Recipient-first: a tapped link resolves a base-28 code to a
   pinpoint and hands off to a real nav app. No in-app routing.
   codec.js is reused untouched.
   ============================================================ */

import {
  encode, decode, estimatePrecision, detectCountry,
  getBBox, BBOXES, COUNTRY_NAMES, ALPHABET,
} from "./codec.js?v=110";
import { t, getLang, setLang, applyStaticI18n } from "./i18n.js?v=110";

/* ── Preferences (localStorage) ───────────────────────────── */
const PREF_KEY = "geo7-prefs";

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; }
  catch { return {}; }
}
function savePrefs(prefs) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {}
}
function prefSet(key, value) {
  const prefs = loadPrefs();
  prefs[key] = value;
  savePrefs(prefs);
}

/* ── App state ────────────────────────────────────────────── */
const state = {
  view: null,            // resolved | offline | notfound | empty | mine
  location: null,        // { lat, lon, country, code, title, region, coords, note }
  remember: !!loadPrefs().remember,
  navProvider: loadPrefs().navProvider === "waze" ? "waze" : "google",
  installDismissed: !!loadPrefs().installDismissed,
};

// Default country for cold-open manual entry / launcher prefix.
let currentCountry = (loadPrefs().country && BBOXES[loadPrefs().country]) ? loadPrefs().country : "CR";

const NOTE_MAX = 80;
const isStandalone =
  window.matchMedia?.("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;
let deferredInstallPrompt = null;

/* ── Map / pin ────────────────────────────────────────────── */
let map, marker;

// Base layers: street map (default) and satellite imagery (Esri) with
// reference overlays (labels + roads) drawn above the imagery.
const layers = {
  map: L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    { maxZoom: 20, attribution: "© OpenStreetMap © CARTO", subdomains: "abcd" }
  ),
  satellite: L.layerGroup([
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "© Esri, Maxar, Earthstar Geographics" }
    ),
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, pane: "reference" }
    ),
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, pane: "reference" }
    ),
  ]),
};
let activeLayer = "map";
let activeLayerObj = layers.map;

function syncLayerToggle() {
  document.getElementById("layer-toggle")?.classList.toggle("active", activeLayer === "satellite");
}
function toggleLayer() {
  map.removeLayer(activeLayerObj);
  activeLayer = activeLayer === "map" ? "satellite" : "map";
  activeLayerObj = layers[activeLayer];
  activeLayerObj.addTo(map);
  prefSet("layer", activeLayer);
  syncLayerToggle();
}

function initMap() {
  map = L.map("map", { zoomControl: false, attributionControl: true })
    .setView([9.7, -84.0], 8);

  // Pane for satellite reference overlays (labels/roads), above the imagery tiles.
  map.createPane("reference");
  map.getPane("reference").style.zIndex = 250;

  // Restore the saved base layer.
  if (loadPrefs().layer === "satellite") {
    activeLayer = "satellite";
    activeLayerObj = layers.satellite;
  }
  activeLayerObj.addTo(map);
  syncLayerToggle();

  // Google-Maps-style interaction: left-click selects a point; right-click opens a menu.
  map.on("click", (e) => {
    if (!entryOverlay.hidden || !handoffOverlay.hidden) return;
    hideContextMenu();
    selectPoint(e.latlng.lat, e.latlng.lng, { source: "map", fly: false });
  });
  map.on("contextmenu", (e) => {
    if (!entryOverlay.hidden || !handoffOverlay.hidden) return;
    if (e.originalEvent) e.originalEvent.preventDefault();
    openContextMenu(e.latlng.lat, e.latlng.lng, e.containerPoint.x, e.containerPoint.y);
  });
  map.on("movestart", hideContextMenu);
}

function pinIcon() {
  return L.divIcon({
    className: "",
    html:
      '<div class="g7-pin">' +
        '<div class="g7-pin-halo"></div>' +
        '<div class="g7-pin-body"><div class="g7-pin-dot"></div></div>' +
      "</div>",
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function setPin(lat, lon, { fly = true, zoom = 16 } = {}) {
  if (marker) map.removeLayer(marker);
  marker = L.marker([lat, lon], { icon: pinIcon() }).addTo(map);
  if (fly) map.setView([lat, lon], zoom, { animate: true });
}

function clearPin() {
  if (marker) { map.removeLayer(marker); marker = null; }
}

/* ── Geo helpers ──────────────────────────────────────────── */

// Valid only if every char is in the alphabet AND length === required length.
function getGeoCodeParts(text, fallbackCountry = currentCountry) {
  const raw = (text || "").trim();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, "");
  const parts = compact.includes("/") ? compact.split("/") : [fallbackCountry, compact];
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const country = parts[0].toUpperCase();
  const code = parts[1].toLowerCase();
  if (!BBOXES[country]) return null;
  if ([...code].some((ch) => !ALPHABET.includes(ch))) return null;
  const expected = estimatePrecision(country)?.numChars;
  if (expected && code.length !== expected) return null;
  return { country, code };
}

function resolveGeoCode(text, fallbackCountry = currentCountry) {
  const parts = getGeoCodeParts(text, fallbackCountry);
  if (!parts) return null;
  try {
    const { lat, lon } = decode(parts.code, parts.country);
    return { lat, lon, country: parts.country, code: parts.code };
  } catch {
    return null;
  }
}

function precisionMeters(country) {
  const p = estimatePrecision(country);
  if (!p) return null;
  return Math.round(Math.max(p.latM, p.lonM));
}

function coordsString(lat, lon) {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

// Reverse-geocode to { title, region }. Throws on failure (→ Offline view).
async function reverseGeocodePlace(lat, lon) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1`,
    { headers: { "Accept-Language": getLang() } }
  );
  if (!res.ok) throw new Error("reverse geocode failed");
  const data = await res.json();
  const full = data?.display_name || "";
  const name = (data?.name || "").trim();
  if (!full && !name) throw new Error("no place name");
  const segs = full.split(",").map((s) => s.trim()).filter(Boolean);
  let title, region;
  if (name) {
    title = name;
    region = segs.filter((s) => s !== name).slice(0, 3).join(", ");
  } else {
    title = segs[0] || "Pinned location";
    region = segs.slice(1, 4).join(", ");
  }
  return { title, region };
}

/* ── Link parsing / building ──────────────────────────────── */

// Reads ?c, ?code, ?n from a URL search string. Returns a location or null.
function parseSharedLink(search = location.search) {
  let params;
  try { params = new URLSearchParams(search); } catch { return null; }
  const code = params.get("code");
  if (!code) return null;
  const country = (params.get("c") || currentCountry).toUpperCase();
  const resolved = resolveGeoCode(`${country}/${code}`, country);
  if (!resolved) return null;
  let note = params.get("n");
  if (note != null) {
    note = note.slice(0, NOTE_MAX).trim();
    if (!note) note = null;
  }
  return { ...resolved, note: note || null };
}

// The full URL that gets shared/copied (works wherever the app is hosted).
function buildShareUrl({ country, code, note }) {
  const url = new URL(location.origin + location.pathname);
  url.search = "";
  url.searchParams.set("c", country);
  url.searchParams.set("code", code);
  if (note) url.searchParams.set("n", note.slice(0, NOTE_MAX));
  return url.toString();
}

// Human-readable host+path form for display (no scheme).
function displayShareUrl(shareUrl) {
  try {
    const u = new URL(shareUrl);
    return u.host + u.pathname.replace(/index\.html$/, "") + u.search;
  } catch {
    return shareUrl;
  }
}

// Handoff deep links — destination only (no origin, stops, mode, or avoids).
function googleDirectionsUrl(lat, lon) {
  // travelmode omitted on purpose so Google asks / uses last choice.
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}
function wazeUrl(lat, lon) {
  return `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;
}
function webMapsUrl(lat, lon) {
  // Always renders in-browser.
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

/* ── DOM refs ─────────────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const views = {
  resolved: $("#view-resolved"),
  offline: $("#view-offline"),
  notfound: $("#view-notfound"),
  empty: $("#view-empty"),
  mine: $("#view-mine"),
  selected: $("#view-selected"),
};
const entryOverlay = $("#entry-overlay");
const handoffOverlay = $("#handoff-overlay");
const codeInput = $("#code-input");

/* ── View switching ───────────────────────────────────────── */
function setCodePrefixes(country) {
  document.querySelectorAll("[data-code-prefix]").forEach((el) => {
    el.textContent = country;
  });
}

function showView(name) {
  state.view = name;
  for (const [key, el] of Object.entries(views)) {
    el.hidden = key !== name;
  }
  // Re-trigger entrance animation on the visible view.
  const el = views[name];
  if (el) { el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; }
  // New content should always be visible — pop the sheet back up if minimized.
  expandSheet();
}

function renderResolved(loc) {
  state.location = loc;
  setCodePrefixes(loc.country);
  $("#res-code").textContent = loc.code;
  $("#res-title").textContent = loc.title || "";
  $("#res-title").hidden = !loc.title;
  $("#res-region").textContent = loc.region || "";
  $("#res-region").hidden = !loc.region;
  const noteEl = $("#res-note");
  if (loc.note) {
    $("#res-note-text").textContent = `“${loc.note}”`;
    noteEl.hidden = false;
  } else {
    noteEl.hidden = true;
  }
  const m = precisionMeters(loc.country);
  $("#res-precision").textContent = t("precision_full", { m, coords: loc.coords });
  setPin(loc.lat, loc.lon);
  showView("resolved");
}

function renderOffline(loc) {
  state.location = loc;
  setCodePrefixes(loc.country);
  $("#off-code").textContent = loc.code;
  $("#off-explainer").textContent = t("offline_explainer", { coords: loc.coords });
  setPin(loc.lat, loc.lon);
  showView("offline");
}

function renderNotFound() {
  state.location = null;
  clearPin();
  showView("notfound");
}

function renderEmpty() {
  state.location = null;
  setCodePrefixes(currentCountry);
  clearPin();
  showView("empty");
}

/* ── Resolve a location object + reverse geocode ──────────── */
async function resolveAndShow(resolved, note = null) {
  const loc = {
    lat: resolved.lat,
    lon: resolved.lon,
    country: resolved.country,
    code: resolved.code,
    coords: coordsString(resolved.lat, resolved.lon),
    note: note || null,
    title: "",
    region: "",
  };
  currentCountry = loc.country;

  // Render immediately — the handoff works without a place name.
  if (navigator.onLine === false) {
    renderOffline(loc);
    return;
  }
  renderResolved(loc); // optimistic; title/region fill in async
  try {
    const { title, region } = await reverseGeocodePlace(loc.lat, loc.lon);
    // Only apply if still the active location.
    if (state.location && state.location.code === loc.code && state.view === "resolved") {
      loc.title = title;
      loc.region = region;
      renderResolved(loc);
    }
  } catch {
    if (state.location && state.location.code === loc.code) {
      renderOffline(loc);
    }
  }
}

/* ── Generator (mine) path ────────────────────────────────── */
const mineState = { lat: null, lon: null, country: null, code: null, label: "" };

function renderMineLink() {
  const note = mineState.label.trim().slice(0, NOTE_MAX);
  const shareUrl = buildShareUrl({ country: mineState.country, code: mineState.code, note });
  mineState.shareUrl = shareUrl;
  $("#mine-link").textContent = displayShareUrl(shareUrl);
}

async function enterGenerator() {
  if (!navigator.geolocation) {
    showToast(t("toast_loc_unavailable"));
    return;
  }
  showToast(t("toast_locating"));
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const country = detectCountry(lat, lon);
      if (!country) {
        showToast(t("toast_outside_area"));
        return;
      }
      let enc;
      try { enc = encode(lat, lon, country); }
      catch { showToast(t("toast_cant_code_here")); return; }

      mineState.lat = lat;
      mineState.lon = lon;
      mineState.country = country;
      mineState.code = enc.code;
      mineState.label = "";
      currentCountry = country;

      setCodePrefixes(country);
      $("#mine-code").textContent = enc.code;
      mineNoteMgr?.reset();
      const m = precisionMeters(country);
      $("#mine-meta").textContent = t("precision_meta", { m });
      renderMineLink();
      setPin(lat, lon);
      showView("mine");
      updateInstallNudge();

      // Enrich meta with a place name when possible.
      try {
        const { title } = await reverseGeocodePlace(lat, lon);
        if (state.view === "mine" && title) {
          $("#mine-meta").textContent = t("precision_meta_title", { title, m });
        }
      } catch {}
    },
    () => showToast(t("toast_enable_share")),
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

/* ── Install nudge ────────────────────────────────────────── */
function updateInstallNudge() {
  const show =
    state.view === "mine" &&
    deferredInstallPrompt &&
    !isStandalone &&
    !state.installDismissed;
  $("#install-nudge").hidden = !show;
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  updateInstallNudge();
});

/* ── Code entry overlay ───────────────────────────────────── */
// Populate the manual-entry region picker once (every supported region).
const entryRegion = $("#entry-region");
if (entryRegion) {
  entryRegion.innerHTML = Object.keys(BBOXES).sort()
    .map((k) => `<option value="${k}">${k}${COUNTRY_NAMES[k] ? " — " + escapeHtml(COUNTRY_NAMES[k]) : ""}</option>`)
    .join("");
  entryRegion.addEventListener("change", () => {
    currentCountry = entryRegion.value;
    setCodePrefixes(currentCountry);
    codeInput.maxLength = estimatePrecision(currentCountry)?.numChars || 6;
    setEntryError("");
    codeInput.focus();
  });
}

function openEntry() {
  state.codeError = "";
  setCodePrefixes(currentCountry);
  if (entryRegion) entryRegion.value = currentCountry;
  const req = estimatePrecision(currentCountry)?.numChars || 6;
  codeInput.maxLength = req;
  codeInput.value = "";
  setEntryError("");
  entryOverlay.hidden = false;
  // Focus inside a frame so the mobile keyboard reliably opens.
  requestAnimationFrame(() => setTimeout(() => codeInput.focus(), 60));
}
function closeEntry() {
  entryOverlay.hidden = true;
  setEntryError("");
}
function setEntryError(msg) {
  const errEl = $("#entry-error");
  const helpEl = $("#entry-helper");
  const row = $("#entry-input-row");
  if (msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
    helpEl.hidden = true;
    row.classList.add("error");
  } else {
    errEl.hidden = true;
    helpEl.hidden = false;
    row.classList.remove("error");
  }
}

codeInput.addEventListener("input", (e) => {
  const raw = (e.target.value || "").toLowerCase();
  if (raw !== e.target.value) e.target.value = raw;
  const req = estimatePrecision(currentCountry)?.numChars || 6;
  if ([...raw].some((ch) => !ALPHABET.includes(ch))) {
    setEntryError(t("entry_err_chars"));
    return;
  }
  setEntryError("");
  if (raw.length >= req) {
    const resolved = resolveGeoCode(`${currentCountry}/${raw}`, currentCountry);
    if (resolved) {
      closeEntry();
      resolveAndShow(resolved);
    } else {
      setEntryError(t("entry_err_invalid"));
    }
  }
});

/* ── Handoff overlay ──────────────────────────────────────── */
function openHandoff() {
  const loc = state.location;
  if (!loc) return;
  // Remembered choice → skip straight to the provider.
  if (state.remember && loadPrefs().navProvider) {
    handoff(loadPrefs().navProvider);
    return;
  }
  $("#handoff-title-text").textContent = loc.title || `${loc.country}/${loc.code}`;
  $("#handoff-code-text").textContent = t("dest_set", { code: `${loc.country}/${loc.code}` });
  syncRememberUI();
  syncProviderDefault();
  handoffOverlay.hidden = false;
}
function closeHandoff() { handoffOverlay.hidden = true; }

function syncRememberUI() {
  $("#remember-toggle").classList.toggle("on", state.remember);
}
function syncProviderDefault() {
  const google = handoffOverlay.querySelector('[data-action="pick-google"]');
  const waze = handoffOverlay.querySelector('[data-action="pick-waze"]');
  const def = state.navProvider;
  google.classList.toggle("provider-card-default", def === "google");
  waze.classList.toggle("provider-card-default", def === "waze");
  google.querySelector(".provider-default-tag")?.toggleAttribute("hidden", def !== "google");
  let wazeTag = waze.querySelector(".provider-default-tag");
  if (def === "waze") {
    if (!wazeTag) {
      wazeTag = document.createElement("span");
      wazeTag.className = "provider-default-tag";
      wazeTag.textContent = t("default");
      waze.prepend(wazeTag);
    }
    wazeTag.hidden = false;
  } else if (wazeTag) {
    wazeTag.hidden = true;
  }
}

function handoff(provider) {
  const loc = state.location;
  if (!loc) return;
  if (state.remember) {
    state.navProvider = provider === "waze" ? "waze" : "google";
    prefSet("navProvider", state.navProvider);
    prefSet("remember", true);
  }
  closeHandoff();
  let url, label;
  if (provider === "waze") { url = wazeUrl(loc.lat, loc.lon); label = t("toast_opening_waze"); }
  else if (provider === "web") { url = webMapsUrl(loc.lat, loc.lon); label = t("toast_opening_web"); }
  else { url = googleDirectionsUrl(loc.lat, loc.lon); label = t("toast_opening_google"); }
  showToast(label);
  location.href = url;
}

/* ── Share / copy ─────────────────────────────────────────── */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

async function shareMineLink() {
  const url = mineState.shareUrl;
  if (!url) return;
  if (navigator.share) {
    try { await navigator.share({ title: t("share_title"), url }); return; }
    catch { /* user cancelled or unsupported → fall through */ }
  }
  const ok = await copyText(url);
  showToast(ok ? t("toast_link_copied") : t("toast_cant_copy_link"));
}

/* ── Toast ────────────────────────────────────────────────── */
let toastTimer;
function showToast(msg) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("visible"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove("visible");
    setTimeout(() => t.remove(), 300);
  }, 1700);
}

/* ── Selected point (map tap / search result) ─────────────── */
function setAddressInput(text) {
  const input = $("#address-input");
  input.value = text || "";
  $("#address-clear").hidden = !input.value;
}

function currentShareUrl() {
  const loc = state.location;
  if (!loc) return "";
  return buildShareUrl({ country: loc.country, code: loc.code, note: loc.note });
}

async function shareCurrentPlace() {
  const url = currentShareUrl();
  if (!url) return;
  if (navigator.share) {
    try { await navigator.share({ title: t("share_title"), url }); return; }
    catch { /* cancelled / unsupported → fall through to copy */ }
  }
  const ok = await copyText(url);
  showToast(ok ? t("toast_link_copied") : t("toast_cant_copy_link"));
}

// Select an arbitrary point: encode it, drop a pin, reverse-geocode, show it.
async function selectPoint(lat, lon, { source = "map", fly = false } = {}) {
  const country = detectCountry(lat, lon);
  if (!country) { showToast(t("toast_spot_unsupported")); return; }
  let enc;
  try { enc = encode(lat, lon, country); }
  catch { showToast(t("toast_cant_code_there")); return; }

  currentCountry = country;
  const loc = {
    lat, lon, country, code: enc.code,
    coords: coordsString(lat, lon),
    title: "", region: "", note: null,
  };
  state.location = loc;

  setCodePrefixes(country);
  $("#sel-code").textContent = enc.code;
  $("#sel-kicker").textContent =
    source === "search" ? t("search_result") : source === "gps" ? t("your_location") : t("dropped_pin");
  $("#sel-title").textContent = loc.coords;
  $("#sel-title").hidden = false;
  $("#sel-region").hidden = true;
  $("#sel-precision").textContent =
    t("precision_full", { m: precisionMeters(country), coords: loc.coords });
  setPin(lat, lon, { fly, zoom: Math.max(map.getZoom(), 15) });
  selNoteMgr?.reset();
  showView("selected");

  try {
    const { title, region } = await reverseGeocodePlace(lat, lon);
    if (state.location === loc) {
      loc.title = title;
      loc.region = region;
      $("#sel-title").textContent = title || loc.coords;
      $("#sel-region").textContent = region || "";
      $("#sel-region").hidden = !region;
      setAddressInput([title, region].filter(Boolean).join(", "));
    }
  } catch { /* keep coords as the title */ }
}

/* ── Right-click context menu (Google-Maps style) ─────────── */
let ctxPoint = null;
function openContextMenu(lat, lon, x, y) {
  ctxPoint = { lat, lon };
  const menu = $("#context-menu");
  menu.innerHTML =
    `<button class="ctx-coords" data-ctx="copy-coords">${coordsString(lat, lon)}</button>` +
    `<button class="ctx-item" data-ctx="whats-here">${t("whats_here")}</button>` +
    `<button class="ctx-item" data-ctx="directions">${t("directions_here")}</button>` +
    `<button class="ctx-item" data-ctx="share">${t("share_location")}</button>` +
    `<button class="ctx-item" data-ctx="copy-code">${t("copy_code")}</button>`;
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  const mw = rect.width || 210, mh = rect.height || 230;
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - mw - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - mh - 8)) + "px";
}
function hideContextMenu() {
  const m = $("#context-menu");
  if (m && !m.hidden) m.hidden = true;
}

$("#context-menu").addEventListener("click", async (e) => {
  const item = e.target.closest("[data-ctx]");
  if (!item || !ctxPoint) return;
  const { lat, lon } = ctxPoint;
  const act = item.dataset.ctx;
  hideContextMenu();
  if (act === "copy-coords") {
    const ok = await copyText(coordsString(lat, lon));
    showToast(ok ? t("toast_coords_copied") : t("toast_cant_copy"));
  } else if (act === "whats-here") {
    selectPoint(lat, lon, { source: "map" });
  } else if (act === "directions") {
    selectPoint(lat, lon, { source: "map" });
    openHandoff();
  } else if (act === "share") {
    selectPoint(lat, lon, { source: "map" });
    shareCurrentPlace();
  } else if (act === "copy-code") {
    const country = detectCountry(lat, lon);
    if (!country) { showToast(t("toast_outside_supported")); return; }
    try {
      const enc = encode(lat, lon, country);
      const ok = await copyText(`${country}/${enc.code}`);
      showToast(ok ? t("toast_code_copied") : t("toast_cant_copy"));
    } catch { showToast(t("toast_cant_code_there")); }
  }
});

/* ── Place search (Nominatim) ─────────────────────────────── */
let searchTimer, searchSeq = 0;
function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function hideSearchResults() {
  const r = $("#search-results");
  r.hidden = true;
  r.innerHTML = "";
}
async function runSearch(q) {
  const seq = ++searchSeq;
  let url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
  try {
    const b = map.getBounds();
    url += `&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}`;
  } catch {}
  try {
    const res = await fetch(url, { headers: { "Accept-Language": getLang() } });
    if (!res.ok || seq !== searchSeq) return;
    const data = await res.json();
    if (seq !== searchSeq) return;
    renderSearchResults(Array.isArray(data) ? data : []);
  } catch { /* ignore */ }
}
function renderSearchResults(items) {
  const r = $("#search-results");
  if (!items.length) { hideSearchResults(); return; }
  r.innerHTML = items.map((it) => {
    const dn = it.display_name || "";
    const name = dn.split(",")[0];
    const rest = dn.split(",").slice(1).join(",").trim();
    return `<button class="search-result" data-result data-lat="${it.lat}" data-lon="${it.lon}">` +
      `<span class="sr-name">${escapeHtml(name)}</span>` +
      `<span class="sr-detail">${escapeHtml(rest)}</span></button>`;
  }).join("");
  r.hidden = false;
}

const addressInput = $("#address-input");
addressInput.addEventListener("input", () => {
  const q = addressInput.value.trim();
  $("#address-clear").hidden = !q;
  clearTimeout(searchTimer);
  if (q.length < 3) { hideSearchResults(); return; }
  searchTimer = setTimeout(() => runSearch(q), 350);
});
addressInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const first = $("#search-results").querySelector("[data-result]");
    if (first) first.click();
  } else if (e.key === "Escape") {
    hideSearchResults();
    addressInput.blur();
  }
});
$("#address-clear").addEventListener("click", () => {
  setAddressInput("");
  hideSearchResults();
  addressInput.focus();
});
$("#search-results").addEventListener("click", (e) => {
  const r = e.target.closest("[data-result]");
  if (!r) return;
  const lat = parseFloat(r.dataset.lat), lon = parseFloat(r.dataset.lon);
  hideSearchResults();
  addressInput.blur();
  selectPoint(lat, lon, { source: "search", fly: true });
});

// Dismiss menu / results on outside interaction.
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest("#context-menu")) hideContextMenu();
  if (!e.target.closest("#search-results") && !e.target.closest(".search-bar")) hideSearchResults();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideContextMenu();
});

/* ── Action delegation ────────────────────────────────────── */
const actions = {
  clear: () => renderEmpty(),
  "get-directions": () => openHandoff(),
  "open-entry": () => openEntry(),
  "close-entry": () => closeEntry(),
  "share-mine": () => enterGenerator(),
  "close-handoff": () => closeHandoff(),
  "pick-google": () => handoff("google"),
  "pick-waze": () => handoff("waze"),
  "pick-web": () => handoff("web"),
  "toggle-remember": () => {
    state.remember = !state.remember;
    prefSet("remember", state.remember);
    syncRememberUI();
  },
  "share-selected": () => shareCurrentPlace(),
  "copy-code-selected": async () => {
    const loc = state.location;
    if (!loc) return;
    const ok = await copyText(`${loc.country}/${loc.code}`);
    showToast(ok ? t("toast_code_copied") : t("toast_cant_copy"));
  },
  "share-link": () => shareMineLink(),
  "copy-link": async () => {
    const ok = await copyText(mineState.shareUrl || "");
    showToast(ok ? t("toast_link_copied") : t("toast_cant_copy"));
  },
  "copy-code": async () => {
    const ok = await copyText(`${mineState.country}/${mineState.code}`);
    showToast(ok ? t("toast_code_copied") : t("toast_cant_copy"));
  },
  install: async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    try { await deferredInstallPrompt.userChoice; } catch {}
    deferredInstallPrompt = null;
    state.installDismissed = true;
    prefSet("installDismissed", true);
    updateInstallNudge();
  },
  "dismiss-install": () => {
    state.installDismissed = true;
    prefSet("installDismissed", true);
    updateInstallNudge();
  },
};

document.addEventListener("click", (e) => {
  const target = e.target.closest("[data-action]");
  if (!target) return;
  const fn = actions[target.dataset.action];
  if (fn) { e.preventDefault(); fn(target); }
});

// "Locate me": fetch GPS and select the user's current point (drop a pin + code).
function locateMe() {
  if (!navigator.geolocation) { showToast(t("toast_loc_unavailable")); return; }
  showToast(t("toast_locating"));
  navigator.geolocation.getCurrentPosition(
    (pos) => selectPoint(pos.coords.latitude, pos.coords.longitude, { source: "gps", fly: true }),
    () => showToast(t("toast_enable_use")),
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// Crosshair button: recenter on the active pin if there is one, otherwise locate the user.
$("#recenter-btn").addEventListener("click", () => {
  const loc = state.location || (mineState.lat != null ? mineState : null);
  if (loc && loc.lat != null) { map.setView([loc.lat, loc.lon], 16, { animate: true }); return; }
  locateMe();
});

$("#layer-toggle").addEventListener("click", toggleLayer);

/* ── Collapsible bottom sheet (drag/tap the handle) ───────── */
const sheet = $("#sheet");
const sheetHandle = sheet.querySelector(".grab-handle");
const SHEET_PEEK = 34; // px of the sheet that stays visible when minimized
let sheetCollapsed = false;
let sheetDrag = null;

function collapsedTranslate() {
  return Math.max(0, sheet.offsetHeight - SHEET_PEEK);
}
function applySheet(collapsed, animate = true) {
  sheetCollapsed = collapsed;
  sheet.style.transition = animate ? "transform .3s cubic-bezier(.2,.8,.2,1)" : "none";
  sheet.style.transform = collapsed ? `translateY(${collapsedTranslate()}px)` : "translateY(0)";
  sheet.classList.toggle("sheet-collapsed", collapsed);
}
function expandSheet() { if (sheetCollapsed) applySheet(false); }

sheetHandle.addEventListener("pointerdown", (e) => {
  sheetDrag = { startY: e.clientY, base: sheetCollapsed ? collapsedTranslate() : 0, moved: false };
  sheet.style.transition = "none";
  sheetHandle.setPointerCapture?.(e.pointerId);
});
sheetHandle.addEventListener("pointermove", (e) => {
  if (!sheetDrag) return;
  const dy = e.clientY - sheetDrag.startY;
  if (Math.abs(dy) > 5) sheetDrag.moved = true;
  const t = Math.min(collapsedTranslate(), Math.max(0, sheetDrag.base + dy));
  sheet.style.transform = `translateY(${t}px)`;
});
function endSheetDrag(e) {
  if (!sheetDrag) return;
  const dy = (e.clientY ?? sheetDrag.startY) - sheetDrag.startY;
  const moved = sheetDrag.moved;
  sheetDrag = null;
  if (!moved) { applySheet(!sheetCollapsed); return; } // tap → toggle
  if (dy > 40) applySheet(true);          // dragged down → minimize
  else if (dy < -40) applySheet(false);   // dragged up → expand
  else applySheet(sheetCollapsed);        // small drag → snap back
}
sheetHandle.addEventListener("pointerup", endSheetDrag);
sheetHandle.addEventListener("pointercancel", endSheetDrag);
window.addEventListener("resize", () => { if (sheetCollapsed) applySheet(true, false); });

/* ── On-device private note manager (Phase 1, serverless) ──── */
const NOTES_KEY = "geo7-notes";
function loadSavedNotes() {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || []; } catch { return []; }
}
function persistSavedNotes(arr) {
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(arr.slice(0, 12))); } catch {}
}
function mountNoteManager(container, onChange) {
  if (!container) return null;
  container.innerHTML =
    '<div class="note-mgr-tag">' + t("note_tag") + '</div>' +
    '<input class="note-mgr-input" type="text" maxlength="80" autocomplete="off" ' +
      'placeholder="' + t("note_ph") + '">' +
    '<div class="note-mgr-chips"></div>' +
    '<div class="note-mgr-row">' +
      '<button type="button" class="note-mgr-save">' + t("note_save") + '</button>' +
      '<span class="note-mgr-help">' + t("note_help") + '</span>' +
    '</div>';
  const input = container.querySelector(".note-mgr-input");
  const chips = container.querySelector(".note-mgr-chips");
  const saveBtn = container.querySelector(".note-mgr-save");
  const emit = () => onChange(input.value.trim().slice(0, NOTE_MAX));
  function renderChips() {
    const notes = loadSavedNotes();
    chips.innerHTML = notes.map((n) => {
      const short = n.body.length > 22 ? n.body.slice(0, 22) + "…" : n.body;
      return '<span class="note-chip">' +
        '<button type="button" class="note-chip-apply" data-id="' + n.id + '">' + escapeHtml(short) + '</button>' +
        '<button type="button" class="note-chip-del" data-id="' + n.id + '" aria-label="' + t("note_del_aria") + '">×</button>' +
        '</span>';
    }).join("");
  }
  input.addEventListener("input", emit);
  saveBtn.addEventListener("click", () => {
    const body = input.value.trim().slice(0, NOTE_MAX);
    if (!body) { showToast(t("toast_type_note")); return; }
    const notes = loadSavedNotes();
    if (notes.some((n) => n.body === body)) { showToast(t("toast_already_saved")); return; }
    notes.unshift({ id: Date.now().toString(36), body });
    persistSavedNotes(notes);
    renderChips();
    showToast(t("toast_note_saved"));
  });
  chips.addEventListener("click", (e) => {
    const apply = e.target.closest(".note-chip-apply");
    const del = e.target.closest(".note-chip-del");
    if (apply) {
      const found = loadSavedNotes().find((n) => n.id === apply.dataset.id);
      input.value = found ? found.body : "";
      emit();
    } else if (del) {
      persistSavedNotes(loadSavedNotes().filter((n) => n.id !== del.dataset.id));
      renderChips();
    }
  });
  renderChips();
  return {
    reset() { input.value = ""; onChange(""); renderChips(); },
    refresh: renderChips,
  };
}

const mineNoteMgr = mountNoteManager($("#mine-note-manager"), (text) => {
  mineState.label = text;
  renderMineLink();
});
const selNoteMgr = mountNoteManager($("#sel-note-manager"), (text) => {
  if (state.location) state.location.note = text || null;
});

/* ── Boot ─────────────────────────────────────────────────── */
// Feedback form: prefill the Language field so each response is tagged EN/ES.
const FEEDBACK_FORM = "https://docs.google.com/forms/d/e/1FAIpQLScSTHqOez8d1PPQreTF_gBXByykyI7-F0_3-IPTBUsxnNodMw/viewform?usp=pp_url&entry.523853697=";
function setFeedbackLinks() {
  const val = encodeURIComponent(getLang() === "es" ? "Español" : "English");
  document.querySelectorAll("a.feedback-link").forEach((a) => { a.href = FEEDBACK_FORM + val; });
}

function boot() {
  applyStaticI18n();
  setFeedbackLinks();
  initMap();

  const fromLink = parseSharedLink(location.search);
  if (fromLink) {
    resolveAndShow(fromLink, fromLink.note);
    return;
  }

  // A code param that didn't resolve → broken/expired/unsupported.
  const hasCodeParam = new URLSearchParams(location.search).get("code");
  if (hasCodeParam) {
    renderNotFound();
    return;
  }

  // No link → cold open.
  renderEmpty();
}

boot();

/* ── Service Worker ───────────────────────────────────────── */
// Production registers the SW for offline/PWA support. On localhost we skip it
// and tear down any existing registration + caches, so local development never
// serves stale assets (no need to toggle DevTools "Bypass for network").
const IS_LOCAL_DEV = ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname);
if ("serviceWorker" in navigator) {
  if (IS_LOCAL_DEV) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {});
    if (window.caches) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
    }
  } else {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

// Exposed for debugging / tests.
window.__geo7 = {
  state, resolveAndShow, resolveGeoCode, parseSharedLink, buildShareUrl,
  googleDirectionsUrl, wazeUrl, webMapsUrl, showView, renderNotFound, renderEmpty,
};
